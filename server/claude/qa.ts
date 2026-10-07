import type { AskQuestionRequest, QaStreamEvent } from "@shared/api";
import type { Chunk, Hunk, Question, Review } from "@shared/domain";
import type { AppContext } from "../context";
import { chunksRepo, hunksRepo, questionsRepo, reviewsRepo, settingsRepo } from "../db/repositories";
import { errorMessage, HttpError } from "../lib/errors";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { sessionFromError, usageFromError } from "./errors";
import { formatHunksForPrompt } from "./format";
import type { RunUsage } from "./runner";
import { loggedSessionUsage, resolveWorktree, startRunLog, usageSince, ZERO_USAGE, type RunLog } from "./runs";

const QA_MAX_TURNS = 20;

interface QaContext {
  readonly review: Review;
  readonly chunk: Chunk | null;
  readonly chunkHunks: readonly Hunk[];
  readonly request: AskQuestionRequest;
}

const chunkHunksFor = (ctx: AppContext, reviewId: string, chunkId: string): readonly Hunk[] => {
  const ids = chunksRepo
    .listChunkHunks(ctx.db, reviewId)
    .filter((link) => link.chunkId === chunkId)
    .map((link) => link.hunkId);
  const byId = new Map(hunksRepo.listHunks(ctx.db, reviewId).map((hunk) => [hunk.id, hunk]));
  return ids.flatMap((id) => {
    const hunk = byId.get(id);
    return hunk === undefined ? [] : [hunk];
  });
};

const lineRange = (request: AskQuestionRequest): string => {
  if (request.startLine === null) return "";
  return request.endLine === null || request.endLine === request.startLine
    ? `, line ${request.startLine}`
    : `, lines ${request.startLine}-${request.endLine}`;
};

const prPreamble = (review: Review): readonly string[] => [
  "You are answering a reviewer's questions about a pull request. The PR's code is checked out at the head commit in your working directory.",
  "You can use Read, Grep, Glob and git log / git blame / git show to look things up. You cannot edit files.",
  "Answer in plain, direct language. Use short code references (path:line) where they help. Keep answers focused on the question.",
  "",
  `PR: ${review.title}`,
  `Author: ${review.author}`,
  `URL: ${review.url}`,
  `Base: ${review.baseSha}`,
  "",
];

/** Prompt for one Q&A turn. A new session gets the PR preamble; a resumed one only gets the question and its location. */
export const buildQaPrompt = (qa: QaContext, newSession: boolean): string => {
  const { review, chunk, chunkHunks, request } = qa;
  const location = request.filePath === null ? [] : [`File: ${request.filePath}${lineRange(request)}`];
  const selection =
    request.selectedText === null || request.selectedText.trim() === ""
      ? []
      : ["Selected code:", "```", request.selectedText, "```"];
  const chunkContext =
    chunk === null
      ? []
      : [`The reviewer is looking at the chunk "${chunk.title}": ${chunk.explanation}`, "", formatHunksForPrompt(chunkHunks, { maxPatchLines: 80 }), ""];
  return [
    ...(newSession ? prPreamble(review) : []),
    `Head commit: ${review.headSha}`,
    ...chunkContext,
    ...location,
    ...selection,
    "",
    "Question:",
    request.question,
  ].join("\n");
};

const loadQaContext = (ctx: AppContext, reviewId: string, request: AskQuestionRequest): QaContext => {
  const review = reviewsRepo.requireReview(ctx.db, reviewId);
  if (review.status === "past") {
    throw new HttpError(409, `Review ${reviewId} is in Past and read-only. Add the PR again to reopen it before asking questions.`);
  }
  if (request.chunkId === null) return { review, chunk: null, chunkHunks: [], request };
  const chunk = chunksRepo.getChunk(ctx.db, request.chunkId);
  if (chunk === undefined || chunk.reviewId !== reviewId) {
    throw new HttpError(404, `Chunk ${request.chunkId} does not belong to review ${reviewId}`);
  }
  return { review, chunk, chunkHunks: chunkHunksFor(ctx, reviewId, chunk.id), request };
};

interface StreamedAnswer {
  readonly answer: string;
  readonly sessionId: string;
  readonly usage: RunUsage;
}

async function* streamAnswer(
  ctx: AppContext,
  qa: QaContext,
  model: string,
  cwd: string,
  resumeSessionId: string | null,
  signal: AbortSignal,
  onDelta: () => void,
): AsyncGenerator<string, StreamedAnswer> {
  const stream = ctx.claude.runStreaming({
    prompt: buildQaPrompt(qa, resumeSessionId === null),
    model,
    cwd,
    resumeSessionId,
    maxTurns: QA_MAX_TURNS,
    signal,
  });
  for await (const event of stream) {
    if (event.type === "text") {
      onDelta();
      yield event.text;
    } else {
      return { answer: event.resultText, sessionId: event.sessionId, usage: event.usage };
    }
  }
  throw new Error("Claude's answer stream ended without a final result");
}

async function* answerWithResumeFallback(
  ctx: AppContext,
  qa: QaContext,
  model: string,
  cwd: string,
  log: RunLog,
  signal: AbortSignal,
): AsyncGenerator<string, StreamedAnswer> {
  const resumeSessionId = qa.review.qaSessionId;
  let streamed = false;
  const markStreamed = (): void => {
    streamed = true;
  };
  try {
    return yield* streamAnswer(ctx, qa, model, cwd, resumeSessionId, signal, markStreamed);
  } catch (error) {
    if (resumeSessionId === null || streamed || signal.aborted) throw error;
    log.retrying(`Could not resume the Q&A session, starting a new one: ${errorMessage(error)}`);
    return yield* streamAnswer(ctx, qa, model, cwd, null, signal, markStreamed);
  }
}

async function* runQuestion(
  ctx: AppContext,
  qa: QaContext,
  signal: AbortSignal,
): AsyncGenerator<QaStreamEvent> {
  const { review, request } = qa;
  const { models } = settingsRepo.getSettings(ctx.db);
  const model = request.useOpus ? models.qaOpus : models.qa;
  const question: Question = questionsRepo.insertQuestion(ctx.db, {
    id: newId("q"),
    reviewId: review.id,
    chunkId: request.chunkId,
    filePath: request.filePath,
    startLine: request.startLine,
    endLine: request.endLine,
    selectedText: request.selectedText,
    headSha: review.headSha,
    question: request.question,
    answer: null,
    model,
    createdAt: nowIso(),
  });
  reviewsRepo.touchReview(ctx.db, review.id);
  yield { type: "question", question };

  const log = startRunLog(ctx, review.id, "qa", model);
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal.reason);
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  let settled = false;
  try {
    const cwd = await resolveWorktree(ctx, review).catch((error: unknown) => {
      throw new Error(`Could not prepare the PR worktree: ${errorMessage(error)}`);
    });
    const answers = answerWithResumeFallback(ctx, qa, model, cwd, log, controller.signal);
    let next = await answers.next();
    while (next.done !== true) {
      yield { type: "delta", text: next.value };
      next = await answers.next();
    }
    const result = next.value;
    const usage = usageSince(result.usage, loggedSessionUsage(ctx, review.id, result.sessionId));
    const saved = ctx.db.transaction((tx) => {
      reviewsRepo.updateReview(tx, review.id, { qaSessionId: result.sessionId });
      return questionsRepo.updateQuestion(tx, question.id, { answer: result.answer });
    });
    settled = true;
    log.succeed({ usage, sessionId: result.sessionId });
    yield { type: "done", question: saved };
  } catch (error) {
    settled = true;
    const message = controller.signal.aborted ? "The question was cancelled" : `Claude could not answer: ${errorMessage(error)}`;
    const sessionId = sessionFromError(error);
    const reported = usageFromError(error);
    const usage =
      reported === null || sessionId === null ? (reported ?? ZERO_USAGE) : usageSince(reported, loggedSessionUsage(ctx, review.id, sessionId));
    log.fail(new Error(message), { usage, sessionId });
    if (!controller.signal.aborted) yield { type: "error", message };
  } finally {
    signal.removeEventListener("abort", abort);
    if (!settled) log.fail(new Error("The question was cancelled"), { usage: ZERO_USAGE, sessionId: null });
    controller.abort();
  }
}

/**
 * Saves the question, streams the answer from the review's ongoing session (resuming reviews.qa_session_id,
 * storing the new one), then saves the answer and logs a "qa" claude_runs row.
 * Yields "question" first, then "delta"s, then "done" or "error".
 * Throws HttpError immediately when the review or chunk does not exist, or the review is in Past.
 */
export const askQuestion = (
  ctx: AppContext,
  reviewId: string,
  request: AskQuestionRequest,
  signal: AbortSignal,
): AsyncIterable<QaStreamEvent> => runQuestion(ctx, loadQaContext(ctx, reviewId, request), signal);
