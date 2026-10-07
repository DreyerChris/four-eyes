import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hunksRepo, reviewsRepo, roundsRepo } from "../db/repositories";
import { HttpError } from "../lib/errors";
import { createTestContext, type TestContextHandle } from "../test/context";
import { FAKE_PR_URL } from "./github-client";
import { deleteReview, moveReviewToPast } from "./lifecycle";
import { startIngest, waitForIngest } from "./pipeline";
import { createLocalGitHubClient, createTempRepo, refuseReviewSubmission, type TempRepo } from "./testing";

const claude = vi.hoisted(() => ({
  runChunking: vi.fn(),
  runReview: vi.fn(),
}));

vi.mock("../claude/chunking", () => ({ runChunking: claude.runChunking }));
vi.mock("../claude/review", () => ({ runReview: claude.runReview }));

const INGEST_STEPS = ["fetch_pr", "clone", "worktree", "diff", "parse", "save"] as const;

describe("ingest pipeline", () => {
  let handle: TestContextHandle;
  const repos: TempRepo[] = [];

  beforeEach(() => {
    handle = createTestContext();
    claude.runChunking.mockReset();
    claude.runReview.mockReset();
    claude.runChunking.mockImplementation(async (ctx: TestContextHandle["ctx"], input: { reviewId: string }) => {
      reviewsRepo.updateReview(ctx.db, input.reviewId, { pipelineStatus: "ready" });
      return [];
    });
    claude.runReview.mockResolvedValue([]);
  });

  afterEach(() => {
    handle.close();
    repos.splice(0).forEach((repo) => repo.dispose());
  });

  it("ingests the fixture PR: metadata, worktree, round 1, hunks and parallel Claude runs", async () => {
    const { ctx } = handle;
    const { review, reopened } = await startIngest(ctx, { url: FAKE_PR_URL });
    expect(reopened).toBe(false);
    expect(review).toMatchObject({ pipelineStatus: "ingesting", title: "four-eyes-fixture/demo#1", status: "active" });
    await waitForIngest(review.id);

    const saved = reviewsRepo.requireReview(ctx.db, review.id);
    expect(saved).toMatchObject({
      title: "Add email to users and send a welcome mail",
      author: "octocat",
      url: FAKE_PR_URL,
      ghState: "open",
      pipelineStatus: "ready",
      pipelineError: null,
    });
    expect(saved.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(saved.remoteHeadSha).toBe(saved.headSha);
    expect(saved.worktreePath).toBe(join(handle.home, "worktrees", review.id));
    expect(existsSync(join(saved.worktreePath ?? "", "src/utils/formatting.ts"))).toBe(true);
    expect(existsSync(join(handle.home, "repos", "github.com", "four-eyes-fixture", "demo.git"))).toBe(true);

    const rounds = roundsRepo.listRounds(ctx.db, review.id);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ number: 1, headSha: saved.headSha });

    const hunks = hunksRepo.listHunks(ctx.db, review.id);
    expect(hunks.map((h) => h.position)).toEqual(hunks.map((_, index) => index));
    expect(hunks.every((h) => h.present && h.roundId === rounds[0]?.id && h.id.startsWith("h_"))).toBe(true);
    const byPath = new Map(hunks.map((h) => [h.filePath, h] as const));
    expect(byPath.get("src/utils/formatting.ts")).toMatchObject({ changeType: "renamed", oldFilePath: "src/utils/format.ts" });
    expect(byPath.get("src/legacy/old-helpers.ts")).toMatchObject({ changeType: "deleted" });
    expect(byPath.get("test/user-service.test.ts")).toMatchObject({ changeType: "added" });
    expect(byPath.get("README.md")?.patchText).toContain("\\ No newline at end of file");

    expect(claude.runChunking).toHaveBeenCalledWith(ctx, { reviewId: review.id, roundId: rounds[0]?.id });
    expect(claude.runReview).toHaveBeenCalledWith(ctx, { reviewId: review.id, roundId: rounds[0]?.id });

    const steps = ctx.events.history(review.id).flatMap((event) => (event.type === "step" ? [`${event.step}:${event.state}`] : []));
    expect(steps).toEqual(INGEST_STEPS.flatMap((step) => [`${step}:started`, `${step}:done`]));
  });

  it("reopens the same PR instead of creating a second review, rebuilding a deleted worktree", async () => {
    const { ctx } = handle;
    const first = await startIngest(ctx, { url: FAKE_PR_URL });
    await waitForIngest(first.review.id);
    const past = await moveReviewToPast(ctx, first.review.id);
    expect(past).toMatchObject({ status: "past", worktreePath: null });
    expect(past.finishedAt).not.toBeNull();
    expect(existsSync(join(handle.home, "worktrees", first.review.id))).toBe(false);

    const again = await startIngest(ctx, { url: `${FAKE_PR_URL}/files` });
    expect(again.reopened).toBe(true);
    expect(again.review).toMatchObject({ id: first.review.id, status: "active", finishedAt: null });
    await waitForIngest(first.review.id);
    expect(reviewsRepo.listReviews(ctx.db)).toHaveLength(1);
    expect(reviewsRepo.requireReview(ctx.db, first.review.id).worktreePath).toBe(join(handle.home, "worktrees", first.review.id));
    expect(claude.runChunking).toHaveBeenCalledTimes(1);
  });

  it("records a readable failure when GitHub cannot be reached, and retries on the next paste", async () => {
    const failing = createTestContext({
      github: {
        fetchPr: async () => {
          throw new Error("gh exploded");
        },
        remoteUrl: () => "/nowhere",
        submitReview: refuseReviewSubmission,
        searchOpenPrs: async () => [],
      },
    });
    try {
      const { review } = await startIngest(failing.ctx, { url: "https://github.com/o/r/pull/9" });
      await waitForIngest(review.id);
      const saved = reviewsRepo.requireReview(failing.ctx.db, review.id);
      expect(saved.pipelineStatus).toBe("failed");
      expect(saved.pipelineError).toBe("Fetching the pull request failed: gh exploded");
      const history = failing.ctx.events.history(review.id);
      expect(history.some((e) => e.type === "step" && e.step === "fetch_pr" && e.state === "failed" && e.message === "gh exploded")).toBe(true);

      const retry = await startIngest(failing.ctx, { url: "https://github.com/o/r/pull/9" });
      expect(retry).toMatchObject({ reopened: true, review: { id: review.id, pipelineStatus: "ingesting", pipelineError: null } });
      await waitForIngest(review.id);
      expect(reviewsRepo.requireReview(failing.ctx.db, review.id).pipelineStatus).toBe("failed");
    } finally {
      failing.close();
    }
  });

  it("marks the review failed when chunking throws but keeps the saved hunks", async () => {
    claude.runChunking.mockRejectedValue(new Error("model unavailable"));
    claude.runReview.mockRejectedValue(new Error("review also down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { review } = await startIngest(handle.ctx, { url: FAKE_PR_URL });
    await waitForIngest(review.id);
    errors.mockRestore();
    const saved = reviewsRepo.requireReview(handle.ctx.db, review.id);
    expect(saved).toMatchObject({ pipelineStatus: "failed", pipelineError: "Chunking failed: model unavailable" });
    expect(hunksRepo.listHunks(handle.ctx.db, review.id).length).toBeGreaterThan(0);
  });

  it("fails clearly when the PR has no text changes", async () => {
    const repo = await createTempRepo();
    repos.push(repo);
    repo.write("logo.png", "\u0000\u0001binary");
    const base = await repo.commit("base");
    repo.write("logo.png", "\u0000\u0002binary");
    const head = await repo.commit("binary only");
    await repo.git("update-ref", "refs/pull/4/head", head);
    await repo.git("branch", "--quiet", "base-branch", base);
    const local = createTestContext({
      github: createLocalGitHubClient(repo.path, () => ({
        title: "Binary only",
        author: "dev",
        url: "https://github.com/o/bin/pull/4",
        state: "open",
        headSha: head,
        baseSha: base,
        headRefName: "feature",
        baseRefName: "base-branch",
      })),
    });
    try {
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { review } = await startIngest(local.ctx, { url: "https://github.com/o/bin/pull/4" });
      await waitForIngest(review.id);
      errors.mockRestore();
      expect(reviewsRepo.requireReview(local.ctx.db, review.id).pipelineError).toMatch(/^Parsing hunks failed: .*no reviewable text changes/);
      expect(roundsRepo.listRounds(local.ctx.db, review.id)).toEqual([]);
    } finally {
      local.close();
    }
  });

  it("rejects links that are not pull requests with a 400", async () => {
    await expect(startIngest(handle.ctx, { url: "https://github.com/o/r/issues/1" })).rejects.toThrow(HttpError);
  });

  it("deletes the review rows, its events and its worktree", async () => {
    const { ctx } = handle;
    const { review } = await startIngest(ctx, { url: FAKE_PR_URL });
    await waitForIngest(review.id);
    const worktree = reviewsRepo.requireReview(ctx.db, review.id).worktreePath ?? "";
    expect(existsSync(worktree)).toBe(true);

    await deleteReview(ctx, review.id);
    expect(reviewsRepo.getReview(ctx.db, review.id)).toBeUndefined();
    expect(hunksRepo.listHunks(ctx.db, review.id)).toEqual([]);
    expect(ctx.events.history(review.id)).toEqual([]);
    expect(existsSync(worktree)).toBe(false);
  });
});
