import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type ToolDecision = { readonly allow: true } | { readonly allow: false; readonly reason: string };

export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Bash"] as const;

export const ALLOWED_TOOL_RULES: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git log:*)",
  "Bash(git blame:*)",
  "Bash(git show:*)",
];

export const DISALLOWED_TOOLS: readonly string[] = [
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "TodoWrite",
  "KillShell",
];

const GIT_COMMAND = /^git\s+(log|blame|show)(\s+[^;&|`$<>()\\\n\r{}!*?]*)?$/;
const HOME_EXPANSION = /(^|\s|=)~/;
const FORBIDDEN_GIT_FLAGS = /(^|\s)(--output|--ext-diff|--textconv)/;

const allow: ToolDecision = { allow: true };
const deny = (reason: string): ToolDecision => ({ allow: false, reason });

const asRecord = (input: unknown): Readonly<Record<string, unknown>> =>
  typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

const stringField = (input: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = input[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const realPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realPath(parent), basename(path));
  }
};

const isInside = (root: string, target: string): boolean => {
  const rel = relative(realPath(resolve(root)), realPath(resolve(root, target)));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const checkPath = (cwd: string, path: string | undefined, what: string): ToolDecision =>
  path === undefined || isInside(cwd, path) ? allow : deny(`${what} must stay inside the PR worktree; "${path}" is outside it`);

const checkGlobPattern = (cwd: string, pattern: string | undefined): ToolDecision => {
  if (pattern === undefined) return allow;
  if (pattern.split(/[\\/]/).includes("..")) return deny(`Glob pattern "${pattern}" must not climb out of the PR worktree`);
  return isAbsolute(pattern) ? checkPath(cwd, pattern, "Glob pattern") : allow;
};

const checkBash = (command: string | undefined): ToolDecision => {
  const trimmed = command?.trim();
  if (trimmed === undefined || trimmed === "") return deny("Bash needs a command");
  if (!GIT_COMMAND.test(trimmed)) {
    return deny(`Only plain "git log", "git blame" and "git show" commands are allowed, without pipes or shell syntax. Refused: ${trimmed}`);
  }
  if (HOME_EXPANSION.test(trimmed)) return deny(`Home-directory paths are not allowed: ${trimmed}`);
  if (FORBIDDEN_GIT_FLAGS.test(trimmed)) return deny(`That git option is not allowed in read-only review mode: ${trimmed}`);
  return allow;
};

/**
 * Read-only policy enforced by a PreToolUse hook on every Claude run: Read/Grep/Glob inside the worktree (symlinks resolved),
 * Bash limited to git log/blame/show, and no write, web, agent or MCP tools. Other internal tools, such as the
 * structured-output tool, are left to the "dontAsk" permission mode.
 */
export const evaluateToolUse = (toolName: string, rawInput: unknown, cwd: string): ToolDecision => {
  const input = asRecord(rawInput);
  if (toolName.startsWith("mcp__") || DISALLOWED_TOOLS.includes(toolName)) {
    return deny(`Tool "${toolName}" is not available in read-only review mode`);
  }
  switch (toolName) {
    case "Read":
      return checkPath(cwd, stringField(input, "file_path"), "Read path");
    case "Grep":
      return checkPath(cwd, stringField(input, "path"), "Grep path");
    case "Glob": {
      const pathDecision = checkPath(cwd, stringField(input, "path"), "Glob path");
      return pathDecision.allow ? checkGlobPattern(cwd, stringField(input, "pattern")) : pathDecision;
    }
    case "Bash":
      return checkBash(stringField(input, "command"));
    default:
      return allow;
  }
};
