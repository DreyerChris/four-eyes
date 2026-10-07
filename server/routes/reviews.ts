import type { Hono } from "hono";
import { routes } from "@shared/api";
import type { AppContext } from "../context";
import { rerunReview } from "../claude/rerun-review";
import { submitGitHubReview } from "../core/github-review";
import { buildReviewDetail, buildSummary, listReviewItems, toListItem } from "../core/views";
import { reviewsRepo } from "../db/repositories";
import { deleteReview, moveReviewToPast } from "../ingest/lifecycle";
import { startIngest } from "../ingest/pipeline";
import { registerJson } from "../lib/http";

export const registerReviewRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.listReviews, ({ query }) => ({ reviews: [...listReviewItems(ctx.db, query.status)] }));

  registerJson(app, routes.createReview, async ({ body }) => {
    const { review, reopened } = await startIngest(ctx, body);
    return { review: toListItem(ctx.db, review), reopened };
  });

  registerJson(app, routes.getReview, ({ params }) => buildReviewDetail(ctx.db, params.reviewId));

  registerJson(app, routes.deleteReview, async ({ params }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    await deleteReview(ctx, params.reviewId);
    return { ok: true } as const;
  });

  registerJson(app, routes.finishReview, async ({ params }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    const review = await moveReviewToPast(ctx, params.reviewId);
    return { review: toListItem(ctx.db, review) };
  });

  registerJson(app, routes.rerunReview, ({ params }) => {
    rerunReview(ctx, params.reviewId);
    return { ok: true } as const;
  });

  registerJson(app, routes.submitGitHubReview, ({ params, body }) => submitGitHubReview(ctx, params.reviewId, body));

  registerJson(app, routes.getSummary, ({ params }) => buildSummary(ctx.db, params.reviewId));
};
