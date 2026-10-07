import type { SubmitGitHubReviewRequest, SubmitGitHubReviewResponse } from "@shared/api";
import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { HttpError } from "../lib/errors";
import { prRefOf } from "../refresh/deps";

/** Posts an approval, comment or change request to GitHub as the user's gh login, on the head commit this review covers. */
export const submitGitHubReview = async (
  ctx: AppContext,
  reviewId: string,
  request: SubmitGitHubReviewRequest,
): Promise<SubmitGitHubReviewResponse> => {
  const review = reviewsRepo.requireReview(ctx.db, reviewId);
  if (review.status === "past") {
    throw new HttpError(409, `Review ${reviewId} is in Past and read-only. Add the PR again to reopen it before submitting a review.`);
  }
  if (review.ghState !== "open") {
    throw new HttpError(409, `${review.owner}/${review.repo}#${review.prNumber} is ${review.ghState}, so it cannot take a new review.`);
  }
  const body = request.body.trim();
  return ctx.github.submitReview(prRefOf(review), {
    event: request.event,
    body: body === "" ? null : body,
    commitId: review.headSha,
  });
};
