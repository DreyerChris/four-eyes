import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { ClaudeExecutableSource, ClaudeExecutableStatus } from "@shared/domain";
import { runCommand } from "../ingest/exec";

export interface ClaudeExecutableInput {
  readonly settingPath: string | null;
  readonly envPath: string | null;
  readonly searchPath: string | undefined;
}

export type ResolvedClaudeExecutable =
  | { readonly ok: true; readonly path: string; readonly source: ClaudeExecutableSource }
  | { readonly ok: false; readonly source: ClaudeExecutableSource; readonly error: string };

const expandHome = (path: string): string => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

const isExecutableFile = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const findOnPath = (name: string, searchPath: string | undefined): string | null =>
  (searchPath ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, name))
    .find(isExecutableFile) ?? null;

const checkExplicit = (raw: string, source: ClaudeExecutableSource, searchPath: string | undefined): ResolvedClaudeExecutable => {
  const expanded = expandHome(raw.trim());
  const path = isAbsolute(expanded) ? expanded : findOnPath(expanded, searchPath);
  if (path !== null && isExecutableFile(path)) return { ok: true, path, source };
  const origin = source === "settings" ? "the Claude path in settings" : "FOUR_EYES_CLAUDE_PATH";
  return { ok: false, source, error: `${origin} is "${raw}", but no executable file was found there.` };
};

/** Picks the Claude Code binary: settings first, then FOUR_EYES_CLAUDE_PATH, then `claude` on PATH. */
export const resolveClaudeExecutable = (input: ClaudeExecutableInput): ResolvedClaudeExecutable => {
  if (input.settingPath !== null) return checkExplicit(input.settingPath, "settings", input.searchPath);
  if (input.envPath !== null) return checkExplicit(input.envPath, "env", input.searchPath);
  const found = findOnPath("claude", input.searchPath);
  return found === null
    ? { ok: false, source: "path", error: "Could not find `claude` on PATH. Install Claude Code or set its path in settings." }
    : { ok: true, path: found, source: "path" };
};

/** Resolves the binary and runs `--version` on it so the settings panel can show what will be used. */
export const describeClaudeExecutable = async (input: ClaudeExecutableInput): Promise<ClaudeExecutableStatus> => {
  const resolved = resolveClaudeExecutable(input);
  if (!resolved.ok) return resolved;
  try {
    const version = (await runCommand(resolved.path, ["--version"], { timeoutMs: 15_000 })).trim();
    return { ...resolved, version };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, source: resolved.source, error: `${resolved.path} did not run with --version: ${reason}` };
  }
};
