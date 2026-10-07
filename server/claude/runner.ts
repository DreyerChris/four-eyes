import type { JsonSchema } from "@shared/claude";
import type { ClaudeRunKind } from "@shared/domain";

export interface RunUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface StructuredRunRequest {
  readonly kind: Exclude<ClaudeRunKind, "qa">;
  readonly prompt: string;
  readonly model: string;
  readonly cwd: string;
  readonly jsonSchema: JsonSchema;
  readonly hunkIds: readonly string[];
  readonly resumeSessionId?: string;
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (message: string) => void;
}

export interface StructuredRunResult {
  readonly output: unknown;
  readonly sessionId: string;
  readonly usage: RunUsage;
}

export interface StreamingRunRequest {
  readonly prompt: string;
  readonly model: string;
  readonly cwd: string;
  readonly resumeSessionId: string | null;
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
}

export type StreamingRunEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "done"; readonly sessionId: string; readonly resultText: string; readonly usage: RunUsage };

/**
 * The only way server code talks to Claude.
 * `hunkIds` lists the hunk IDs the prompt refers to; the fake runner builds canned output from them.
 * Both methods throw (or the stream throws) with a meaningful message on failure.
 */
export interface ClaudeRunner {
  readonly runStructured: (request: StructuredRunRequest) => Promise<StructuredRunResult>;
  readonly runStreaming: (request: StreamingRunRequest) => AsyncIterable<StreamingRunEvent>;
}
