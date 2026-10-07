import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { FindingView, SummaryChunk, SummaryResponse } from "@shared/api";
import { SEVERITIES, USER_VERDICTS, type ClaudeRun, type Hunk, type UserVerdict } from "@shared/domain";
import { useFinishReview, useProgressEvents, useReview, useSetFindingVerdict, useSummary } from "../../api/queries";
import { navigate, paths } from "../../app/router";
import { flashStatus } from "../../bus/context";
import { useKeyBinding } from "../../keys/hooks";
import { copyText } from "../../lib/clipboard";
import { Link } from "../../ui/Link";
import { Markdown } from "../../ui/Markdown";
import { Panel } from "../../ui/Panel";
import { RefreshButton } from "../shell/refresh/RefreshButton";
import { CostPanel } from "./CostPanel";
import { FindingCard } from "./FindingCard";
import { SEVERITY_LABELS, STATUS_LABELS, STATUS_MARKS, SUGGESTION_LABELS, USER_VERDICT_LABELS } from "./labels";
import { formatRelative } from "../shell/list/format";
import { orderFindings } from "./ordering";
import { RerunReviewButton } from "./RerunReviewButton";
import { SubmitReviewPanel } from "./SubmitReviewPanel";
import { buildFullReviewMarkdown, findingToGitHubComment, notedChunks, noteToGitHubComment } from "./markdown";
import styles from "./review.module.css";

export interface SummaryPageProps {
  readonly reviewId: string;
}

const copy = (text: string, label: string): void => {
  copyText(text, label).catch((error: unknown) => console.error("[summary] copy failed", error));
};

const chunkNumber = (chunks: readonly SummaryChunk[], chunkId: string): number => chunks.findIndex((chunk) => chunk.id === chunkId) + 1;

const isInteractive = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && target.closest("button, a, summary, input, textarea, select") !== null;

interface SummaryBodyProps {
  readonly summary: SummaryResponse;
  readonly hunksByChunk: ReadonlyMap<string, readonly Hunk[]>;
  readonly runs: readonly ClaudeRun[];
}

const SummaryBody = ({ summary, hunksByChunk, runs }: SummaryBodyProps): ReactElement => {
  const hunks = useMemo(() => [...hunksByChunk.values()].flat(), [hunksByChunk]);
  const { review, verdict, coverage, reviewRun } = summary;
  const reviewId = review.id;
  const readOnly = review.status === "past";
  const findings = useMemo(() => orderFindings(summary.findings), [summary.findings]);
  const setVerdict = useSetFindingVerdict(reviewId);
  const finish = useFinishReview();
  const [selected, setSelected] = useState(0);
  const cards = useRef(new Map<string, HTMLElement>());
  const pastTagRef = useRef<HTMLSpanElement>(null);
  const focusPastTag = useRef(false);

  useEffect(() => {
    if (!readOnly || !focusPastTag.current) return;
    focusPastTag.current = false;
    pastTagRef.current?.focus();
  }, [readOnly]);
  const noted = notedChunks(summary.chunks);
  const unseen = summary.chunks.filter((chunk) => chunk.progress.status === "unseen");
  const current = findings[selected];

  const select = (index: number): void => {
    const finding = findings[index];
    if (!finding) return;
    setSelected(index);
    cards.current.get(finding.id)?.focus();
  };

  const vote = (finding: FindingView, verdict: UserVerdict): void => {
    if (readOnly) return;
    if (finding.lifecycle === "resolved") {
      flashStatus("This finding is resolved, so there is nothing to vote on");
      return;
    }
    const next = finding.userVerdict === verdict ? null : verdict;
    setVerdict.mutate(
      { findingId: finding.id, verdict: next },
      {
        onSuccess: () => flashStatus(next ? `Marked "${finding.title}" as ${USER_VERDICT_LABELS[next].toLowerCase()}` : "Verdict cleared"),
        onError: (error) => flashStatus(`Could not save your verdict: ${error.message}`),
      },
    );
  };

  const copyFinding = (finding: FindingView): void =>
    finding.lifecycle === "resolved"
      ? flashStatus("This finding is resolved, so there is nothing to copy")
      : copy(findingToGitHubComment(finding, hunks), "Finding copied as a GitHub comment");
  const copyAll = (): void => copy(buildFullReviewMarkdown(summary), "Full review copied");
  const gotoFinding = (finding: FindingView): void => {
    const chunkId = finding.chunkIds[0];
    if (chunkId) navigate(paths.review(reviewId, chunkId));
    else flashStatus("This finding is not in any chunk");
  };

  const hasFindings = findings.length > 0;
  useKeyBinding({ id: "summary.next", key: "j", scope: "summary", description: "next finding", handler: () => select(Math.min(findings.length - 1, selected + 1)) }, hasFindings);
  useKeyBinding({ id: "summary.previous", key: "k", scope: "summary", description: "prev finding", handler: () => select(Math.max(0, selected - 1)) }, hasFindings);
  useKeyBinding(
    { id: "summary.agree", key: "a", scope: "summary", description: "agree", handler: () => (current ? vote(current, "agree") : undefined) },
    hasFindings && !readOnly,
  );
  useKeyBinding(
    { id: "summary.disagree", key: "x", scope: "summary", description: "disagree", handler: () => (current ? vote(current, "disagree") : undefined) },
    hasFindings && !readOnly,
  );
  useKeyBinding(
    { id: "summary.copy", key: "c", scope: "summary", description: "copy finding", handler: () => (current ? copyFinding(current) : undefined) },
    hasFindings,
  );
  useKeyBinding({ id: "summary.copyAll", key: "C", scope: "summary", description: "copy review", handler: copyAll });
  useKeyBinding(
    {
      id: "summary.open",
      key: "enter",
      scope: "summary",
      description: "go to chunk",
      showInStatusBar: false,
      handler: (event) => {
        if (isInteractive(event.target)) event.target.closest<HTMLElement>("button, a, summary, input, textarea, select")?.click();
        else if (current) gotoFinding(current);
      },
    },
    hasFindings,
  );

  const finishReview = (): void => {
    focusPastTag.current = true;
    finish.mutate(reviewId, {
      onSuccess: () => flashStatus("Review finished and moved to Past"),
      onError: (error) => {
        focusPastTag.current = false;
        flashStatus(`Could not finish the review: ${error.message}`);
      },
    });
  };

  return (
    <div className={styles.page}>
      <Panel
        title={`summary: ${review.title}`}
        headingLevel={1}
        actions={
          <>
            <RefreshButton reviewId={reviewId} />
            <button type="button" onClick={copyAll}>
              Copy full review<kbd> C</kbd>
            </button>
          </>
        }
      >
        <div className={styles.meta}>
          <a href={review.url} target="_blank" rel="noreferrer">
            {review.owner}/{review.repo}#{review.prNumber}
          </a>
          <span>by {review.author}</span>
          <Link to={paths.review(reviewId)}>← back to chunks</Link>
          {readOnly ? (
            <span ref={pastTagRef} tabIndex={-1} className={styles.tag}>
              past, read-only
            </span>
          ) : (
            <button type="button" onClick={finishReview} disabled={finish.isPending}>
              {finish.isPending ? "Finishing…" : "Finish review"}
            </button>
          )}
        </div>
        {finish.error ? (
          <p role="alert" className={styles.error}>
            Could not finish the review: {finish.error.message}
          </p>
        ) : null}
      </Panel>

      <Panel title="verdict" actions={readOnly ? undefined : <RerunReviewButton reviewId={reviewId} status={reviewRun?.status ?? null} />}>
        {verdict ? (
          <>
            <p className={`${styles.suggestion} ${styles[`suggestion_${verdict.suggestion}`] ?? ""}`}>{SUGGESTION_LABELS[verdict.suggestion]}</p>
            <Markdown className={styles.markdown} text={verdict.summary} />
          </>
        ) : reviewRun?.status === "failed" ? (
          <p role="alert" className={styles.error}>
            Claude&apos;s review failed: {reviewRun.error ?? "unknown error"}
          </p>
        ) : reviewRun?.status === "running" ? (
          <p role="status">Claude is still reviewing this PR (started {formatRelative(reviewRun.startedAt, Date.now())})…</p>
        ) : (
          <p className={styles.muted}>No verdict from Claude yet.</p>
        )}
        {reviewRun && reviewRun.costUsd !== null ? (
          <p className={styles.muted}>
            {reviewRun.model} · {reviewRun.inputTokens ?? 0} in / {reviewRun.outputTokens ?? 0} out tokens · ${reviewRun.costUsd.toFixed(2)}
          </p>
        ) : null}
      </Panel>

      <Panel title={`findings (${findings.length})`}>
        {findings.length === 0 ? <p className={styles.muted}>No findings.</p> : null}
        {SEVERITIES.map((severity) => {
          const group = findings.filter((finding) => finding.severity === severity);
          if (group.length === 0) return null;
          return (
            <section key={severity} aria-labelledby={`severity-${severity}`} className={styles.findingGroup}>
              <h3 id={`severity-${severity}`} className={styles[`severity_${severity}`]}>
                {SEVERITY_LABELS[severity]} ({group.length})
              </h3>
              {group.map((finding) => {
                const index = findings.indexOf(finding);
                return (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    headingLevel={4}
                    selected={index === selected}
                    onFocus={() => setSelected(index)}
                    cardRef={(element) => {
                      if (element) cards.current.set(finding.id, element);
                      else cards.current.delete(finding.id);
                    }}
                  >
                    <div className={styles.findingActions}>
                      {finding.chunkIds.map((chunkId) => (
                        <Link key={chunkId} to={paths.review(reviewId, chunkId)}>
                          go to chunk {chunkNumber(summary.chunks, chunkId)}
                        </Link>
                      ))}
                      {finding.lifecycle === "resolved" ? (
                        finding.userVerdict ? (
                          <span className={styles.resolvedNote}>You marked this {USER_VERDICT_LABELS[finding.userVerdict].toLowerCase()}</span>
                        ) : null
                      ) : (
                        <>
                          <button type="button" onClick={() => copyFinding(finding)}>
                            Copy as GitHub comment
                          </button>
                          <span role="group" aria-label={`Your verdict on ${finding.title}`} className={styles.buttons}>
                            {USER_VERDICTS.map((option) => (
                              <button
                                key={option}
                                type="button"
                                aria-pressed={finding.userVerdict === option}
                                disabled={readOnly}
                                onClick={() => vote(finding, option)}
                              >
                                {USER_VERDICT_LABELS[option]}
                              </button>
                            ))}
                          </span>
                        </>
                      )}
                    </div>
                  </FindingCard>
                );
              })}
            </section>
          );
        })}
        {setVerdict.error ? (
          <p role="alert" className={styles.error}>
            Could not save your verdict: {setVerdict.error.message}
          </p>
        ) : null}
      </Panel>

      <Panel title={`your flags and notes (${noted.length})`}>
        {noted.length === 0 ? <p className={styles.muted}>You did not flag or note any chunk.</p> : null}
        <ul className={styles.plainList}>
          {noted.map((chunk) => (
            <li key={chunk.id} className={styles.noteItem}>
              <span className={`${styles.status} ${styles[`status_${chunk.progress.status}`] ?? ""}`}>
                {STATUS_MARKS[chunk.progress.status]} {STATUS_LABELS[chunk.progress.status]}
              </span>{" "}
              <Link to={paths.review(reviewId, chunk.id)}>
                chunk {chunkNumber(summary.chunks, chunk.id)}: {chunk.title}
              </Link>
              {chunk.progress.note.trim() !== "" ? <blockquote className={styles.note}>{chunk.progress.note}</blockquote> : null}
              <button
                type="button"
                onClick={() =>
                  copy(
                    noteToGitHubComment(chunk.progress, chunk.title, hunksByChunk.get(chunk.id) ?? []),
                    "Note copied as a GitHub comment",
                  )
                }
              >
                Copy as GitHub comment
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`questions (${summary.questions.length})`}>
        {summary.questions.length === 0 ? (
          <p className={styles.muted}>No questions asked.</p>
        ) : (
          <details>
            <summary>Show {summary.questions.length} question{summary.questions.length === 1 ? "" : "s"}</summary>
            <ul className={styles.plainList}>
              {summary.questions.map((question) => (
                <li key={question.id} className={styles.question}>
                  <p>
                    <strong>Q:</strong> {question.question}
                    {question.filePath ? (
                      <span className={styles.muted}>
                        {" "}
                        ({question.filePath}
                        {question.startLine !== null ? `:${question.startLine}${question.endLine && question.endLine !== question.startLine ? `-${question.endLine}` : ""}` : ""})
                      </span>
                    ) : null}
                  </p>
                  <div className={styles.answerRow}>
                    <strong>A:</strong>
                    <Markdown className={styles.markdown} text={question.answer ?? "No answer yet."} />
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>

      <Panel title="coverage">
        <ul className={styles.plainList}>
          <li>
            Chunks reviewed: {coverage.reviewedChunks} of {coverage.totalChunks}
          </li>
          <li>
            Hunks reviewed: {coverage.reviewedHunks} of {coverage.presentHunks} still in the PR
          </li>
          {coverage.missingHunks > 0 ? <li>Hunks no longer in the PR: {coverage.missingHunks}</li> : null}
        </ul>
        {unseen.length > 0 ? (
          <>
            <h3 className={styles.subheading}>Not yet reviewed</h3>
            <ul className={styles.plainList}>
              {unseen.map((chunk) => (
                <li key={chunk.id}>
                  <Link to={paths.review(reviewId, chunk.id)}>
                    chunk {chunkNumber(summary.chunks, chunk.id)}: {chunk.title}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Panel>

      <SubmitReviewPanel summary={summary} />

      <CostPanel runs={runs} />
    </div>
  );
};

/** Verdict, findings by severity, your flags and notes, questions, coverage, submit to GitHub, Copy full review. */
export const SummaryPage = ({ reviewId }: SummaryPageProps): ReactElement => {
  const summary = useSummary(reviewId);
  const detail = useReview(reviewId);
  useProgressEvents(summary.data ? reviewId : null);
  const hunksByChunk = useMemo(
    () => new Map((detail.data?.chunks ?? []).map((chunk) => [chunk.id, chunk.hunks] as const)),
    [detail.data],
  );
  if (summary.isPending) {
    return (
      <Panel title="summary" headingLevel={1}>
        <p role="status">Loading summary…</p>
      </Panel>
    );
  }
  if (summary.error) {
    return (
      <Panel title="summary" headingLevel={1}>
        <p role="alert" className={styles.error}>
          Could not load the summary: {summary.error.message}
        </p>
        <Link to={paths.list()}>Back to reviews</Link>
      </Panel>
    );
  }
  return <SummaryBody summary={summary.data} hunksByChunk={hunksByChunk} runs={detail.data?.runs ?? (summary.data.reviewRun ? [summary.data.reviewRun] : [])} />;
};
