import type { AppContext } from "../context";

const running = new WeakMap<AppContext, Set<string>>();

const setFor = (ctx: AppContext): Set<string> => {
  const existing = running.get(ctx);
  if (existing) return existing;
  const created = new Set<string>();
  running.set(ctx, created);
  return created;
};

export const isRefreshing = (ctx: AppContext, reviewId: string): boolean => setFor(ctx).has(reviewId);

export const markRefreshing = (ctx: AppContext, reviewId: string): void => {
  setFor(ctx).add(reviewId);
};

export const clearRefreshing = (ctx: AppContext, reviewId: string): void => {
  setFor(ctx).delete(reviewId);
};
