import { eq } from "drizzle-orm";
import type { ChunkProgress, ChunkStatus } from "@shared/domain";
import { nowIso } from "../../lib/time";
import { chunkProgress, chunks } from "../schema";
import type { DbExecutor } from "../types";

export const getChunkProgress = (db: DbExecutor, chunkId: string): ChunkProgress | undefined =>
  db.select().from(chunkProgress).where(eq(chunkProgress.chunkId, chunkId)).get();

export const upsertChunkProgress = (
  db: DbExecutor,
  chunkId: string,
  input: { readonly status: ChunkStatus; readonly note: string },
): ChunkProgress => {
  const row: ChunkProgress = { chunkId, status: input.status, note: input.note, updatedAt: nowIso() };
  db.insert(chunkProgress)
    .values(row)
    .onConflictDoUpdate({ target: chunkProgress.chunkId, set: { status: row.status, note: row.note, updatedAt: row.updatedAt } })
    .run();
  return row;
};

export const listChunkProgress = (db: DbExecutor, reviewId: string): readonly ChunkProgress[] =>
  db
    .select({
      chunkId: chunkProgress.chunkId,
      status: chunkProgress.status,
      note: chunkProgress.note,
      updatedAt: chunkProgress.updatedAt,
    })
    .from(chunkProgress)
    .innerJoin(chunks, eq(chunks.id, chunkProgress.chunkId))
    .where(eq(chunks.reviewId, reviewId))
    .all();
