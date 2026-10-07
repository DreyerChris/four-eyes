import type {
  ChunkView,
  Coverage,
  FindingView,
  ReviewDetailResponse,
  ReviewListItem,
  ReviewProgress,
  SummaryChunk,
  SummaryResponse,
} from "@shared/api";
import type { Chunk, ChunkProgress, Finding, Hunk, Review, ReviewStatus } from "@shared/domain";
import type { DbExecutor } from "../db/types";
import {
  chunkProgressRepo,
  chunksRepo,
  claudeRunsRepo,
  findingsRepo,
  hunksRepo,
  questionsRepo,
  reviewsRepo,
  roundsRepo,
  verdictsRepo,
} from "../db/repositories";

const unseenProgress = (chunkId: string, updatedAt: string): ChunkProgress => ({ chunkId, status: "unseen", note: "", updatedAt });

const countProgress = (progress: readonly ChunkProgress[], totalChunks: number): ReviewProgress => {
  const count = (status: ChunkProgress["status"]): number => progress.filter((p) => p.status === status).length;
  const good = count("good");
  const flagged = count("flagged");
  const question = count("question");
  return { totalChunks, good, flagged, question, unseen: Math.max(0, totalChunks - good - flagged - question) };
};

/** A review row plus the derived fields the list and headers need. */
export const toListItem = (db: DbExecutor, review: Review): ReviewListItem => {
  const chunks = chunksRepo.listChunks(db, review.id);
  return {
    ...review,
    progress: countProgress(chunkProgressRepo.listChunkProgress(db, review.id), chunks.length),
    hasNewCommits: review.remoteHeadSha !== null && review.remoteHeadSha !== review.headSha,
    reviewRunStatus: claudeRunsRepo.getLatestRun(db, review.id, "review")?.status ?? null,
  };
};

export const listReviewItems = (db: DbExecutor, status?: ReviewStatus): readonly ReviewListItem[] =>
  reviewsRepo.listReviews(db, status).map((review) => toListItem(db, review));

interface ReviewGraph {
  readonly review: Review;
  readonly chunks: readonly Chunk[];
  readonly hunksByChunk: ReadonlyMap<string, readonly Hunk[]>;
  readonly progressByChunk: ReadonlyMap<string, ChunkProgress>;
  readonly roundNumberById: ReadonlyMap<string, number>;
  readonly findings: readonly Finding[];
  readonly hunks: readonly Hunk[];
}

const loadGraph = (db: DbExecutor, reviewId: string): ReviewGraph => {
  const review = reviewsRepo.requireReview(db, reviewId);
  const hunks = hunksRepo.listHunks(db, reviewId);
  const hunkById = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  const hunksByChunk = chunksRepo.listChunkHunks(db, reviewId).reduce((map, link) => {
    const hunk = hunkById.get(link.hunkId);
    return hunk ? map.set(link.chunkId, [...(map.get(link.chunkId) ?? []), hunk]) : map;
  }, new Map<string, Hunk[]>());
  return {
    review,
    chunks: chunksRepo.listChunks(db, reviewId),
    hunksByChunk,
    progressByChunk: new Map(chunkProgressRepo.listChunkProgress(db, reviewId).map((p) => [p.chunkId, p])),
    roundNumberById: new Map(roundsRepo.listRounds(db, reviewId).map((round) => [round.id, round.number])),
    findings: findingsRepo.listFindings(db, reviewId),
    hunks,
  };
};

const chunkIdsForFinding = (graph: ReviewGraph, finding: Finding): string[] =>
  graph.chunks
    .filter((chunk) => (graph.hunksByChunk.get(chunk.id) ?? []).some((hunk) => finding.hunkIds.includes(hunk.id)))
    .map((chunk) => chunk.id);

const progressFor = (graph: ReviewGraph, chunk: Chunk): ChunkProgress =>
  graph.progressByChunk.get(chunk.id) ?? unseenProgress(chunk.id, graph.review.createdAt);

const roundNumberFor = (graph: ReviewGraph, roundId: string): number => {
  const number = graph.roundNumberById.get(roundId);
  if (number === undefined) throw new Error(`Round ${roundId} is missing for review ${graph.review.id}`);
  return number;
};

/** Everything the Review stepper needs in one response. */
export const buildReviewDetail = (db: DbExecutor, reviewId: string): ReviewDetailResponse => {
  const graph = loadGraph(db, reviewId);
  const questionCounts = questionsRepo
    .listQuestions(db, reviewId)
    .reduce((map, q) => (q.chunkId ? map.set(q.chunkId, (map.get(q.chunkId) ?? 0) + 1) : map), new Map<string, number>());
  const chunks: ChunkView[] = graph.chunks.map((chunk) => {
    const hunks = graph.hunksByChunk.get(chunk.id) ?? [];
    const hunkIds = new Set(hunks.map((hunk) => hunk.id));
    return {
      ...chunk,
      roundNumber: roundNumberFor(graph, chunk.roundId),
      hunks: [...hunks],
      progress: progressFor(graph, chunk),
      findingIds: graph.findings.filter((f) => f.hunkIds.some((id) => hunkIds.has(id))).map((f) => f.id),
      questionCount: questionCounts.get(chunk.id) ?? 0,
    };
  });
  return {
    review: toListItem(db, graph.review),
    rounds: [...roundsRepo.listRounds(db, reviewId)],
    chunks,
    findings: [...graph.findings],
    runs: [...claudeRunsRepo.listRuns(db, reviewId)],
  };
};

const buildCoverage = (graph: ReviewGraph): Coverage => {
  const reviewed = graph.chunks.filter((chunk) => progressFor(graph, chunk).status !== "unseen");
  const reviewedHunkIds = new Set(reviewed.flatMap((chunk) => (graph.hunksByChunk.get(chunk.id) ?? []).map((h) => h.id)));
  const presentHunks = graph.hunks.filter((hunk) => hunk.present);
  return {
    totalChunks: graph.chunks.length,
    reviewedChunks: reviewed.length,
    unseenChunks: graph.chunks.length - reviewed.length,
    totalHunks: graph.hunks.length,
    presentHunks: presentHunks.length,
    missingHunks: graph.hunks.length - presentHunks.length,
    reviewedHunks: presentHunks.filter((hunk) => reviewedHunkIds.has(hunk.id)).length,
  };
};

/** Everything the Summary page needs in one response. */
export const buildSummary = (db: DbExecutor, reviewId: string): SummaryResponse => {
  const graph = loadGraph(db, reviewId);
  const findings: FindingView[] = graph.findings.map((finding) => ({ ...finding, chunkIds: chunkIdsForFinding(graph, finding) }));
  const chunks: SummaryChunk[] = graph.chunks.map((chunk) => {
    const hunks = graph.hunksByChunk.get(chunk.id) ?? [];
    return {
      ...chunk,
      roundNumber: roundNumberFor(graph, chunk.roundId),
      progress: progressFor(graph, chunk),
      hunkCount: hunks.length,
      presentHunkCount: hunks.filter((hunk) => hunk.present).length,
    };
  });
  return {
    review: toListItem(db, graph.review),
    verdict: verdictsRepo.getLatestVerdict(db, reviewId) ?? null,
    findings,
    chunks,
    questions: [...questionsRepo.listQuestions(db, reviewId)],
    coverage: buildCoverage(graph),
    reviewRun: claudeRunsRepo.getLatestRun(db, reviewId, "review") ?? null,
  };
};
