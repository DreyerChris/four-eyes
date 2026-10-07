import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PrMeta, PrRef, Review } from "@shared/domain";
import { bareRepoPath, worktreePath } from "../config";
import { noteWorktreeUse } from "./worktree-usage";
import type { AppContext } from "../context";
import { reviewsRepo } from "../db/repositories";
import { HttpError, errorMessage } from "../lib/errors";
import { runCommand, runCommandRaw } from "./exec";

const GIT_ENV: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

const BASE_ARGS: readonly string[] = ["-c", "color.ui=false", "-c", "core.hooksPath=/dev/null", "-c", "advice.detachedHead=false"];

const git = (cwd: string, args: readonly string[]): Promise<string> =>
  runCommand("git", [...BASE_ARGS, ...args], { cwd, env: GIT_ENV });

const gitRaw = (cwd: string, args: readonly string[]): ReturnType<typeof runCommandRaw> =>
  runCommandRaw("git", [...BASE_ARGS, ...args], { cwd, env: GIT_ENV });

const locks = new Map<string, Promise<unknown>>();

const withLock = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, settled);
  try {
    return await run;
  } finally {
    if (locks.get(key) === settled) locks.delete(key);
  }
};

const credentialArgs = (remoteUrl: string): readonly string[] =>
  remoteUrl.startsWith("https://") ? ["-c", "credential.helper=!gh auth git-credential"] : [];

const isGitDir = (path: string): boolean => existsSync(join(path, "HEAD")) && existsSync(join(path, "objects"));

const refOf = (review: Review): PrRef => ({ host: review.host, owner: review.owner, repo: review.repo, number: review.prNumber });

const prRefPrefix = (ref: PrRef): string => `refs/four-eyes/pull/${ref.number}`;

/** True when `sha` resolves to a commit inside `repoPath`. */
export const hasCommit = async (repoPath: string, sha: string): Promise<boolean> =>
  sha !== "" && (await gitRaw(repoPath, ["cat-file", "-e", `${sha}^{commit}`])).exitCode === 0;

/** Creates the bare clone at bareRepoPath(config, ref) if missing. Returns its path. */
export const ensureBareClone = async (ctx: AppContext, ref: PrRef): Promise<string> => {
  const bare = bareRepoPath(ctx.config, ref);
  const remote = ctx.github.remoteUrl(ref);
  return withLock(bare, async () => {
    if (!isGitDir(bare)) {
      await mkdir(bare, { recursive: true });
      await git(bare, ["init", "--bare", "--quiet"]);
      await git(bare, ["remote", "add", "origin", remote]);
      return bare;
    }
    const current = await gitRaw(bare, ["remote", "get-url", "origin"]);
    if (current.exitCode !== 0) await git(bare, ["remote", "add", "origin", remote]);
    else if (current.stdout.trim() !== remote) await git(bare, ["remote", "set-url", "origin", remote]);
    return bare;
  });
};

const fetchFromOrigin = async (bare: string, remote: string, refspecs: readonly string[]): Promise<string | null> => {
  const output = await gitRaw(bare, [...credentialArgs(remote), "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "origin", ...refspecs]);
  return output.exitCode === 0 ? null : output.stderr.trim() || `git fetch exited with ${output.exitCode}`;
};

const missingCommits = async (bare: string, shas: readonly string[]): Promise<readonly string[]> => {
  const present = await Promise.all(shas.map((sha) => hasCommit(bare, sha)));
  return shas.filter((_, index) => !present[index]);
};

/** Fetches the PR head and base commits into the bare clone so both SHAs are available locally. */
export const fetchPrCommits = async (ctx: AppContext, ref: PrRef, meta: PrMeta): Promise<void> => {
  const bare = await ensureBareClone(ctx, ref);
  const remote = ctx.github.remoteUrl(ref);
  const prefix = prRefPrefix(ref);
  const wanted = [meta.headSha, meta.baseSha].filter((sha) => sha !== "");
  await withLock(bare, async () => {
    const refspecs = [
      `+refs/pull/${ref.number}/head:${prefix}/head`,
      ...(meta.baseRefName === "" ? [] : [`+refs/heads/${meta.baseRefName}:${prefix}/base`]),
    ];
    const refError = await fetchFromOrigin(bare, remote, refspecs);
    const stillMissing = await missingCommits(bare, wanted);
    if (stillMissing.length === 0) return;
    const shaError = await fetchFromOrigin(bare, remote, stillMissing);
    const finalMissing = await missingCommits(bare, wanted);
    if (finalMissing.length === 0) return;
    const reason = shaError ?? refError ?? "the remote did not send them";
    throw new Error(`Could not fetch commit(s) ${finalMissing.map((sha) => sha.slice(0, 12)).join(", ")} from ${remote}: ${reason}`);
  });
};

const forceRemoveWorktree = async (bare: string | null, path: string): Promise<void> => {
  if (bare !== null && isGitDir(bare)) {
    const removed = await gitRaw(bare, ["worktree", "remove", "--force", "--force", path]);
    if (removed.exitCode !== 0 && existsSync(path)) {
      console.warn(`[ingest] git worktree remove failed for ${path}, deleting the folder instead: ${removed.stderr.trim()}`);
    }
  }
  await rm(path, { recursive: true, force: true });
  if (bare !== null && isGitDir(bare)) await git(bare, ["worktree", "prune"]);
};

/** Adds a detached git worktree for the review at `sha`, at worktreePath(config, reviewId). Returns its path. */
export const addWorktree = async (ctx: AppContext, ref: PrRef, reviewId: string, sha: string): Promise<string> => {
  const bare = bareRepoPath(ctx.config, ref);
  const path = worktreePath(ctx.config, reviewId);
  if (!isGitDir(bare)) throw new Error(`Cannot add a worktree: no local clone of ${ref.owner}/${ref.repo} at ${bare}`);
  return withLock(bare, async () => {
    if (existsSync(path)) await forceRemoveWorktree(bare, path);
    await mkdir(dirname(path), { recursive: true });
    await git(bare, ["worktree", "add", "--detach", "--force", "--quiet", path, sha]);
    return path;
  });
};

/** Checks out `sha` (detached) in an existing worktree. */
export const moveWorktree = async (_ctx: AppContext, worktreePathToMove: string, sha: string): Promise<void> => {
  if (!existsSync(join(worktreePathToMove, ".git"))) {
    throw new Error(`Cannot move worktree: ${worktreePathToMove} is not a git worktree`);
  }
  await git(worktreePathToMove, ["checkout", "--detach", "--force", "--quiet", sha]);
};

/** Removes the review's worktree (if any) and clears reviews.worktree_path. */
export const removeWorktree = async (ctx: AppContext, reviewId: string): Promise<void> => {
  const review = reviewsRepo.getReview(ctx.db, reviewId);
  const path = review?.worktreePath ?? worktreePath(ctx.config, reviewId);
  const bare = review === undefined ? null : bareRepoPath(ctx.config, refOf(review));
  await withLock(bare ?? path, () => forceRemoveWorktree(bare, path));
  if (review !== undefined && review.worktreePath !== null && reviewsRepo.getReview(ctx.db, reviewId) !== undefined) {
    reviewsRepo.updateReview(ctx.db, reviewId, { worktreePath: null });
  }
};

const isUsableWorktree = (path: string | null): path is string => path !== null && existsSync(join(path, ".git"));

/** Returns the review's worktree path, rebuilding it at the review's head SHA if it was deleted. */
export const ensureWorktree = async (ctx: AppContext, reviewId: string): Promise<string> =>
  withLock(`worktree:${reviewId}`, async () => {
    const review = reviewsRepo.requireReview(ctx.db, reviewId);
    noteWorktreeUse(ctx, reviewId);
    if (isUsableWorktree(review.worktreePath)) return review.worktreePath;
    if (review.headSha === "") {
      throw new HttpError(409, `Review ${reviewId} has no head commit yet; wait for ingest to finish`);
    }
    const ref = refOf(review);
    try {
      const bare = await ensureBareClone(ctx, ref);
      const missing = await missingCommits(bare, [review.headSha, review.baseSha].filter((sha) => sha !== ""));
      if (missing.length > 0) {
        await fetchPrCommits(ctx, ref, {
          title: review.title,
          author: review.author,
          url: review.url,
          state: review.ghState,
          headSha: review.headSha,
          baseSha: review.baseSha,
          headRefName: "",
          baseRefName: "",
        });
      }
      const path = await addWorktree(ctx, ref, reviewId, review.headSha);
      reviewsRepo.updateReview(ctx.db, reviewId, { worktreePath: path });
      return path;
    } catch (error) {
      throw new HttpError(502, `Could not rebuild the worktree for review ${reviewId}: ${errorMessage(error)}`);
    }
  });

/** Raw unified diff of `git diff base...head` (merge-base diff) inside `repoPath`. */
export const diffBetween = async (repoPath: string, baseSha: string, headSha: string): Promise<string> =>
  git(repoPath, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    "--unified=3",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--no-relative",
    `${baseSha}...${headSha}`,
    "--",
  ]);

const normalizeRepoPath = (path: string): string => path.replace(/^(\.\/)+/, "").replace(/^\/+/, "");

/** File contents at a commit, or null when the path does not exist at that commit. */
export const readFileAtSha = async (repoPath: string, sha: string, path: string): Promise<string | null> => {
  const output = await gitRaw(repoPath, ["cat-file", "blob", `${sha}:${normalizeRepoPath(path)}`]);
  if (output.exitCode === 0) return output.stdout;
  if (await hasCommit(repoPath, sha)) return null;
  throw new HttpError(404, `Commit ${sha.slice(0, 12)} is not available locally`);
};
