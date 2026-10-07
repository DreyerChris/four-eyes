import { existsSync } from "node:fs";
import type { ClaudeRun, ClaudeRunKind, Review } from "@shared/domain";
import type { AppContext } from "../context";
import { claudeRunsRepo } from "../db/repositories";
import { ensureWorktree } from "../ingest/git";
import { errorMessage } from "../lib/errors";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import type { RunUsage } from "./runner";

export const ZERO_USAGE: RunUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** Adds two usage records. */
export const addUsage = (a: RunUsage, b: RunUsage): RunUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd,
});

/** Resumed sessions report totals that include earlier turns; this removes what was already counted. */
export const usageSince = (reported: RunUsage, alreadyCounted: RunUsage): RunUsage => ({
  inputTokens: Math.max(0, reported.inputTokens - alreadyCounted.inputTokens),
  outputTokens: Math.max(0, reported.outputTokens - alreadyCounted.outputTokens),
  costUsd: Math.max(0, reported.costUsd - alreadyCounted.costUsd),
});

/** Usage already logged for runs of this review that belong to the given SDK session. */
export const loggedSessionUsage = (ctx: AppContext, reviewId: string, sessionId: string): RunUsage =>
  claudeRunsRepo
    .listRuns(ctx.db, reviewId)
    .filter((run) => run.sessionId === sessionId)
    .reduce<RunUsage>(
      (total, run) =>
        addUsage(total, { inputTokens: run.inputTokens ?? 0, outputTokens: run.outputTokens ?? 0, costUsd: run.costUsd ?? 0 }),
      ZERO_USAGE,
    );

export interface RunLog {
  readonly run: ClaudeRun;
  readonly progress: (message: string) => void;
  readonly retrying: (message: string) => void;
  readonly succeed: (details: RunOutcome) => ClaudeRun;
  readonly fail: (error: unknown, details: RunOutcome) => ClaudeRun;
}

export interface RunOutcome {
  readonly usage: RunUsage;
  readonly sessionId: string | null;
}

/** Inserts a running claude_runs row, publishes "run started", and returns helpers to report progress and finish it. */
export const startRunLog = (ctx: AppContext, reviewId: string, kind: ClaudeRunKind, model: string): RunLog => {
  const run = claudeRunsRepo.insertRun(ctx.db, {
    id: newId("run"),
    reviewId,
    kind,
    model,
    status: "running",
    sessionId: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    error: null,
    startedAt: nowIso(),
    finishedAt: null,
  });
  const publish = (state: "started" | "progress" | "retrying" | "done" | "failed", message: string | null): void => {
    ctx.events.publish(reviewId, { type: "run", runId: run.id, kind, state, message });
  };
  publish("started", `${kind} run started with ${model}`);

  const finish = (status: "succeeded" | "failed", outcome: RunOutcome, error: string | null): ClaudeRun =>
    claudeRunsRepo.updateRun(ctx.db, run.id, {
      status,
      sessionId: outcome.sessionId,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      costUsd: outcome.usage.costUsd,
      error,
      finishedAt: nowIso(),
    });

  return {
    run,
    progress: (message) => publish("progress", message),
    retrying: (message) => publish("retrying", message),
    succeed: (outcome) => {
      const updated = finish("succeeded", outcome, null);
      publish("done", null);
      return updated;
    },
    fail: (error, outcome) => {
      const message = errorMessage(error);
      const updated = finish("failed", outcome, message);
      publish("failed", message);
      return updated;
    },
  };
};

/** The review's worktree, rebuilt through ingest when it is missing (past reviews delete theirs). */
export const resolveWorktree = async (ctx: AppContext, review: Review): Promise<string> =>
  review.worktreePath !== null && existsSync(review.worktreePath) ? review.worktreePath : ensureWorktree(ctx, review.id);
