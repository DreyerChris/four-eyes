import { relative, dirname } from "node:path";
import { z } from "zod";
import type {
  ContextLinesQuery,
  ContextLinesResponse,
  DefinitionMatch,
  DefinitionSearchQuery,
  DefinitionSearchResponse,
  FileContentsQuery,
  FileContentsResponse,
} from "@shared/api";
import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { HttpError } from "../lib/errors";
import { CommandError, runCommandRaw } from "./exec";
import { ensureWorktree, readFileAtSha } from "./git";

const MAX_DEFINITION_MATCHES = 50;
const MAX_PREVIEW_LENGTH = 200;
const SYMBOL_PATTERN = /^#?[A-Za-z_$][A-Za-z0-9_$]*$/;

const splitLines = (content: string): readonly string[] => {
  const lines = content.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  return content.endsWith("\n") ? lines.slice(0, -1) : lines;
};

/** Whole file at `sha` (default: review head). Rebuilds the worktree on demand. content is null if the file does not exist there. */
export const getFileContents = async (
  ctx: AppContext,
  reviewId: string,
  query: FileContentsQuery,
): Promise<FileContentsResponse> => {
  const worktree = await ensureWorktree(ctx, reviewId);
  const sha = query.sha ?? reviewsRepo.requireReview(ctx.db, reviewId).headSha;
  const content = await readFileAtSha(worktree, sha, query.path);
  return { path: query.path, sha, content };
};

/** Lines start..end (1-based, inclusive, clamped to the file) of a file at `sha`, for expanding diff context. */
export const getContextLines = async (
  ctx: AppContext,
  reviewId: string,
  query: ContextLinesQuery,
): Promise<ContextLinesResponse> => {
  if (query.end < query.start) {
    throw new HttpError(400, `Invalid line range ${query.start}-${query.end}: end must not be before start`);
  }
  const worktree = await ensureWorktree(ctx, reviewId);
  const content = await readFileAtSha(worktree, query.sha, query.path);
  if (content === null) throw new HttpError(404, `${query.path} does not exist at ${query.sha.slice(0, 12)}`);
  const all = splitLines(content);
  const start = Math.max(1, query.start);
  const end = Math.min(all.length, query.end);
  const lines = start > end ? [] : all.slice(start - 1, end).map((text, index) => ({ number: start + index, text }));
  return { path: query.path, sha: query.sha, lines, totalLines: all.length };
};

const escapeSymbol = (symbol: string): string => symbol.replace(/\$/g, "\\$");

const MODIFIERS =
  "(?:(?:export|default|declare|abstract|public|private|protected|internal|static|async|final|sealed|open|override|readonly|pub(?:\\([a-z]+\\))?|unsafe|const|extern|inline|virtual|partial)\\s+)*";

/** ripgrep patterns (Rust regex syntax) that match a definition of `symbol` in common languages. */
export const definitionPatterns = (symbol: string): readonly string[] => {
  const name = escapeSymbol(symbol);
  const end = "(?:[^A-Za-z0-9_$]|$)";
  const modifiers = MODIFIERS;
  return [
    `(?:^|[^A-Za-z0-9_$.])${modifiers}(?:function\\*?|class|interface|type|enum|namespace|module|struct|trait|union|record|object|def|fn|fun|func|mod|typealias|protocol|extension|impl)\\s+${name}${end}`,
    `(?:^|[^A-Za-z0-9_$.])${modifiers}(?:const|let|var|val)\\s+${name}\\s*(?::[^=]*)?=`,
    `^\\s*func\\s+\\([^)]*\\)\\s*${name}\\s*[\\[(]`,
    `^\\s*${modifiers}(?:get\\s+|set\\s+|\\*\\s*)?#?${name}\\s*(?:<[^>]*>)?\\s*\\([^;]*\\)\\s*(?::[^;=]+)?\\{\\s*$`,
    `^\\s*${modifiers}#?${name}\\s*(?::[^=;]+)?=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[A-Za-z0-9_$]+)\\s*(?::[^=]+)?=>`,
    `^\\s*${modifiers}#${name}\\s*[?!]?\\s*(?::[^=;]+)?(?:=(?:[^=>]|$)|;\\s*$|$)`,
    `^\\s*${modifiers}${name}\\s*[?!]?\\s*:[^=;]+(?:=(?:[^=>]|$)|;\\s*$)`,
    `^\\s*#\\s*define\\s+${name}${end}`,
  ];
};

/** Patterns for ripgrep's multiline mode: method signatures whose parameters span several lines. */
export const multilineDefinitionPatterns = (symbol: string): readonly string[] => {
  const name = escapeSymbol(symbol);
  return [
    `^[ \\t]*${MODIFIERS}(?:get[ \\t]+|set[ \\t]+|\\*[ \\t]*)?#?${name}[ \\t]*(?:<[^>\\n]*>)?[ \\t]*\\([^;{}]*?\\)[ \\t]*(?::[^;={}]+)?\\{[ \\t]*$`,
  ];
};

const RgMatchSchema = z.object({
  type: z.literal("match"),
  data: z.object({
    path: z.object({ text: z.string() }),
    lines: z.object({ text: z.string() }),
    line_number: z.number().int().positive(),
    submatches: z.array(z.object({ start: z.number().int().nonnegative() })),
  }),
});

const symbolColumn = (line: string, symbol: string, fromByte: number): number => {
  const fromChar = Buffer.from(line, "utf8").subarray(0, fromByte).toString("utf8").length;
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapeSymbol(symbol)}(?![A-Za-z0-9_$])`, "g");
  pattern.lastIndex = fromChar;
  const found = pattern.exec(line);
  return (found?.index ?? fromChar) + 1;
};

const parseRgOutput = (stdout: string, symbol: string): readonly DefinitionMatch[] =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith('{"type":"match"'))
    .flatMap((line): readonly DefinitionMatch[] => {
      const parsed = RgMatchSchema.safeParse(JSON.parse(line));
      if (!parsed.success) return [];
      const { data } = parsed.data;
      const text = data.lines.text.split("\n")[0]?.replace(/\r$/, "") ?? "";
      const path = data.path.text.replace(/^\.\//, "");
      return [
        {
          path,
          line: data.line_number,
          column: symbolColumn(text, symbol, data.submatches[0]?.start ?? 0),
          preview: text.trim().slice(0, MAX_PREVIEW_LENGTH),
        },
      ];
    });

const proximity = (match: DefinitionMatch, fromPath: string | undefined): number => {
  if (fromPath === undefined) return 2;
  if (match.path === fromPath) return 0;
  if (dirname(match.path) === dirname(fromPath)) return 1;
  return 2 + relative(dirname(fromPath), dirname(match.path)).split("/").length;
};

const isTestPath = (path: string): boolean => /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z]+$/i.test(path);

const runRipgrep = async (
  worktree: string,
  symbol: string,
  patterns: readonly string[],
  multiline: boolean,
): Promise<readonly DefinitionMatch[]> => {
  const args = [
    ...(multiline ? ["--multiline"] : []),
    "--json",
    "--no-config",
    "--max-columns",
    "1000",
    "--max-filesize",
    "2M",
    "--glob",
    "!**/node_modules/**",
    "--glob",
    "!**/*.min.js",
    "--glob",
    "!**/*.map",
    ...patterns.flatMap((pattern) => ["-e", pattern]),
    ".",
  ];
  const output = await runCommandRaw("rg", args, { cwd: worktree, timeoutMs: 30_000 }).catch((error: unknown) => {
    const reason = error instanceof CommandError ? error.stderr : String(error);
    throw new HttpError(500, `Definition search could not run ripgrep: ${reason}`);
  });
  if (output.exitCode > 1 && !output.stdout.includes('"type":"match"')) {
    throw new HttpError(500, `ripgrep failed while searching for ${symbol}: ${output.stderr.trim().split("\n").slice(-3).join(" ")}`);
  }
  return parseRgOutput(output.stdout, symbol);
};

/** ripgrep over the review worktree for definition patterns of `symbol` (function/class/const/type/interface/def...). */
export const searchDefinitions = async (
  ctx: AppContext,
  reviewId: string,
  query: DefinitionSearchQuery,
): Promise<DefinitionSearchResponse> => {
  const symbol = query.symbol.trim();
  if (!SYMBOL_PATTERN.test(symbol)) return { symbol, matches: [] };
  const name = symbol.replace(/^#/, "");
  const worktree = await ensureWorktree(ctx, reviewId);
  const [single, multi] = await Promise.all([
    runRipgrep(worktree, name, definitionPatterns(name), false),
    runRipgrep(worktree, name, multilineDefinitionPatterns(name), true),
  ]);
  const unique = new Map([...single, ...multi].map((match) => [`${match.path}:${match.line}`, match] as const));
  const matches = [...unique.values()]
    .sort(
      (a, b) =>
        Number(isTestPath(a.path)) - Number(isTestPath(b.path)) ||
        proximity(a, query.fromPath) - proximity(b, query.fromPath) ||
        a.path.localeCompare(b.path) ||
        a.line - b.line,
    )
    .slice(0, MAX_DEFINITION_MATCHES);
  return { symbol, matches };
};
