import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  CHANGE_TYPES,
  CHUNK_KINDS,
  CHUNK_STATUSES,
  CLAUDE_RUN_KINDS,
  CLAUDE_RUN_STATUSES,
  DIFF_SIDES,
  FINDING_LIFECYCLES,
  GH_STATES,
  PIPELINE_STATUSES,
  REVIEW_STATUSES,
  SEVERITIES,
  USER_VERDICTS,
  VERDICT_SUGGESTIONS,
} from "../../shared/domain";

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    host: text("host").notNull(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    prNumber: integer("pr_number").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    url: text("url").notNull(),
    baseSha: text("base_sha").notNull(),
    headSha: text("head_sha").notNull(),
    ghState: text("gh_state", { enum: GH_STATES }).notNull(),
    status: text("status", { enum: REVIEW_STATUSES }).notNull(),
    pipelineStatus: text("pipeline_status", { enum: PIPELINE_STATUSES }).notNull(),
    pipelineError: text("pipeline_error"),
    worktreePath: text("worktree_path"),
    qaSessionId: text("qa_session_id"),
    remoteHeadSha: text("remote_head_sha"),
    remoteCheckedAt: text("remote_checked_at"),
    createdAt: text("created_at").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [uniqueIndex("reviews_pr_unique").on(t.host, t.owner, t.repo, t.prNumber)],
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    headSha: text("head_sha").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("rounds_review_number_unique").on(t.reviewId, t.number)],
);

export const hunks = sqliteTable(
  "hunks",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    filePath: text("file_path").notNull(),
    oldFilePath: text("old_file_path"),
    changeType: text("change_type", { enum: CHANGE_TYPES }).notNull(),
    oldStart: integer("old_start").notNull(),
    oldLines: integer("old_lines").notNull(),
    newStart: integer("new_start").notNull(),
    newLines: integer("new_lines").notNull(),
    patchText: text("patch_text").notNull(),
    position: integer("position").notNull(),
    present: integer("present", { mode: "boolean" }).notNull(),
  },
  (t) => [index("hunks_review_idx").on(t.reviewId), index("hunks_fingerprint_idx").on(t.reviewId, t.fingerprint)],
);

export const chunks = sqliteTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    kind: text("kind", { enum: CHUNK_KINDS }).notNull(),
  },
  (t) => [index("chunks_review_idx").on(t.reviewId)],
);

export const chunkHunks = sqliteTable(
  "chunk_hunks",
  {
    chunkId: text("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    hunkId: text("hunk_id")
      .notNull()
      .references(() => hunks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chunkId, t.hunkId] }), index("chunk_hunks_hunk_idx").on(t.hunkId)],
);

export const chunkProgress = sqliteTable("chunk_progress", {
  chunkId: text("chunk_id")
    .primaryKey()
    .references(() => chunks.id, { onDelete: "cascade" }),
  status: text("status", { enum: CHUNK_STATUSES }).notNull(),
  note: text("note").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const findings = sqliteTable(
  "findings",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    suggestedFix: text("suggested_fix"),
    lifecycle: text("lifecycle", { enum: FINDING_LIFECYCLES }).notNull(),
    userVerdict: text("user_verdict", { enum: USER_VERDICTS }),
    rangeSide: text("range_side", { enum: DIFF_SIDES }),
    rangeStartLine: integer("range_start_line"),
    rangeEndLine: integer("range_end_line"),
  },
  (t) => [index("findings_review_idx").on(t.reviewId)],
);

export const findingHunks = sqliteTable(
  "finding_hunks",
  {
    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    hunkId: text("hunk_id")
      .notNull()
      .references(() => hunks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.findingId, t.hunkId] })],
);

export const verdicts = sqliteTable(
  "verdicts",
  {
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    suggestion: text("suggestion", { enum: VERDICT_SUGGESTIONS }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.roundId] })],
);

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    chunkId: text("chunk_id").references(() => chunks.id, { onDelete: "set null" }),
    filePath: text("file_path"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    selectedText: text("selected_text"),
    headSha: text("head_sha").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("questions_review_idx").on(t.reviewId)],
);

export const claudeRuns = sqliteTable(
  "claude_runs",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: CLAUDE_RUN_KINDS }).notNull(),
    model: text("model").notNull(),
    status: text("status", { enum: CLAUDE_RUN_STATUSES }).notNull(),
    sessionId: text("session_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("claude_runs_review_idx").on(t.reviewId)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
