import type { ReactElement } from "react";
import { useRefreshStatus, useReview } from "../../../api/queries";
import { useKeyBinding } from "../../../keys/hooks";
import styles from "./RefreshButton.module.css";
import { useRefreshAction } from "./useRefreshAction";

export interface RefreshButtonProps {
  readonly reviewId: string;
}

/** Shows the new-commits state and applies a refresh. web-review places it in the Review page header. */
export const RefreshButton = ({ reviewId }: RefreshButtonProps): ReactElement => {
  const status = useRefreshStatus(reviewId);
  const review = useReview(reviewId);
  const { refresh, busy } = useRefreshAction(reviewId);
  const isPast = review.data?.review.status === "past";
  const refreshing = busy || status.data?.refreshing === true;
  const hasNewCommits = status.data?.hasNewCommits === true;

  useKeyBinding(
    {
      id: "shell-refresh",
      key: "r",
      scope: "global",
      description: "refresh",
      handler: () => {
        if (!refreshing) void refresh();
      },
    },
    !isPast,
  );

  const label = refreshing ? "refreshing…" : hasNewCommits ? "new commits · refresh" : "refresh";
  const title = isPast
    ? "Past reviews are read-only"
    : status.error
      ? `Could not read refresh status: ${status.error.message}`
      : hasNewCommits
        ? "The PR has commits you have not reviewed. Press r to pull them in."
        : "Check the PR for new commits (r)";

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={hasNewCommits ? styles.attention : undefined}
        onClick={() => void refresh()}
        disabled={isPast || refreshing}
        title={title}
        aria-keyshortcuts="r"
      >
        {hasNewCommits ? <span aria-hidden="true">● </span> : null}
        {label}
      </button>
      {status.error ? (
        <span className={styles.error} role="status">
          status unavailable
        </span>
      ) : null}
    </span>
  );
};
