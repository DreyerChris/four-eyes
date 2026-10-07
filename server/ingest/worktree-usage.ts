import type { AppContext } from "../context";

const lastUse = new WeakMap<AppContext, Map<string, number>>();

const usesFor = (ctx: AppContext): Map<string, number> => {
  const existing = lastUse.get(ctx);
  if (existing) return existing;
  const created = new Map<string, number>();
  lastUse.set(ctx, created);
  return created;
};

/** Records that a review's worktree was just used, so idle cleanup leaves it alone for a while. */
export const noteWorktreeUse = (ctx: AppContext, reviewId: string, now: number = Date.now()): void => {
  usesFor(ctx).set(reviewId, now);
};

/** When the review's worktree was last used in this process, or null if never. */
export const lastWorktreeUse = (ctx: AppContext, reviewId: string): number | null => usesFor(ctx).get(reviewId) ?? null;

/** Forgets a review's worktree use, after its worktree is removed. */
export const forgetWorktreeUse = (ctx: AppContext, reviewId: string): void => {
  usesFor(ctx).delete(reviewId);
};
