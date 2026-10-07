import { desc, eq } from "drizzle-orm";
import type { Verdict } from "@shared/domain";
import { rounds, verdicts } from "../schema";
import type { DbExecutor } from "../types";

export const upsertVerdict = (db: DbExecutor, verdict: Verdict): Verdict => {
  db.insert(verdicts)
    .values(verdict)
    .onConflictDoUpdate({
      target: [verdicts.reviewId, verdicts.roundId],
      set: { summary: verdict.summary, suggestion: verdict.suggestion },
    })
    .run();
  return verdict;
};

export const listVerdicts = (db: DbExecutor, reviewId: string): readonly Verdict[] =>
  db
    .select({
      reviewId: verdicts.reviewId,
      roundId: verdicts.roundId,
      summary: verdicts.summary,
      suggestion: verdicts.suggestion,
    })
    .from(verdicts)
    .innerJoin(rounds, eq(rounds.id, verdicts.roundId))
    .where(eq(verdicts.reviewId, reviewId))
    .orderBy(desc(rounds.number))
    .all();

/** The verdict from the highest-numbered round that has one. */
export const getLatestVerdict = (db: DbExecutor, reviewId: string): Verdict | undefined => listVerdicts(db, reviewId)[0];
