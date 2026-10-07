import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PrMeta, PrRef } from "@shared/domain";
import { runCommand } from "./exec";
import type { GitHubClient } from "./github-client";

export interface TempRepo {
  readonly path: string;
  readonly write: (file: string, content: string) => void;
  readonly remove: (file: string) => void;
  readonly git: (...args: readonly string[]) => Promise<string>;
  readonly commit: (message: string) => Promise<string>;
  readonly dispose: () => void;
}

const TEST_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/** Creates a throwaway non-bare git repository on branch main, for tests. */
export const createTempRepo = async (): Promise<TempRepo> => {
  const path = mkdtempSync(join(tmpdir(), "four-eyes-repo-"));
  const git = (...args: readonly string[]): Promise<string> =>
    runCommand("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: path, env: TEST_GIT_ENV });
  await git("init", "--quiet", "-b", "main");
  await git("config", "uploadpack.allowAnySHA1InWant", "true");
  return {
    path,
    git,
    write: (file, content) => {
      mkdirSync(dirname(join(path, file)), { recursive: true });
      writeFileSync(join(path, file), content);
    },
    remove: (file) => rmSync(join(path, file), { force: true }),
    commit: async (message) => {
      await git("add", "--all");
      await git("commit", "--quiet", "--allow-empty", "-m", message);
      return (await git("rev-parse", "HEAD")).trim();
    },
    dispose: () => rmSync(path, { recursive: true, force: true }),
  };
};

/** GitHubClient over a local repository: refs/pull/<n>/head must exist in `repo`. */
export const createLocalGitHubClient = (repoPath: string, meta: (ref: PrRef) => Promise<PrMeta> | PrMeta): GitHubClient => ({
  fetchPr: async (ref) => meta(ref),
  remoteUrl: () => repoPath,
  submitReview: refuseReviewSubmission,
});

/** submitReview for test GitHub clients that never expect a review to be posted. */
export const refuseReviewSubmission = async (): Promise<never> => {
  throw new Error("This test GitHub client does not accept reviews");
};

/** Numbered lines `line 1`..`line n`, each ending in a newline. */
export const numberedLines = (count: number, map: (line: number) => string = (line) => `line ${line}`): string =>
  Array.from({ length: count }, (_, index) => `${map(index + 1)}\n`).join("");
