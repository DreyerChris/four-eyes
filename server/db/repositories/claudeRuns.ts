import { and, desc, eq } from "drizzle-orm";
import type { ClaudeRun, ClaudeRunKind } from "@shared/domain";
import { NotFoundError } from "../../lib/errors";
import { claudeRuns } from "../schema";
import type { DbExecutor } from "../types";

export type ClaudeRunPatch = Partial<Omit<ClaudeRun, "id" | "reviewId" | "kind">>;

export const insertRun = (db: DbExecutor, run: ClaudeRun): ClaudeRun => {
  db.insert(claudeRuns).values(run).run();
  return run;
};

export const updateRun = (db: DbExecutor, id: string, patch: ClaudeRunPatch): ClaudeRun => {
  const updated = db.update(claudeRuns).set(patch).where(eq(claudeRuns.id, id)).returning().get();
  if (!updated) throw new NotFoundError("Claude run", id);
  return updated;
};

export const listRuns = (db: DbExecutor, reviewId: string): readonly ClaudeRun[] =>
  db.select().from(claudeRuns).where(eq(claudeRuns.reviewId, reviewId)).orderBy(desc(claudeRuns.startedAt)).all();

export const getLatestRun = (db: DbExecutor, reviewId: string, kind: ClaudeRunKind): ClaudeRun | undefined =>
  db
    .select()
    .from(claudeRuns)
    .where(and(eq(claudeRuns.reviewId, reviewId), eq(claudeRuns.kind, kind)))
    .orderBy(desc(claudeRuns.startedAt))
    .limit(1)
    .get();
