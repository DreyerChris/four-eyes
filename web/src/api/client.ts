import type { z } from "zod";
import {
  buildPath,
  routes,
  type ApplyRefreshResponse,
  type AskQuestionRequest,
  type ContextLinesQuery,
  type ContextLinesResponse,
  type CreateReviewRequest,
  type CreateReviewResponse,
  type DefinitionSearchQuery,
  type DefinitionSearchResponse,
  type FileContentsQuery,
  type FileContentsResponse,
  type FinishReviewResponse,
  type JsonRoute,
  type ListQuestionsQuery,
  type ListQuestionsResponse,
  type ListReviewsQuery,
  type ListReviewsResponse,
  type OkResponse,
  type QaStreamEvent,
  type ReviewDetailResponse,
  type SeedFixtureResponse,
  type SetFindingVerdictRequest,
  type SubmitGitHubReviewRequest,
  type SubmitGitHubReviewResponse,
  type SummaryResponse,
  type UpdateChunkProgressRequest,
  type UpdateSettingsRequest,
} from "@shared/api";
import type { ChunkProgress, ClaudeExecutableStatus, Finding, ProgressEvent, RefreshStatus, Settings } from "@shared/domain";
import { postSse, subscribeSse } from "./sse";

export class ApiClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

type QueryValue = string | number | boolean | undefined;

const toQueryString = (query: Readonly<Record<string, QueryValue>> | undefined): string => {
  const entries = Object.entries(query ?? {}).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined);
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
};

const readError = async (response: Response): Promise<string> => {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    return text || response.statusText;
  }
  return text || response.statusText;
};

interface CallOptions {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/** Calls a JSON route from shared/api.ts and validates the response against its schema. */
export const callJson = async <S extends z.ZodType>(
  route: JsonRoute<string, z.ZodType | null, z.ZodType | null, S>,
  options: CallOptions = {},
): Promise<z.infer<S>> => {
  const url = `${buildPath(route.path, options.params ?? {})}${toQueryString(options.query)}`;
  const response = await fetch(url, {
    method: route.method,
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  if (!response.ok) throw new ApiClientError(response.status, await readError(response));
  const json: unknown = await response.json();
  const parsed = route.response.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError(response.status, `Unexpected response from ${route.method} ${route.path}: ${parsed.error.message}`);
  }
  return parsed.data;
};

/** One typed function per route in shared/api.ts. */
export const api = {
  listReviews: (query: ListReviewsQuery = {}): Promise<ListReviewsResponse> => callJson(routes.listReviews, { query }),
  createReview: (body: CreateReviewRequest): Promise<CreateReviewResponse> => callJson(routes.createReview, { body }),
  getReview: (reviewId: string): Promise<ReviewDetailResponse> => callJson(routes.getReview, { params: { reviewId } }),
  deleteReview: (reviewId: string): Promise<OkResponse> => callJson(routes.deleteReview, { params: { reviewId } }),
  finishReview: (reviewId: string): Promise<FinishReviewResponse> => callJson(routes.finishReview, { params: { reviewId } }),
  rerunReview: (reviewId: string): Promise<OkResponse> => callJson(routes.rerunReview, { params: { reviewId } }),
  submitGitHubReview: (reviewId: string, body: SubmitGitHubReviewRequest): Promise<SubmitGitHubReviewResponse> =>
    callJson(routes.submitGitHubReview, { params: { reviewId }, body }),
  updateChunkProgress: (reviewId: string, chunkId: string, body: UpdateChunkProgressRequest): Promise<ChunkProgress> =>
    callJson(routes.updateChunkProgress, { params: { reviewId, chunkId }, body }),
  getSummary: (reviewId: string): Promise<SummaryResponse> => callJson(routes.getSummary, { params: { reviewId } }),
  setFindingVerdict: (reviewId: string, findingId: string, body: SetFindingVerdictRequest): Promise<Finding> =>
    callJson(routes.setFindingVerdict, { params: { reviewId, findingId }, body }),
  listQuestions: (reviewId: string, query: ListQuestionsQuery = {}): Promise<ListQuestionsResponse> =>
    callJson(routes.listQuestions, { params: { reviewId }, query }),
  askQuestion: (
    reviewId: string,
    body: AskQuestionRequest,
    onEvent: (event: QaStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> =>
    postSse(buildPath(routes.askQuestion.path, { reviewId }), body, routes.askQuestion.event, onEvent, signal),
  getFileContents: (reviewId: string, query: FileContentsQuery): Promise<FileContentsResponse> =>
    callJson(routes.getFileContents, { params: { reviewId }, query }),
  getContextLines: (reviewId: string, query: ContextLinesQuery): Promise<ContextLinesResponse> =>
    callJson(routes.getContextLines, { params: { reviewId }, query }),
  searchDefinitions: (reviewId: string, query: DefinitionSearchQuery): Promise<DefinitionSearchResponse> =>
    callJson(routes.searchDefinitions, { params: { reviewId }, query }),
  getRefreshStatus: (reviewId: string): Promise<RefreshStatus> => callJson(routes.getRefreshStatus, { params: { reviewId } }),
  checkRefresh: (reviewId: string): Promise<RefreshStatus> => callJson(routes.checkRefresh, { params: { reviewId } }),
  applyRefresh: (reviewId: string): Promise<ApplyRefreshResponse> => callJson(routes.applyRefresh, { params: { reviewId } }),
  getSettings: (): Promise<Settings> => callJson(routes.getSettings),
  updateSettings: (body: UpdateSettingsRequest): Promise<Settings> => callJson(routes.updateSettings, { body }),
  getClaudeExecutable: (): Promise<ClaudeExecutableStatus> => callJson(routes.getClaudeExecutable),
  subscribeProgress: (reviewId: string, onEvent: (event: ProgressEvent) => void, onError?: (message: string) => void): (() => void) =>
    subscribeSse(buildPath(routes.progressEvents.path, { reviewId }), routes.progressEvents.event, onEvent, onError),
  seedFixture: (): Promise<SeedFixtureResponse> => callJson(routes.seedFixture),
} as const;
