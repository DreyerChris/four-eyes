import { mkdirSync } from "node:fs";
import type { AppConfig } from "./config";
import { createFakeClaudeRunner } from "./claude/fake-runner";
import type { ClaudeRunner } from "./claude/runner";
import type { ClaudeExecutableInput } from "./claude/executable";
import { createSdkClaudeRunner } from "./claude/sdk-runner";
import { openDb, type Db } from "./db/client";
import { settingsRepo } from "./db/repositories";
import { createFakeGitHubClient, createGhCliClient, type GitHubClient } from "./ingest/github-client";
import { createEventBus, type EventBus } from "./lib/events";

export interface AppContext {
  readonly config: AppConfig;
  readonly db: Db;
  readonly events: EventBus;
  readonly claude: ClaudeRunner;
  readonly github: GitHubClient;
}

export interface AppContextHandle {
  readonly ctx: AppContext;
  readonly close: () => void;
}

export interface AppContextOverrides {
  readonly claude?: ClaudeRunner;
  readonly github?: GitHubClient;
  readonly events?: EventBus;
  readonly dbPath?: string;
}

/** Inputs for finding the Claude binary, read fresh so a settings change applies to the next run. */
export const claudeExecutableInput = (config: AppConfig, db: Db): ClaudeExecutableInput => ({
  settingPath: settingsRepo.getSettings(db).claudePath,
  envPath: config.claudePathEnv,
  searchPath: config.searchPath,
});

/** Wires config, database, event bus, Claude runner and GitHub client. Overrides exist for tests. */
export const createAppContext = (config: AppConfig, overrides: AppContextOverrides = {}): AppContextHandle => {
  mkdirSync(config.home, { recursive: true });
  const { db, close } = openDb(overrides.dbPath ?? config.dbPath);
  const ctx: AppContext = {
    config,
    db,
    events: overrides.events ?? createEventBus(),
    claude: overrides.claude ?? (config.fakeClaude ? createFakeClaudeRunner() : createSdkClaudeRunner(() => claudeExecutableInput(config, db))),
    github: overrides.github ?? (config.fakeGitHub ? createFakeGitHubClient(config) : createGhCliClient()),
  };
  return { ctx, close };
};
