import { useCallback } from "react";
import type { ApplyRefreshResponse } from "@shared/api";
import { useApplyRefresh, useCheckRefresh } from "../../../api/queries";
import { flashStatus } from "../../../bus/context";

export interface RefreshAction {
  readonly refresh: () => Promise<void>;
  readonly busy: boolean;
}

const describeApplied = (result: ApplyRefreshResponse): string => {
  const parts = [
    result.addedHunks > 0 ? `${result.addedHunks} new hunk${result.addedHunks === 1 ? "" : "s"}` : null,
    result.matchedHunks > 0 ? `${result.matchedHunks} kept` : null,
    result.missingHunks > 0 ? `${result.missingHunks} no longer in PR` : null,
  ].filter((part): part is string => part !== null);
  const round = result.roundNumber !== null && result.addedHunks > 0 ? `Round ${result.roundNumber}: ` : "";
  return `Refreshed. ${round}${parts.length > 0 ? parts.join(", ") : "no hunk changes"}`;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Checks the PR for new commits and applies them when there are any, reporting the outcome in the status bar. */
export const useRefreshAction = (reviewId: string): RefreshAction => {
  const { mutateAsync: checkAsync, isPending: checking } = useCheckRefresh(reviewId);
  const { mutateAsync: applyAsync, isPending: applying } = useApplyRefresh(reviewId);
  const busy = checking || applying;

  const refresh = useCallback(async (): Promise<void> => {
    try {
      flashStatus("Checking for new commits…");
      const status = await checkAsync();
      if (status.refreshing) {
        flashStatus("A refresh is already running");
        return;
      }
      if (!status.hasNewCommits) {
        flashStatus(status.ghState === "open" ? "No new commits" : `No new commits (PR is ${status.ghState})`);
        return;
      }
      flashStatus("Applying new commits…");
      flashStatus(describeApplied(await applyAsync()), 5000);
    } catch (error) {
      flashStatus(`Refresh failed: ${errorMessage(error)}`, 6000);
    }
  }, [checkAsync, applyAsync]);

  return { refresh, busy };
};
