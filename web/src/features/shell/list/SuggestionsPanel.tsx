import type { ReactElement } from "react";
import type { PrSuggestion } from "@shared/domain";
import { useCheckSuggestions, useCreateReview, useHideSuggestion, useSuggestions, type SuggestionAction } from "../../../api/queries";
import { flashStatus } from "../../../bus/context";
import { formatRelative } from "./format";
import styles from "./ListPage.module.css";

const reasonsOf = (suggestion: PrSuggestion): readonly string[] => [
  ...(suggestion.recentRepo ? ["repo you reviewed recently"] : []),
  ...(suggestion.knownAuthor ? [`@${suggestion.author}'s PRs you reviewed before`] : []),
];

const HIDDEN_MESSAGES: Readonly<Record<SuggestionAction, string>> = {
  dismiss: "Dismissed until the PR changes",
  ignore: "Marked not interested",
};

interface SuggestionRowProps {
  readonly suggestion: PrSuggestion;
  readonly now: number;
  readonly onAdded: (reviewId: string) => void;
}

const SuggestionRow = ({ suggestion, now, onAdded }: SuggestionRowProps): ReactElement => {
  const create = useCreateReview();
  const hide = useHideSuggestion();
  const label = `${suggestion.owner}/${suggestion.repo}#${suggestion.number}`;

  const review = (): void =>
    create.mutate(suggestion.url, {
      onSuccess: ({ review: added, reopened }) => {
        flashStatus(`${reopened ? "Reopened" : "Added"} ${label}`);
        onAdded(added.id);
      },
    });

  const hideAs = (action: SuggestionAction): void =>
    hide.mutate({ id: suggestion.id, action }, { onSuccess: () => flashStatus(`${HIDDEN_MESSAGES[action]}: ${label}`) });

  const error = create.error ?? hide.error;
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.suggestionTitle}>{suggestion.title}</span>
        <div className={styles.meta}>
          <span>{label}</span>
          <span>@{suggestion.author}</span>
          {reasonsOf(suggestion).map((reason) => (
            <span key={reason} className={styles.badge}>
              {reason}
            </span>
          ))}
          <span className={styles.muted}>
            updated <time dateTime={suggestion.updatedAt}>{formatRelative(suggestion.updatedAt, now)}</time>
          </span>
        </div>
        {error ? (
          <p role="alert" className={styles.error}>
            {create.error ? `Could not add the PR: ${create.error.message}` : `Could not hide the suggestion: ${hide.error?.message ?? ""}`}
          </p>
        ) : null}
      </div>
      <div className={styles.suggestionActions}>
        <button type="button" onClick={review} disabled={create.isPending} aria-label={`Review this: ${label}`}>
          {create.isPending ? "adding…" : "Review this"}
        </button>
        <a href={suggestion.url} target="_blank" rel="noreferrer" aria-label={`Open on GitHub: ${label}`}>
          Open on GitHub
        </a>
        <button type="button" onClick={() => hideAs("dismiss")} disabled={hide.isPending} aria-label={`Dismiss: ${label}`}>
          Dismiss
        </button>
        <button type="button" onClick={() => hideAs("ignore")} disabled={hide.isPending} aria-label={`Not interested: ${label}`}>
          Not interested
        </button>
      </div>
    </li>
  );
};

export interface SuggestionsPanelProps {
  readonly now: number;
  readonly onAdded: (reviewId: string) => void;
}

/** Open PRs in repos you reviewed recently or by people you reviewed before. Adding one is up to you; nothing runs on its own. */
export const SuggestionsPanel = ({ now, onAdded }: SuggestionsPanelProps): ReactElement => {
  const { data, error, isPending } = useSuggestions();
  const check = useCheckSuggestions();
  const checking = check.isPending || data?.checking === true;

  if (isPending) return <p>Loading suggestions…</p>;
  if (error) return <p role="alert">Could not load suggestions: {error.message}</p>;
  if (!data.enabled) {
    return <p className={styles.muted}>PR suggestions are turned off. Turn them on in settings (press ,).</p>;
  }
  return (
    <>
      <div className={styles.suggestionsStatus}>
        <span className={styles.muted} aria-live="polite">
          {checking
            ? "Checking GitHub…"
            : data.lastCheckedAt === null
              ? "Not checked yet"
              : `Checked ${formatRelative(data.lastCheckedAt, now)}`}
        </span>
        <button type="button" onClick={() => check.mutate()} disabled={checking}>
          Check now
        </button>
      </div>
      {[...data.errors.map((failure) => `Could not check ${failure.host}: ${failure.message}`), ...(check.error ? [`Could not check: ${check.error.message}`] : [])].map(
        (message) => (
          <p key={message} role="alert" className={styles.error}>
            {message}
          </p>
        ),
      )}
      {data.suggestions.length === 0 ? (
        <p className={styles.muted}>
          No suggestions right now. four-eyes looks for open PRs in repos you reviewed in the last 30 days and by people whose PRs you
          reviewed before.
        </p>
      ) : (
        <ul className={styles.list} aria-label="Suggested pull requests">
          {data.suggestions.map((suggestion) => (
            <SuggestionRow key={suggestion.id} suggestion={suggestion} now={now} onAdded={onAdded} />
          ))}
        </ul>
      )}
    </>
  );
};
