import type { ReactElement } from "react";
import type { ClaudeRunStatus } from "@shared/domain";
import { useRerunReview } from "../../api/queries";
import { flashStatus } from "../../bus/context";

const LABELS: Readonly<Record<ClaudeRunStatus | "none", string>> = {
  running: "Restart review",
  failed: "Retry review",
  succeeded: "Run review again",
  none: "Run review",
};

export interface RerunReviewButtonProps {
  readonly reviewId: string;
  readonly status: ClaudeRunStatus | null;
}

/** Starts a fresh Claude review of the latest round, stopping one that is still running. */
export const RerunReviewButton = ({ reviewId, status }: RerunReviewButtonProps): ReactElement => {
  const rerun = useRerunReview(reviewId);
  const onClick = (): void =>
    rerun.mutate(undefined, {
      onSuccess: () => flashStatus(status === "running" ? "Stopped the running review and started a new one" : "Started a new Claude review"),
      onError: (error) => flashStatus(`Could not start the review: ${error.message}`),
    });
  return (
    <button type="button" onClick={onClick} disabled={rerun.isPending}>
      {rerun.isPending ? "Starting…" : LABELS[status ?? "none"]}
    </button>
  );
};
