import type { Hunk, ParsedHunk, Review, Round } from "@shared/domain";
import type { AppContext } from "../context";
import { hunksRepo, reviewsRepo, roundsRepo } from "../db/repositories";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import type { ClaudeRunner, RunUsage, StreamingRunEvent, StreamingRunRequest, StructuredRunRequest, StructuredRunResult } from "./runner";

export const SCRIPTED_USAGE: RunUsage = { inputTokens: 100, outputTokens: 20, costUsd: 0.01 };

export interface SeededReview {
  readonly review: Review;
  readonly round: Round;
  readonly hunks: readonly Hunk[];
}

const parsedHunk = (filePath: string, index: number): ParsedHunk => ({
  filePath,
  oldFilePath: null,
  changeType: "modified",
  oldStart: index * 10 + 1,
  oldLines: 2,
  newStart: index * 10 + 1,
  newLines: 3,
  patchText: [`@@ -${index * 10 + 1},2 +${index * 10 + 1},3 @@`, " context", "-old line", "+new line", "+another line"].join("\n"),
});

/** Inserts a review (worktree at the test home), round 1 and one hunk per given file path. */
export const seedReviewWithHunks = (ctx: AppContext, filePaths: readonly string[]): SeededReview => {
  const now = nowIso();
  const review = reviewsRepo.insertReview(ctx.db, {
    id: newId("rev"),
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    prNumber: 7,
    title: "Add email to users",
    author: "octocat",
    url: "https://github.com/acme/widgets/pull/7",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    ghState: "open",
    status: "active",
    pipelineStatus: "chunking",
    pipelineError: null,
    worktreePath: ctx.config.home,
    qaSessionId: null,
    remoteHeadSha: null,
    remoteCheckedAt: null,
    myReviewState: null,
    myReviewSubmittedAt: null,
    myReviewCommitSha: null,
    createdAt: now,
    lastActivityAt: now,
    finishedAt: null,
  });
  const round = roundsRepo.insertRound(ctx.db, { id: newId("rnd"), reviewId: review.id, number: 1, headSha: review.headSha, createdAt: now });
  const hunks = hunksRepo.insertHunks(
    ctx.db,
    filePaths.map((filePath, position) => ({
      ...parsedHunk(filePath, position),
      id: newId("h"),
      reviewId: review.id,
      roundId: round.id,
      fingerprint: `fp-${position}`,
      position,
      present: true,
    })),
  );
  return { review, round, hunks };
};

export type ScriptedStep = { readonly output: unknown; readonly sessionId?: string; readonly usage?: RunUsage } | Error | "hang";

export interface ScriptedRunner extends ClaudeRunner {
  readonly structuredRequests: readonly StructuredRunRequest[];
  readonly streamingRequests: readonly StreamingRunRequest[];
}

/** Never settles until the request is aborted, then rejects with the abort reason. */
const hangUntilAborted = (signal: AbortSignal | undefined): Promise<never> =>
  new Promise((_resolve, reject) => {
    if (signal === undefined) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

/** A runner that replays the given structured outputs (or throws the given errors, or hangs) in order, recording every request. */
export const createScriptedRunner = (
  steps: readonly ScriptedStep[],
  stream: (request: StreamingRunRequest) => readonly StreamingRunEvent[] = () => [],
): ScriptedRunner => {
  const structuredRequests: StructuredRunRequest[] = [];
  const streamingRequests: StreamingRunRequest[] = [];

  const runStructured = async (request: StructuredRunRequest): Promise<StructuredRunResult> => {
    const step = steps[structuredRequests.length];
    structuredRequests.push(request);
    if (step === undefined) throw new Error(`Scripted runner has no step ${structuredRequests.length}`);
    if (step instanceof Error) throw step;
    if (step === "hang") return hangUntilAborted(request.signal);
    return { output: step.output, sessionId: step.sessionId ?? `scripted-${structuredRequests.length}`, usage: step.usage ?? SCRIPTED_USAGE };
  };

  async function* runStreaming(request: StreamingRunRequest): AsyncIterable<StreamingRunEvent> {
    streamingRequests.push(request);
    for (const event of stream(request)) {
      await Promise.resolve();
      yield event;
    }
  }

  return { runStructured, runStreaming, structuredRequests, streamingRequests };
};
