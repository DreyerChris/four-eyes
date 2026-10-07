import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PR_REF = "refs/pull/1/head";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Octo Cat",
  GIT_AUTHOR_EMAIL: "octocat@example.com",
  GIT_COMMITTER_NAME: "Octo Cat",
  GIT_COMMITTER_EMAIL: "octocat@example.com",
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, encoding: "utf8" }).trim();

/** Path of the fake-GitHub fixture repo the e2e server builds under its FOUR_EYES_HOME. */
export const fakeRemoteDir = (): string => {
  const home = process.env.FOUR_EYES_E2E_HOME;
  if (home === undefined) throw new Error("FOUR_EYES_E2E_HOME is not set; run through playwright.config.ts");
  return join(home, "fake-gh", "four-eyes-fixture", "demo");
};

/** Sets the fixture PR's GitHub state as reported by the fake client ("open" removes the override). */
export const setPrState = (state: "open" | "merged" | "closed"): void => {
  const file = join(fakeRemoteDir(), ".git", "four-eyes-pr-state");
  if (state === "open") rmSync(file, { force: true });
  else writeFileSync(file, `${state}\n`);
};

/** Current head SHA of the fixture PR. */
export const prHead = (): string => git(fakeRemoteDir(), ["rev-parse", PR_REF]);

/** Points the fixture PR back at an earlier head, undoing pushCommit. */
export const resetPrHead = (sha: string): void => {
  git(fakeRemoteDir(), ["update-ref", PR_REF, sha]);
};

export interface FileEdit {
  readonly path: string;
  readonly edit: (content: string) => string;
}

/** Adds one commit on top of the fixture PR head and moves refs/pull/1/head to it. Returns the new SHA. */
export const pushCommit = (message: string, edits: readonly FileEdit[]): string => {
  const remote = fakeRemoteDir();
  const scratch = mkdtempSync(join(tmpdir(), "four-eyes-e2e-remote-"));
  try {
    git(scratch, ["init", "--quiet"]);
    git(scratch, ["fetch", "--quiet", remote, PR_REF]);
    git(scratch, ["checkout", "--quiet", "FETCH_HEAD"]);
    for (const { path, edit } of edits) {
      const full = join(scratch, path);
      const before = (() => {
        try {
          return readFileSync(full, "utf8");
        } catch {
          return "";
        }
      })();
      writeFileSync(full, edit(before));
    }
    git(scratch, ["add", "--all"]);
    git(scratch, ["commit", "--quiet", "--no-verify", "-m", message]);
    const sha = git(scratch, ["rev-parse", "HEAD"]);
    git(remote, ["fetch", "--quiet", scratch, `+HEAD:${PR_REF}`]);
    return sha;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
