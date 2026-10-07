import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import { claudeRunsRepo, findingsRepo, reviewsRepo } from "../db/repositories";
import { HttpError } from "../lib/errors";
import { nowIso } from "../lib/time";
import { createTestContext, type TestContextHandle } from "../test/context";
import { rerunReview } from "./rerun-review";
import { runReview } from "./review";
import { createScriptedRunner, seedReviewWithHunks, type ScriptedRunner, type ScriptedStep, type SeededReview } from "./test-support";

const reviewOutput = (hunkId: string, titles: readonly string[]): ScriptedStep => ({
  output: {
    verdict: { summary: "Mostly fine.", suggestion: "approve_with_nits" },
    findings: titles.map((title) => ({ severity: "risk", title, explanation: "Because.", hunkIds: [hunkId] })),
  },
});

interface Setup {
  readonly ctx: AppContext;
  readonly runner: ScriptedRunner;
  readonly seeded: SeededReview;
}

describe("review runs", () => {
  let handle: TestContextHandle | undefined;
  afterEach(() => handle?.close());

  const setup = (steps: (hunkId: string) => readonly ScriptedStep[]): Setup => {
    const script: ScriptedStep[] = [];
    const runner = createScriptedRunner(script);
    handle = createTestContext({ claude: runner });
    const seeded = seedReviewWithHunks(handle.ctx, ["src/a.ts"]);
    const hunkId = seeded.hunks[0]?.id ?? "";
    script.push(...steps(hunkId));
    return { ctx: handle.ctx, runner, seeded };
  };

  const startHanging = async ({ ctx, runner, seeded }: Setup): Promise<{ readonly settled: Promise<unknown> }> => {
    const settled = runReview(ctx, { reviewId: seeded.review.id, roundId: seeded.round.id }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(runner.structuredRequests).toHaveLength(1));
    return { settled };
  };

  it("stops a hanging run when a newer one starts, and the stopped run never saves", async () => {
    const test = setup((hunkId) => ["hang", reviewOutput(hunkId, ["Null email"])]);
    const { ctx } = test;
    const { review, round } = test.seeded;
    const hanging = await startHanging(test);

    await runReview(ctx, { reviewId: review.id, roundId: round.id });

    const stopped = await hanging.settled;
    expect(stopped).toBeInstanceOf(Error);
    expect(String(stopped)).toContain("Review stopped: a newer review run of this PR started");
    const runs = claudeRunsRepo.listRuns(ctx.db, review.id);
    expect(runs.map((run) => run.status).sort()).toEqual(["failed", "succeeded"]);
    expect(runs.find((run) => run.status === "failed")?.error).toBe("Review stopped: a newer review run of this PR started");
    expect(findingsRepo.listFindings(ctx.db, review.id).map((finding) => finding.title)).toEqual(["Null email"]);
  });

  it("rerunReview restarts a hanging review and marks the stuck run failed straight away", async () => {
    const test = setup((hunkId) => ["hang", reviewOutput(hunkId, ["Null email"])]);
    const { ctx } = test;
    const reviewId = test.seeded.review.id;
    const hanging = await startHanging(test);
    const stuck = claudeRunsRepo.getLatestRun(ctx.db, reviewId, "review");

    rerunReview(ctx, reviewId);

    expect(claudeRunsRepo.listRuns(ctx.db, reviewId).find((run) => run.id === stuck?.id)?.status).toBe("failed");
    await hanging.settled;
    await vi.waitFor(() => expect(claudeRunsRepo.getLatestRun(ctx.db, reviewId, "review")?.status).toBe("succeeded"));
    await vi.waitFor(() => expect(findingsRepo.listFindings(ctx.db, reviewId).map((finding) => finding.title)).toEqual(["Null email"]));
  });

  it("rerunReview keeps the reviewer's verdict on a finding Claude reports again and drops the rest", async () => {
    const test = setup((hunkId) => [reviewOutput(hunkId, ["Null email", "Slow query"]), reviewOutput(hunkId, ["Null email"])]);
    const { ctx } = test;
    const { review, round } = test.seeded;
    await runReview(ctx, { reviewId: review.id, roundId: round.id });
    const nullEmail = findingsRepo.listFindings(ctx.db, review.id).find((finding) => finding.title === "Null email");
    findingsRepo.updateFinding(ctx.db, nullEmail?.id ?? "", { userVerdict: "agree" });

    rerunReview(ctx, review.id);

    await vi.waitFor(() =>
      expect(findingsRepo.listFindings(ctx.db, review.id).map((finding) => [finding.title, finding.lifecycle, finding.userVerdict])).toEqual([
        ["Null email", "new", "agree"],
      ]),
    );
  });

  it("rerunReview refuses reviews in Past", () => {
    const { ctx, seeded } = setup(() => []);
    const reviewId = seeded.review.id;
    reviewsRepo.updateReview(ctx.db, reviewId, { status: "past" });
    expect(() => rerunReview(ctx, reviewId)).toThrow(HttpError);
    expect(claudeRunsRepo.listRuns(ctx.db, reviewId)).toEqual([]);
  });
});

describe("failRunningRuns", () => {
  it("marks only runs still recorded as running as failed", async () => {
    const handle = createTestContext({ claude: createScriptedRunner(["hang"]) });
    try {
      const { ctx } = handle;
      const { review, round } = seedReviewWithHunks(ctx, ["src/a.ts"]);
      void runReview(ctx, { reviewId: review.id, roundId: round.id }).catch(() => undefined);
      expect(claudeRunsRepo.failRunningRuns(ctx.db, "Interrupted", nowIso())).toBe(1);
      expect(claudeRunsRepo.getLatestRun(ctx.db, review.id, "review")).toMatchObject({ status: "failed", error: "Interrupted" });
      expect(claudeRunsRepo.failRunningRuns(ctx.db, "Interrupted", nowIso())).toBe(0);
    } finally {
      handle.close();
    }
  });
});
