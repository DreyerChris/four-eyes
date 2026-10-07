import { asc, eq } from "drizzle-orm";
import type { Chunk, ChunkHunk } from "@shared/domain";
import { NotFoundError } from "../../lib/errors";
import { nowIso } from "../../lib/time";
import { chunkHunks, chunkProgress, chunks, rounds } from "../schema";
import type { DbExecutor } from "../types";

export interface NewChunk {
  readonly chunk: Chunk;
  readonly hunkIds: readonly string[];
}

/** Inserts chunks with their hunk links and an `unseen` progress row each. Callers should wrap in a transaction. */
export const insertChunks = (db: DbExecutor, rows: readonly NewChunk[]): readonly Chunk[] => {
  const updatedAt = nowIso();
  rows.forEach(({ chunk, hunkIds }) => {
    db.insert(chunks).values(chunk).run();
    if (hunkIds.length > 0) {
      db.insert(chunkHunks)
        .values(hunkIds.map((hunkId, position) => ({ chunkId: chunk.id, hunkId, position })))
        .run();
    }
    db.insert(chunkProgress).values({ chunkId: chunk.id, status: "unseen", note: "", updatedAt }).run();
  });
  return rows.map(({ chunk }) => chunk);
};

export const getChunk = (db: DbExecutor, id: string): Chunk | undefined =>
  db.select().from(chunks).where(eq(chunks.id, id)).get();

export const requireChunk = (db: DbExecutor, id: string): Chunk => {
  const chunk = getChunk(db, id);
  if (!chunk) throw new NotFoundError("Chunk", id);
  return chunk;
};

/** Chunks of a review in stepping order: by round number, then position within the round. */
export const listChunks = (db: DbExecutor, reviewId: string): readonly Chunk[] =>
  db
    .select({
      id: chunks.id,
      reviewId: chunks.reviewId,
      roundId: chunks.roundId,
      position: chunks.position,
      title: chunks.title,
      explanation: chunks.explanation,
      kind: chunks.kind,
    })
    .from(chunks)
    .innerJoin(rounds, eq(rounds.id, chunks.roundId))
    .where(eq(chunks.reviewId, reviewId))
    .orderBy(asc(rounds.number), asc(chunks.position))
    .all();

export const listChunkHunks = (db: DbExecutor, reviewId: string): readonly ChunkHunk[] =>
  db
    .select({ chunkId: chunkHunks.chunkId, hunkId: chunkHunks.hunkId, position: chunkHunks.position })
    .from(chunkHunks)
    .innerJoin(chunks, eq(chunks.id, chunkHunks.chunkId))
    .where(eq(chunks.reviewId, reviewId))
    .orderBy(asc(chunkHunks.chunkId), asc(chunkHunks.position))
    .all();

export const deleteChunksForRound = (db: DbExecutor, roundId: string): void => {
  db.delete(chunks).where(eq(chunks.roundId, roundId)).run();
};
