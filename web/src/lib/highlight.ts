import type { BundledTheme, Highlighter } from "shiki";
import type { Theme } from "@shared/domain";

export type SyntaxKind = "comment" | "string";

export interface HighlightToken {
  readonly content: string;
  readonly color?: string;
  readonly fontStyle?: "italic" | "bold" | "underline";
  readonly syntax?: SyntaxKind;
}

export type HighlightedLine = readonly HighlightToken[];

const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  graphql: "graphql",
  gql: "graphql",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  lua: "lua",
  dart: "dart",
  scala: "scala",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  tf: "hcl",
  hcl: "hcl",
  proto: "proto",
  prisma: "prisma",
  ini: "ini",
};

const FILENAME_LANGUAGES: Readonly<Record<string, string>> = {
  dockerfile: "docker",
  makefile: "make",
  gemfile: "ruby",
  rakefile: "ruby",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
};

/** Shiki language id for a file path ("typescript", "tsx", "json", ...), or "text" when unknown. */
export const languageForPath = (path: string): string => {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  const byName = FILENAME_LANGUAGES[name];
  if (byName) return byName;
  if (name.startsWith("dockerfile")) return "docker";
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "text";
  return EXTENSION_LANGUAGES[name.slice(dot + 1)] ?? "text";
};

const SYNTAX_THEMES: Readonly<Record<Theme, BundledTheme>> = {
  dark: "github-dark-default",
  light: "github-light-default",
  "tokyo-night": "tokyo-night",
  "catppuccin-mocha": "catppuccin-mocha",
  "catppuccin-latte": "catppuccin-latte",
  dracula: "dracula",
  gruvbox: "gruvbox-dark-medium",
  nord: "nord",
  "rose-pine": "rose-pine",
  synthwave: "synthwave-84",
};
const CACHE_LIMIT = 300;

const plainLines = (code: string): readonly HighlightedLine[] => code.split("\n").map((line) => [{ content: line }]);

const fontStyleOf = (flags: number | undefined): HighlightToken["fontStyle"] => {
  if (flags === undefined || flags <= 0) return undefined;
  if (flags & 1) return "italic";
  if (flags & 2) return "bold";
  if (flags & 4) return "underline";
  return undefined;
};

/** "comment" or "string" when the innermost relevant TextMate scope is a comment or string literal; template `${}` code counts as code. */
export const syntaxOfScopes = (scopes: readonly string[]): SyntaxKind | undefined => {
  const innermost = [...scopes].reverse().find((scope) => /^(comment|string|meta\.template\.expression|meta\.embedded)\b/.test(scope));
  if (innermost === undefined) return undefined;
  if (innermost.startsWith("comment")) return "comment";
  if (innermost.startsWith("string")) return "string";
  return undefined;
};

let highlighterPromise: Promise<{ readonly highlighter: Highlighter; readonly known: ReadonlySet<string> }> | null = null;

const loadHighlighter = (): Promise<{ readonly highlighter: Highlighter; readonly known: ReadonlySet<string> }> => {
  highlighterPromise ??= import("shiki")
    .then(async (shiki) => ({
      highlighter: await shiki.createHighlighter({ themes: [], langs: [], engine: shiki.createJavaScriptRegexEngine() }),
      known: new Set([...Object.keys(shiki.bundledLanguages), ...Object.keys(shiki.bundledLanguagesAlias)]),
    }))
    .catch((error: unknown) => {
      highlighterPromise = null;
      throw error;
    });
  return highlighterPromise;
};

const languageLoads = new Map<string, Promise<void>>();

const ensureLanguage = (highlighter: Highlighter, language: string): Promise<void> => {
  const existing = languageLoads.get(language);
  if (existing) return existing;
  const load = highlighter.loadLanguage(language as Parameters<Highlighter["loadLanguage"]>[0]).catch((error: unknown) => {
    languageLoads.delete(language);
    throw error;
  });
  languageLoads.set(language, load);
  return load;
};

const themeLoads = new Map<BundledTheme, Promise<void>>();

const ensureTheme = (highlighter: Highlighter, theme: BundledTheme): Promise<void> => {
  const existing = themeLoads.get(theme);
  if (existing) return existing;
  const load = highlighter.loadTheme(theme).catch((error: unknown) => {
    themeLoads.delete(theme);
    throw error;
  });
  themeLoads.set(theme, load);
  return load;
};

const cache = new Map<string, readonly HighlightedLine[]>();

const remember = (key: string, lines: readonly HighlightedLine[]): readonly HighlightedLine[] => {
  cache.set(key, lines);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return lines;
};

/**
 * Highlights code into per-line tokens in the syntax colours that match the app theme, loading Shiki, the language and the colours lazily on first use.
 * Falls back to plain, uncoloured lines for unknown languages; rejects if Shiki itself fails to load.
 */
export const highlightCode = async (code: string, language: string, theme: Theme): Promise<readonly HighlightedLine[]> => {
  if (language === "text") return plainLines(code);
  const syntaxTheme = SYNTAX_THEMES[theme];
  const key = `${syntaxTheme}\u0000${language}\u0000${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const { highlighter, known } = await loadHighlighter();
  if (!known.has(language)) return plainLines(code);
  await Promise.all([ensureLanguage(highlighter, language), ensureTheme(highlighter, syntaxTheme)]);
  const tokens = highlighter.codeToTokensBase(code, {
    lang: language as Parameters<Highlighter["codeToTokensBase"]>[1]["lang"],
    theme: syntaxTheme,
    includeExplanation: "scopeName",
  });
  return remember(
    key,
    tokens.map((line) =>
      line.flatMap((token): readonly HighlightToken[] => {
        const fontStyle = fontStyleOf(token.fontStyle);
        const style = { ...(token.color ? { color: token.color } : {}), ...(fontStyle ? { fontStyle } : {}) };
        const parts = token.explanation ?? [];
        if (parts.length === 0 || parts.map((part) => part.content).join("") !== token.content) return [{ content: token.content, ...style }];
        return parts.map((part): HighlightToken => {
          const syntax = syntaxOfScopes(part.scopes.map((scope) => scope.scopeName));
          return { content: part.content, ...style, ...(syntax ? { syntax } : {}) };
        });
      }),
    ),
  );
};
