import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ChangeType } from "@shared/domain";
import type { FingerprintedHunk } from "../../ingest/types";
import { changedLinesSignature } from "../match";

export interface TempRepo {
  readonly dir: string;
  readonly git: (...args: readonly string[]) => string;
  readonly write: (files: Readonly<Record<string, string | null>>) => void;
  readonly commit: (message: string, files?: Readonly<Record<string, string | null>>) => string;
  readonly head: () => string;
  readonly hunks: (baseSha: string, headSha: string) => Promise<readonly FingerprintedHunk[]>;
  readonly remove: () => void;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Four Eyes Test",
  GIT_AUTHOR_EMAIL: "test@four-eyes.invalid",
  GIT_COMMITTER_NAME: "Four Eyes Test",
  GIT_COMMITTER_EMAIL: "test@four-eyes.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

interface FileHeader {
  readonly filePath: string;
  readonly oldFilePath: string | null;
  readonly changeType: ChangeType;
}

interface ParseState {
  readonly hunks: readonly FingerprintedHunk[];
  readonly header: FileHeader | null;
  readonly current: { readonly header: FileHeader; readonly lines: readonly string[] } | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const finish = (state: ParseState): readonly FingerprintedHunk[] => {
  if (state.current === null) return state.hunks;
  const [first = "", ...body] = state.current.lines;
  const match = HUNK_HEADER.exec(first);
  if (!match) throw new Error(`Malformed hunk header in test diff: ${first}`);
  const patchText = [first, ...body].join("\n");
  const { header } = state.current;
  const fingerprint = createHash("sha256")
    .update(`${header.filePath}\n${changedLinesSignature(patchText)}`)
    .digest("hex")
    .slice(0, 16);
  return [
    ...state.hunks,
    {
      ...header,
      oldStart: Number(match[1]),
      oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newLines: match[4] === undefined ? 1 : Number(match[4]),
      patchText,
      fingerprint,
    },
  ];
};

const updateHeader = (header: FileHeader, line: string): FileHeader => {
  if (line.startsWith("new file mode")) return { ...header, changeType: "added" };
  if (line.startsWith("deleted file mode")) return { ...header, changeType: "deleted" };
  if (line.startsWith("rename from ")) return { ...header, oldFilePath: line.slice("rename from ".length), changeType: "renamed" };
  if (line.startsWith("rename to ")) return { ...header, filePath: line.slice("rename to ".length) };
  return header;
};

/** Minimal unified diff parser for refresh tests. Ingest owns the production parser. */
export const parseTestDiff = (raw: string): readonly FingerprintedHunk[] => {
  const end = raw
    .split("\n")
    .reduce<ParseState>(
      (state, line) => {
        const fileMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
        if (fileMatch) {
          return {
            hunks: finish(state),
            header: { filePath: fileMatch[2] ?? "", oldFilePath: null, changeType: "modified" },
            current: null,
          };
        }
        if (line.startsWith("@@")) {
          if (state.header === null) throw new Error(`Hunk without file header in test diff: ${line}`);
          return { hunks: finish(state), header: state.header, current: { header: state.header, lines: [line] } };
        }
        if (state.current !== null && /^[ +\-\\]/.test(line)) {
          return { ...state, current: { ...state.current, lines: [...state.current.lines, line] } };
        }
        if (state.current === null && state.header !== null) {
          return { ...state, header: updateHeader(state.header, line) };
        }
        return state;
      },
      { hunks: [], header: null, current: null },
    );
  return finish(end);
};

/** Creates an empty git repo in a temp folder with a deterministic identity and `main` as the initial branch. */
export const createTempRepo = (): TempRepo => {
  const dir = mkdtempSync(join(tmpdir(), "four-eyes-refresh-repo-"));
  const gitRaw = (...args: readonly string[]): string =>
    execFileSync("git", [...args], { cwd: dir, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const git = (...args: readonly string[]): string => gitRaw(...args).trim();
  git("init", "--quiet", "--initial-branch=main");
  const write = (files: Readonly<Record<string, string | null>>): void => {
    Object.entries(files).forEach(([path, content]) => {
      const full = join(dir, path);
      if (content === null) {
        rmSync(full, { force: true });
        return;
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    });
  };
  const head = (): string => git("rev-parse", "HEAD");
  const commit = (message: string, files: Readonly<Record<string, string | null>> = {}): string => {
    write(files);
    git("add", "--all");
    git("commit", "--quiet", "--allow-empty", "-m", message);
    return head();
  };
  return {
    dir,
    git,
    write,
    commit,
    head,
    hunks: async (baseSha, headSha) => parseTestDiff(gitRaw("diff", "--no-color", "-M", `${baseSha}...${headSha}`)),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};

/** `count` numbered lines such as "line 1\n...line N\n", for files big enough to keep hunks apart. */
export const numberedLines = (count: number, label = "line"): readonly string[] =>
  Array.from({ length: count }, (_, index) => `${label} ${index + 1}`);

export const joinLines = (lines: readonly string[]): string => `${lines.join("\n")}\n`;
