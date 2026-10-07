import { query, type HookCallback, type Options, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRunError } from "./errors";
import { resolveClaudeExecutable, type ClaudeExecutableInput } from "./executable";
import type { ClaudeRunner, RunUsage, StreamingRunEvent, StreamingRunRequest, StructuredRunRequest, StructuredRunResult } from "./runner";
import { ALLOWED_TOOL_RULES, DISALLOWED_TOOLS, evaluateToolUse, READ_ONLY_TOOLS } from "./tool-policy";

const DEFAULT_STRUCTURED_MAX_TURNS = 30;
const DEFAULT_STREAMING_MAX_TURNS = 20;

interface BaseRunInput {
  readonly model: string;
  readonly cwd: string;
  readonly maxTurns: number;
  readonly resumeSessionId: string | null;
  readonly abortController: AbortController;
  readonly onProgress?: (message: string) => void;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;

const numberField = (record: Readonly<Record<string, unknown>>, key: string): number => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const toolUseSummary = (name: string, input: unknown): string => {
  const record = isRecord(input) ? input : {};
  const target = ["file_path", "pattern", "path", "command"]
    .map((key) => record[key])
    .find((value): value is string => typeof value === "string");
  return target === undefined ? `Using ${name}` : `${name}: ${target}`;
};

/** Live-progress text for a tool call once the guard has decided; refused calls say so. Null for internal tools. */
export const toolProgressText = (toolName: string, toolInput: unknown, allowed: boolean): string | null => {
  if (toolName === "StructuredOutput") return null;
  const summary = toolUseSummary(toolName, toolInput);
  return allowed ? summary : `Blocked (not allowed in read-only mode) ${summary}`;
};

const toolGuard =
  (cwd: string, onProgress: ((message: string) => void) | undefined): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const decision = evaluateToolUse(input.tool_name, input.tool_input, cwd);
    const progress = toolProgressText(input.tool_name, input.tool_input, decision.allow);
    if (progress !== null) onProgress?.(progress);
    return decision.allow
      ? {}
      : {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason,
          },
        };
  };

const buildOptions = (executable: string, input: BaseRunInput): Options => ({
  pathToClaudeCodeExecutable: executable,
  settingSources: ["user"],
  model: input.model,
  cwd: input.cwd,
  maxTurns: input.maxTurns,
  tools: [...READ_ONLY_TOOLS],
  allowedTools: [...ALLOWED_TOOL_RULES],
  disallowedTools: [...DISALLOWED_TOOLS],
  permissionMode: "dontAsk",
  strictMcpConfig: true,
  mcpServers: {},
  hooks: { PreToolUse: [{ hooks: [toolGuard(input.cwd, input.onProgress)] }] },
  abortController: input.abortController,
  ...(input.resumeSessionId === null ? {} : { resume: input.resumeSessionId }),
});

const usageOf = (result: SDKResultMessage): RunUsage => {
  const models = Object.values(result.modelUsage ?? {});
  if (models.length > 0) {
    return models.reduce<RunUsage>(
      (total, model) => ({
        inputTokens: total.inputTokens + model.inputTokens + model.cacheReadInputTokens + model.cacheCreationInputTokens,
        outputTokens: total.outputTokens + model.outputTokens,
        costUsd: total.costUsd,
      }),
      { inputTokens: 0, outputTokens: 0, costUsd: result.total_cost_usd },
    );
  }
  const usage: unknown = result.usage;
  const record = isRecord(usage) ? usage : {};
  return {
    inputTokens:
      numberField(record, "input_tokens") +
      numberField(record, "cache_read_input_tokens") +
      numberField(record, "cache_creation_input_tokens"),
    outputTokens: numberField(record, "output_tokens"),
    costUsd: result.total_cost_usd,
  };
};

const failureMessage = (result: SDKResultMessage): string => {
  if (result.subtype === "success") return `Claude reported an error: ${result.result || "no details"}`;
  const details = result.errors.length > 0 ? `: ${result.errors.join("; ")}` : "";
  switch (result.subtype) {
    case "error_max_turns":
      return `Claude ran out of turns before finishing${details}`;
    case "error_max_budget_usd":
      return `Claude hit the budget limit${details}`;
    case "error_max_structured_output_retries":
      return `Claude could not produce output matching the schema${details}`;
    case "error_during_execution":
      return `Claude failed during execution${details}`;
  }
};

const linkAbort = (signal: AbortSignal | undefined): AbortController => {
  const controller = new AbortController();
  if (signal?.aborted) controller.abort(signal.reason);
  signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller;
};

const textDeltaOf = (message: SDKMessage): string | null => {
  if (message.type !== "stream_event" || message.parent_tool_use_id !== null) return null;
  const event: unknown = message.event;
  if (!isRecord(event) || event.type !== "content_block_delta" || !isRecord(event.delta)) return null;
  return event.delta.type === "text_delta" && typeof event.delta.text === "string" ? event.delta.text : null;
};

const parseStructured = (result: SDKResultMessage): unknown => {
  if (result.subtype !== "success") return undefined;
  if (result.structured_output !== undefined && result.structured_output !== null) return result.structured_output;
  try {
    return JSON.parse(result.result);
  } catch {
    return undefined;
  }
};

const describeError = (error: unknown, executable: string): string => {
  const message = error instanceof Error ? error.message : String(error);
  return `Claude run failed (executable ${executable}): ${message}`;
};

/**
 * Real runner over @anthropic-ai/claude-agent-sdk, using the Claude Code binary picked by resolveClaudeExecutable.
 * Must use read-only tools only: Read, Grep, Glob, and Bash limited to git log / git blame / git show.
 */
export const createSdkClaudeRunner = (executableInput: () => ClaudeExecutableInput): ClaudeRunner => {
  const executable = (): string => {
    const resolved = resolveClaudeExecutable(executableInput());
    if (!resolved.ok) throw new ClaudeRunError(resolved.error);
    return resolved.path;
  };

  const runStructured = async (request: StructuredRunRequest): Promise<StructuredRunResult> => {
    const path = executable();
    const abortController = linkAbort(request.signal);
    const options: Options = {
      ...buildOptions(path, {
        model: request.model,
        cwd: request.cwd,
        maxTurns: request.maxTurns ?? DEFAULT_STRUCTURED_MAX_TURNS,
        resumeSessionId: request.resumeSessionId ?? null,
        abortController,
        onProgress: request.onProgress,
      }),
      outputFormat: { type: "json_schema", schema: { ...request.jsonSchema } },
    };
    let result: SDKResultMessage | undefined;
    let sessionId: string | null = request.resumeSessionId ?? null;
    try {
      for await (const message of query({ prompt: request.prompt, options })) {
        sessionId = message.session_id ?? sessionId;
        if (message.type === "result") result = message;
      }
    } catch (error) {
      throw new ClaudeRunError(describeError(error, path), {
        sessionId,
        usage: result === undefined ? null : usageOf(result),
      });
    }
    if (result === undefined) throw new ClaudeRunError("Claude finished without a result message", { sessionId });
    const usage = usageOf(result);
    if (result.subtype !== "success" || result.is_error) {
      throw new ClaudeRunError(failureMessage(result), { usage, sessionId: result.session_id });
    }
    const output = parseStructured(result);
    if (output === undefined) {
      throw new ClaudeRunError("Claude returned no structured output", { usage, sessionId: result.session_id });
    }
    return { output, sessionId: result.session_id, usage };
  };

  async function* runStreaming(request: StreamingRunRequest): AsyncIterable<StreamingRunEvent> {
    const path = executable();
    const abortController = linkAbort(request.signal);
    const options: Options = {
      ...buildOptions(path, {
        model: request.model,
        cwd: request.cwd,
        maxTurns: request.maxTurns ?? DEFAULT_STREAMING_MAX_TURNS,
        resumeSessionId: request.resumeSessionId,
        abortController,
      }),
      includePartialMessages: true,
    };
    let result: SDKResultMessage | undefined;
    let sessionId: string | null = request.resumeSessionId;
    let finished = false;
    try {
      for await (const message of query({ prompt: request.prompt, options })) {
        sessionId = message.session_id ?? sessionId;
        const text = textDeltaOf(message);
        if (text !== null && text !== "") yield { type: "text", text };
        if (message.type === "result") result = message;
      }
      finished = true;
    } catch (error) {
      throw new ClaudeRunError(describeError(error, path), {
        sessionId,
        usage: result === undefined ? null : usageOf(result),
      });
    } finally {
      if (!finished) abortController.abort();
    }
    if (result === undefined) throw new ClaudeRunError("Claude finished without a result message", { sessionId });
    const usage = usageOf(result);
    if (result.subtype !== "success" || result.is_error) {
      throw new ClaudeRunError(failureMessage(result), { usage, sessionId: result.session_id });
    }
    yield { type: "done", sessionId: result.session_id, resultText: result.result, usage };
  }

  return { runStructured, runStreaming };
};
