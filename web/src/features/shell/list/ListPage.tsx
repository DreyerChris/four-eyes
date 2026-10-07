import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import type { ReviewListItem } from "@shared/api";
import { useCreateReview, useDeleteReview, useReviews, useSuggestions } from "../../../api/queries";
import { navigate, paths, type ListTab } from "../../../app/router";
import { flashStatus } from "../../../bus/context";
import { useKeyBinding } from "../../../keys/hooks";
import { Panel } from "../../../ui/Panel";
import { formatRelative, progressBar } from "./format";
import { IngestProgress } from "./IngestProgress";
import { SuggestionsPanel } from "./SuggestionsPanel";
import styles from "./ListPage.module.css";

export interface ListPageProps {
  readonly tab: ListTab;
}

const TabLink = ({ to, current, children }: { readonly to: string; readonly current: boolean; readonly children: ReactNode }): ReactElement => {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} aria-current={current ? "page" : undefined} className={current ? styles.tabCurrent : styles.tab}>
      {children}
    </a>
  );
};

interface PasteBoxProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly tab: ListTab;
  readonly onLeave: (reviewId: string | null) => void;
}

const PasteBox = ({ inputRef, tab, onLeave }: PasteBoxProps): ReactElement => {
  const inputId = useId();
  const errorId = useId();
  const [url, setUrl] = useState("");
  const create = useCreateReview();

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = url.trim();
    if (trimmed === "") return;
    create.mutate(trimmed, {
      onSuccess: ({ review, reopened }) => {
        setUrl("");
        if (reopened) {
          flashStatus(`Reopened ${review.owner}/${review.repo}#${review.prNumber}`);
          navigate(paths.review(review.id));
          return;
        }
        flashStatus(`Added ${review.owner}/${review.repo}#${review.prNumber}`);
        if (tab !== "active") navigate(paths.list("active"));
        onLeave(review.id);
      },
    });
  };

  return (
    <form className={styles.paste} onSubmit={onSubmit}>
      <label htmlFor={inputId}>Pull request URL</label>
      <input
        id={inputId}
        ref={inputRef}
        className={styles.pasteInput}
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          if (create.error) create.reset();
        }}
        placeholder="https://github.com/owner/repo/pull/123"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={create.error ? true : undefined}
        aria-describedby={create.error ? errorId : undefined}
        aria-keyshortcuts="/"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onLeave(null);
        }}
      />
      <button type="submit" disabled={create.isPending || url.trim() === ""}>
        {create.isPending ? "adding…" : "add"}
      </button>
      {create.error ? (
        <p id={errorId} role="alert" className={styles.error}>
          Could not add the PR: {create.error.message}
        </p>
      ) : null}
    </form>
  );
};

const GH_STATE_CLASS = { open: styles.ghOpen, merged: styles.ghMerged, closed: styles.ghClosed } as const;

const isPipelineRunning = (review: ReviewListItem): boolean => review.pipelineStatus === "ingesting" || review.pipelineStatus === "chunking";

interface RowProps {
  readonly review: ReviewListItem;
  readonly index: number;
  readonly now: number;
  readonly confirming: boolean;
  readonly onSelect: (index: number) => void;
  readonly onAskDelete: (reviewId: string | null) => void;
  readonly onDeleted: () => void;
}

const ReviewRow = ({ review, index, now, confirming, onSelect, onAskDelete, onDeleted }: RowProps): ReactElement => {
  const remove = useDeleteReview();
  const reviewed = review.progress.totalChunks - review.progress.unseen;
  const name = review.title || `${review.owner}/${review.repo}#${review.prNumber}`;

  const confirmDelete = (): void => {
    remove.mutate(review.id, {
      onSuccess: () => {
        flashStatus(`Deleted ${name}`);
        onAskDelete(null);
        onDeleted();
      },
    });
  };

  return (
    <li className={styles.row} onFocus={() => onSelect(index)}>
      <div className={styles.rowMain}>
        <a
          href={paths.review(review.id)}
          className={styles.rowLink}
          data-row-index={index}
          data-review-id={review.id}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate(paths.review(review.id));
          }}
        >
          {name}
        </a>
        <div className={styles.meta}>
          <span>
            {review.owner}/{review.repo}#{review.prNumber}
          </span>
          {review.author ? <span>@{review.author}</span> : null}
          <span className={GH_STATE_CLASS[review.ghState]}>{review.ghState}</span>
          {review.pipelineStatus === "ready" ? (
            <span>
              <span aria-hidden="true">{progressBar(review.progress)} </span>
              {reviewed}/{review.progress.totalChunks} chunks reviewed
              {review.progress.flagged > 0 ? `, ${review.progress.flagged} flagged` : ""}
            </span>
          ) : null}
          {review.hasNewCommits ? <span className={styles.badge}>new commits</span> : null}
          {review.reviewRunStatus === "running" ? <span className={styles.muted}>Claude review running</span> : null}
          {review.reviewRunStatus === "failed" ? <span className={styles.error}>Claude review failed</span> : null}
          <span className={styles.muted}>
            active <time dateTime={review.lastActivityAt} title={review.lastActivityAt}>{formatRelative(review.lastActivityAt, now)}</time>
          </span>
        </div>
        {isPipelineRunning(review) ? <IngestProgress review={review} /> : null}
        {review.pipelineStatus === "failed" ? (
          <p className={styles.error}>Ingest failed: {review.pipelineError ?? "unknown error"}</p>
        ) : null}
      </div>
      <div className={styles.rowActions}>
        {confirming ? (
          <div role="group" aria-label={`Confirm deleting ${name}`} className={styles.confirm}>
            <span>Delete this review and its notes?</span>
            <button type="button" className={styles.danger} onClick={confirmDelete} disabled={remove.isPending} autoFocus>
              {remove.isPending ? "deleting…" : "yes, delete"}
            </button>
            <button type="button" onClick={() => onAskDelete(null)} disabled={remove.isPending}>
              cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => onAskDelete(review.id)} aria-label={`Delete ${name}`} aria-keyshortcuts="d">
            delete
          </button>
        )}
        {remove.error ? (
          <p role="alert" className={styles.error}>
            Could not delete: {remove.error.message}
          </p>
        ) : null}
      </div>
    </li>
  );
};

const TAB_HEADINGS: Readonly<Record<ListTab, string>> = {
  active: "Active reviews",
  past: "Past reviews",
  suggested: "Suggested pull requests",
};

const useNow = (intervalMs: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};

/** Active/Past/Suggested tabs, paste box, review rows, delete with confirm, ingest progress view, PR suggestions. */
export const ListPage = ({ tab }: ListPageProps): ReactElement => {
  const { data, error, isPending } = useReviews(tab === "past" ? "past" : "active");
  const suggestionCount = useSuggestions().data?.suggestions.length ?? 0;
  const reviews = data?.reviews ?? [];
  const listRef = useRef<HTMLUListElement>(null);
  const pasteRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(0);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const now = useNow(30_000);

  const focusRow = (index: number): void => {
    const clamped = Math.max(0, Math.min(reviews.length - 1, index));
    listRef.current?.querySelector<HTMLAnchorElement>(`[data-row-index="${clamped}"]`)?.focus();
    setSelected(clamped);
  };

  const [focusReviewId, setFocusReviewId] = useState<string | null>(null);

  useEffect(() => {
    if (focusReviewId === null) return;
    const link = listRef.current?.querySelector<HTMLAnchorElement>(`[data-review-id="${focusReviewId}"]`);
    if (!link) return;
    setFocusReviewId(null);
    link.focus();
  }, [focusReviewId, reviews]);

  const leavePasteBox = (reviewId: string | null): void => {
    if (reviewId !== null) {
      pasteRef.current?.blur();
      setFocusReviewId(reviewId);
      return;
    }
    if (reviews.length > 0) focusRow(selected);
    else pasteRef.current?.blur();
  };

  const rowIsFocused = (): boolean => listRef.current?.contains(document.activeElement) === true;

  useKeyBinding({ id: "shell-list-next", key: "j", scope: "list", description: "next", handler: () => focusRow(rowIsFocused() ? selected + 1 : 0) });
  useKeyBinding({ id: "shell-list-prev", key: "k", scope: "list", description: "previous", handler: () => focusRow(rowIsFocused() ? selected - 1 : 0) });
  useKeyBinding({
    id: "shell-list-delete",
    key: "d",
    scope: "list",
    description: "delete",
    handler: () => {
      const review = reviews[selected];
      if (review && rowIsFocused()) setConfirmingId(review.id);
    },
  });
  useKeyBinding({ id: "shell-list-paste", key: "/", scope: "list", description: "paste PR", handler: () => pasteRef.current?.focus() });

  const tabs = (
    <nav aria-label="Review lists" className={styles.tabs}>
      <TabLink to={paths.list("active")} current={tab === "active"}>
        active
      </TabLink>
      <TabLink to={paths.list("past")} current={tab === "past"}>
        past
      </TabLink>
      <TabLink to={paths.list("suggested")} current={tab === "suggested"}>
        suggested{suggestionCount > 0 ? ` (${suggestionCount})` : ""}
      </TabLink>
    </nav>
  );

  return (
    <>
      <h1 className="visually-hidden">{TAB_HEADINGS[tab]}</h1>
      <Panel title="add a pull request">
        <PasteBox inputRef={pasteRef} tab={tab} onLeave={leavePasteBox} />
      </Panel>
      <Panel title={`reviews · ${tab}`} actions={tabs}>
        {tab === "suggested" ? (
          <SuggestionsPanel
            now={now}
            onAdded={(reviewId) => {
              navigate(paths.list("active"));
              setFocusReviewId(reviewId);
            }}
          />
        ) : (
          <>
            {isPending ? <p>Loading reviews…</p> : null}
            {error ? <p role="alert">Could not load reviews: {error.message}</p> : null}
            {data && reviews.length === 0 ? (
              <p className={styles.muted}>
                {tab === "active" ? "No active reviews. Paste a PR link above to start one." : "No past reviews yet. Finished, merged and closed reviews appear here."}
              </p>
            ) : null}
            {reviews.length > 0 ? (
              <ul ref={listRef} className={styles.list} aria-label={tab === "active" ? "Active reviews" : "Past reviews"}>
                {reviews.map((review, index) => (
                  <ReviewRow
                    key={review.id}
                    review={review}
                    index={index}
                    now={now}
                    confirming={confirmingId === review.id}
                    onSelect={setSelected}
                    onAskDelete={setConfirmingId}
                    onDeleted={() => pasteRef.current?.focus()}
                  />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Panel>
    </>
  );
};
