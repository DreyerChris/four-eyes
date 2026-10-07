import { and, asc, eq, inArray } from "drizzle-orm";
import type { Hunk } from "@shared/domain";
import { NotFoundError } from "../../lib/errors";
import { hunks } from "../schema";
import type { DbExecutor } from "../types";

export interface HunkFilter {
  readonly roundId?: string;
  readonly presentOnly?: boolean;
}

export type HunkPatch = Partial<Omit<Hunk, "id" | "reviewId">>;

export const insertHunks = (db: DbExecutor, rows: readonly Hunk[]): readonly Hunk[] => {
  if (rows.length > 0) db.insert(hunks).values([...rows]).run();
  return rows;
};

export const getHunk = (db: DbExecutor, id: string): Hunk | undefined =>
  db.select().from(hunks).where(eq(hunks.id, id)).get();

export const requireHunk = (db: DbExecutor, id: string): Hunk => {
  const hunk = getHunk(db, id);
  if (!hunk) throw new NotFoundError("Hunk", id);
  return hunk;
};

export const listHunks = (db: DbExecutor, reviewId: string, filter: HunkFilter = {}): readonly Hunk[] =>
  db
    .select()
    .from(hunks)
    .where(
      and(
        eq(hunks.reviewId, reviewId),
        filter.roundId ? eq(hunks.roundId, filter.roundId) : undefined,
        filter.presentOnly ? eq(hunks.present, true) : undefined,
      ),
    )
    .orderBy(asc(hunks.position))
    .all();

export const updateHunk = (db: DbExecutor, id: string, patch: HunkPatch): Hunk => {
  const updated = db.update(hunks).set(patch).where(eq(hunks.id, id)).returning().get();
  if (!updated) throw new NotFoundError("Hunk", id);
  return updated;
};

export const setHunksPresent = (db: DbExecutor, ids: readonly string[], present: boolean): void => {
  if (ids.length === 0) return;
  db.update(hunks).set({ present }).where(inArray(hunks.id, [...ids])).run();
};
