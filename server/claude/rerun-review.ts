import type { Finding } from "@shared/domain";
import type { AppContext } from "../context";
import { findingsRepo, reviewsRepo, roundsRepo } from "../db/repositories";
import { errorMessage, HttpError } from "../lib/errors";
import { matchFindings, reconcileFindingSets } from "../refresh/lifecycle";
import { runReview } from "./review";

/**
 * After a re-run of the latest round: a newcomer matching one of that round's previous findings takes over its
 * lifecycle and the reviewer's verdict; findings from earlier rounds are reconciled as a refresh would.
 */
const carryOverFindings = (ctx: AppContext, newcomers: readonly Finding[], previous: readonly Finding[], roundId: string): void => {
  const sameRound = previous.filter((finding) => finding.roundId === roundId && finding.lifecycle !== "resolved");
  const carried = new Map(
    matchFindings(newcomers, sameRound).pairs.map(({ newcomer, earlier }) => [
      newcomer.id,
      findingsRepo.updateFinding(ctx.db, newcomer.id, { lifecycle: earlier.lifecycle, userVerdict: earlier.userVerdict }),
    ]),
  );
  reconcileFindingSets(
    ctx,
    newcomers.map((finding) => carried.get(finding.id) ?? finding),
    previous.filter((finding) => finding.roundId !== roundId),
  );
};

/**
 * Starts a fresh Claude review of the latest round in the background and returns once its run is logged.
 * Any review run already in progress for this review is stopped. Throws 409 for Past reviews and reviews with no saved changes.
 */
export const rerunReview = (ctx: AppContext, reviewId: string): void => {
  const review = reviewsRepo.requireReview(ctx.db, reviewId);
  if (review.status === "past") {
    throw new HttpError(409, `Review ${reviewId} is in Past and read-only. Add the PR again to reopen it before running the review again.`);
  }
  const round = roundsRepo.getLatestRound(ctx.db, reviewId);
  if (round === undefined) throw new HttpError(409, `Review ${reviewId} has no saved changes yet, so there is nothing to review.`);
  const previous = findingsRepo.listFindings(ctx.db, reviewId);
  runReview(ctx, { reviewId, roundId: round.id })
    .then((newcomers) => {
      carryOverFindings(ctx, newcomers, previous, round.id);
      ctx.events.publish(reviewId, { type: "review_updated" });
    })
    .catch((error: unknown) => {
      console.error(`[four-eyes] review re-run for ${reviewId} did not finish: ${errorMessage(error)}`);
    });
};
