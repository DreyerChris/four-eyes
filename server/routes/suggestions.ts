import type { Hono } from "hono";
import { routes } from "@shared/api";
import type { AppContext } from "../context";
import { settingsRepo, suggestionsRepo } from "../db/repositories";
import { HttpError } from "../lib/errors";
import { registerJson } from "../lib/http";
import { nowIso } from "../lib/time";
import { listSuggestions, pollSuggestions } from "../suggestions/poll";

export const registerSuggestionRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.listSuggestions, () => listSuggestions(ctx));
  registerJson(app, routes.checkSuggestions, async () => {
    if (!settingsRepo.getSettings(ctx.db).suggestPrs) throw new HttpError(409, "PR suggestions are turned off in settings");
    await pollSuggestions(ctx);
    return listSuggestions(ctx);
  });
  registerJson(app, routes.dismissSuggestion, ({ params }) => {
    suggestionsRepo.dismiss(ctx.db, params.suggestionId, nowIso());
    return { ok: true } as const;
  });
  registerJson(app, routes.ignoreSuggestion, ({ params }) => {
    suggestionsRepo.ignore(ctx.db, params.suggestionId, nowIso());
    return { ok: true } as const;
  });
};
