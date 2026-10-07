import { z } from "zod";
import { CHUNK_PLAN_JSON_SCHEMA, ChunkPlanSchema, type ChunkPlan, type PlannedChunk } from "@shared/claude";
import type { Chunk, Hunk } from "@shared/domain";
import { err, ok, type Result } from "@shared/result";
import type { AppContext } from "../context";
import { chunksRepo, hunksRepo, reviewsRepo, settingsRepo } from "../db/repositories";
import { errorMessage } from "../lib/errors";
import { newId } from "../lib/ids";
import { fallbackChunkPlan } from "./fallback";
import { formatHunksForPrompt } from "./format";
import { resolveWorktree, startRunLog, ZERO_USAGE, type RunOutcome } from "./runs";
import { runStructuredWithRetry } from "./structured";

export interface RoundRunInput {
  readonly reviewId: string;
  readonly roundId: string;
}

const CHUNKING_MAX_TURNS = 12;
const OTHER_CHANGES_TITLE = "Other changes";

/** Formats zod issues as one readable line, for feeding back to Claude on retry. */
export const formatZodIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

const findDuplicates = (ids: readonly string[]): readonly string[] =>
  [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

const otherChangesChunk = (hunkIds: readonly string[]): PlannedChunk => ({
  title: OTHER_CHANGES_TITLE,
  explanation: "Hunks the plan did not place in any chunk.",
  kind: "core",
  hunkIds,
});

const saveChunks = (ctx: AppContext, input: RoundRunInput, plan: ChunkPlan): readonly Chunk[] =>
  ctx.db.transaction((tx) => {
    chunksRepo.deleteChunksForRound(tx, input.roundId);
    const saved = chunksRepo.insertChunks(
      tx,
      plan.chunks.map((planned, position) => ({
        chunk: {
          id: newId("chk"),
          reviewId: input.reviewId,
          roundId: input.roundId,
          position,
          title: planned.title,
          explanation: planned.explanation,
          kind: planned.kind,
        },
        hunkIds: planned.hunkIds,
      })),
    );
    reviewsRepo.updateReview(tx, input.reviewId, { pipelineStatus: "ready", pipelineError: null });
    return saved;
  });

const retryPrompt =
  (hunks: readonly Hunk[]) =>
  (error: string, resumed: boolean): string => {
    const correction = [
      "Your previous chunk plan was rejected:",
      error,
      "",
      "Return a corrected plan. Use every hunk ID exactly once and only the IDs listed.",
    ].join("\n");
    return resumed ? correction : `${buildChunkingPrompt(hunks)}\n\n## Previous attempt\n${correction}`;
  };

/**
 * Chunks the round's hunks: prompt → runStructured → validate → retry once with the validation error →
 * fallbackChunkPlan. Saves chunks (positions within the round), logs a claude_runs row with tokens and cost,
 * publishes "run" and "step" events, and sets pipeline_status to "ready" when chunks are saved.
 */
export const runChunking = async (ctx: AppContext, input: RoundRunInput): Promise<readonly Chunk[]> => {
  const review = reviewsRepo.requireReview(ctx.db, input.reviewId);
  const hunks = hunksRepo.listHunks(ctx.db, input.reviewId, { roundId: input.roundId });
  const hunkIds = hunks.map((hunk) => hunk.id);
  const model = settingsRepo.getSettings(ctx.db).models.chunking;
  ctx.events.publish(input.reviewId, { type: "step", step: "chunking", state: "started", message: `${hunks.length} hunks` });

  if (hunks.length === 0) {
    const saved = saveChunks(ctx, input, { chunks: [] });
    ctx.events.publish(input.reviewId, { type: "step", step: "chunking", state: "skipped", message: "No hunks in this round" });
    ctx.events.publish(input.reviewId, { type: "review_updated" });
    return saved;
  }

  const log = startRunLog(ctx, input.reviewId, "chunking", model);
  let claudeOutcome: RunOutcome = { usage: ZERO_USAGE, sessionId: null };
  try {
    const cwd = await resolveWorktree(ctx, review).catch((error: unknown) => {
      throw new Error(`Could not prepare the PR worktree for chunking: ${errorMessage(error)}`);
    });
    const outcome = await runStructuredWithRetry({
      ctx,
      log,
      kind: "chunking",
      model,
      cwd,
      prompt: buildChunkingPrompt(hunks),
      jsonSchema: CHUNK_PLAN_JSON_SCHEMA,
      hunkIds,
      maxTurns: CHUNKING_MAX_TURNS,
      validate: (raw) => validateChunkPlan(raw, hunkIds),
      retryPrompt: retryPrompt(hunks),
    });
    claudeOutcome = outcome;
    const plan = outcome.ok ? outcome.value : fallbackChunkPlan(hunks);
    const saved = saveChunks(ctx, input, plan);
    if (outcome.ok) {
      log.succeed(outcome);
    } else {
      log.fail(new Error(`Fell back to one chunk per file: ${outcome.error}`), outcome);
    }
    ctx.events.publish(input.reviewId, {
      type: "step",
      step: "chunking",
      state: "done",
      message: outcome.ok ? `${saved.length} chunks` : `${saved.length} chunks (fallback: one per file)`,
    });
    ctx.events.publish(input.reviewId, { type: "review_updated" });
    return saved;
  } catch (error) {
    const message = `Chunking failed: ${errorMessage(error)}`;
    log.fail(new Error(message), claudeOutcome);
    ctx.events.publish(input.reviewId, { type: "step", step: "chunking", state: "failed", message });
    if (reviewsRepo.getReview(ctx.db, input.reviewId) !== undefined) {
      reviewsRepo.updateReview(ctx.db, input.reviewId, { pipelineStatus: "failed", pipelineError: message });
    }
    throw new Error(message, { cause: error });
  }
};

/** Prompt asking Claude to group and order hunk IDs (types → logic → wiring → tests → skim), 5–40 changed lines per chunk. */
export const buildChunkingPrompt = (hunks: readonly Hunk[]): string =>
  [
    "You are helping a human review a pull request one small piece at a time.",
    "Group the hunks below into chunks and put the chunks in the order a reviewer should read them.",
    "",
    "Rules:",
    "- Only group and order hunk IDs. Never rewrite or summarise code in place of a hunk.",
    "- Use every hunk ID exactly once. Do not invent IDs.",
    "- Aim for 5 to 40 changed lines per chunk. Keep hunks that only make sense together in the same chunk, even across files.",
    "- Order: types and data models first, then core logic, then wiring (routes, config, dependency setup), then tests.",
    '- Put noisy changes a reviewer only needs to skim (lockfiles, generated code, snapshots, pure renames or formatting) last, with kind "skim". Everything else is kind "core".',
    "- title: a short imperative phrase naming what the chunk does (for example \"Add email to the User type\").",
    "- explanation: two or three plain sentences on what changed and why it matters, so the reviewer knows what to look for.",
    "- You may use Read, Grep, Glob and git log/blame/show in the PR worktree for context, but keep it brief.",
    "",
    `## Hunks (${hunks.length})`,
    "",
    formatHunksForPrompt(hunks, { maxPatchLines: 60 }),
  ].join("\n");

/**
 * Parses raw output with ChunkPlanSchema. Errors on duplicate or unknown hunk IDs (the error text is fed back on retry).
 * Hunks Claude left out are appended as an "Other changes" chunk.
 */
export const validateChunkPlan = (raw: unknown, hunkIds: readonly string[]): Result<ChunkPlan> => {
  const parsed = ChunkPlanSchema.safeParse(raw);
  if (!parsed.success) return err(`Output does not match the chunk plan schema: ${formatZodIssues(parsed.error)}`);

  const known = new Set(hunkIds);
  const used = parsed.data.chunks.flatMap((chunk) => chunk.hunkIds);
  const unknown = [...new Set(used.filter((id) => !known.has(id)))];
  const duplicates = findDuplicates(used);
  const problems = [
    ...(unknown.length > 0 ? [`unknown hunk IDs: ${unknown.join(", ")}`] : []),
    ...(duplicates.length > 0 ? [`hunk IDs used more than once: ${duplicates.join(", ")}`] : []),
  ];
  if (problems.length > 0) return err(problems.join("; "));

  const usedSet = new Set(used);
  const leftovers = hunkIds.filter((id) => !usedSet.has(id));
  const chunks = parsed.data.chunks.filter((chunk) => chunk.hunkIds.length > 0);
  return ok({ chunks: [...chunks, ...(leftovers.length > 0 ? [otherChangesChunk(leftovers)] : [])] });
};
