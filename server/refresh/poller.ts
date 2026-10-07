import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { sweepPastWorktrees } from "../ingest/lifecycle";
import { errorMessage } from "../lib/errors";
import { defaultRefreshDeps, type RefreshDeps } from "./deps";
import { isRefreshing } from "./state";
import { checkReviewWith } from "./status";

export interface PollResult {
  readonly checked: readonly string[];
  readonly failed: readonly { readonly reviewId: string; readonly error: string }[];
}

export interface PollOptions {
  readonly onlyOpen: boolean;
}

/** Ticks between checks of active reviews that nobody has open; open reviews are checked on every tick. */
export const IDLE_CHECK_EVERY_TICKS = 5;

/**
 * Checks active, fully ingested reviews once, one at a time. With onlyOpen, only reviews open in the browser
 * (with a live event stream) are checked. Failures are logged and collected, never thrown.
 */
export const pollOnce = async (
  ctx: AppContext,
  deps: RefreshDeps = defaultRefreshDeps,
  options: PollOptions = { onlyOpen: false },
): Promise<PollResult> => {
  const candidates = reviewsRepo
    .listReviews(ctx.db, "active")
    .filter((review) => review.pipelineStatus !== "ingesting" && review.pipelineStatus !== "failed")
    .filter((review) => !isRefreshing(ctx, review.id))
    .filter((review) => !options.onlyOpen || ctx.events.hasSubscribers(review.id));
  return candidates.reduce<Promise<PollResult>>(async (previous, review) => {
    const acc = await previous;
    try {
      await checkReviewWith(ctx, review.id, deps);
      return { ...acc, checked: [...acc.checked, review.id] };
    } catch (error) {
      const message = errorMessage(error);
      console.error(`[four-eyes] refresh check failed for review ${review.id}: ${message}`);
      return { ...acc, failed: [...acc.failed, { reviewId: review.id, error: message }] };
    }
  }, Promise.resolve({ checked: [], failed: [] }));
};

/**
 * Every config.pollIntervalMs, checks the reviews open in the browser. Every IDLE_CHECK_EVERY_TICKS ticks (starting
 * with the first) it checks every active review, so merged or closed PRs still move to Past. Returns a stop function.
 */
export const startRefreshPoller = (ctx: AppContext, deps: RefreshDeps = defaultRefreshDeps): (() => void) => {
  const state = { polling: false, stopped: false, ticks: 0 };
  const tick = (): void => {
    if (state.polling || state.stopped) return;
    state.polling = true;
    const onlyOpen = state.ticks % IDLE_CHECK_EVERY_TICKS !== 0;
    state.ticks += 1;
    pollOnce(ctx, deps, { onlyOpen })
      .then(() => sweepPastWorktrees(ctx))
      .catch((error: unknown) => {
        console.error(`[four-eyes] refresh poll failed: ${errorMessage(error)}`);
      })
      .finally(() => {
        state.polling = false;
      });
  };
  const timer = setInterval(tick, ctx.config.pollIntervalMs);
  timer.unref();
  return () => {
    state.stopped = true;
    clearInterval(timer);
  };
};
