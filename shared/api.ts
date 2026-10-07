import { z } from "zod";
import {
  ChunkProgressSchema,
  ChunkSchema,
  ChunkStatusSchema,
  ClaudeRunSchema,
  ClaudeRunStatusSchema,
  FindingSchema,
  GitHubReviewEventSchema,
  HunkSchema,
  ModelSettingsSchema,
  ProgressEventSchema,
  QuestionSchema,
  RefreshStatusSchema,
  ReviewSchema,
  ReviewStatusSchema,
  RoundSchema,
  SettingsSchema,
  ClaudeExecutableStatusSchema,
  UserVerdictSchema,
  VerdictSchema,
} from "./domain";

export const ReviewProgressSchema = z.object({
  totalChunks: z.number().int().nonnegative(),
  good: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative(),
  question: z.number().int().nonnegative(),
  unseen: z.number().int().nonnegative(),
});
export type ReviewProgress = z.infer<typeof ReviewProgressSchema>;

export const ReviewListItemSchema = ReviewSchema.extend({
  progress: ReviewProgressSchema,
  hasNewCommits: z.boolean(),
  reviewRunStatus: ClaudeRunStatusSchema.nullable(),
});
export type ReviewListItem = z.infer<typeof ReviewListItemSchema>;

export const ListReviewsQuerySchema = z.object({
  status: ReviewStatusSchema.optional(),
});
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;

export const ListReviewsResponseSchema = z.object({
  reviews: z.array(ReviewListItemSchema),
});
export type ListReviewsResponse = z.infer<typeof ListReviewsResponseSchema>;

export const CreateReviewRequestSchema = z.object({
  url: z.string().trim().min(1),
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

export const CreateReviewResponseSchema = z.object({
  review: ReviewListItemSchema,
  reopened: z.boolean(),
});
export type CreateReviewResponse = z.infer<typeof CreateReviewResponseSchema>;

export const ChunkViewSchema = ChunkSchema.extend({
  roundNumber: z.number().int().positive(),
  hunks: z.array(HunkSchema),
  progress: ChunkProgressSchema,
  findingIds: z.array(z.string()),
  questionCount: z.number().int().nonnegative(),
});
export type ChunkView = z.infer<typeof ChunkViewSchema>;

export const ReviewDetailResponseSchema = z.object({
  review: ReviewListItemSchema,
  rounds: z.array(RoundSchema),
  chunks: z.array(ChunkViewSchema),
  findings: z.array(FindingSchema),
  runs: z.array(ClaudeRunSchema),
});
export type ReviewDetailResponse = z.infer<typeof ReviewDetailResponseSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

export const FinishReviewResponseSchema = z.object({
  review: ReviewListItemSchema,
});
export type FinishReviewResponse = z.infer<typeof FinishReviewResponseSchema>;

export const SubmitGitHubReviewRequestSchema = z
  .object({
    event: GitHubReviewEventSchema,
    body: z.string(),
  })
  .refine((request) => request.event === "approve" || request.body.trim() !== "", {
    message: "GitHub needs a comment unless you approve",
    path: ["body"],
  });
export type SubmitGitHubReviewRequest = z.infer<typeof SubmitGitHubReviewRequestSchema>;

export const SubmitGitHubReviewResponseSchema = z.object({
  url: z.string(),
});
export type SubmitGitHubReviewResponse = z.infer<typeof SubmitGitHubReviewResponseSchema>;

export const UpdateChunkProgressRequestSchema = z.object({
  status: ChunkStatusSchema,
  note: z.string(),
});
export type UpdateChunkProgressRequest = z.infer<typeof UpdateChunkProgressRequestSchema>;

export const FindingViewSchema = FindingSchema.extend({
  chunkIds: z.array(z.string()),
});
export type FindingView = z.infer<typeof FindingViewSchema>;

export const SummaryChunkSchema = ChunkSchema.extend({
  roundNumber: z.number().int().positive(),
  progress: ChunkProgressSchema,
  hunkCount: z.number().int().nonnegative(),
  presentHunkCount: z.number().int().nonnegative(),
});
export type SummaryChunk = z.infer<typeof SummaryChunkSchema>;

export const CoverageSchema = z.object({
  totalChunks: z.number().int().nonnegative(),
  reviewedChunks: z.number().int().nonnegative(),
  unseenChunks: z.number().int().nonnegative(),
  totalHunks: z.number().int().nonnegative(),
  presentHunks: z.number().int().nonnegative(),
  missingHunks: z.number().int().nonnegative(),
  reviewedHunks: z.number().int().nonnegative(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const SummaryResponseSchema = z.object({
  review: ReviewListItemSchema,
  verdict: VerdictSchema.nullable(),
  findings: z.array(FindingViewSchema),
  chunks: z.array(SummaryChunkSchema),
  questions: z.array(QuestionSchema),
  coverage: CoverageSchema,
  reviewRun: ClaudeRunSchema.nullable(),
});
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export const SetFindingVerdictRequestSchema = z.object({
  verdict: UserVerdictSchema.nullable(),
});
export type SetFindingVerdictRequest = z.infer<typeof SetFindingVerdictRequestSchema>;

export const ListQuestionsQuerySchema = z.object({
  chunkId: z.string().optional(),
});
export type ListQuestionsQuery = z.infer<typeof ListQuestionsQuerySchema>;

export const ListQuestionsResponseSchema = z.object({
  questions: z.array(QuestionSchema),
});
export type ListQuestionsResponse = z.infer<typeof ListQuestionsResponseSchema>;

export const AskQuestionRequestSchema = z.object({
  chunkId: z.string().nullable(),
  filePath: z.string().nullable(),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  selectedText: z.string().nullable(),
  question: z.string().trim().min(1),
  useOpus: z.boolean(),
});
export type AskQuestionRequest = z.infer<typeof AskQuestionRequestSchema>;

export const QaStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("question"), question: QuestionSchema }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done"), question: QuestionSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type QaStreamEvent = z.infer<typeof QaStreamEventSchema>;

export const FileContentsQuerySchema = z.object({
  path: z.string().min(1),
  sha: z.string().min(1).optional(),
});
export type FileContentsQuery = z.infer<typeof FileContentsQuerySchema>;

export const FileContentsResponseSchema = z.object({
  path: z.string(),
  sha: z.string(),
  content: z.string().nullable(),
});
export type FileContentsResponse = z.infer<typeof FileContentsResponseSchema>;

export const ContextLinesQuerySchema = z.object({
  path: z.string().min(1),
  sha: z.string().min(1),
  start: z.coerce.number().int().positive(),
  end: z.coerce.number().int().positive(),
});
export type ContextLinesQuery = z.infer<typeof ContextLinesQuerySchema>;

export const SourceLineSchema = z.object({
  number: z.number().int().positive(),
  text: z.string(),
});
export type SourceLine = z.infer<typeof SourceLineSchema>;

export const ContextLinesResponseSchema = z.object({
  path: z.string(),
  sha: z.string(),
  lines: z.array(SourceLineSchema),
  totalLines: z.number().int().nonnegative(),
});
export type ContextLinesResponse = z.infer<typeof ContextLinesResponseSchema>;

export const DefinitionSearchQuerySchema = z.object({
  symbol: z.string().min(1),
  fromPath: z.string().optional(),
});
export type DefinitionSearchQuery = z.infer<typeof DefinitionSearchQuerySchema>;

export const DefinitionMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  preview: z.string(),
});
export type DefinitionMatch = z.infer<typeof DefinitionMatchSchema>;

export const DefinitionSearchResponseSchema = z.object({
  symbol: z.string(),
  matches: z.array(DefinitionMatchSchema),
});
export type DefinitionSearchResponse = z.infer<typeof DefinitionSearchResponseSchema>;

export const ApplyRefreshResponseSchema = z.object({
  status: RefreshStatusSchema,
  roundId: z.string().nullable(),
  roundNumber: z.number().int().positive().nullable(),
  matchedHunks: z.number().int().nonnegative(),
  addedHunks: z.number().int().nonnegative(),
  missingHunks: z.number().int().nonnegative(),
});
export type ApplyRefreshResponse = z.infer<typeof ApplyRefreshResponseSchema>;

export const UpdateSettingsRequestSchema = SettingsSchema.omit({ models: true })
  .partial()
  .extend({ models: ModelSettingsSchema.partial().optional() });
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

export const SeedFixtureResponseSchema = z.object({
  reviewId: z.string(),
});
export type SeedFixtureResponse = z.infer<typeof SeedFixtureResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface JsonRoute<
  P extends string = string,
  Q extends z.ZodType | null = z.ZodType | null,
  B extends z.ZodType | null = z.ZodType | null,
  R extends z.ZodType = z.ZodType,
> {
  readonly kind: "json";
  readonly method: HttpMethod;
  readonly path: P;
  readonly query: Q;
  readonly body: B;
  readonly response: R;
}

export interface SseRoute<
  P extends string = string,
  Q extends z.ZodType | null = z.ZodType | null,
  B extends z.ZodType | null = z.ZodType | null,
  E extends z.ZodType = z.ZodType,
> {
  readonly kind: "sse";
  readonly method: HttpMethod;
  readonly path: P;
  readonly query: Q;
  readonly body: B;
  readonly event: E;
}

const json = <
  const P extends string,
  Q extends z.ZodType | null,
  B extends z.ZodType | null,
  R extends z.ZodType,
>(
  route: Omit<JsonRoute<P, Q, B, R>, "kind">,
): JsonRoute<P, Q, B, R> => ({ kind: "json", ...route });

const sse = <
  const P extends string,
  Q extends z.ZodType | null,
  B extends z.ZodType | null,
  E extends z.ZodType,
>(
  route: Omit<SseRoute<P, Q, B, E>, "kind">,
): SseRoute<P, Q, B, E> => ({ kind: "sse", ...route });

/** Every HTTP route the server exposes. Server registration and the web client both read from here. */
export const routes = {
  listReviews: json({
    method: "GET",
    path: "/api/reviews",
    query: ListReviewsQuerySchema,
    body: null,
    response: ListReviewsResponseSchema,
  }),
  createReview: json({
    method: "POST",
    path: "/api/reviews",
    query: null,
    body: CreateReviewRequestSchema,
    response: CreateReviewResponseSchema,
  }),
  getReview: json({
    method: "GET",
    path: "/api/reviews/:reviewId",
    query: null,
    body: null,
    response: ReviewDetailResponseSchema,
  }),
  deleteReview: json({
    method: "DELETE",
    path: "/api/reviews/:reviewId",
    query: null,
    body: null,
    response: OkResponseSchema,
  }),
  finishReview: json({
    method: "POST",
    path: "/api/reviews/:reviewId/finish",
    query: null,
    body: null,
    response: FinishReviewResponseSchema,
  }),
  rerunReview: json({
    method: "POST",
    path: "/api/reviews/:reviewId/review-run",
    query: null,
    body: null,
    response: OkResponseSchema,
  }),
  submitGitHubReview: json({
    method: "POST",
    path: "/api/reviews/:reviewId/github-review",
    query: null,
    body: SubmitGitHubReviewRequestSchema,
    response: SubmitGitHubReviewResponseSchema,
  }),
  updateChunkProgress: json({
    method: "PUT",
    path: "/api/reviews/:reviewId/chunks/:chunkId/progress",
    query: null,
    body: UpdateChunkProgressRequestSchema,
    response: ChunkProgressSchema,
  }),
  getSummary: json({
    method: "GET",
    path: "/api/reviews/:reviewId/summary",
    query: null,
    body: null,
    response: SummaryResponseSchema,
  }),
  setFindingVerdict: json({
    method: "PUT",
    path: "/api/reviews/:reviewId/findings/:findingId/verdict",
    query: null,
    body: SetFindingVerdictRequestSchema,
    response: FindingSchema,
  }),
  listQuestions: json({
    method: "GET",
    path: "/api/reviews/:reviewId/questions",
    query: ListQuestionsQuerySchema,
    body: null,
    response: ListQuestionsResponseSchema,
  }),
  askQuestion: sse({
    method: "POST",
    path: "/api/reviews/:reviewId/questions",
    query: null,
    body: AskQuestionRequestSchema,
    event: QaStreamEventSchema,
  }),
  getFileContents: json({
    method: "GET",
    path: "/api/reviews/:reviewId/file",
    query: FileContentsQuerySchema,
    body: null,
    response: FileContentsResponseSchema,
  }),
  getContextLines: json({
    method: "GET",
    path: "/api/reviews/:reviewId/context",
    query: ContextLinesQuerySchema,
    body: null,
    response: ContextLinesResponseSchema,
  }),
  searchDefinitions: json({
    method: "GET",
    path: "/api/reviews/:reviewId/definitions",
    query: DefinitionSearchQuerySchema,
    body: null,
    response: DefinitionSearchResponseSchema,
  }),
  getRefreshStatus: json({
    method: "GET",
    path: "/api/reviews/:reviewId/refresh",
    query: null,
    body: null,
    response: RefreshStatusSchema,
  }),
  checkRefresh: json({
    method: "POST",
    path: "/api/reviews/:reviewId/refresh/check",
    query: null,
    body: null,
    response: RefreshStatusSchema,
  }),
  applyRefresh: json({
    method: "POST",
    path: "/api/reviews/:reviewId/refresh/apply",
    query: null,
    body: null,
    response: ApplyRefreshResponseSchema,
  }),
  getSettings: json({
    method: "GET",
    path: "/api/settings",
    query: null,
    body: null,
    response: SettingsSchema,
  }),
  updateSettings: json({
    method: "PATCH",
    path: "/api/settings",
    query: null,
    body: UpdateSettingsRequestSchema,
    response: SettingsSchema,
  }),
  getClaudeExecutable: json({
    method: "GET",
    path: "/api/settings/claude",
    query: null,
    body: null,
    response: ClaudeExecutableStatusSchema,
  }),
  progressEvents: sse({
    method: "GET",
    path: "/api/reviews/:reviewId/events",
    query: null,
    body: null,
    event: ProgressEventSchema,
  }),
  seedFixture: json({
    method: "POST",
    path: "/api/__test/seed",
    query: null,
    body: null,
    response: SeedFixtureResponseSchema,
  }),
} as const;

export type Routes = typeof routes;
export type RouteName = keyof Routes;

type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

export type PathParams<P extends string> = { readonly [K in ParamNames<P>]: string };

/** Fills `:param` placeholders in a route path, URI-encoding each value. */
export const buildPath = (path: string, params: Readonly<Record<string, string>>): string =>
  path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter "${name}" for ${path}`);
    }
    return encodeURIComponent(value);
  });
