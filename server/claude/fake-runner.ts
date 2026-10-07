import type { ChunkPlan, ReviewResult } from "@shared/claude";
import type {
  ClaudeRunner,
  RunUsage,
  StreamingRunEvent,
  StreamingRunRequest,
  StructuredRunRequest,
  StructuredRunResult,
} from "./runner";

const FAKE_USAGE: RunUsage = { inputTokens: 1200, outputTokens: 300, costUsd: 0.0123 };
const HUNKS_PER_CHUNK = 2;

const groupsOf = <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/** Deterministic chunk plan: pairs of hunks in the given order, the last group marked as skim when there are 3+ groups. */
export const fakeChunkPlan = (hunkIds: readonly string[]): ChunkPlan => {
  const groups = groupsOf(hunkIds, HUNKS_PER_CHUNK);
  return {
    chunks: groups.map((ids, index) => ({
      title: `Fake chunk ${index + 1}`,
      explanation: `Canned explanation for hunks ${ids.join(", ")}.`,
      kind: groups.length >= 3 && index === groups.length - 1 ? "skim" : "core",
      hunkIds: ids,
    })),
  };
};

/** Deterministic review: one bug on the first hunk, one nit on the last hunk. */
export const fakeReviewResult = (hunkIds: readonly string[]): ReviewResult => {
  const first = hunkIds[0];
  const last = hunkIds[hunkIds.length - 1];
  return {
    verdict: {
      summary: "Fake review: the change looks reasonable with one bug worth fixing.",
      suggestion: first === undefined ? "approve" : "request_changes",
    },
    findings: [
      ...(first === undefined
        ? []
        : [
            {
              severity: "bug" as const,
              title: "Fake bug finding",
              explanation: "Canned bug explanation from the fake Claude runner.",
              hunkIds: [first],
              suggestedFix: "Apply the canned fix.",
            },
          ]),
      ...(last === undefined || last === first
        ? []
        : [
            {
              severity: "nit" as const,
              title: "Fake nit finding",
              explanation: "Canned nit explanation from the fake Claude runner.",
              hunkIds: [last],
            },
          ]),
    ],
  };
};

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Fake Claude run aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Fake Claude run aborted"));
      },
      { once: true },
    );
  });

export interface FakeClaudeRunnerOptions {
  readonly latencyMs?: number;
}

/** Spends no tokens. Selected with FOUR_EYES_FAKE_CLAUDE=1 for tests and e2e runs. */
export const createFakeClaudeRunner = (options: FakeClaudeRunnerOptions = {}): ClaudeRunner => {
  const latencyMs = options.latencyMs ?? 50;
  let sessionCounter = 0;

  const runStructured = async (request: StructuredRunRequest): Promise<StructuredRunResult> => {
    request.onProgress?.(`fake ${request.kind} run started`);
    await delay(latencyMs, request.signal);
    sessionCounter += 1;
    const output = request.kind === "chunking" ? fakeChunkPlan(request.hunkIds) : fakeReviewResult(request.hunkIds);
    return { output, sessionId: request.resumeSessionId ?? `fake-session-${sessionCounter}`, usage: FAKE_USAGE };
  };

  async function* runStreaming(request: StreamingRunRequest): AsyncIterable<StreamingRunEvent> {
    sessionCounter += 1;
    const sessionId = request.resumeSessionId ?? `fake-session-${sessionCounter}`;
    const words = ["This", "is", "a", "fake", "answer", "from", "the", "fake", "Claude", "runner."];
    const parts = words.map((word, index) => (index === 0 ? word : ` ${word}`));
    for (const text of parts) {
      await delay(Math.max(1, Math.floor(latencyMs / 5)), request.signal);
      yield { type: "text", text };
    }
    yield { type: "done", sessionId, resultText: parts.join(""), usage: FAKE_USAGE };
  }

  return { runStructured, runStreaming };
};
