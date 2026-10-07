import type { Hono } from "hono";
import { routes } from "@shared/api";
import type { AppContext } from "../context";
import { seedFixtureReview } from "../core/seed";
import { HttpError } from "../lib/errors";
import { registerJson } from "../lib/http";

export const registerTestFixtureRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.seedFixture, () => {
    if (!ctx.config.fakeClaude) throw new HttpError(404, "Fixture seeding is only available with FOUR_EYES_FAKE_CLAUDE=1");
    return { reviewId: seedFixtureReview(ctx).id };
  });
};
