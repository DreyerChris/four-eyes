import { useId, useState, type FormEvent, type ReactElement } from "react";
import type { SummaryResponse } from "@shared/api";
import { GITHUB_REVIEW_EVENTS, type GitHubReviewEvent } from "@shared/domain";
import { useSubmitGitHubReview } from "../../api/queries";
import { flashStatus } from "../../bus/context";
import { Panel } from "../../ui/Panel";
import { formatRelative } from "../shell/list/format";
import { GITHUB_REVIEW_EVENT_LABELS, GITHUB_REVIEW_SUBMIT_LABELS, hasCommitsSinceMyReview, MY_REVIEW_SENTENCES } from "./labels";
import { buildFullReviewMarkdown } from "./markdown";
import styles from "./review.module.css";

const PANEL_TITLE = "submit to GitHub";

const appendBlock = (current: string, block: string): string => (current.trim() === "" ? block : `${current.trimEnd()}\n\n${block}`);

/** Approve, comment on or request changes on the PR in GitHub, with an optional comment when approving. */
export const SubmitReviewPanel = ({ summary }: { readonly summary: SummaryResponse }): ReactElement => {
  const { review } = summary;
  const baseId = useId();
  const submit = useSubmitGitHubReview(review.id);
  const [event, setEvent] = useState<GitHubReviewEvent | null>(null);
  const [body, setBody] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);
  const prLabel = `${review.owner}/${review.repo}#${review.prNumber}`;

  if (review.status === "past") {
    return (
      <Panel title={PANEL_TITLE}>
        <p className={styles.muted}>This review is in Past, so it cannot be submitted to GitHub.</p>
      </Panel>
    );
  }
  if (review.ghState !== "open") {
    return (
      <Panel title={PANEL_TITLE}>
        <p className={styles.muted}>
          {prLabel} is {review.ghState}, so it cannot take a new review.
        </p>
      </Panel>
    );
  }

  const commentMissing = event !== null && event !== "approve" && body.trim() === "";
  const canSubmit = event !== null && !commentMissing && !submit.isPending;

  const onSubmit = (formEvent: FormEvent<HTMLFormElement>): void => {
    formEvent.preventDefault();
    if (event === null || !canSubmit) return;
    setSubmittedUrl(null);
    submit.mutate(
      { event, body },
      {
        onSuccess: (result) => {
          setSubmittedUrl(result.url);
          setEvent(null);
          setBody("");
          flashStatus(`Review submitted to GitHub: ${GITHUB_REVIEW_EVENT_LABELS[event].toLowerCase()}`);
        },
      },
    );
  };

  return (
    <Panel title={PANEL_TITLE}>
      <form className={styles.submitReview} onSubmit={onSubmit} noValidate>
        <p id={`${baseId}-hint`} className={styles.muted}>
          Posts to {prLabel} as your gh login, on commit <code>{review.headSha.slice(0, 7)}</code>, the commit you reviewed. A comment is
          optional when you approve and required otherwise. Markdown works.
        </p>
        {review.myReviewState !== null && review.myReviewSubmittedAt !== null ? (
          <p>
            {MY_REVIEW_SENTENCES[review.myReviewState]} {formatRelative(review.myReviewSubmittedAt, Date.now())}
            {hasCommitsSinceMyReview(review) ? ", and it has new commits since" : ""}.
          </p>
        ) : null}
        {review.hasNewCommits ? (
          <p className={styles.warning}>The PR has newer commits than this review. Your review will be attached to the older commit.</p>
        ) : null}
        <fieldset className={styles.reviewEvents}>
          <legend>Review type</legend>
          {GITHUB_REVIEW_EVENTS.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={`${baseId}-event`}
                value={option}
                checked={event === option}
                onChange={() => setEvent(option)}
              />
              {GITHUB_REVIEW_EVENT_LABELS[option]}
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${baseId}-body`}>Your comment</label>
        <textarea
          id={`${baseId}-body`}
          value={body}
          rows={6}
          aria-describedby={`${baseId}-hint`}
          aria-invalid={commentMissing}
          onChange={(changeEvent) => setBody(changeEvent.target.value)}
        />
        {commentMissing ? (
          <p role="alert" className={styles.error}>
            Write a comment first. GitHub requires one unless you approve.
          </p>
        ) : null}
        {submit.error ? (
          <p role="alert" className={styles.error}>
            Could not submit the review: {submit.error.message}
          </p>
        ) : null}
        <div className={styles.buttons}>
          <button type="submit" disabled={!canSubmit}>
            {submit.isPending ? "Submitting…" : event === null ? "Submit to GitHub" : GITHUB_REVIEW_SUBMIT_LABELS[event]}
          </button>
          <button type="button" onClick={() => setBody((current) => appendBlock(current, buildFullReviewMarkdown(summary)))}>
            Add full review to comment
          </button>
        </div>
        {submittedUrl !== null ? (
          <p role="status">
            Review submitted.{" "}
            <a href={submittedUrl} target="_blank" rel="noreferrer">
              View it on GitHub
            </a>
          </p>
        ) : null}
      </form>
    </Panel>
  );
};
