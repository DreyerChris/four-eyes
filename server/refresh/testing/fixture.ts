import type { Chunk, Finding, Hunk, PrMeta, PrRef, Review, Round } from "@shared/domain";
import { fakeChunkPlan } from "../../claude/fake-runner";
import type { AppContext } from "../../context";
import { chunksRepo, findingsRepo, hunksRepo, reviewsRepo, roundsRepo } from "../../db/repositories";
import type { GitHubClient } from "../../ingest/github-client";
import { refuseReviewSubmission } from "../../ingest/testing";
import { newId } from "../../lib/ids";
import { nowIso } from "../../lib/time";
import type { RefreshDeps } from "../deps";
import type { TempRepo } from "./git-repo";

export const FIXTURE_REF: PrRef = { host: "github.com", owner: "four-eyes-fixture", repo: "refresh", number: 7 };

export interface FakeGitHub extends GitHubClient {
  readonly setPr: (patch: Partial<PrMeta>) => void;
  readonly calls: () => number;
}

/** GitHubClient whose PR metadata the test changes between refreshes. */
export const createFakeGitHub = (initial: PrMeta): FakeGitHub => {
  const state = { meta: initial, calls: 0 };
  return {
    fetchPr: async () => {
      state.calls += 1;
      return state.meta;
    },
    remoteUrl: () => "file:///dev/null",
    submitReview: refuseReviewSubmission,
    searchOpenPrs: async () => [],
    setPr: (patch) => {
      state.meta = { ...state.meta, ...patch };
    },
    calls: () => state.calls,
  };
};

export const prMeta = (baseSha: string, headSha: string, state: PrMeta["state"] = "open"): PrMeta => ({
  title: "Refresh fixture PR",
  author: "octocat",
  url: `https://${FIXTURE_REF.host}/${FIXTURE_REF.owner}/${FIXTURE_REF.repo}/pull/${FIXTURE_REF.number}`,
  state,
  headSha,
  baseSha,
  headRefName: "feature",
  baseRefName: "main",
});

export interface SeededReview {
  readonly review: Review;
  readonly round: Round;
  readonly hunks: readonly Hunk[];
  readonly chunks: readonly Chunk[];
}

/** Inserts a ready review with Round 1, the given hunks and one chunk per hunk, as ingest + chunking would. */
export const seedReview = async (ctx: AppContext, repo: TempRepo, baseSha: string, headSha: string): Promise<SeededReview> => {
  const now = nowIso();
  const review = reviewsRepo.insertReview(ctx.db, {
    id: newId("rev"),
    host: FIXTURE_REF.host,
    owner: FIXTURE_REF.owner,
    repo: FIXTURE_REF.repo,
    prNumber: FIXTURE_REF.number,
    title: "Refresh fixture PR",
    author: "octocat",
    url: prMeta(baseSha, headSha).url,
    baseSha,
    headSha,
    ghState: "open",
    status: "active",
    pipelineStatus: "ready",
    pipelineError: null,
    worktreePath: repo.dir,
    qaSessionId: null,
    remoteHeadSha: headSha,
    remoteCheckedAt: now,
    createdAt: now,
    lastActivityAt: now,
    finishedAt: null,
  });
  const round = roundsRepo.insertRound(ctx.db, { id: newId("rnd"), reviewId: review.id, number: 1, headSha, createdAt: now });
  const parsed = await repo.hunks(baseSha, headSha);
  const hunks = hunksRepo.insertHunks(
    ctx.db,
    parsed.map((hunk, position) => ({ ...hunk, id: newId("h"), reviewId: review.id, roundId: round.id, position, present: true })),
  );
  const chunks = chunksRepo.insertChunks(
    ctx.db,
    hunks.map((hunk, position) => ({
      chunk: {
        id: newId("chk"),
        reviewId: review.id,
        roundId: round.id,
        position,
        title: `Chunk for ${hunk.filePath}`,
        explanation: "Seeded chunk",
        kind: "core",
      },
      hunkIds: [hunk.id],
    })),
  );
  return { review, round, hunks, chunks };
};

export type ScriptedReview = (hunks: readonly Hunk[]) => readonly Pick<Finding, "severity" | "title" | "hunkIds">[];

export interface FakeDepsHandle {
  readonly deps: RefreshDeps;
  readonly movedTo: () => readonly string[];
  readonly pastCalls: () => readonly string[];
}

/** Refresh deps over a temp repo: real `git diff` for hunks, fake-runner chunking, scripted review findings. */
export const createFakeDeps = (repo: TempRepo, review: ScriptedReview = () => []): FakeDepsHandle => {
  const moved: string[] = [];
  const past: string[] = [];
  const deps: RefreshDeps = {
    fetchPrCommits: async () => undefined,
    ensureWorktree: async () => repo.dir,
    moveWorktree: async (_ctx, _path, sha) => {
      moved.push(sha);
    },
    computeHunks: (_repoPath, baseSha, headSha) => repo.hunks(baseSha, headSha),
    runChunking: async (ctx, { reviewId, roundId }) => {
      const roundHunks = hunksRepo.listHunks(ctx.db, reviewId, { roundId });
      const plan = fakeChunkPlan(roundHunks.map((hunk) => hunk.id));
      const saved = ctx.db.transaction((tx) =>
        chunksRepo.insertChunks(
          tx,
          plan.chunks.map((chunk, position) => ({
            chunk: {
              id: newId("chk"),
              reviewId,
              roundId,
              position,
              title: chunk.title,
              explanation: chunk.explanation,
              kind: chunk.kind,
            },
            hunkIds: chunk.hunkIds,
          })),
        ),
      );
      reviewsRepo.updateReview(ctx.db, reviewId, { pipelineStatus: "ready" });
      return saved;
    },
    runReview: async (ctx, { reviewId, roundId }) => {
      const present = hunksRepo.listHunks(ctx.db, reviewId, { presentOnly: true });
      const rows: readonly Finding[] = review(present).map((finding) => ({
        ...finding,
        id: newId("fnd"),
        reviewId,
        roundId,
        explanation: `Explanation for ${finding.title}`,
        suggestedFix: null,
        lifecycle: "new",
        userVerdict: null,
        range: null,
      }));
      return ctx.db.transaction((tx) => findingsRepo.insertFindings(tx, rows));
    },
    moveReviewToPast: async (ctx, reviewId) => {
      past.push(reviewId);
      return reviewsRepo.updateReview(ctx.db, reviewId, { status: "past", finishedAt: nowIso(), worktreePath: null });
    },
  };
  return { deps, movedTo: () => [...moved], pastCalls: () => [...past] };
};
