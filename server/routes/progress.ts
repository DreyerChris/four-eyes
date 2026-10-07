import type { Hono } from "hono";
import { routes } from "@shared/api";
import type { AppContext } from "../context";
import { progressEventStream } from "../core/event-stream";
import { setFindingVerdict, updateChunkProgress } from "../core/mutations";
import { reviewsRepo } from "../db/repositories";
import { registerJson, registerSse } from "../lib/http";

export const registerProgressRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.updateChunkProgress, ({ params, body }) =>
    updateChunkProgress(ctx.db, params.reviewId, params.chunkId, body),
  );

  registerJson(app, routes.setFindingVerdict, ({ params, body }) =>
    setFindingVerdict(ctx.db, params.reviewId, params.findingId, body),
  );

  registerSse(app, routes.progressEvents, ({ params, signal }) => {
    reviewsRepo.requireReview(ctx.db, params.reviewId);
    return progressEventStream(ctx.events, params.reviewId, signal);
  });
};
