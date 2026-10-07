import { z } from "zod";

export const REVIEW_STATUSES = ["active", "past"] as const;
export const GH_STATES = ["open", "closed", "merged"] as const;
export const PIPELINE_STATUSES = ["ingesting", "chunking", "ready", "failed"] as const;
export const CHANGE_TYPES = ["added", "modified", "deleted", "renamed"] as const;
export const CHUNK_KINDS = ["core", "skim"] as const;
export const CHUNK_STATUSES = ["unseen", "good", "flagged", "question"] as const;
export const SEVERITIES = ["bug", "risk", "improvement", "nit"] as const;
export const FINDING_LIFECYCLES = ["new", "still_present", "resolved"] as const;
export const USER_VERDICTS = ["agree", "disagree", "unsure"] as const;
export const VERDICT_SUGGESTIONS = ["approve", "approve_with_nits", "request_changes"] as const;
export const CLAUDE_RUN_KINDS = ["chunking", "review", "qa"] as const;
export const CLAUDE_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export const DIFF_LAYOUTS = ["unified", "split"] as const;
export const THEMES = ["dark", "light"] as const;
export const VERBOSITIES = ["brief", "standard", "detailed"] as const;
export const GITHUB_REVIEW_EVENTS = ["approve", "comment", "request_changes"] as const;
export const DIFF_SIDES = ["old", "new"] as const;

export const ReviewStatusSchema = z.enum(REVIEW_STATUSES);
export const GhStateSchema = z.enum(GH_STATES);
export const PipelineStatusSchema = z.enum(PIPELINE_STATUSES);
export const ChangeTypeSchema = z.enum(CHANGE_TYPES);
export const ChunkKindSchema = z.enum(CHUNK_KINDS);
export const ChunkStatusSchema = z.enum(CHUNK_STATUSES);
export const SeveritySchema = z.enum(SEVERITIES);
export const FindingLifecycleSchema = z.enum(FINDING_LIFECYCLES);
export const UserVerdictSchema = z.enum(USER_VERDICTS);
export const VerdictSuggestionSchema = z.enum(VERDICT_SUGGESTIONS);
export const ClaudeRunKindSchema = z.enum(CLAUDE_RUN_KINDS);
export const ClaudeRunStatusSchema = z.enum(CLAUDE_RUN_STATUSES);
export const DiffLayoutSchema = z.enum(DIFF_LAYOUTS);
export const ThemeSchema = z.enum(THEMES);
export const VerbositySchema = z.enum(VERBOSITIES);
export const GitHubReviewEventSchema = z.enum(GITHUB_REVIEW_EVENTS);
export const DiffSideSchema = z.enum(DIFF_SIDES);

export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type GhState = z.infer<typeof GhStateSchema>;
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;
export type ChangeType = z.infer<typeof ChangeTypeSchema>;
export type ChunkKind = z.infer<typeof ChunkKindSchema>;
export type ChunkStatus = z.infer<typeof ChunkStatusSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type FindingLifecycle = z.infer<typeof FindingLifecycleSchema>;
export type UserVerdict = z.infer<typeof UserVerdictSchema>;
export type VerdictSuggestion = z.infer<typeof VerdictSuggestionSchema>;
export type ClaudeRunKind = z.infer<typeof ClaudeRunKindSchema>;
export type ClaudeRunStatus = z.infer<typeof ClaudeRunStatusSchema>;
export type DiffLayout = z.infer<typeof DiffLayoutSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Verbosity = z.infer<typeof VerbositySchema>;
export type GitHubReviewEvent = z.infer<typeof GitHubReviewEventSchema>;
export type DiffSide = z.infer<typeof DiffSideSchema>;

export const IsoDateSchema = z.string();

export const PrRefSchema = z.object({
  host: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
});
export type PrRef = z.infer<typeof PrRefSchema>;

export const PrMetaSchema = z.object({
  title: z.string(),
  author: z.string(),
  url: z.string(),
  state: GhStateSchema,
  headSha: z.string(),
  baseSha: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
});
export type PrMeta = z.infer<typeof PrMetaSchema>;

export const ReviewSchema = z.object({
  id: z.string(),
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().int(),
  title: z.string(),
  author: z.string(),
  url: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  ghState: GhStateSchema,
  status: ReviewStatusSchema,
  pipelineStatus: PipelineStatusSchema,
  pipelineError: z.string().nullable(),
  worktreePath: z.string().nullable(),
  qaSessionId: z.string().nullable(),
  remoteHeadSha: z.string().nullable(),
  remoteCheckedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  lastActivityAt: IsoDateSchema,
  finishedAt: IsoDateSchema.nullable(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const RoundSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  number: z.number().int().positive(),
  headSha: z.string(),
  createdAt: IsoDateSchema,
});
export type Round = z.infer<typeof RoundSchema>;

export const ParsedHunkSchema = z.object({
  filePath: z.string(),
  oldFilePath: z.string().nullable(),
  changeType: ChangeTypeSchema,
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  patchText: z.string(),
});
export type ParsedHunk = z.infer<typeof ParsedHunkSchema>;

export const HunkSchema = ParsedHunkSchema.extend({
  id: z.string(),
  reviewId: z.string(),
  roundId: z.string(),
  fingerprint: z.string(),
  position: z.number().int().nonnegative(),
  present: z.boolean(),
});
export type Hunk = z.infer<typeof HunkSchema>;

export const ChunkSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  roundId: z.string(),
  position: z.number().int().nonnegative(),
  title: z.string(),
  explanation: z.string(),
  kind: ChunkKindSchema,
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const ChunkHunkSchema = z.object({
  chunkId: z.string(),
  hunkId: z.string(),
  position: z.number().int().nonnegative(),
});
export type ChunkHunk = z.infer<typeof ChunkHunkSchema>;

export const ChunkProgressSchema = z.object({
  chunkId: z.string(),
  status: ChunkStatusSchema,
  note: z.string(),
  updatedAt: IsoDateSchema,
});
export type ChunkProgress = z.infer<typeof ChunkProgressSchema>;

export const FindingRangeSchema = z
  .object({
    side: DiffSideSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((range) => range.endLine >= range.startLine, { message: "endLine must not be before startLine" });
export type FindingRange = z.infer<typeof FindingRangeSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  roundId: z.string(),
  severity: SeveritySchema,
  title: z.string(),
  explanation: z.string(),
  suggestedFix: z.string().nullable(),
  lifecycle: FindingLifecycleSchema,
  userVerdict: UserVerdictSchema.nullable(),
  hunkIds: z.array(z.string()).readonly(),
  range: FindingRangeSchema.nullable(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const VerdictSchema = z.object({
  reviewId: z.string(),
  roundId: z.string(),
  summary: z.string(),
  suggestion: VerdictSuggestionSchema,
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  chunkId: z.string().nullable(),
  filePath: z.string().nullable(),
  startLine: z.number().int().nullable(),
  endLine: z.number().int().nullable(),
  selectedText: z.string().nullable(),
  headSha: z.string(),
  question: z.string(),
  answer: z.string().nullable(),
  model: z.string(),
  createdAt: IsoDateSchema,
});
export type Question = z.infer<typeof QuestionSchema>;

export const ClaudeRunSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  kind: ClaudeRunKindSchema,
  model: z.string(),
  status: ClaudeRunStatusSchema,
  sessionId: z.string().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  error: z.string().nullable(),
  startedAt: IsoDateSchema,
  finishedAt: IsoDateSchema.nullable(),
});
export type ClaudeRun = z.infer<typeof ClaudeRunSchema>;

export const ModelSettingsSchema = z.object({
  chunking: z.string().min(1),
  review: z.string().min(1),
  qa: z.string().min(1),
  qaOpus: z.string().min(1),
});
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

export const SettingsSchema = z.object({
  models: ModelSettingsSchema,
  inlineFindings: z.boolean(),
  theme: ThemeSchema,
  verbosity: VerbositySchema,
  diffLayout: DiffLayoutSchema,
  hideWhitespace: z.boolean(),
  claudePath: z.string().trim().min(1).nullable(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const ClaudeExecutableSourceSchema = z.enum(["settings", "env", "path"]);
export type ClaudeExecutableSource = z.infer<typeof ClaudeExecutableSourceSchema>;

export const ClaudeExecutableStatusSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), path: z.string(), source: ClaudeExecutableSourceSchema, version: z.string() }),
  z.object({ ok: z.literal(false), source: ClaudeExecutableSourceSchema, error: z.string() }),
]);
export type ClaudeExecutableStatus = z.infer<typeof ClaudeExecutableStatusSchema>;

export const MODEL_IDS = {
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  haiku: "claude-haiku-4-5-20251001",
} as const;

export const DEFAULT_SETTINGS: Settings = {
  models: {
    chunking: MODEL_IDS.sonnet,
    review: MODEL_IDS.opus,
    qa: MODEL_IDS.sonnet,
    qaOpus: MODEL_IDS.opus,
  },
  inlineFindings: false,
  theme: "dark",
  verbosity: "standard",
  diffLayout: "unified",
  hideWhitespace: false,
  claudePath: null,
};

export const PIPELINE_STEPS = [
  "fetch_pr",
  "clone",
  "worktree",
  "diff",
  "parse",
  "save",
  "chunking",
  "review",
  "refresh",
] as const;
export const PipelineStepSchema = z.enum(PIPELINE_STEPS);
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

export const STEP_STATES = ["started", "done", "failed", "skipped"] as const;
export const StepStateSchema = z.enum(STEP_STATES);
export type StepState = z.infer<typeof StepStateSchema>;

export const RUN_EVENT_STATES = ["started", "progress", "retrying", "done", "failed"] as const;
export const RunEventStateSchema = z.enum(RUN_EVENT_STATES);
export type RunEventState = z.infer<typeof RunEventStateSchema>;

export const RefreshStatusSchema = z.object({
  reviewId: z.string(),
  reviewHeadSha: z.string(),
  remoteHeadSha: z.string().nullable(),
  hasNewCommits: z.boolean(),
  ghState: GhStateSchema,
  checkedAt: IsoDateSchema.nullable(),
  refreshing: z.boolean(),
});
export type RefreshStatus = z.infer<typeof RefreshStatusSchema>;

export const ProgressEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("step"),
    step: PipelineStepSchema,
    state: StepStateSchema,
    message: z.string().nullable(),
    at: IsoDateSchema,
  }),
  z.object({
    type: z.literal("run"),
    runId: z.string(),
    kind: ClaudeRunKindSchema,
    state: RunEventStateSchema,
    message: z.string().nullable(),
    at: IsoDateSchema,
  }),
  z.object({
    type: z.literal("review_updated"),
    at: IsoDateSchema,
  }),
  z.object({
    type: z.literal("refresh_status"),
    status: RefreshStatusSchema,
    at: IsoDateSchema,
  }),
]);
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
