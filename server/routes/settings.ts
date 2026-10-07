import type { Hono } from "hono";
import { routes } from "@shared/api";
import { claudeExecutableInput, type AppContext } from "../context";
import { describeClaudeExecutable, resolveClaudeExecutable } from "../claude/executable";
import { settingsRepo } from "../db/repositories";
import { errorMessage, HttpError } from "../lib/errors";
import { registerJson } from "../lib/http";
import { pollSuggestions } from "../suggestions/poll";

export const registerSettingsRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.getSettings, () => settingsRepo.getSettings(ctx.db));
  registerJson(app, routes.updateSettings, ({ body }) => {
    if (body.claudePath !== undefined && body.claudePath !== null) {
      const resolved = resolveClaudeExecutable({ ...claudeExecutableInput(ctx.config, ctx.db), settingPath: body.claudePath });
      if (!resolved.ok) throw new HttpError(400, resolved.error);
    }
    const wasSuggesting = settingsRepo.getSettings(ctx.db).suggestPrs;
    const updated = settingsRepo.updateSettings(ctx.db, body);
    if (updated.suggestPrs && !wasSuggesting) {
      pollSuggestions(ctx).catch((error: unknown) => console.error(`[four-eyes] PR suggestions poll failed: ${errorMessage(error)}`));
    }
    return updated;
  });
  registerJson(app, routes.getClaudeExecutable, () => describeClaudeExecutable(claudeExecutableInput(ctx.config, ctx.db)));
};
