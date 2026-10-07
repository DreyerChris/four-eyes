import { homedir } from "node:os";
import { join } from "node:path";
import type { PrRef } from "@shared/domain";

export interface AppConfig {
  readonly home: string;
  readonly dbPath: string;
  readonly reposDir: string;
  readonly worktreesDir: string;
  readonly port: number;
  readonly fakeClaude: boolean;
  readonly fakeGitHub: boolean;
  readonly claudePathEnv: string | null;
  readonly searchPath: string | undefined;
  readonly production: boolean;
  readonly pollIntervalMs: number;
}

const parsePort = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}": expected an integer between 1 and 65535`);
  }
  return port;
};

const parsePositiveInt = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name} "${raw}": expected a positive integer`);
  }
  return value;
};

/** Reads app configuration from environment variables. FOUR_EYES_HOME isolates all on-disk state. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const home = env.FOUR_EYES_HOME && env.FOUR_EYES_HOME !== "" ? env.FOUR_EYES_HOME : join(homedir(), ".four-eyes");
  return {
    home,
    dbPath: join(home, "four-eyes.db"),
    reposDir: join(home, "repos"),
    worktreesDir: join(home, "worktrees"),
    port: parsePort(env.PORT, 8787),
    fakeClaude: env.FOUR_EYES_FAKE_CLAUDE === "1",
    fakeGitHub: env.FOUR_EYES_FAKE_GH === "1",
    claudePathEnv: env.FOUR_EYES_CLAUDE_PATH && env.FOUR_EYES_CLAUDE_PATH !== "" ? env.FOUR_EYES_CLAUDE_PATH : null,
    searchPath: env.PATH,
    production: env.NODE_ENV === "production",
    pollIntervalMs: parsePositiveInt("FOUR_EYES_POLL_MS", env.FOUR_EYES_POLL_MS, 120_000),
  };
};

/** Location of the bare clone for a repository. */
export const bareRepoPath = (config: AppConfig, ref: Pick<PrRef, "host" | "owner" | "repo">): string =>
  join(config.reposDir, ref.host, ref.owner, `${ref.repo}.git`);

/** Location of the git worktree for a review. */
export const worktreePath = (config: AppConfig, reviewId: string): string => join(config.worktreesDir, reviewId);
