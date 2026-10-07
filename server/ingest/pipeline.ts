import type { CreateReviewRequest } from "@shared/api";
import type { Hunk, PipelineStep, PrRef, Review } from "@shared/domain";
import { runChunking } from "../claude/chunking";
import { runReview } from "../claude/review";
import type { AppContext } from "../context";
import { hunksRepo, reviewsRepo, roundsRepo, suggestionsRepo } from "../db/repositories";
import { suggestionId } from "../suggestions/signals";
import { syncMyReview } from "./my-review";
import { errorMessage } from "../lib/errors";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { addWorktree, diffBetween, ensureBareClone, ensureWorktree, fetchPrCommits, removeWorktree } from "./git";
import { hunksFromDiff } from "./hunks";
import { parsePrUrl, prWebUrl } from "./pr-url";
import type { FingerprintedHunk } from "./types";

export interface StartIngestResult {
  readonly review: Review;
  readonly reopened: boolean;
}

const STEP_LABELS: Readonly<Record<PipelineStep, string>> = {
  fetch_pr: "Fetching the pull request",
  clone: "Fetching commits",
  worktree: "Creating the worktree",
  diff: "Computing the diff",
  parse: "Parsing hunks",
  save: "Saving hunks",
  chunking: "Chunking",
  review: "Reviewing",
  refresh: "Refreshing",
};

class StepError extends Error {
  constructor(step: PipelineStep, cause: unknown) {
    super(`${STEP_LABELS[step]} failed: ${errorMessage(cause)}`, { cause });
    this.name = "StepError";
  }
}

const inflight = new Map<string, Promise<void>>();

const refOf = (review: Review): PrRef => ({ host: review.host, owner: review.owner, repo: review.repo, number: review.prNumber });

const runStep = async <T>(
  ctx: AppContext,
  reviewId: string,
  step: PipelineStep,
  task: () => Promise<T> | T,
  describe: (value: T) => string | null = () => null,
): Promise<T> => {
  ctx.events.publish(reviewId, { type: "step", step, state: "started", message: STEP_LABELS[step] });
  try {
    const value = await task();
    ctx.events.publish(reviewId, { type: "step", step, state: "done", message: describe(value) });
    return value;
  } catch (error) {
    ctx.events.publish(reviewId, { type: "step", step, state: "failed", message: errorMessage(error) });
    throw new StepError(step, error);
  }
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

const describeHunks = (hunks: readonly FingerprintedHunk[]): string =>
  `${plural(hunks.length, "hunk")} in ${plural(new Set(hunks.map((hunk) => hunk.filePath)).size, "file")}`;

const saveRoundOne = (ctx: AppContext, reviewId: string, headSha: string, parsed: readonly FingerprintedHunk[]): string => {
  const roundId = newId("rnd");
  const hunks: readonly Hunk[] = parsed.map((hunk, position) => ({
    ...hunk,
    id: newId("h"),
    reviewId,
    roundId,
    position,
    present: true,
  }));
  ctx.db.transaction((tx) => {
    roundsRepo.insertRound(tx, { id: roundId, reviewId, number: 1, headSha, createdAt: nowIso() });
    hunksRepo.insertHunks(tx, hunks);
    reviewsRepo.updateReview(tx, reviewId, { pipelineStatus: "chunking", pipelineError: null, lastActivityAt: nowIso() });
  });
  return roundId;
};

const ingest = async (ctx: AppContext, reviewId: string): Promise<void> => {
  const ref = refOf(reviewsRepo.requireReview(ctx.db, reviewId));

  const meta = await runStep(ctx, reviewId, "fetch_pr", () => ctx.github.fetchPr(ref), (m) => `${m.title} by ${m.author}`);
  const checkedAt = nowIso();
  reviewsRepo.updateReview(ctx.db, reviewId, {
    title: meta.title,
    author: meta.author,
    url: meta.url,
    ghState: meta.state,
    baseSha: meta.baseSha,
    headSha: meta.headSha,
    remoteHeadSha: meta.headSha,
    remoteCheckedAt: checkedAt,
    lastActivityAt: checkedAt,
  });
  await syncMyReview(ctx, reviewId);

  const bare = await runStep(ctx, reviewId, "clone", async () => {
    const path = await ensureBareClone(ctx, ref);
    await fetchPrCommits(ctx, ref, meta);
    return path;
  });

  const worktree = await runStep(ctx, reviewId, "worktree", () => addWorktree(ctx, ref, reviewId, meta.headSha));
  reviewsRepo.updateReview(ctx.db, reviewId, { worktreePath: worktree });

  const raw = await runStep(ctx, reviewId, "diff", () => diffBetween(bare, meta.baseSha, meta.headSha));

  const hunks = await runStep(
    ctx,
    reviewId,
    "parse",
    () => {
      const parsed = hunksFromDiff(raw);
      if (parsed.length === 0) {
        throw new Error("the pull request has no reviewable text changes (only binary files, pure renames or mode changes)");
      }
      return parsed;
    },
    describeHunks,
  );

  const roundId = await runStep(ctx, reviewId, "save", () => saveRoundOne(ctx, reviewId, meta.headSha, hunks), () => describeHunks(hunks));
  ctx.events.publish(reviewId, { type: "review_updated" });

  const [chunking, review] = await Promise.allSettled([
    runChunking(ctx, { reviewId, roundId }),
    runReview(ctx, { reviewId, roundId }),
  ]);
  if (review.status === "rejected") {
    console.error(`[ingest] review run failed for ${reviewId}: ${errorMessage(review.reason)}`);
  }
  if (chunking.status === "rejected") {
    throw new Error(`Chunking failed: ${errorMessage(chunking.reason)}`, { cause: chunking.reason });
  }
};

const recordFailure = async (ctx: AppContext, reviewId: string, error: unknown): Promise<void> => {
  const message = errorMessage(error);
  if (reviewsRepo.getReview(ctx.db, reviewId) === undefined) {
    await removeWorktree(ctx, reviewId).catch((cleanupError: unknown) => {
      console.error(`[ingest] could not clean up the worktree of deleted review ${reviewId}: ${errorMessage(cleanupError)}`);
    });
    return;
  }
  console.error(`[ingest] pipeline failed for ${reviewId}: ${message}`);
  reviewsRepo.updateReview(ctx.db, reviewId, { pipelineStatus: "failed", pipelineError: message, lastActivityAt: nowIso() });
  ctx.events.publish(reviewId, { type: "review_updated" });
};

/**
 * Full pipeline for a new review: fetch PR meta, clone, worktree, diff, parse, save round 1 + hunks,
 * then runChunking and runReview in parallel. Publishes "step" events and sets pipeline_status/pipeline_error.
 * Never throws: failures are recorded on the review and published.
 */
export const runIngestPipeline = async (ctx: AppContext, reviewId: string): Promise<void> => {
  const existing = inflight.get(reviewId);
  if (existing !== undefined) return existing;
  const run = ingest(ctx, reviewId)
    .catch((error: unknown) => recordFailure(ctx, reviewId, error))
    .catch((error: unknown) => {
      console.error(`[ingest] could not record the failure of review ${reviewId}: ${errorMessage(error)}`);
    })
    .finally(() => {
      inflight.delete(reviewId);
    });
  inflight.set(reviewId, run);
  return run;
};

/** Resolves when the review's in-flight ingest pipeline (if any) has finished. */
export const waitForIngest = (reviewId: string): Promise<void> => inflight.get(reviewId) ?? Promise.resolve();

const placeholderReview = (ref: PrRef): Review => {
  const now = nowIso();
  return {
    id: newId("rev"),
    host: ref.host,
    owner: ref.owner,
    repo: ref.repo,
    prNumber: ref.number,
    title: `${ref.owner}/${ref.repo}#${ref.number}`,
    author: "",
    url: prWebUrl(ref),
    baseSha: "",
    headSha: "",
    ghState: "open",
    status: "active",
    pipelineStatus: "ingesting",
    pipelineError: null,
    worktreePath: null,
    qaSessionId: null,
    remoteHeadSha: null,
    remoteCheckedAt: null,
    myReviewState: null,
    myReviewSubmittedAt: null,
    myReviewCommitSha: null,
    createdAt: now,
    lastActivityAt: now,
    finishedAt: null,
  };
};

const reopen = (ctx: AppContext, existing: Review): StartIngestResult => {
  const now = nowIso();
  const neverSaved = existing.pipelineStatus === "failed" && roundsRepo.listRounds(ctx.db, existing.id).length === 0;
  const review = reviewsRepo.updateReview(ctx.db, existing.id, {
    status: "active",
    finishedAt: null,
    lastActivityAt: now,
    ...(neverSaved ? { pipelineStatus: "ingesting" as const, pipelineError: null } : {}),
  });
  if (neverSaved && !inflight.has(review.id)) {
    void runIngestPipeline(ctx, review.id);
  } else if (review.headSha !== "" && !inflight.has(review.id)) {
    const rebuild = ensureWorktree(ctx, review.id)
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error(`[ingest] could not rebuild the worktree for reopened review ${review.id}: ${errorMessage(error)}`);
      })
      .finally(() => {
        inflight.delete(review.id);
      });
    inflight.set(review.id, rebuild);
  }
  return { review, reopened: true };
};

/**
 * Handles a pasted PR URL. Reopens the existing review for the same PR (moving it back to active),
 * otherwise inserts a review with pipeline_status "ingesting" and starts runIngestPipeline without awaiting it.
 */
export const startIngest = async (ctx: AppContext, request: CreateReviewRequest): Promise<StartIngestResult> => {
  const ref = parsePrUrl(request.url);
  suggestionsRepo.forget(ctx.db, suggestionId(ref.host, ref));
  const existing = reviewsRepo.findReviewByPr(ctx.db, ref);
  if (existing !== undefined) return reopen(ctx, existing);
  const review = reviewsRepo.insertReview(ctx.db, placeholderReview(ref));
  void runIngestPipeline(ctx, review.id);
  return { review, reopened: false };
};
