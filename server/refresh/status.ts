import type { PrMeta, RefreshStatus, Review } from "@shared/domain";
import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { syncMyReview } from "../ingest/my-review";
import { errorMessage, HttpError } from "../lib/errors";
import { nowIso } from "../lib/time";
import { defaultRefreshDeps, prRefOf, type RefreshDeps } from "./deps";
import { isRefreshing } from "./state";

export const toRefreshStatus = (ctx: AppContext, review: Review): RefreshStatus => ({
  reviewId: review.id,
  reviewHeadSha: review.headSha,
  remoteHeadSha: review.remoteHeadSha,
  hasNewCommits: review.remoteHeadSha !== null && review.remoteHeadSha !== review.headSha,
  ghState: review.ghState,
  checkedAt: review.remoteCheckedAt,
  refreshing: isRefreshing(ctx, review.id),
});

export const publishRefreshStatus = (ctx: AppContext, reviewId: string): RefreshStatus => {
  const status = toRefreshStatus(ctx, reviewsRepo.requireReview(ctx.db, reviewId));
  ctx.events.publish(reviewId, { type: "refresh_status", status });
  return status;
};

export const fetchPrMeta = async (ctx: AppContext, review: Review): Promise<PrMeta> => {
  try {
    return await ctx.github.fetchPr(prRefOf(review));
  } catch (error) {
    throw new HttpError(
      502,
      `Could not check ${review.owner}/${review.repo}#${review.prNumber} on ${review.host}: ${errorMessage(error)}`,
    );
  }
};

/** Last known refresh state from reviews.remote_head_sha / remote_checked_at plus whether a refresh is running. */
export const getRefreshStatus = async (ctx: AppContext, reviewId: string): Promise<RefreshStatus> =>
  toRefreshStatus(ctx, reviewsRepo.requireReview(ctx.db, reviewId));

/** checkReview with injectable ingest dependencies. */
export const checkReviewWith = async (ctx: AppContext, reviewId: string, deps: RefreshDeps): Promise<RefreshStatus> => {
  const review = reviewsRepo.requireReview(ctx.db, reviewId);
  const meta = await fetchPrMeta(ctx, review);
  const updated = reviewsRepo.updateReview(ctx.db, reviewId, {
    remoteHeadSha: meta.headSha,
    remoteCheckedAt: nowIso(),
    ghState: meta.state,
  });
  await syncMyReview(ctx, reviewId);
  if (meta.state !== "open" && updated.status === "active") {
    await deps.moveReviewToPast(ctx, reviewId);
  }
  return publishRefreshStatus(ctx, reviewId);
};

/**
 * Asks GitHub for the current head SHA and state now. Stores remote_head_sha, remote_checked_at, gh_state and your latest review,
 * moves the review to past when merged/closed, and publishes a "refresh_status" event.
 */
export const checkReview = async (ctx: AppContext, reviewId: string): Promise<RefreshStatus> =>
  checkReviewWith(ctx, reviewId, defaultRefreshDeps);
