import type { ApplyRefreshResponse } from "@shared/api";
import type { Finding, Hunk, PrMeta, Review, Round } from "@shared/domain";
import type { AppContext } from "../context";
import type { DbExecutor } from "../db/types";
import { findingsRepo, hunksRepo, reviewsRepo, roundsRepo } from "../db/repositories";
import type { FingerprintedHunk } from "../ingest/types";
import { errorMessage, HttpError } from "../lib/errors";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { defaultRefreshDeps, prRefOf, type RefreshDeps } from "./deps";
import { reconcileFindingSets } from "./lifecycle";
import { matchHunks, type HunkMatchResult } from "./match";
import { clearRefreshing, isRefreshing, markRefreshing } from "./state";
import { fetchPrMeta, publishRefreshStatus, toRefreshStatus } from "./status";

export interface StartedRefresh {
  readonly response: ApplyRefreshResponse;
  readonly background: Promise<void>;
}

interface SavedRefresh {
  readonly review: Review;
  readonly round: Round;
  readonly addedRound: boolean;
  readonly newlyMissing: number;
}

const assertRefreshable = (ctx: AppContext, review: Review): void => {
  if (review.status === "past") {
    throw new HttpError(409, `Review ${review.id} is in Past and read-only; add the PR again to reopen it before refreshing`);
  }
  if (review.pipelineStatus === "ingesting") {
    throw new HttpError(409, `Review ${review.id} is still being ingested; refresh once it has finished`);
  }
  if (isRefreshing(ctx, review.id)) {
    throw new HttpError(409, `A refresh is already running for review ${review.id}`);
  }
};

const toHunkRow = (hunk: FingerprintedHunk, review: Review, roundId: string, position: number): Hunk => ({
  id: newId("h"),
  reviewId: review.id,
  roundId,
  fingerprint: hunk.fingerprint,
  filePath: hunk.filePath,
  oldFilePath: hunk.oldFilePath,
  changeType: hunk.changeType,
  oldStart: hunk.oldStart,
  oldLines: hunk.oldLines,
  newStart: hunk.newStart,
  newLines: hunk.newLines,
  patchText: hunk.patchText,
  position,
  present: true,
});

const requireLatestRound = (db: DbExecutor, reviewId: string): Round => {
  const round = roundsRepo.getLatestRound(db, reviewId);
  if (!round) throw new HttpError(409, `Review ${reviewId} has no rounds yet; wait for ingest to finish before refreshing`);
  return round;
};

const saveRefresh = (
  ctx: AppContext,
  review: Review,
  meta: PrMeta,
  previous: readonly Hunk[],
  match: HunkMatchResult,
): SavedRefresh =>
  ctx.db.transaction((tx) => {
    const latest = requireLatestRound(tx, review.id);
    match.matched.forEach(({ previous: row, next }) => {
      hunksRepo.updateHunk(tx, row.id, {
        fingerprint: next.fingerprint,
        filePath: next.filePath,
        oldFilePath: next.oldFilePath,
        changeType: next.changeType,
        oldStart: next.oldStart,
        oldLines: next.oldLines,
        newStart: next.newStart,
        newLines: next.newLines,
        patchText: next.patchText,
        present: true,
      });
    });
    hunksRepo.setHunksPresent(
      tx,
      match.missing.map((hunk) => hunk.id),
      false,
    );
    const addedRound = match.added.length > 0;
    const round: Round = addedRound
      ? roundsRepo.insertRound(tx, {
          id: newId("rnd"),
          reviewId: review.id,
          number: latest.number + 1,
          headSha: meta.headSha,
          createdAt: nowIso(),
        })
      : latest;
    const firstPosition = previous.reduce((max, hunk) => Math.max(max, hunk.position), -1) + 1;
    hunksRepo.insertHunks(
      tx,
      match.added.map((hunk, index) => toHunkRow(hunk, review, round.id, firstPosition + index)),
    );
    const updated = reviewsRepo.updateReview(tx, review.id, {
      title: meta.title,
      headSha: meta.headSha,
      baseSha: meta.baseSha,
      ghState: meta.state,
      remoteHeadSha: meta.headSha,
      remoteCheckedAt: nowIso(),
      lastActivityAt: nowIso(),
      ...(addedRound ? { pipelineStatus: "chunking" as const, pipelineError: null } : {}),
    });
    return {
      review: updated,
      round,
      addedRound,
      newlyMissing: match.missing.filter((hunk) => hunk.present).length,
    };
  });

const runChunkingStep = async (ctx: AppContext, deps: RefreshDeps, saved: SavedRefresh): Promise<void> => {
  if (!saved.addedRound) return;
  try {
    await deps.runChunking(ctx, { reviewId: saved.review.id, roundId: saved.round.id });
  } catch (error) {
    reviewsRepo.updateReview(ctx.db, saved.review.id, {
      pipelineStatus: "failed",
      pipelineError: `Chunking Round ${saved.round.number} failed: ${errorMessage(error)}`,
    });
    throw error;
  }
};

const runReviewStep = async (
  ctx: AppContext,
  deps: RefreshDeps,
  saved: SavedRefresh,
  earlier: readonly Finding[],
): Promise<void> => {
  const newcomers = await deps.runReview(ctx, { reviewId: saved.review.id, roundId: saved.round.id });
  const newcomerIds = new Set(newcomers.map((finding) => finding.id));
  reconcileFindingSets(
    ctx,
    newcomers,
    earlier.filter((finding) => !newcomerIds.has(finding.id)),
  );
  ctx.events.publish(saved.review.id, { type: "review_updated" });
};

const runBackground = async (
  ctx: AppContext,
  deps: RefreshDeps,
  saved: SavedRefresh,
  earlier: readonly Finding[],
): Promise<void> => {
  const reviewId = saved.review.id;
  try {
    const outcomes = await Promise.allSettled([
      runChunkingStep(ctx, deps, saved),
      runReviewStep(ctx, deps, saved, earlier),
    ]);
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [errorMessage(outcome.reason)] : []));
    if (failures.length > 0) {
      const message = `Refresh to ${saved.review.headSha.slice(0, 7)} partly failed: ${failures.join("; ")}`;
      console.error(`[four-eyes] ${message} (review ${reviewId})`);
      ctx.events.publish(reviewId, { type: "step", step: "refresh", state: "failed", message });
    } else {
      ctx.events.publish(reviewId, {
        type: "step",
        step: "refresh",
        state: "done",
        message: `Round ${saved.round.number} chunked and reviewed`,
      });
    }
  } finally {
    clearRefreshing(ctx, reviewId);
    if (reviewsRepo.getReview(ctx.db, reviewId)) publishRefreshStatus(ctx, reviewId);
  }
};

const unchangedResponse = (ctx: AppContext, review: Review): ApplyRefreshResponse => {
  const round = roundsRepo.getLatestRound(ctx.db, review.id);
  return {
    status: toRefreshStatus(ctx, review),
    roundId: round?.id ?? null,
    roundNumber: round?.number ?? null,
    matchedHunks: hunksRepo.listHunks(ctx.db, review.id, { presentOnly: true }).length,
    addedHunks: 0,
    missingHunks: 0,
  };
};

const prepareRefresh = async (
  ctx: AppContext,
  review: Review,
  meta: PrMeta,
  deps: RefreshDeps,
): Promise<{ readonly saved: SavedRefresh; readonly match: HunkMatchResult }> => {
  await deps.fetchPrCommits(ctx, prRefOf(review), meta);
  const worktree = await deps.ensureWorktree(ctx, review.id);
  await deps.moveWorktree(ctx, worktree, meta.headSha);
  const next = await deps.computeHunks(worktree, meta.baseSha, meta.headSha);
  const previous = hunksRepo.listHunks(ctx.db, review.id);
  const match = matchHunks(previous, next);
  return { saved: saveRefresh(ctx, review, meta, previous, match), match };
};

/** applyRefresh with injectable ingest/claude dependencies. `background` settles when chunking, review and reconciliation finish. */
export const startApplyRefresh = async (ctx: AppContext, reviewId: string, deps: RefreshDeps): Promise<StartedRefresh> => {
  const review = reviewsRepo.requireReview(ctx.db, reviewId);
  assertRefreshable(ctx, review);
  markRefreshing(ctx, reviewId);
  try {
    ctx.events.publish(reviewId, { type: "step", step: "refresh", state: "started", message: "Checking the PR for new commits" });
    const meta = await fetchPrMeta(ctx, review);
    if (meta.state !== "open") {
      reviewsRepo.updateReview(ctx.db, reviewId, { ghState: meta.state, remoteHeadSha: meta.headSha, remoteCheckedAt: nowIso() });
      await deps.moveReviewToPast(ctx, reviewId);
      throw new HttpError(409, `The PR is ${meta.state}, so the review was moved to Past instead of refreshing`);
    }
    if (meta.headSha === review.headSha && meta.baseSha === review.baseSha) {
      const current = reviewsRepo.updateReview(ctx.db, reviewId, { remoteHeadSha: meta.headSha, remoteCheckedAt: nowIso() });
      clearRefreshing(ctx, reviewId);
      ctx.events.publish(reviewId, { type: "step", step: "refresh", state: "skipped", message: "Already up to date" });
      publishRefreshStatus(ctx, reviewId);
      return { response: unchangedResponse(ctx, current), background: Promise.resolve() };
    }
    const earlier = findingsRepo.listFindings(ctx.db, reviewId);
    const { saved, match } = await prepareRefresh(ctx, review, meta, deps);
    ctx.events.publish(reviewId, {
      type: "step",
      step: "refresh",
      state: "started",
      message: `${match.matched.length} hunks kept, ${match.added.length} new, ${saved.newlyMissing} no longer in PR`,
    });
    ctx.events.publish(reviewId, { type: "review_updated" });
    const response: ApplyRefreshResponse = {
      status: toRefreshStatus(ctx, saved.review),
      roundId: saved.round.id,
      roundNumber: saved.round.number,
      matchedHunks: match.matched.length,
      addedHunks: match.added.length,
      missingHunks: saved.newlyMissing,
    };
    publishRefreshStatus(ctx, reviewId);
    return { response, background: runBackground(ctx, deps, saved, earlier) };
  } catch (error) {
    clearRefreshing(ctx, reviewId);
    const message = `Refresh failed: ${errorMessage(error)}`;
    ctx.events.publish(reviewId, { type: "step", step: "refresh", state: "failed", message });
    if (reviewsRepo.getReview(ctx.db, reviewId)) publishRefreshStatus(ctx, reviewId);
    throw error;
  }
};

/**
 * Re-fetches the PR, moves the worktree, recomputes hunks, matches by fingerprint (matched hunks keep their
 * rows and progress, missing ones get present=false), creates Round N for added hunks, then starts
 * runChunking for Round N and runReview + reconcileFindings in the background.
 */
export const applyRefresh = async (ctx: AppContext, reviewId: string): Promise<ApplyRefreshResponse> => {
  const { response } = await startApplyRefresh(ctx, reviewId, defaultRefreshDeps);
  return response;
};
