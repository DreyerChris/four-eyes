import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewsRepo } from "../db/repositories";
import { refuseReviewSubmission } from "../ingest/testing";
import { createTestContext, type TestContextHandle } from "../test/context";
import { IDLE_CHECK_EVERY_TICKS, pollOnce, startRefreshPoller } from "./poller";
import { checkReviewWith, getRefreshStatus } from "./status";
import { createTempRepo, joinLines, numberedLines, type TempRepo } from "./testing/git-repo";
import { createFakeDeps, createFakeGitHub, prMeta, seedReview, type FakeGitHub, type SeededReview } from "./testing/fixture";

interface Setup {
  readonly handle: TestContextHandle;
  readonly repo: TempRepo;
  readonly github: FakeGitHub;
  readonly seeded: SeededReview;
  readonly headSha: string;
}

describe("refresh status and polling", () => {
  const state: { setup: Setup | null } = { setup: null };
  const setup = (): Setup => {
    if (!state.setup) throw new Error("setup missing");
    return state.setup;
  };

  beforeEach(async () => {
    const repo = createTempRepo();
    const baseSha = repo.commit("base", { "a.ts": joinLines(numberedLines(10)) });
    const headSha = repo.commit("head", { "a.ts": joinLines(["changed", ...numberedLines(10).slice(1)]) });
    const github = createFakeGitHub(prMeta(baseSha, headSha));
    const handle = createTestContext({ github });
    const seeded = await seedReview(handle.ctx, repo, baseSha, headSha);
    state.setup = { handle, repo, github, seeded, headSha };
  });

  afterEach(() => {
    vi.useRealTimers();
    state.setup?.handle.close();
    state.setup?.repo.remove();
    state.setup = null;
  });

  it("reports no new commits right after ingest", async () => {
    const { handle, seeded, headSha } = setup();
    expect(await getRefreshStatus(handle.ctx, seeded.review.id)).toMatchObject({
      reviewHeadSha: headSha,
      hasNewCommits: false,
      refreshing: false,
      ghState: "open",
    });
  });

  it("stores the remote head, flags new commits and publishes refresh_status", async () => {
    const { handle, github, repo, seeded } = setup();
    github.setPr({ headSha: "f".repeat(40) });
    const status = await checkReviewWith(handle.ctx, seeded.review.id, createFakeDeps(repo).deps);
    expect(status).toMatchObject({ remoteHeadSha: "f".repeat(40), hasNewCommits: true });
    expect(status.checkedAt).not.toBeNull();
    expect(reviewsRepo.requireReview(handle.ctx.db, seeded.review.id).remoteHeadSha).toBe("f".repeat(40));
    expect(handle.ctx.events.history(seeded.review.id).at(-1)).toMatchObject({ type: "refresh_status", status });
  });

  it.each(["merged", "closed"] as const)("auto-moves the review to past when the PR is %s", async (prState) => {
    const { handle, github, repo, seeded } = setup();
    github.setPr({ state: prState });
    const fake = createFakeDeps(repo);
    const status = await checkReviewWith(handle.ctx, seeded.review.id, fake.deps);
    expect(status.ghState).toBe(prState);
    expect(fake.pastCalls()).toEqual([seeded.review.id]);
    expect(reviewsRepo.requireReview(handle.ctx.db, seeded.review.id).status).toBe("past");

    await checkReviewWith(handle.ctx, seeded.review.id, fake.deps);
    expect(fake.pastCalls()).toHaveLength(1);
  });

  it("wraps GitHub failures in a readable 502", async () => {
    const { handle, repo, seeded } = setup();
    const failing = createTestContext({
      github: { fetchPr: async () => Promise.reject(new Error("gh: not logged in")), remoteUrl: () => "", submitReview: refuseReviewSubmission },
    });
    try {
      const copy = await seedReview(failing.ctx, repo, seeded.review.baseSha, seeded.review.headSha);
      await expect(checkReviewWith(failing.ctx, copy.review.id, createFakeDeps(repo).deps)).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining("gh: not logged in"),
      });
    } finally {
      failing.close();
    }
    expect(handle.ctx.events.history(seeded.review.id)).toEqual([]);
  });

  it("pollOnce checks active reviews only and keeps going after failures", async () => {
    const { handle, repo, seeded } = setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fake = createFakeDeps(repo);
    const ok = await pollOnce(handle.ctx, fake.deps);
    expect(ok.checked).toEqual([seeded.review.id]);

    reviewsRepo.updateReview(handle.ctx.db, seeded.review.id, { status: "past" });
    expect((await pollOnce(handle.ctx, fake.deps)).checked).toEqual([]);

    reviewsRepo.updateReview(handle.ctx.db, seeded.review.id, { status: "active" });
    const broken = createTestContext({ github: { fetchPr: async () => Promise.reject(new Error("offline")), remoteUrl: () => "", submitReview: refuseReviewSubmission } });
    try {
      await seedReview(broken.ctx, repo, seeded.review.baseSha, seeded.review.headSha);
      const result = await pollOnce(broken.ctx, fake.deps);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.error).toContain("offline");
      expect(errors).toHaveBeenCalled();
    } finally {
      broken.close();
      errors.mockRestore();
    }
  });

  it("pollOnce with onlyOpen checks only reviews with a live event stream", async () => {
    const { handle, repo, seeded } = setup();
    const fake = createFakeDeps(repo);
    expect((await pollOnce(handle.ctx, fake.deps, { onlyOpen: true })).checked).toEqual([]);
    const unsubscribe = handle.ctx.events.subscribe(seeded.review.id, () => undefined);
    expect((await pollOnce(handle.ctx, fake.deps, { onlyOpen: true })).checked).toEqual([seeded.review.id]);
    unsubscribe();
  });

  it("startRefreshPoller checks open reviews every interval and idle ones every few intervals until stopped", async () => {
    vi.useFakeTimers();
    const { handle, github, repo, seeded } = setup();
    const interval = handle.ctx.config.pollIntervalMs;
    const stop = startRefreshPoller(handle.ctx, createFakeDeps(repo).deps);
    expect(github.calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(interval);
    expect(github.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(interval * (IDLE_CHECK_EVERY_TICKS - 1));
    expect(github.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(interval);
    expect(github.calls()).toBe(2);

    const unsubscribe = handle.ctx.events.subscribe(seeded.review.id, () => undefined);
    await vi.advanceTimersByTimeAsync(interval * 2);
    expect(github.calls()).toBe(4);
    unsubscribe();
    stop();
    await vi.advanceTimersByTimeAsync(interval * IDLE_CHECK_EVERY_TICKS * 2);
    expect(github.calls()).toBe(4);
  });
});
