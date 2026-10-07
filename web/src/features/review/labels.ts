import type { ChunkStatus, FindingLifecycle, Severity, UserVerdict, VerdictSuggestion } from "@shared/domain";

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  bug: "Bug",
  risk: "Risk",
  improvement: "Improvement",
  nit: "Nit",
};

export const STATUS_LABELS: Readonly<Record<ChunkStatus, string>> = {
  unseen: "Unseen",
  good: "Looks good",
  flagged: "Flagged",
  question: "Question",
};

export const STATUS_MARKS: Readonly<Record<ChunkStatus, string>> = {
  unseen: "·",
  good: "✓",
  flagged: "!",
  question: "?",
};

export const LIFECYCLE_LABELS: Readonly<Record<FindingLifecycle, string>> = {
  new: "new",
  still_present: "still present",
  resolved: "resolved",
};

export const USER_VERDICT_LABELS: Readonly<Record<UserVerdict, string>> = {
  agree: "Agree",
  disagree: "Disagree",
  unsure: "Unsure",
};

export const SUGGESTION_LABELS: Readonly<Record<VerdictSuggestion, string>> = {
  approve: "Approve",
  approve_with_nits: "Approve with nits",
  request_changes: "Request changes",
};
