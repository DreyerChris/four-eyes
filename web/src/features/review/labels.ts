import type { ChunkStatus, FindingLifecycle, GitHubReviewEvent, MyReviewState, Review, Severity, UserVerdict, VerdictSuggestion } from "@shared/domain";

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

export const GITHUB_REVIEW_EVENT_LABELS: Readonly<Record<GitHubReviewEvent, string>> = {
  approve: "Approve",
  comment: "Comment",
  request_changes: "Request changes",
};

export const GITHUB_REVIEW_SUBMIT_LABELS: Readonly<Record<GitHubReviewEvent, string>> = {
  approve: "Approve on GitHub",
  comment: "Comment on GitHub",
  request_changes: "Request changes on GitHub",
};

export const MY_REVIEW_LABELS: Readonly<Record<MyReviewState, string>> = {
  approved: "you approved",
  changes_requested: "you requested changes",
  commented: "you commented",
  dismissed: "your review was dismissed",
};

/** True when the PR's latest known head is not the commit your GitHub review was left on. */
export const hasCommitsSinceMyReview = (review: Pick<Review, "myReviewCommitSha" | "remoteHeadSha" | "headSha">): boolean =>
  review.myReviewCommitSha !== null && review.myReviewCommitSha !== (review.remoteHeadSha ?? review.headSha);

export const MY_REVIEW_SENTENCES: Readonly<Record<MyReviewState, string>> = {
  approved: "You approved this PR on GitHub",
  changes_requested: "You requested changes on this PR on GitHub",
  commented: "You commented on this PR on GitHub",
  dismissed: "Your GitHub review of this PR was dismissed",
};
