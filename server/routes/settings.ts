import type { Hono } from "hono";
import { routes } from "@shared/api";
import { claudeExecutableInput, type AppContext } from "../context";
import { describeClaudeExecutable, resolveClaudeExecutable } from "../claude/executable";
import { settingsRepo } from "../db/repositories";
import { HttpError } from "../lib/errors";
import { registerJson } from "../lib/http";

export const registerSettingsRoutes = (app: Hono, ctx: AppContext): void => {
  registerJson(app, routes.getSettings, () => settingsRepo.getSettings(ctx.db));
  registerJson(app, routes.updateSettings, ({ body }) => {
    if (body.claudePath !== undefined && body.claudePath !== null) {
      const resolved = resolveClaudeExecutable({ ...claudeExecutableInput(ctx.config, ctx.db), settingPath: body.claudePath });
      if (!resolved.ok) throw new HttpError(400, resolved.error);
    }
    return settingsRepo.updateSettings(ctx.db, body);
  });
  registerJson(app, routes.getClaudeExecutable, () => describeClaudeExecutable(claudeExecutableInput(ctx.config, ctx.db)));
};
