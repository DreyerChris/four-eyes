import type { Hono } from "hono";
import { routes } from "@shared/api";
import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { registerJson } from "../lib/http";
import { applyRefresh } from "../refresh/apply";
import { checkReview, getRefreshStatus } from "../refresh/status";

export const registerRefreshRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.getRefreshStatus, ({ params }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return getRefreshStatus(ctx, params.reviewId);
  });

  registerJson(app, routes.checkRefresh, ({ params }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return checkReview(ctx, params.reviewId);
  });

  registerJson(app, routes.applyRefresh, ({ params }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return applyRefresh(ctx, params.reviewId);
  });
};
