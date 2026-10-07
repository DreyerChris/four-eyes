import type { SetFindingVerdictRequest, UpdateChunkProgressRequest } from "@shared/api";
import type { ChunkProgress, Finding } from "@shared/domain";
import type { Db } from "../db/client";
import type { DbExecutor } from "../db/types";
import { chunkProgressRepo, chunksRepo, findingsRepo, reviewsRepo } from "../db/repositories";
import { HttpError, NotFoundError } from "../lib/errors";

const requireActiveReview = (db: DbExecutor, reviewId: string): void => {
  const review = reviewsRepo.requireReview(db, reviewId);
  if (review.status === "past") {
    throw new HttpError(409, `Review ${reviewId} is in Past and read-only. Add the PR again to reopen it.`);
  }
};

/** Sets a chunk's good/flagged/question status and note. Rejects past reviews and chunks from another review. */
export const updateChunkProgress = (
  db: Db,
  reviewId: string,
  chunkId: string,
  request: UpdateChunkProgressRequest,
): ChunkProgress =>
  db.transaction((tx) => {
    requireActiveReview(tx, reviewId);
    const chunk = chunksRepo.requireChunk(tx, chunkId);
    if (chunk.reviewId !== reviewId) throw new NotFoundError("Chunk", chunkId);
    const progress = chunkProgressRepo.upsertChunkProgress(tx, chunkId, request);
    reviewsRepo.touchReview(tx, reviewId);
    return progress;
  });

/** Records the user's agree/disagree/unsure (or clears it) on a finding. */
export const setFindingVerdict = (
  db: Db,
  reviewId: string,
  findingId: string,
  request: SetFindingVerdictRequest,
): Finding =>
  db.transaction((tx) => {
    requireActiveReview(tx, reviewId);
    const finding = findingsRepo.requireFinding(tx, findingId);
    if (finding.reviewId !== reviewId) throw new NotFoundError("Finding", findingId);
    const updated = findingsRepo.updateFinding(tx, findingId, { userVerdict: request.verdict });
    reviewsRepo.touchReview(tx, reviewId);
    return updated;
  });
