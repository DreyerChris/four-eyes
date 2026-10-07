import { REVIEW_RESULT_JSON_SCHEMA, ReviewResultSchema, type ReviewResult, type ReviewResultFinding } from "@shared/claude";
import type { Finding, FindingRange, Hunk, Review, Verbosity } from "@shared/domain";
import { rangeFitsHunk } from "@shared/findings";
import { err, ok, type Result } from "@shared/result";
import type { AppContext } from "../context";
import { findingsRepo, hunksRepo, reviewsRepo, settingsRepo, verdictsRepo } from "../db/repositories";
import { errorMessage } from "../lib/errors";
import { newId } from "../lib/ids";
import { formatZodIssues, type RoundRunInput } from "./chunking";
import { formatHunksForPrompt } from "./format";
import { resolveWorktree, startRunLog, ZERO_USAGE, type RunOutcome } from "./runs";
import { runStructuredWithRetry } from "./structured";
import { OUTPUT_LENGTH_RULES } from "./verbosity";

const REVIEW_MAX_TURNS = 40;

const EMPTY_REVIEW: ReviewResult = {
  verdict: { summary: "There are no changes left in this PR to review.", suggestion: "approve" },
  findings: [],
};

const saveReview = (ctx: AppContext, input: RoundRunInput, result: ReviewResult): readonly Finding[] =>
  ctx.db.transaction((tx) => {
    findingsRepo.deleteFindingsForRound(tx, input.roundId);
    const saved = findingsRepo.insertFindings(
      tx,
      result.findings.map((finding) => ({
        id: newId("fnd"),
        reviewId: input.reviewId,
        roundId: input.roundId,
        severity: finding.severity,
        title: finding.title,
        explanation: finding.explanation,
        suggestedFix: finding.suggestedFix ?? null,
        lifecycle: "new",
        userVerdict: null,
        hunkIds: finding.hunkIds,
        range: finding.range ?? null,
      })),
    );
    verdictsRepo.upsertVerdict(tx, {
      reviewId: input.reviewId,
      roundId: input.roundId,
      summary: result.verdict.summary,
      suggestion: result.verdict.suggestion,
    });
    return saved;
  });

const retryPrompt =
  (review: Review, hunks: readonly Hunk[], verbosity: Verbosity) =>
  (error: string, resumed: boolean): string => {
    const correction = [
      "Your previous review output was rejected:",
      error,
      "",
      "Return the corrected review. Every finding must list at least one hunk ID from the list you were given.",
    ].join("\n");
    return resumed ? correction : `${buildReviewPrompt(review, hunks, verbosity)}\n\n## Previous attempt\n${correction}`;
  };

const finish = (ctx: AppContext, input: RoundRunInput, findings: readonly Finding[]): readonly Finding[] => {
  ctx.events.publish(input.reviewId, { type: "step", step: "review", state: "done", message: `${findings.length} findings` });
  ctx.events.publish(input.reviewId, { type: "review_updated" });
  return findings;
};

const activeRuns = new Map<string, AbortController>();

const NEWER_RUN_STARTED = "a newer review run of this PR started";

/**
 * Reviews every present hunk of the review. prompt → runStructured → validate → retry once.
 * Saves findings for input.roundId with lifecycle "new" plus the round's verdict, logs claude_runs,
 * publishes "run" events and a "review_updated" event. Refresh reconciles lifecycles afterwards.
 * Only one review run per review is active: starting one stops the previous run, which is marked failed at once and never saves.
 * Throws when Claude cannot produce a valid review or the run is stopped, so callers do not reconcile against missing findings.
 */
export const runReview = async (ctx: AppContext, input: RoundRunInput): Promise<readonly Finding[]> => {
  const review = reviewsRepo.requireReview(ctx.db, input.reviewId);
  activeRuns.get(input.reviewId)?.abort(new Error(NEWER_RUN_STARTED));
  const controller = new AbortController();
  activeRuns.set(input.reviewId, controller);
  const { signal } = controller;
  const hunks = hunksRepo.listHunks(ctx.db, input.reviewId, { presentOnly: true });
  const hunkIds = hunks.map((hunk) => hunk.id);
  const settings = settingsRepo.getSettings(ctx.db);
  const model = settings.models.review;
  ctx.events.publish(input.reviewId, { type: "step", step: "review", state: "started", message: `${hunks.length} hunks` });

  try {
    if (hunks.length === 0) return finish(ctx, input, saveReview(ctx, input, EMPTY_REVIEW));

    const log = startRunLog(ctx, input.reviewId, "review", model);
    const stoppedMessage = (): string => `Review stopped: ${errorMessage(signal.reason)}`;
    signal.addEventListener("abort", () => log.fail(new Error(stoppedMessage()), { usage: ZERO_USAGE, sessionId: null }), { once: true });
    let claudeOutcome: RunOutcome = { usage: ZERO_USAGE, sessionId: null };
    try {
      const cwd = await resolveWorktree(ctx, review).catch((error: unknown) => {
        throw new Error(`Could not prepare the PR worktree for the review: ${errorMessage(error)}`);
      });
      const outcome = await runStructuredWithRetry({
        ctx,
        log,
        kind: "review",
        model,
        cwd,
        prompt: buildReviewPrompt(review, hunks, settings.verbosity),
        jsonSchema: REVIEW_RESULT_JSON_SCHEMA,
        hunkIds,
        maxTurns: REVIEW_MAX_TURNS,
        signal,
        validate: (raw) => validateReviewResult(raw, hunks),
        retryPrompt: retryPrompt(review, hunks, settings.verbosity),
      });
      claudeOutcome = outcome;
      signal.throwIfAborted();
      if (!outcome.ok) throw new Error(outcome.error);
      const saved = saveReview(ctx, input, outcome.value);
      log.succeed(outcome);
      return finish(ctx, input, saved);
    } catch (error) {
      if (signal.aborted) {
        log.fail(new Error(stoppedMessage()), claudeOutcome);
        throw new Error(stoppedMessage(), { cause: error });
      }
      const message = `Review failed: ${errorMessage(error)}`;
      log.fail(new Error(message), claudeOutcome);
      ctx.events.publish(input.reviewId, { type: "step", step: "review", state: "failed", message });
      throw new Error(message, { cause: error });
    }
  } finally {
    if (activeRuns.get(input.reviewId) === controller) activeRuns.delete(input.reviewId);
  }
};

/** Prompt asking Claude for a verdict and findings that each reference real hunk IDs. */
export const buildReviewPrompt = (review: Review, hunks: readonly Hunk[], verbosity: Verbosity): string =>
  [
    "You are a senior engineer reviewing a pull request. The PR's code is checked out at the head commit in your working directory.",
    "",
    `PR: ${review.title}`,
    `Author: ${review.author}`,
    `URL: ${review.url}`,
    `Base: ${review.baseSha}`,
    `Head: ${review.headSha}`,
    "",
    "How to review:",
    "- Read the hunks below. Use Read, Grep and Glob on the worktree, and git log / git blame / git show, to check callers, types and surrounding code before you claim something is wrong.",
    "- Report only real problems you can explain. Do not pad the list. An empty findings list is fine for a clean PR.",
    "- severity: bug = wrong behaviour or a crash; risk = could break under some conditions, security, data loss, performance or compatibility; improvement = clearer or simpler code with a concrete benefit; nit = style or naming.",
    "- Every finding must list the hunk IDs it is about, using only IDs from the list below. Findings without a valid hunk ID are dropped.",
    "- range: when the finding is about specific lines, give the side and line numbers from the numbered hunks below. Use side \"new\" with the new line number for added or unchanged lines, and side \"old\" with the old line number only for removed lines. startLine and endLine must be inside one of the finding's hunks; keep the range tight (the lines a reader should look at). Leave range out when the finding is about the hunk as a whole.",
    `- ${OUTPUT_LENGTH_RULES[verbosity].finding}`,
    `- ${OUTPUT_LENGTH_RULES[verbosity].verdictSummary} verdict.suggestion: approve, approve_with_nits, or request_changes.`,
    "- You cannot edit files. Do not try.",
    "",
    `## Hunks (${hunks.length})`,
    "",
    formatHunksForPrompt(hunks, { numbered: true }),
  ].join("\n");

type HunkSpan = Pick<Hunk, "id" | "oldStart" | "oldLines" | "newStart" | "newLines">;

const checkedRange = (finding: ReviewResultFinding, hunks: ReadonlyMap<string, HunkSpan>): FindingRange | undefined => {
  const range = finding.range;
  if (range === undefined) return undefined;
  const fits = finding.hunkIds.some((id) => {
    const hunk = hunks.get(id);
    return hunk !== undefined && rangeFitsHunk(range, hunk);
  });
  return fits ? { side: range.side, startLine: range.startLine, endLine: range.endLine } : undefined;
};

/**
 * Parses raw output with ReviewResultSchema. Unknown hunk IDs are removed and findings left with none are dropped.
 * A line range that does not fit inside one of the finding's hunks is removed; the finding itself is kept.
 */
export const validateReviewResult = (raw: unknown, hunks: readonly HunkSpan[]): Result<ReviewResult> => {
  const parsed = ReviewResultSchema.safeParse(raw);
  if (!parsed.success) return err(`Output does not match the review schema: ${formatZodIssues(parsed.error)}`);
  const known = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  const findings = parsed.data.findings
    .map((finding) => ({ ...finding, hunkIds: [...new Set(finding.hunkIds.filter((id) => known.has(id)))] }))
    .filter((finding) => finding.hunkIds.length > 0)
    .map((finding) => {
      const range = checkedRange(finding, known);
      const { range: _unchecked, ...rest } = finding;
      return range === undefined ? rest : { ...rest, range };
    });
  return ok({ verdict: parsed.data.verdict, findings });
};
