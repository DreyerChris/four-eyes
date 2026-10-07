import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewsRepo } from "../db/repositories";
import { createTestContext, type TestContextHandle } from "../test/context";
import { FAKE_PR_URL } from "./github-client";
import { ensureWorktree } from "./git";
import { moveReviewToPast, PAST_WORKTREE_IDLE_MS, sweepPastWorktrees } from "./lifecycle";
import { startIngest, waitForIngest } from "./pipeline";

vi.mock("../claude/chunking", () => ({ runChunking: vi.fn(async () => []) }));
vi.mock("../claude/review", () => ({ runReview: vi.fn(async () => []) }));

describe("sweepPastWorktrees", () => {
  let handle: TestContextHandle | undefined;
  afterEach(() => handle?.close());

  it("removes a Past review's rebuilt worktree once it has been idle, and leaves active reviews alone", async () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review } = await startIngest(ctx, { url: FAKE_PR_URL });
    await waitForIngest(review.id);
    expect(await sweepPastWorktrees(ctx)).toEqual([]);

    await moveReviewToPast(ctx, review.id);
    const rebuilt = await ensureWorktree(ctx, review.id);
    const usedAt = Date.now();
    expect(existsSync(rebuilt)).toBe(true);

    expect(await sweepPastWorktrees(ctx, usedAt + PAST_WORKTREE_IDLE_MS - 1_000)).toEqual([]);
    expect(existsSync(rebuilt)).toBe(true);

    expect(await sweepPastWorktrees(ctx, usedAt + PAST_WORKTREE_IDLE_MS + 1_000)).toEqual([review.id]);
    expect(existsSync(rebuilt)).toBe(false);
    expect(reviewsRepo.requireReview(ctx.db, review.id).worktreePath).toBeNull();
  });
});
