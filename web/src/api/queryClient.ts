import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "./client";

/** Shared TanStack Query client. 4xx errors are not retried. */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          !(error instanceof ApiClientError && error.status >= 400 && error.status < 500) && failureCount < 2,
      },
    },
  });
