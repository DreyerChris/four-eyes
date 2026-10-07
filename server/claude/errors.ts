import type { RunUsage } from "./runner";

/** A Claude run that failed after starting. Carries whatever usage and session the SDK reported so it can still be logged. */
export class ClaudeRunError extends Error {
  readonly usage: RunUsage | null;
  readonly sessionId: string | null;

  constructor(message: string, details: { readonly usage?: RunUsage | null; readonly sessionId?: string | null } = {}) {
    super(message);
    this.name = "ClaudeRunError";
    this.usage = details.usage ?? null;
    this.sessionId = details.sessionId ?? null;
  }
}

/** Usage attached to an error thrown by a runner, if any. */
export const usageFromError = (error: unknown): RunUsage | null => (error instanceof ClaudeRunError ? error.usage : null);

/** Session ID attached to an error thrown by a runner, if any. */
export const sessionFromError = (error: unknown): string | null => (error instanceof ClaudeRunError ? error.sessionId : null);
