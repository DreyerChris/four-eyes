import { describe, expect, it } from "vitest";
import type { ProgressEvent } from "@shared/domain";
import { formatRelative, progressBar, summarizeSteps } from "./format";

const at = "2026-10-07T10:00:00.000Z";
const now = Date.parse(at);

describe("formatRelative", () => {
  it("formats recent times relative to now", () => {
    expect(formatRelative(at, now + 10_000)).toBe("just now");
    expect(formatRelative(at, now + 5 * 60_000)).toBe("5m ago");
    expect(formatRelative(at, now + 3 * 3_600_000)).toBe("3h ago");
    expect(formatRelative(at, now + 2 * 86_400_000)).toBe("2d ago");
  });

  it("falls back to the date for old times and handles bad input", () => {
    expect(formatRelative(at, now + 30 * 86_400_000)).toBe("2026-10-07");
    expect(formatRelative("not a date", now)).toBe("unknown");
  });
});

describe("progressBar", () => {
  it("fills in proportion to reviewed chunks", () => {
    expect(progressBar({ totalChunks: 4, good: 1, flagged: 1, question: 0, unseen: 2 }, 4)).toBe("[##--]");
    expect(progressBar({ totalChunks: 0, good: 0, flagged: 0, question: 0, unseen: 0 }, 3)).toBe("[---]");
  });
});

describe("summarizeSteps", () => {
  it("keeps the latest state per step and merges run events into their step", () => {
    const events: readonly ProgressEvent[] = [
      { type: "step", step: "fetch_pr", state: "started", message: null, at },
      { type: "step", step: "fetch_pr", state: "done", message: null, at },
      { type: "step", step: "clone", state: "started", message: "fetching", at },
      { type: "run", runId: "run_1", kind: "chunking", state: "retrying", message: "missing hunk h_1", at },
      { type: "run", runId: "run_2", kind: "qa", state: "started", message: null, at },
      { type: "review_updated", at },
    ];
    const summary = summarizeSteps(events);
    const byStep = new Map(summary.map((step) => [step.step, step]));
    expect(summary.map((step) => step.step)).toEqual(["fetch_pr", "clone", "worktree", "diff", "parse", "save", "chunking", "review"]);
    expect(byStep.get("fetch_pr")?.state).toBe("done");
    expect(byStep.get("clone")).toMatchObject({ state: "started", message: "fetching" });
    expect(byStep.get("chunking")).toMatchObject({ state: "started", message: "retrying: missing hunk h_1" });
    expect(byStep.get("worktree")?.state).toBe("pending");
  });

  it("keeps an earlier message when a later event has none", () => {
    const summary = summarizeSteps([
      { type: "step", step: "save", state: "failed", message: "disk full", at },
      { type: "step", step: "save", state: "failed", message: null, at },
    ]);
    expect(summary.find((step) => step.step === "save")?.message).toBe("disk full");
  });
});
