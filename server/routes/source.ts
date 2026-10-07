import type { Hono } from "hono";
import { routes } from "@shared/api";
import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { getContextLines, getFileContents, searchDefinitions } from "../ingest/source";
import { registerJson } from "../lib/http";

export const registerSourceRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.getFileContents, ({ params, query }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return getFileContents(ctx, params.reviewId, query);
  });

  registerJson(app, routes.getContextLines, ({ params, query }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return getContextLines(ctx, params.reviewId, query);
  });

  registerJson(app, routes.searchDefinitions, ({ params, query }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return searchDefinitions(ctx, params.reviewId, query);
  });
};
