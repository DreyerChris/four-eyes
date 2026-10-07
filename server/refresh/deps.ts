import type { Chunk, Finding, PrMeta, PrRef, Review } from "@shared/domain";
import type { RoundRunInput } from "../claude/chunking";
import { runChunking } from "../claude/chunking";
import { runReview } from "../claude/review";
import type { AppContext } from "../context";
import { ensureWorktree, fetchPrCommits, moveWorktree } from "../ingest/git";
import { computeHunks } from "../ingest/hunks";
import { moveReviewToPast } from "../ingest/lifecycle";
import type { FingerprintedHunk } from "../ingest/types";

export interface RefreshDeps {
  readonly fetchPrCommits: (ctx: AppContext, ref: PrRef, meta: PrMeta) => Promise<void>;
  readonly ensureWorktree: (ctx: AppContext, reviewId: string) => Promise<string>;
  readonly moveWorktree: (ctx: AppContext, worktreePath: string, sha: string) => Promise<void>;
  readonly computeHunks: (repoPath: string, baseSha: string, headSha: string) => Promise<readonly FingerprintedHunk[]>;
  readonly runChunking: (ctx: AppContext, input: RoundRunInput) => Promise<readonly Chunk[]>;
  readonly runReview: (ctx: AppContext, input: RoundRunInput) => Promise<readonly Finding[]>;
  readonly moveReviewToPast: (ctx: AppContext, reviewId: string) => Promise<Review>;
}

export const defaultRefreshDeps: RefreshDeps = {
  fetchPrCommits,
  ensureWorktree,
  moveWorktree,
  computeHunks,
  runChunking,
  runReview,
  moveReviewToPast,
};

export const prRefOf = (review: Review): PrRef => ({
  host: review.host,
  owner: review.owner,
  repo: review.repo,
  number: review.prNumber,
});
