import { Hono } from "hono";
import type { AppContext } from "./context";
import { handleError } from "./lib/http";
import { registerProgressRoutes } from "./routes/progress";
import { registerQuestionRoutes } from "./routes/questions";
import { registerRefreshRoutes } from "./routes/refresh";
import { registerReviewRoutes } from "./routes/reviews";
import { registerSettingsRoutes } from "./routes/settings";
import { registerSourceRoutes } from "./routes/source";
import { registerTestFixtureRoutes } from "./routes/test-fixtures";

/** Builds the Hono app with every API route from shared/api.ts registered. */
export const createApp = (ctx: AppContext): Hono => {
  const app = new Hono();
  app.onError(handleError);
  app.get("/api/health", (c) => c.json({ ok: true as const, fakeClaude: ctx.config.fakeClaude }));
  registerReviewRoutes(app, ctx);
  registerProgressRoutes(app, ctx);
  registerQuestionRoutes(app, ctx);
  registerSourceRoutes(app, ctx);
  registerRefreshRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerTestFixtureRoutes(app, ctx);
  app.all("/api/*", (c) => c.json({ error: `No API route for ${c.req.method} ${c.req.path}` }, 404));
  return app;
};
