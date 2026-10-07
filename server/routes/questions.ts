import type { Hono } from "hono";
import { routes } from "@shared/api";
import { askQuestion } from "../claude/qa";
import type { AppContext } from "../context";
import { questionsRepo, reviewsRepo } from "../db/repositories";
import { registerJson, registerSse } from "../lib/http";

export const registerQuestionRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.listQuestions, ({ params, query }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return { questions: [...questionsRepo.listQuestions(ctx.db, params.reviewId, query.chunkId)] };
  });

  registerSse(app, routes.askQuestion, ({ params, body, signal }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return askQuestion(ctx, params.reviewId, body, signal);
  });
};
