import type { Review } from "@shared/domain";
import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { errorMessage } from "../lib/errors";
import { nowIso } from "../lib/time";
import { removeWorktree } from "./git";
import { forgetWorktreeUse, lastWorktreeUse } from "./worktree-usage";

const removeWorktreeLogged = async (ctx: AppContext, reviewId: string): Promise<void> => {
  try {
    await removeWorktree(ctx, reviewId);
  } catch (error) {
    console.error(`[ingest] could not remove the worktree for review ${reviewId}: ${errorMessage(error)}`);
  }
};

/** Marks the review past (finished_at = now) and deletes its worktree. Used by Finish and by refresh on merge/close. */
export const moveReviewToPast = async (ctx: AppContext, reviewId: string): Promise<Review> => {
  reviewsRepo.requireReview(ctx.db, reviewId);
  await removeWorktreeLogged(ctx, reviewId);
  const now = nowIso();
  return reviewsRepo.updateReview(ctx.db, reviewId, { status: "past", finishedAt: now, lastActivityAt: now, worktreePath: null });
};

/** Deletes the review's worktree and all its database rows. */
export const deleteReview = async (ctx: AppContext, reviewId: string): Promise<void> => {
  await removeWorktreeLogged(ctx, reviewId);
  reviewsRepo.deleteReview(ctx.db, reviewId);
  ctx.events.clear(reviewId);
};

/** How long a Past review's rebuilt worktree may sit unused before sweepPastWorktrees deletes it. */
export const PAST_WORKTREE_IDLE_MS = 10 * 60_000;

/** Deletes worktrees of Past reviews that were rebuilt on demand and have not been used for idleMs. Returns the review IDs cleaned. */
export const sweepPastWorktrees = async (
  ctx: AppContext,
  now: number = Date.now(),
  idleMs: number = PAST_WORKTREE_IDLE_MS,
): Promise<readonly string[]> => {
  const idle = reviewsRepo
    .listReviews(ctx.db, "past")
    .filter((review) => review.worktreePath !== null)
    .filter((review) => {
      const used = lastWorktreeUse(ctx, review.id);
      return used === null || now - used >= idleMs;
    });
  const cleaned = await Promise.all(
    idle.map(async (review): Promise<string | null> => {
      try {
        await removeWorktree(ctx, review.id);
        forgetWorktreeUse(ctx, review.id);
        return review.id;
      } catch (error) {
        console.error(`[four-eyes] could not remove the idle worktree of Past review ${review.id}: ${errorMessage(error)}`);
        return null;
      }
    }),
  );
  return cleaned.filter((id): id is string => id !== null);
};
