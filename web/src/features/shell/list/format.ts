import type { ReviewProgress } from "@shared/api";
import type { PipelineStep, ProgressEvent, RunEventState, StepState } from "@shared/domain";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short relative time such as "5m ago". Falls back to the calendar date after a week. */
export const formatRelative = (iso: string, nowMs: number): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const elapsed = Math.max(0, nowMs - then);
  if (elapsed < 45_000) return "just now";
  if (elapsed < HOUR) return `${Math.round(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.round(elapsed / DAY)}d ago`;
  return new Date(then).toISOString().slice(0, 10);
};

/** A fixed-width text progress bar like "[###---]". */
export const progressBar = (progress: ReviewProgress, width = 10): string => {
  if (progress.totalChunks === 0) return `[${"-".repeat(width)}]`;
  const reviewed = progress.totalChunks - progress.unseen;
  const filled = Math.round((reviewed / progress.totalChunks) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
};

export const INGEST_STEPS = ["fetch_pr", "clone", "worktree", "diff", "parse", "save", "chunking", "review"] as const satisfies readonly PipelineStep[];
export type IngestStep = (typeof INGEST_STEPS)[number];

export const STEP_LABELS: Readonly<Record<IngestStep, string>> = {
  fetch_pr: "fetch PR details",
  clone: "update local clone",
  worktree: "check out the head commit",
  diff: "diff base and head",
  parse: "split the diff into hunks",
  save: "save hunks",
  chunking: "Claude groups hunks into chunks",
  review: "Claude reviews the PR",
};

export type StepDisplayState = "pending" | StepState;

export interface StepSummary {
  readonly step: IngestStep;
  readonly label: string;
  readonly state: StepDisplayState;
  readonly message: string | null;
}

const RUN_TO_STEP_STATE: Readonly<Record<RunEventState, StepState>> = {
  started: "started",
  progress: "started",
  retrying: "started",
  done: "done",
  failed: "failed",
};

const isIngestStep = (step: string): step is IngestStep => (INGEST_STEPS as readonly string[]).includes(step);

/** Folds progress events into the latest state and message for each ingest step, in pipeline order. */
export const summarizeSteps = (events: readonly ProgressEvent[]): readonly StepSummary[] => {
  const latest = events.reduce((map, event) => {
    if (event.type === "step" && isIngestStep(event.step)) {
      const previous = map.get(event.step);
      return new Map(map).set(event.step, { state: event.state, message: event.message ?? previous?.message ?? null });
    }
    if (event.type === "run" && isIngestStep(event.kind)) {
      const previous = map.get(event.kind);
      const message = event.state === "retrying" ? `retrying${event.message ? `: ${event.message}` : ""}` : event.message;
      return new Map(map).set(event.kind, { state: RUN_TO_STEP_STATE[event.state], message: message ?? previous?.message ?? null });
    }
    return map;
  }, new Map<IngestStep, { readonly state: StepState; readonly message: string | null }>());
  return INGEST_STEPS.map((step) => ({
    step,
    label: STEP_LABELS[step],
    state: latest.get(step)?.state ?? "pending",
    message: latest.get(step)?.message ?? null,
  }));
};

export const STEP_MARKERS: Readonly<Record<StepDisplayState, string>> = {
  pending: "[ ]",
  started: "[~]",
  done: "[x]",
  failed: "[!]",
  skipped: "[-]",
};
