import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GhStateSchema, type GhState, type PrMeta, type PrRef } from "@shared/domain";
import type { AppConfig } from "../config";
import { HttpError, errorMessage } from "../lib/errors";
import { CommandError, runCommand, runCommandRaw } from "./exec";
import { prWebUrl } from "./pr-url";

export interface GitHubClient {
  readonly fetchPr: (ref: PrRef) => Promise<PrMeta>;
  readonly remoteUrl: (ref: PrRef) => string;
}

const GH_FIELDS = ["title", "author", "url", "state", "headRefOid", "baseRefOid", "headRefName", "baseRefName"] as const;

const GhPrSchema = z.object({
  title: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  url: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  headRefOid: z.string().min(1),
  baseRefOid: z.string().min(1),
  headRefName: z.string(),
  baseRefName: z.string(),
});

const GH_STATE: Readonly<Record<z.infer<typeof GhPrSchema>["state"], GhState>> = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
};

/** Maps `gh pr view --json` output to PrMeta. Throws a readable error when the JSON has an unexpected shape. */
export const parseGhPrJson = (raw: string): PrMeta => {
  const json = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`gh pr view returned invalid JSON: ${errorMessage(error)}`);
    }
  })();
  const parsed = GhPrSchema.safeParse(json);
  if (!parsed.success) throw new Error(`gh pr view returned unexpected JSON: ${parsed.error.message}`);
  const pr = parsed.data;
  return {
    title: pr.title,
    author: pr.author?.login ?? "ghost",
    url: pr.url,
    state: GH_STATE[pr.state],
    headSha: pr.headRefOid,
    baseSha: pr.baseRefOid,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
  };
};

const ghError = (ref: PrRef, error: unknown): HttpError => {
  const label = `${ref.host}/${ref.owner}/${ref.repo}#${ref.number}`;
  if (!(error instanceof CommandError)) return new HttpError(502, `Could not load ${label} with gh: ${errorMessage(error)}`);
  const stderr = error.stderr;
  if (error.exitCode === -1) return new HttpError(502, `Could not run gh to load ${label}: ${stderr}`);
  if (/could not resolve to a pullrequest|not found|404/i.test(stderr)) {
    return new HttpError(404, `Pull request ${label} was not found, or your gh login cannot see it`);
  }
  if (/auth login|not logged in|authentication|401|403/i.test(stderr)) {
    return new HttpError(502, `gh is not logged in to ${ref.host}. Run: gh auth login --hostname ${ref.host}`);
  }
  return new HttpError(502, `gh pr view failed for ${label}: ${stderr.trim().split("\n").slice(-3).join(" ")}`);
};

/** Real client over the `gh` CLI, using the user's existing logins. Read-only: never writes to GitHub. */
export const createGhCliClient = (): GitHubClient => ({
  fetchPr: async (ref: PrRef): Promise<PrMeta> => {
    const args = ["pr", "view", String(ref.number), "--repo", `${ref.host}/${ref.owner}/${ref.repo}`, "--json", GH_FIELDS.join(",")];
    const output = await runCommandRaw("gh", args, {
      env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1" },
      timeoutMs: 60_000,
    }).catch((error: unknown) => {
      throw ghError(ref, error);
    });
    if (output.exitCode !== 0) throw ghError(ref, new CommandError("gh pr view", output.exitCode, output.stderr));
    return parseGhPrJson(output.stdout);
  },
  remoteUrl: (ref: PrRef): string => `https://${ref.host}/${ref.owner}/${ref.repo}.git`,
});

export const FAKE_PR_URL = "https://github.com/four-eyes-fixture/demo/pull/1";

const FAKE_REF: PrRef = { host: "github.com", owner: "four-eyes-fixture", repo: "demo", number: 1 };
const FAKE_BASE_BRANCH = "main";
const FAKE_HEAD_BRANCH = "feature/welcome-email";
const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/demo", import.meta.url));
const FIXTURE_SUFFIX = ".fixture";

const FAKE_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Octo Cat",
  GIT_AUTHOR_EMAIL: "octocat@example.com",
  GIT_COMMITTER_NAME: "Octo Cat",
  GIT_COMMITTER_EMAIL: "octocat@example.com",
};

const isFakeRef = (ref: PrRef): boolean =>
  ref.host === FAKE_REF.host && ref.owner === FAKE_REF.owner && ref.repo === FAKE_REF.repo && ref.number === FAKE_REF.number;

const fakeGit = (cwd: string, args: readonly string[], date?: string): Promise<string> =>
  runCommand("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: date === undefined ? FAKE_GIT_ENV : { ...FAKE_GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });

const listFixtureFiles = async (root: string): Promise<readonly string[]> => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(FIXTURE_SUFFIX))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
};

const copyFixtureTree = async (source: string, target: string): Promise<void> => {
  const files = await listFixtureFiles(source);
  await Promise.all(
    files.map(async (file) => {
      const destination = join(target, file.slice(0, -FIXTURE_SUFFIX.length));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(source, file), destination);
    }),
  );
};

const commitAll = async (repo: string, message: string, date: string): Promise<void> => {
  await fakeGit(repo, ["add", "--all"]);
  await fakeGit(repo, ["commit", "--quiet", "--no-verify", "-m", message], date);
};

const buildFakeRepo = async (repoDir: string): Promise<void> => {
  const staging = `${repoDir}.building-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await fakeGit(staging, ["init", "--quiet", "-b", FAKE_BASE_BRANCH]);
    await fakeGit(staging, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
    await fakeGit(staging, ["config", "core.autocrlf", "false"]);
    await copyFixtureTree(join(FIXTURE_DIR, "base"), staging);
    await commitAll(staging, "Initial demo app", "2026-01-01T10:00:00Z");
    await fakeGit(staging, ["checkout", "--quiet", "-b", FAKE_HEAD_BRANCH]);
    await fakeGit(staging, ["rm", "-r", "--quiet", "."]);
    await copyFixtureTree(join(FIXTURE_DIR, "head"), staging);
    await commitAll(staging, "Add email to users and send a welcome mail", "2026-01-02T10:00:00Z");
    await fakeGit(staging, ["update-ref", `refs/pull/${FAKE_REF.number}/head`, FAKE_HEAD_BRANCH]);
    await rm(repoDir, { recursive: true, force: true });
    await mkdir(dirname(repoDir), { recursive: true });
    await rename(staging, repoDir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`Could not build the fake GitHub fixture repo at ${repoDir}: ${errorMessage(error)}`, { cause: error });
  }
};

/** File inside the fake repo's .git directory that sets the fixture PR's state ("open", "merged" or "closed"). Missing means open. */
export const FAKE_PR_STATE_FILE = "four-eyes-pr-state";

const readFakeState = async (repoDir: string): Promise<GhState> => {
  const raw = await readFile(join(repoDir, ".git", FAKE_PR_STATE_FILE), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "open";
    throw new Error(`Could not read the fake PR state from ${repoDir}: ${errorMessage(error)}`, { cause: error });
  });
  const parsed = GhStateSchema.safeParse(raw.trim());
  if (!parsed.success) throw new Error(`Fake PR state file in ${repoDir} holds "${raw.trim()}"; expected open, merged or closed`);
  return parsed.data;
};

const revParse = async (repoDir: string, rev: string): Promise<string | null> => {
  const output = await runCommandRaw("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd: repoDir, env: FAKE_GIT_ENV });
  return output.exitCode === 0 ? output.stdout.trim() : null;
};

/** Recorded-PR client for e2e runs, selected with FOUR_EYES_FAKE_GH=1. Serves fixture PRs backed by local git repos under config.home. */
export const createFakeGitHubClient = (config: AppConfig): GitHubClient => {
  const repoDir = join(config.home, "fake-gh", FAKE_REF.owner, FAKE_REF.repo);
  let ready: Promise<void> | null = null;

  const ensureRepo = (): Promise<void> => {
    ready ??= (async (): Promise<void> => {
      if (existsSync(join(repoDir, ".git")) && (await revParse(repoDir, `refs/pull/${FAKE_REF.number}/head`)) !== null) return;
      await buildFakeRepo(repoDir);
    })().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  const requireFake = (ref: PrRef): void => {
    if (!isFakeRef(ref)) {
      throw new HttpError(404, `Fake GitHub mode only knows ${FAKE_PR_URL}; got ${prWebUrl(ref)}`);
    }
  };

  return {
    fetchPr: async (ref: PrRef): Promise<PrMeta> => {
      requireFake(ref);
      await ensureRepo();
      const [headSha, baseSha, state] = await Promise.all([
        revParse(repoDir, `refs/pull/${FAKE_REF.number}/head`),
        revParse(repoDir, FAKE_BASE_BRANCH),
        readFakeState(repoDir),
      ]);
      if (headSha === null || baseSha === null) throw new Error(`Fake GitHub repo at ${repoDir} is missing its PR refs`);
      return {
        title: "Add email to users and send a welcome mail",
        author: "octocat",
        url: FAKE_PR_URL,
        state,
        headSha,
        baseSha,
        headRefName: FAKE_HEAD_BRANCH,
        baseRefName: FAKE_BASE_BRANCH,
      };
    },
    remoteUrl: (ref: PrRef): string => {
      requireFake(ref);
      return repoDir;
    },
  };
};
