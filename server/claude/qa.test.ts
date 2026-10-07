import { afterEach, describe, expect, it } from "vitest";
import type { AskQuestionRequest, QaStreamEvent } from "@shared/api";
import { chunksRepo, claudeRunsRepo, questionsRepo, reviewsRepo, settingsRepo } from "../db/repositories";
import { HttpError } from "../lib/errors";
import { createTestContext, type TestContextHandle } from "../test/context";
import { runChunking } from "./chunking";
import { ClaudeRunError } from "./errors";
import { askQuestion } from "./qa";
import { createScriptedRunner, seedReviewWithHunks } from "./test-support";

const request = (overrides: Partial<AskQuestionRequest> = {}): AskQuestionRequest => ({
  chunkId: null,
  filePath: "src/a.ts",
  startLine: 3,
  endLine: 5,
  selectedText: "const x = 1;",
  question: "Why is this needed?",
  useOpus: false,
  ...overrides,
});

const collect = async (stream: AsyncIterable<QaStreamEvent>): Promise<readonly QaStreamEvent[]> => {
  const events: QaStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

describe("askQuestion", () => {
  let handle: TestContextHandle | undefined;
  afterEach(() => handle?.close());

  it("saves the question, streams deltas, saves the answer and starts a session", async () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review } = seedReviewWithHunks(ctx, ["src/a.ts"]);

    const events = await collect(askQuestion(ctx, review.id, request(), new AbortController().signal));

    expect(events[0]?.type).toBe("question");
    expect(events.filter((event) => event.type === "delta").length).toBeGreaterThan(1);
    const done = events[events.length - 1];
    if (done?.type !== "done") throw new Error("expected done");
    expect(done.question.answer).toBe("This is a fake answer from the fake Claude runner.");
    expect(done.question.headSha).toBe(review.headSha);
    expect(done.question.model).toBe(settingsRepo.getSettings(ctx.db).models.qa);
    expect(questionsRepo.listQuestions(ctx.db, review.id)[0]?.answer).toBe(done.question.answer);
    expect(reviewsRepo.requireReview(ctx.db, review.id).qaSessionId).toMatch(/^fake-session-/);
    expect(claudeRunsRepo.getLatestRun(ctx.db, review.id, "qa")).toMatchObject({ status: "succeeded", kind: "qa" });
  });

  it("resumes the stored session on the next question and only sends the preamble once", async () => {
    const runner = createScriptedRunner([], (req) => [
      { type: "text", text: "Answer" },
      { type: "done", sessionId: req.resumeSessionId ?? "session-1", resultText: "Answer", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.5 } },
    ]);
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review } = seedReviewWithHunks(ctx, ["src/a.ts"]);

    await collect(askQuestion(ctx, review.id, request(), new AbortController().signal));
    await collect(askQuestion(ctx, review.id, request({ question: "And this?", useOpus: true }), new AbortController().signal));

    expect(runner.streamingRequests.map((req) => req.resumeSessionId)).toEqual([null, "session-1"]);
    expect(runner.streamingRequests[0]?.prompt).toContain("You are answering a reviewer's questions");
    expect(runner.streamingRequests[1]?.prompt).not.toContain("You are answering a reviewer's questions");
    expect(runner.streamingRequests[1]?.prompt).toContain("And this?");
    expect(runner.streamingRequests[1]?.model).toBe(settingsRepo.getSettings(ctx.db).models.qaOpus);
    const runs = claudeRunsRepo.listRuns(ctx.db, review.id).filter((run) => run.kind === "qa");
    expect(runs.map((run) => run.costUsd).sort()).toEqual([0, 0.5]);
  });

  it("starts a new session when resuming fails before any text arrives", async () => {
    const runner = createScriptedRunner([], (req) => {
      if (req.resumeSessionId !== null) throw new ClaudeRunError("No conversation found");
      return [{ type: "done", sessionId: "fresh", resultText: "Hi", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } }];
    });
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review } = seedReviewWithHunks(ctx, ["src/a.ts"]);
    reviewsRepo.updateReview(ctx.db, review.id, { qaSessionId: "stale" });

    const events = await collect(askQuestion(ctx, review.id, request(), new AbortController().signal));

    expect(events[events.length - 1]?.type).toBe("done");
    expect(runner.streamingRequests.map((req) => req.resumeSessionId)).toEqual(["stale", null]);
    expect(reviewsRepo.requireReview(ctx.db, review.id).qaSessionId).toBe("fresh");
  });

  it("yields an error and logs a failed run when Claude fails", async () => {
    const runner = createScriptedRunner([], () => {
      throw new ClaudeRunError("gateway down");
    });
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review } = seedReviewWithHunks(ctx, ["src/a.ts"]);

    const events = await collect(askQuestion(ctx, review.id, request(), new AbortController().signal));

    expect(events.map((event) => event.type)).toEqual(["question", "error"]);
    const last = events[1];
    if (last?.type === "error") expect(last.message).toContain("gateway down");
    expect(claudeRunsRepo.getLatestRun(ctx.db, review.id, "qa")).toMatchObject({ status: "failed" });
    expect(questionsRepo.listQuestions(ctx.db, review.id)[0]?.answer).toBeNull();
  });

  it("includes the chunk's hunks in the prompt when asked from a chunk", async () => {
    const runner = createScriptedRunner([], () => [
      { type: "done", sessionId: "s", resultText: "ok", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } },
    ]);
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review, round, hunks } = seedReviewWithHunks(ctx, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    reviewsRepo.updateReview(ctx.db, review.id, { worktreePath: ctx.config.home });
    const scripted = createScriptedRunner([{ output: { chunks: [{ title: "First", explanation: "E", kind: "core", hunkIds: [hunks[0]?.id] }] } }]);
    await runChunking({ ...ctx, claude: scripted }, { reviewId: review.id, roundId: round.id });
    const chunk = chunksRepo.listChunks(ctx.db, review.id)[0];
    if (chunk === undefined) throw new Error("expected a chunk");

    await collect(askQuestion(ctx, review.id, request({ chunkId: chunk.id }), new AbortController().signal));

    const prompt = runner.streamingRequests[0]?.prompt ?? "";
    expect(prompt).toContain('chunk "First"');
    expect(prompt).toContain(`### ${hunks[0]?.id}`);
    expect(prompt).not.toContain(`### ${hunks[1]?.id}`);
    expect(prompt).toContain("File: src/a.ts, lines 3-5");
    expect(questionsRepo.listQuestions(ctx.db, review.id, chunk.id)).toHaveLength(1);
  });

  it("rejects a chunk from another review before streaming", () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review } = seedReviewWithHunks(ctx, ["src/a.ts"]);
    expect(() => askQuestion(ctx, review.id, request({ chunkId: "chk_missing" }), new AbortController().signal)).toThrow(HttpError);
  });

  it("rejects questions on a Past review without starting a run", () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review } = seedReviewWithHunks(ctx, ["src/a.ts"]);
    reviewsRepo.updateReview(ctx.db, review.id, { status: "past" });
    expect(() => askQuestion(ctx, review.id, request(), new AbortController().signal)).toThrow(/Past and read-only/);
    expect(questionsRepo.listQuestions(ctx.db, review.id)).toHaveLength(0);
    expect(claudeRunsRepo.getLatestRun(ctx.db, review.id, "qa")).toBeUndefined();
  });

  it("logs the run as failed when the client goes away mid-stream", async () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review } = seedReviewWithHunks(ctx, ["src/a.ts"]);
    const stream = askQuestion(ctx, review.id, request(), new AbortController().signal)[Symbol.asyncIterator]();

    await stream.next();
    await stream.next();
    await stream.return?.();

    expect(claudeRunsRepo.getLatestRun(ctx.db, review.id, "qa")).toMatchObject({ status: "failed", error: "The question was cancelled" });
  });
});
