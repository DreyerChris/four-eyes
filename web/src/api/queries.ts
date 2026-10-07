import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApplyRefreshResponse,
  AskQuestionRequest,
  ContextLinesQuery,
  ContextLinesResponse,
  CreateReviewResponse,
  DefinitionSearchResponse,
  FileContentsResponse,
  FinishReviewResponse,
  ListQuestionsResponse,
  ListReviewsResponse,
  OkResponse,
  QaStreamEvent,
  ReviewDetailResponse,
  SetFindingVerdictRequest,
  SubmitGitHubReviewRequest,
  SubmitGitHubReviewResponse,
  SuggestionsResponse,
  SummaryResponse,
  UpdateChunkProgressRequest,
  UpdateSettingsRequest,
} from "@shared/api";
import type { ChunkProgress, ClaudeExecutableStatus, Finding, ProgressEvent, Question, RefreshStatus, ReviewStatus, Settings } from "@shared/domain";
import { api } from "./client";

export const queryKeys = {
  reviews: (status?: ReviewStatus) => ["reviews", status ?? "all"] as const,
  suggestions: ["suggestions"] as const,
  allReviews: ["reviews"] as const,
  review: (reviewId: string) => ["review", reviewId] as const,
  summary: (reviewId: string) => ["summary", reviewId] as const,
  questions: (reviewId: string, chunkId?: string) => ["questions", reviewId, chunkId ?? "all"] as const,
  allQuestions: (reviewId: string) => ["questions", reviewId] as const,
  settings: ["settings"] as const,
  claudeExecutable: ["settings", "claude"] as const,
  refresh: (reviewId: string) => ["refresh", reviewId] as const,
  file: (reviewId: string, path: string, sha?: string) => ["file", reviewId, path, sha ?? "head"] as const,
  context: (reviewId: string, query: ContextLinesQuery) =>
    ["context", reviewId, query.path, query.sha, query.start, query.end] as const,
  definitions: (reviewId: string, symbol: string, fromPath?: string) => ["definitions", reviewId, symbol, fromPath ?? ""] as const,
};

/** Refetches every query that depends on a review's state. */
export const invalidateReview = async (client: QueryClient, reviewId: string): Promise<void> => {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.review(reviewId) }),
    client.invalidateQueries({ queryKey: queryKeys.summary(reviewId) }),
    client.invalidateQueries({ queryKey: queryKeys.refresh(reviewId) }),
    client.invalidateQueries({ queryKey: queryKeys.allQuestions(reviewId) }),
    client.invalidateQueries({ queryKey: queryKeys.allReviews }),
  ]);
};

export const useReviews = (status?: ReviewStatus): UseQueryResult<ListReviewsResponse> =>
  useQuery({ queryKey: queryKeys.reviews(status), queryFn: () => api.listReviews({ status }), refetchInterval: 30_000 });

export const useSuggestions = (): UseQueryResult<SuggestionsResponse> =>
  useQuery({ queryKey: queryKeys.suggestions, queryFn: () => api.listSuggestions(), refetchInterval: 60_000 });

export const useCheckSuggestions = (): UseMutationResult<SuggestionsResponse, Error, void> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.checkSuggestions(),
    onSuccess: (data) => client.setQueryData(queryKeys.suggestions, data),
  });
};

export type SuggestionAction = "dismiss" | "ignore";

export const useHideSuggestion = (): UseMutationResult<OkResponse, Error, { readonly id: string; readonly action: SuggestionAction }> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }) => (action === "dismiss" ? api.dismissSuggestion(id) : api.ignoreSuggestion(id)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.suggestions }),
  });
};

export const useReview = (reviewId: string): UseQueryResult<ReviewDetailResponse> =>
  useQuery({ queryKey: queryKeys.review(reviewId), queryFn: () => api.getReview(reviewId) });

export const useSummary = (reviewId: string): UseQueryResult<SummaryResponse> =>
  useQuery({ queryKey: queryKeys.summary(reviewId), queryFn: () => api.getSummary(reviewId) });

export const useQuestions = (reviewId: string, chunkId?: string): UseQueryResult<ListQuestionsResponse> =>
  useQuery({ queryKey: queryKeys.questions(reviewId, chunkId), queryFn: () => api.listQuestions(reviewId, { chunkId }) });

export const useSettings = (): UseQueryResult<Settings> =>
  useQuery({ queryKey: queryKeys.settings, queryFn: api.getSettings, staleTime: Infinity });

export const useClaudeExecutable = (): UseQueryResult<ClaudeExecutableStatus> =>
  useQuery({ queryKey: queryKeys.claudeExecutable, queryFn: api.getClaudeExecutable });

export const useRefreshStatus = (reviewId: string): UseQueryResult<RefreshStatus> =>
  useQuery({ queryKey: queryKeys.refresh(reviewId), queryFn: () => api.getRefreshStatus(reviewId), refetchInterval: 60_000 });

export const useFileContents = (
  reviewId: string,
  path: string | null,
  sha?: string,
): UseQueryResult<FileContentsResponse> =>
  useQuery({
    queryKey: queryKeys.file(reviewId, path ?? "", sha),
    queryFn: () => api.getFileContents(reviewId, { path: path ?? "", sha }),
    enabled: path !== null,
    staleTime: Infinity,
  });

export const useContextLines = (reviewId: string, query: ContextLinesQuery | null): UseQueryResult<ContextLinesResponse> =>
  useQuery({
    queryKey: query ? queryKeys.context(reviewId, query) : ["context", reviewId, "disabled"],
    queryFn: () => {
      if (!query) throw new Error("useContextLines called without a query");
      return api.getContextLines(reviewId, query);
    },
    enabled: query !== null,
    staleTime: Infinity,
  });

export const useDefinitions = (
  reviewId: string,
  symbol: string | null,
  fromPath?: string,
): UseQueryResult<DefinitionSearchResponse> =>
  useQuery({
    queryKey: queryKeys.definitions(reviewId, symbol ?? "", fromPath),
    queryFn: () => api.searchDefinitions(reviewId, { symbol: symbol ?? "", fromPath }),
    enabled: symbol !== null && symbol !== "",
    staleTime: Infinity,
  });

export const useCreateReview = (): UseMutationResult<CreateReviewResponse, Error, string> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.createReview({ url }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.allReviews }),
        client.invalidateQueries({ queryKey: queryKeys.suggestions }),
      ]);
    },
  });
};

export const useDeleteReview = (): UseMutationResult<OkResponse, Error, string> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => api.deleteReview(reviewId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.allReviews }),
  });
};

export const useFinishReview = (): UseMutationResult<FinishReviewResponse, Error, string> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => api.finishReview(reviewId),
    onSuccess: (_data, reviewId) => invalidateReview(client, reviewId),
  });
};

export const useRerunReview = (reviewId: string): UseMutationResult<OkResponse, Error, void> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.rerunReview(reviewId),
    onSuccess: () => invalidateReview(client, reviewId),
  });
};

export const useSubmitGitHubReview = (reviewId: string): UseMutationResult<SubmitGitHubReviewResponse, Error, SubmitGitHubReviewRequest> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SubmitGitHubReviewRequest) => api.submitGitHubReview(reviewId, request),
    onSuccess: () => invalidateReview(client, reviewId),
  });
};

export interface ChunkProgressVariables extends UpdateChunkProgressRequest {
  readonly chunkId: string;
}

export const useUpdateChunkProgress = (reviewId: string): UseMutationResult<ChunkProgress, Error, ChunkProgressVariables> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ chunkId, status, note }: ChunkProgressVariables) => api.updateChunkProgress(reviewId, chunkId, { status, note }),
    onSuccess: () => invalidateReview(client, reviewId),
  });
};

export interface FindingVerdictVariables extends SetFindingVerdictRequest {
  readonly findingId: string;
}

export const useSetFindingVerdict = (reviewId: string): UseMutationResult<Finding, Error, FindingVerdictVariables> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, verdict }: FindingVerdictVariables) => api.setFindingVerdict(reviewId, findingId, { verdict }),
    onSuccess: () => invalidateReview(client, reviewId),
  });
};

export const useUpdateSettings = (): UseMutationResult<Settings, Error, UpdateSettingsRequest> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateSettingsRequest) => api.updateSettings(patch),
    onSuccess: (settings) => {
      client.setQueryData(queryKeys.settings, settings);
      void client.invalidateQueries({ queryKey: queryKeys.claudeExecutable });
    },
  });
};

export const useCheckRefresh = (reviewId: string): UseMutationResult<RefreshStatus, Error, void> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.checkRefresh(reviewId),
    onSuccess: (status) => {
      client.setQueryData(queryKeys.refresh(reviewId), status);
      return client.invalidateQueries({ queryKey: queryKeys.allReviews });
    },
  });
};

export const useApplyRefresh = (reviewId: string): UseMutationResult<ApplyRefreshResponse, Error, void> => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.applyRefresh(reviewId),
    onSuccess: () => invalidateReview(client, reviewId),
  });
};

const INVALIDATING_STATES = new Set(["done", "failed"]);

/**
 * Streams a review's progress events (replaying recent ones) and keeps review queries fresh.
 * Returns every event received so far, oldest first.
 */
export const useProgressEvents = (reviewId: string | null): readonly ProgressEvent[] => {
  const client = useQueryClient();
  const [events, setEvents] = useState<readonly ProgressEvent[]>([]);
  useEffect(() => {
    if (reviewId === null) return undefined;
    setEvents([]);
    return api.subscribeProgress(
      reviewId,
      (event) => {
        setEvents((previous) => [...previous, event]);
        const invalidates =
          event.type === "review_updated" ||
          event.type === "refresh_status" ||
          ((event.type === "step" || event.type === "run") && INVALIDATING_STATES.has(event.state));
        if (invalidates) void invalidateReview(client, reviewId);
      },
      (message) => console.warn(`[progress] ${message}`),
    );
  }, [client, reviewId]);
  return events;
};

export interface AskQuestionState {
  readonly status: "idle" | "streaming" | "done" | "error";
  readonly question: Question | null;
  readonly answer: string;
  readonly error: string | null;
}

const IDLE_ASK: AskQuestionState = { status: "idle", question: null, answer: "", error: null };

export interface AskQuestionHandle {
  readonly state: AskQuestionState;
  readonly ask: (request: AskQuestionRequest) => Promise<void>;
  readonly cancel: () => void;
  readonly reset: () => void;
}

const applyQaEvent = (state: AskQuestionState, event: QaStreamEvent): AskQuestionState => {
  switch (event.type) {
    case "question":
      return { ...state, question: event.question };
    case "delta":
      return { ...state, answer: state.answer + event.text };
    case "done":
      return { status: "done", question: event.question, answer: event.question.answer ?? state.answer, error: null };
    case "error":
      return { ...state, status: "error", error: event.message };
  }
};

/** Streams one question's answer. Cancels any in-flight question when a new one starts or on unmount. */
export const useAskQuestion = (reviewId: string): AskQuestionHandle => {
  const client = useQueryClient();
  const [state, setState] = useState<AskQuestionState>(IDLE_ASK);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const ask = useCallback(
    async (request: AskQuestionRequest): Promise<void> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ ...IDLE_ASK, status: "streaming" });
      try {
        await api.askQuestion(reviewId, request, (event) => setState((previous) => applyQaEvent(previous, event)), controller.signal);
        setState((previous) => (previous.status === "streaming" ? { ...previous, status: "done" } : previous));
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((previous) => ({ ...previous, status: "error", error: error instanceof Error ? error.message : String(error) }));
      } finally {
        void invalidateReview(client, reviewId);
      }
    },
    [client, reviewId],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState((previous) => (previous.status === "streaming" ? { ...previous, status: "idle" } : previous));
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState(IDLE_ASK);
  }, []);

  return { state, ask, cancel, reset };
};
