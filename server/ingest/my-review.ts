import type { Review } from "@shared/domain";
import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { errorMessage } from "../lib/errors";
import type { ViewerReview } from "./github-client";

type MyReviewPatch = Pick<Review, "myReviewState" | "myReviewSubmittedAt" | "myReviewCommitSha">;

export const toMyReviewPatch = (latest: ViewerReview | null): MyReviewPatch => ({
  myReviewState: latest?.state ?? null,
  myReviewSubmittedAt: latest?.submittedAt ?? null,
  myReviewCommitSha: latest?.commitSha ?? null,
});

/**
 * Stores the user's latest GitHub review of the PR, from four-eyes or GitHub itself, on the review.
 * Failures are logged and leave the stored review as it was, so a flaky call never fails a check or an ingest.
 */
export const syncMyReview = async (ctx: AppContext, reviewId: string): Promise<void> => {
  const review = reviewsRepo.getReview(ctx.db, reviewId);
  if (review === undefined) return;
  try {
    const latest = await ctx.github.fetchViewerReview({ host: review.host, owner: review.owner, repo: review.repo, number: review.prNumber });
    if (reviewsRepo.getReview(ctx.db, reviewId) === undefined) return;
    reviewsRepo.updateReview(ctx.db, reviewId, toMyReviewPatch(latest));
  } catch (error) {
    console.error(`[four-eyes] could not read your GitHub review of review ${reviewId}: ${errorMessage(error)}`);
  }
};
