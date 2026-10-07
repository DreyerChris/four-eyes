import type { JsonSchema } from "@shared/claude";
import type { Result } from "@shared/result";
import type { AppContext } from "../context";
import { errorMessage } from "../lib/errors";
import { sessionFromError, usageFromError } from "./errors";
import type { RunUsage, StructuredRunRequest } from "./runner";
import { addUsage, usageSince, ZERO_USAGE, type RunLog } from "./runs";

export interface StructuredAttemptPlan<T> {
  readonly ctx: AppContext;
  readonly log: RunLog;
  readonly kind: StructuredRunRequest["kind"];
  readonly model: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly jsonSchema: JsonSchema;
  readonly hunkIds: readonly string[];
  readonly maxTurns: number;
  readonly signal?: AbortSignal;
  readonly validate: (raw: unknown) => Result<T>;
  readonly retryPrompt: (error: string, resumed: boolean) => string;
}

export type StructuredOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly usage: RunUsage; readonly sessionId: string | null }
  | { readonly ok: false; readonly error: string; readonly usage: RunUsage; readonly sessionId: string | null };

interface AttemptResult<T> {
  readonly outcome: StructuredOutcome<T>;
  readonly producedOutput: boolean;
}

const attempt = async <T>(
  plan: StructuredAttemptPlan<T>,
  prompt: string,
  resumeSessionId: string | null,
): Promise<AttemptResult<T>> => {
  try {
    const result = await plan.ctx.claude.runStructured({
      kind: plan.kind,
      prompt,
      model: plan.model,
      cwd: plan.cwd,
      jsonSchema: plan.jsonSchema,
      hunkIds: plan.hunkIds,
      maxTurns: plan.maxTurns,
      onProgress: plan.log.progress,
      ...(plan.signal === undefined ? {} : { signal: plan.signal }),
      ...(resumeSessionId === null ? {} : { resumeSessionId }),
    });
    const validated = plan.validate(result.output);
    return {
      producedOutput: true,
      outcome: validated.ok
        ? { ok: true, value: validated.value, usage: result.usage, sessionId: result.sessionId }
        : { ok: false, error: `Invalid output: ${validated.error}`, usage: result.usage, sessionId: result.sessionId },
    };
  } catch (error) {
    return {
      producedOutput: false,
      outcome: {
        ok: false,
        error: errorMessage(error),
        usage: usageFromError(error) ?? ZERO_USAGE,
        sessionId: sessionFromError(error) ?? resumeSessionId,
      },
    };
  }
};

/**
 * Runs a structured Claude call, validates the output, and retries once with the error in the prompt.
 * The retry resumes the first session when the first attempt produced output, so Claude keeps its context.
 * Never throws for Claude failures; the caller decides what to do with an unsuccessful outcome.
 */
export const runStructuredWithRetry = async <T>(plan: StructuredAttemptPlan<T>): Promise<StructuredOutcome<T>> => {
  const first = await attempt(plan, plan.prompt, null);
  if (first.outcome.ok || plan.signal?.aborted === true) return first.outcome;

  plan.log.retrying(first.outcome.error);
  const resumeFrom = first.producedOutput ? first.outcome.sessionId : null;
  const second = await attempt(plan, plan.retryPrompt(first.outcome.error, resumeFrom !== null), resumeFrom);
  const secondUsage = resumeFrom === null ? second.outcome.usage : usageSince(second.outcome.usage, first.outcome.usage);
  const usage = addUsage(first.outcome.usage, secondUsage);
  const sessionId = second.outcome.sessionId ?? first.outcome.sessionId;
  return second.outcome.ok
    ? { ...second.outcome, usage, sessionId }
    : {
        ok: false,
        error: `${second.outcome.error} (first attempt: ${first.outcome.error})`,
        usage,
        sessionId,
      };
};
