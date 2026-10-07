import { afterEach, describe, expect, it } from "vitest";
import { chunksRepo, claudeRunsRepo, reviewsRepo, settingsRepo } from "../db/repositories";
import { createTestContext, type TestContextHandle } from "../test/context";
import { buildChunkingPrompt, runChunking, validateChunkPlan } from "./chunking";
import { ClaudeRunError } from "./errors";
import { createScriptedRunner, SCRIPTED_USAGE, seedReviewWithHunks } from "./test-support";

const plan = (...groups: readonly (readonly string[])[]): unknown => ({
  chunks: groups.map((hunkIds, index) => ({ title: `Chunk ${index + 1}`, explanation: "Why", kind: "core", hunkIds })),
});

describe("validateChunkPlan", () => {
  const ids = ["h_1", "h_2", "h_3"];

  it("accepts a plan that uses every hunk once", () => {
    const result = validateChunkPlan(plan(["h_2"], ["h_1", "h_3"]), ids);
    expect(result).toEqual({ ok: true, value: plan(["h_2"], ["h_1", "h_3"]) });
  });

  it("appends missing hunks as an Other changes chunk", () => {
    const result = validateChunkPlan(plan(["h_3"]), ids);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.chunks.map((chunk) => chunk.title)).toEqual(["Chunk 1", "Other changes"]);
    expect(result.value.chunks[1]?.hunkIds).toEqual(["h_1", "h_2"]);
  });

  it("rejects duplicate hunk IDs", () => {
    const result = validateChunkPlan(plan(["h_1", "h_2"], ["h_2", "h_3"]), ids);
    expect(result).toEqual({ ok: false, error: "hunk IDs used more than once: h_2" });
  });

  it("rejects unknown hunk IDs", () => {
    const result = validateChunkPlan(plan(["h_1", "h_9"], ["h_2", "h_3"]), ids);
    expect(result).toEqual({ ok: false, error: "unknown hunk IDs: h_9" });
  });

  it("reports unknown and duplicate IDs together", () => {
    const result = validateChunkPlan(plan(["h_1", "h_1", "h_x"]), ids);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknown hunk IDs: h_x");
      expect(result.error).toContain("used more than once: h_1");
    }
  });

  it("rejects output that does not match the schema", () => {
    const result = validateChunkPlan({ chunks: [{ title: "", kind: "weird", hunkIds: [] }] }, ids);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not match the chunk plan schema/);
  });

  it("drops empty chunks", () => {
    const result = validateChunkPlan(plan([], ["h_1", "h_2", "h_3"]), ids);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.chunks).toHaveLength(1);
  });
});

describe("buildChunkingPrompt", () => {
  it("lists every hunk ID with its file and patch", () => {
    const handle = createTestContext();
    const { hunks } = seedReviewWithHunks(handle.ctx, ["src/a.ts", "src/b.ts"]);
    const prompt = buildChunkingPrompt(hunks);
    hunks.forEach((hunk) => expect(prompt).toContain(`### ${hunk.id}`));
    expect(prompt).toContain("file: src/a.ts | modified | +2 -1");
    expect(prompt).toContain("+new line");
    handle.close();
  });
});

describe("runChunking", () => {
  let handle: TestContextHandle | undefined;
  afterEach(() => handle?.close());

  it("saves a valid plan with positions in the round, logs the run and marks the review ready", async () => {
    const steps: { output: unknown }[] = [{ output: null }];
    const runner = createScriptedRunner(steps);
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review, round, hunks } = seedReviewWithHunks(ctx, ["src/types.ts", "src/logic.ts", "src/b.test.ts"]);
    const ids = hunks.map((hunk) => hunk.id);
    steps[0] = { output: plan([ids[0] ?? ""], [ids[1] ?? "", ids[2] ?? ""]) };

    const chunks = await runChunking(ctx, { reviewId: review.id, roundId: round.id });

    expect(chunks.map((chunk) => chunk.position)).toEqual([0, 1]);
    expect(chunksRepo.listChunks(ctx.db, review.id)).toHaveLength(2);
    expect(reviewsRepo.requireReview(ctx.db, review.id).pipelineStatus).toBe("ready");
    expect(runner.structuredRequests[0]?.model).toBe(settingsRepo.getSettings(ctx.db).models.chunking);
    expect(runner.structuredRequests[0]?.cwd).toBe(ctx.config.home);
    const [run] = claudeRunsRepo.listRuns(ctx.db, review.id);
    expect(run).toMatchObject({
      kind: "chunking",
      status: "succeeded",
      inputTokens: SCRIPTED_USAGE.inputTokens,
      outputTokens: SCRIPTED_USAGE.outputTokens,
      costUsd: SCRIPTED_USAGE.costUsd,
      sessionId: "scripted-1",
    });
    const events = ctx.events.history(review.id);
    expect(events.filter((event) => event.type === "run").map((event) => event.type === "run" && event.state)).toEqual(["started", "done"]);
    expect(events.some((event) => event.type === "step" && event.step === "chunking" && event.state === "done")).toBe(true);
  });

  it("retries once with the validation error, resuming the session, and succeeds", async () => {
    const steps: { output: unknown; sessionId?: string }[] = [{ output: null }, { output: null }];
    const runner = createScriptedRunner(steps);
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review, round, hunks } = seedReviewWithHunks(ctx, ["src/a.ts", "src/b.ts"]);
    const ids = hunks.map((hunk) => hunk.id);
    steps[0] = { output: plan([ids[0] ?? "", "h_bogus"]), sessionId: "session-a" };
    steps[1] = { output: plan(ids), sessionId: "session-a" };

    const chunks = await runChunking(ctx, { reviewId: review.id, roundId: round.id });

    expect(chunks).toHaveLength(1);
    expect(runner.structuredRequests).toHaveLength(2);
    expect(runner.structuredRequests[1]?.resumeSessionId).toBe("session-a");
    expect(runner.structuredRequests[1]?.prompt).toContain("unknown hunk IDs: h_bogus");
    const runEvents = ctx.events.history(review.id).flatMap((event) => (event.type === "run" ? [event.state] : []));
    expect(runEvents).toEqual(["started", "retrying", "done"]);
    expect(claudeRunsRepo.listRuns(ctx.db, review.id)[0]?.status).toBe("succeeded");
  });

  it("falls back to one chunk per file after two invalid outputs and logs the run as failed", async () => {
    const runner = createScriptedRunner([{ output: { nope: true } }, new ClaudeRunError("gateway timeout", { usage: SCRIPTED_USAGE })]);
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review, round } = seedReviewWithHunks(ctx, ["src/app.test.ts", "src/types/user.ts", "pnpm-lock.yaml"]);

    const chunks = await runChunking(ctx, { reviewId: review.id, roundId: round.id });

    expect(chunks.map((chunk) => chunk.title)).toEqual(["src/types/user.ts", "src/app.test.ts", "Skim: lockfiles, generated code and snapshots"]);
    expect(chunks[2]?.kind).toBe("skim");
    expect(runner.structuredRequests[1]?.resumeSessionId).toBe("scripted-1");
    expect(reviewsRepo.requireReview(ctx.db, review.id).pipelineStatus).toBe("ready");
    const [run] = claudeRunsRepo.listRuns(ctx.db, review.id);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("Fell back to one chunk per file");
    expect(run?.error).toContain("gateway timeout");
    expect(run?.inputTokens).toBe(SCRIPTED_USAGE.inputTokens);
  });

  it("retries with the full prompt when the first attempt threw before producing output", async () => {
    const steps: ({ output: unknown } | Error)[] = [new Error("spawn failed"), { output: null }];
    const runner = createScriptedRunner(steps);
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review, round, hunks } = seedReviewWithHunks(ctx, ["src/a.ts"]);
    steps[1] = { output: plan(hunks.map((hunk) => hunk.id)) };

    await runChunking(ctx, { reviewId: review.id, roundId: round.id });

    expect(runner.structuredRequests[1]?.resumeSessionId).toBeUndefined();
    expect(runner.structuredRequests[1]?.prompt).toContain("## Hunks (1)");
    expect(runner.structuredRequests[1]?.prompt).toContain("spawn failed");
  });

  it("only chunks the hunks of the given round", async () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review, round } = seedReviewWithHunks(ctx, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const chunks = await runChunking(ctx, { reviewId: review.id, roundId: round.id });
    const linked = chunksRepo.listChunkHunks(ctx.db, review.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(linked).toHaveLength(3);
  });

  it("marks the pipeline failed when the worktree cannot be prepared", async () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review, round } = seedReviewWithHunks(ctx, ["src/a.ts"]);
    reviewsRepo.updateReview(ctx.db, review.id, { worktreePath: null });

    await expect(runChunking(ctx, { reviewId: review.id, roundId: round.id })).rejects.toThrow(/Chunking failed/);
    const updated = reviewsRepo.requireReview(ctx.db, review.id);
    expect(updated.pipelineStatus).toBe("failed");
    expect(updated.pipelineError).toMatch(/worktree/);
    expect(claudeRunsRepo.listRuns(ctx.db, review.id)[0]?.status).toBe("failed");
  });
});
