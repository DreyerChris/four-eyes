import type { ChunkView, FindingView, ReviewDetailResponse, ReviewListItem, SummaryResponse } from "@shared/api";
import type { ChunkProgress, Hunk } from "@shared/domain";

const NOW = "2026-10-07T10:00:00.000Z";

export const fixtureHunk = (overrides: Partial<Hunk> = {}): Hunk => ({
  id: "h_1",
  reviewId: "rev_1",
  roundId: "rnd_1",
  fingerprint: "fp",
  position: 0,
  present: true,
  filePath: "src/user.ts",
  oldFilePath: null,
  changeType: "modified",
  oldStart: 10,
  oldLines: 3,
  newStart: 10,
  newLines: 4,
  patchText: ["@@ -10,3 +10,4 @@", " const a = 1;", "-const user = load();", "+const user = loadUser();", "+const email = user.email;", " done();"].join(
    "\n",
  ),
  ...overrides,
});

export const fixtureProgress = (overrides: Partial<ChunkProgress> = {}): ChunkProgress => ({
  chunkId: "chk_1",
  status: "unseen",
  note: "",
  updatedAt: NOW,
  ...overrides,
});

export const fixtureReviewItem = (overrides: Partial<ReviewListItem> = {}): ReviewListItem => ({
  id: "rev_1",
  host: "github.com",
  owner: "acme",
  repo: "widgets",
  prNumber: 7,
  title: "Add email to users",
  author: "octocat",
  url: "https://github.com/acme/widgets/pull/7",
  baseSha: "b".repeat(40),
  headSha: "h".repeat(40),
  ghState: "open",
  status: "active",
  pipelineStatus: "ready",
  pipelineError: null,
  worktreePath: null,
  qaSessionId: null,
  remoteHeadSha: null,
  remoteCheckedAt: null,
  myReviewState: null,
  myReviewSubmittedAt: null,
  myReviewCommitSha: null,
  createdAt: NOW,
  lastActivityAt: NOW,
  finishedAt: null,
  progress: { totalChunks: 2, good: 0, flagged: 0, question: 0, unseen: 2 },
  hasNewCommits: false,
  reviewRunStatus: "succeeded",
  ...overrides,
});

export const fixtureFinding = (overrides: Partial<FindingView> = {}): FindingView => ({
  id: "fnd_1",
  reviewId: "rev_1",
  roundId: "rnd_1",
  severity: "bug",
  title: "Email can be undefined",
  explanation: "loadUser may return a user without an email.",
  suggestedFix: "Guard with `user.email ?? null`.",
  lifecycle: "new",
  userVerdict: null,
  hunkIds: ["h_1"],
  chunkIds: ["chk_1"],
  range: null,
  ...overrides,
});

export const fixtureChunk = (overrides: Partial<ChunkView> = {}): ChunkView => ({
  id: "chk_1",
  reviewId: "rev_1",
  roundId: "rnd_1",
  position: 0,
  title: "Load users with email",
  explanation: "Switches to loadUser and reads the email.",
  kind: "core",
  roundNumber: 1,
  hunks: [fixtureHunk()],
  progress: fixtureProgress(),
  findingIds: ["fnd_1"],
  questionCount: 0,
  ...overrides,
});

export const fixtureDetail = (overrides: Partial<ReviewDetailResponse> = {}): ReviewDetailResponse => ({
  review: fixtureReviewItem(),
  rounds: [{ id: "rnd_1", reviewId: "rev_1", number: 1, headSha: "h".repeat(40), createdAt: NOW }],
  chunks: [
    fixtureChunk(),
    fixtureChunk({
      id: "chk_2",
      position: 1,
      title: "Lockfile",
      explanation: "Dependency bump.",
      kind: "skim",
      hunks: [fixtureHunk({ id: "h_2", filePath: "pnpm-lock.yaml", patchText: "@@ -1,1 +1,1 @@\n-version: 1\n+version: 2", oldStart: 1, newStart: 1, oldLines: 1, newLines: 1 })],
      progress: fixtureProgress({ chunkId: "chk_2" }),
      findingIds: [],
    }),
  ],
  findings: [fixtureFinding()],
  runs: [],
  ...overrides,
});

export const fixtureSummary = (overrides: Partial<SummaryResponse> = {}): SummaryResponse => ({
  review: fixtureReviewItem(),
  verdict: { reviewId: "rev_1", roundId: "rnd_1", summary: "Fix the email guard.", suggestion: "request_changes" },
  findings: [fixtureFinding(), fixtureFinding({ id: "fnd_2", severity: "nit", title: "Rename variable", explanation: "Call it userEmail.", suggestedFix: null, hunkIds: ["h_2"], chunkIds: ["chk_2"] })],
  chunks: [
    {
      id: "chk_1",
      reviewId: "rev_1",
      roundId: "rnd_1",
      position: 0,
      title: "Load users with email",
      explanation: "Switches to loadUser.",
      kind: "core",
      roundNumber: 1,
      progress: fixtureProgress({ status: "flagged", note: "Check null emails.\nAlso the old callers." }),
      hunkCount: 1,
      presentHunkCount: 1,
    },
    {
      id: "chk_2",
      reviewId: "rev_1",
      roundId: "rnd_1",
      position: 1,
      title: "Lockfile",
      explanation: "Dependency bump.",
      kind: "skim",
      roundNumber: 1,
      progress: fixtureProgress({ chunkId: "chk_2" }),
      hunkCount: 1,
      presentHunkCount: 1,
    },
  ],
  questions: [
    {
      id: "q_1",
      reviewId: "rev_1",
      chunkId: "chk_1",
      filePath: "src/user.ts",
      startLine: 11,
      endLine: 12,
      selectedText: "loadUser()",
      headSha: "h".repeat(40),
      question: "Can loadUser throw?",
      answer: "Yes, on a network error.",
      model: "claude-sonnet-5-5",
      createdAt: NOW,
    },
  ],
  coverage: { totalChunks: 2, reviewedChunks: 1, unseenChunks: 1, totalHunks: 3, presentHunks: 2, missingHunks: 1, reviewedHunks: 1 },
  reviewRun: null,
  ...overrides,
});
