import type { ReactElement } from "react";
import type { ReviewListItem } from "@shared/api";
import { useProgressEvents } from "../../../api/queries";
import { STEP_MARKERS, summarizeSteps } from "./format";
import styles from "./ListPage.module.css";

const STATE_CLASS = {
  pending: styles.stepPending,
  started: styles.stepStarted,
  done: styles.stepDone,
  failed: styles.stepFailed,
  skipped: styles.stepPending,
} as const;

/** Live checklist of a review's ingest and chunking steps, streamed from the progress events. */
export const IngestProgress = ({ review }: { readonly review: ReviewListItem }): ReactElement => {
  const steps = summarizeSteps(useProgressEvents(review.id));
  return (
    <ol className={styles.steps} aria-label={`Progress for ${review.title || review.url}`}>
      {steps.map((step) => (
        <li key={step.step} className={STATE_CLASS[step.state]}>
          <span aria-hidden="true">{STEP_MARKERS[step.state]} </span>
          {step.label}
          <span className="visually-hidden"> ({step.state})</span>
          {step.message && (step.state === "started" || step.state === "failed") ? <span className={styles.stepMessage}> · {step.message}</span> : null}
        </li>
      ))}
    </ol>
  );
};
