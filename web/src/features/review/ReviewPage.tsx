import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { ReviewDetailResponse, UpdateSettingsRequest } from "@shared/api";
import { DEFAULT_SETTINGS, type ChunkStatus, type ProgressEvent, type Settings } from "@shared/domain";
import { useProgressEvents, useReview, useSettings, useUpdateChunkProgress, useUpdateSettings } from "../../api/queries";
import { navigate, paths } from "../../app/router";
import { flashStatus, reviewLocationStore } from "../../bus/context";
import { useAppEvent } from "../../bus/events";
import { useKeyBinding } from "../../keys/hooks";
import { Link } from "../../ui/Link";
import { Panel } from "../../ui/Panel";
import { RefreshButton } from "../shell/refresh/RefreshButton";
import { ChunkProgressBar } from "./ChunkProgressBar";
import { ChunkQuestions } from "./ChunkQuestions";
import { DiffView } from "./diff/DiffView";
import type { ContextCommand } from "./diff/HunkView";
import { STATUS_LABELS, STATUS_MARKS } from "./labels";
import { NoteEditor } from "./NoteEditor";
import { findUnseen, orderChunks, resolveChunkIndex } from "./ordering";
import { RerunReviewButton } from "./RerunReviewButton";
import styles from "./review.module.css";

export interface ReviewPageProps {
  readonly reviewId: string;
  readonly chunkId: string | null;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const RUN_STATUS_TEXT = {
  running: "Claude review running…",
  succeeded: "Claude review done",
  failed: "Claude review failed",
} as const;

const lastStepMessage = (events: readonly ProgressEvent[]): string | null => {
  const step = [...events].reverse().find((event) => event.type === "step" || event.type === "run");
  if (!step || (step.type !== "step" && step.type !== "run")) return null;
  const name = step.type === "step" ? step.step : step.kind;
  return `${name}: ${step.state}${step.message ? ` (${step.message})` : ""}`;
};

const PipelineState = ({ detail, events }: { readonly detail: ReviewDetailResponse; readonly events: readonly ProgressEvent[] }): ReactElement => {
  const { review } = detail;
  if (review.pipelineStatus === "failed") {
    return (
      <p role="alert" className={styles.error}>
        Preparing this review failed: {review.pipelineError ?? "unknown error"}
      </p>
    );
  }
  if (review.pipelineStatus === "ready") return <p>This PR has no changes to review.</p>;
  const latest = lastStepMessage(events);
  return (
    <div role="status">
      <p>{review.pipelineStatus === "ingesting" ? "Fetching the PR and building hunks…" : "Claude is grouping the changes into chunks…"}</p>
      {latest ? <p className={styles.muted}>{latest}</p> : null}
    </div>
  );
};

interface StepperProps {
  readonly detail: ReviewDetailResponse;
  readonly chunkId: string | null;
  readonly settings: Settings;
  readonly events: readonly ProgressEvent[];
}

const Stepper = ({ detail, chunkId, settings, events }: StepperProps): ReactElement => {
  const { review } = detail;
  const reviewId = review.id;
  const readOnly = review.status === "past";
  const chunks = useMemo(() => orderChunks(detail.chunks), [detail.chunks]);
  const index = resolveChunkIndex(chunks, chunkId);
  const current = chunks[index];
  const progress = useUpdateChunkProgress(reviewId);
  const updateSettings = useUpdateSettings();
  const [editingNote, setEditingNote] = useState(false);
  const [contextCommand, setContextCommand] = useState<ContextCommand>({ mode: "collapse", seq: 0 });
  const contextExpanded = contextCommand.mode === "expand";
  const chunkRef = useRef<HTMLDivElement>(null);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const restoreNoteFocus = useRef(false);
  const previousChunk = useRef<string | null>(null);

  useEffect(() => {
    if (current && current.id !== chunkId) navigate(paths.review(reviewId, current.id), { replace: true });
  }, [current, chunkId, reviewId]);

  useEffect(() => {
    reviewLocationStore.set({
      reviewId,
      chunkId: current?.id ?? null,
      chunkNumber: current ? index + 1 : null,
      chunkCount: chunks.length,
    });
  }, [reviewId, current, index, chunks.length]);

  useEffect(() => () => reviewLocationStore.set(null), []);

  useEffect(() => {
    setContextCommand((previousCommand) =>
      previousCommand.mode === "collapse" ? previousCommand : { mode: "collapse", seq: previousCommand.seq + 1 },
    );
  }, [current?.id]);

  useEffect(() => {
    const id = current?.id ?? null;
    if (previousChunk.current !== null && previousChunk.current !== id) {
      setEditingNote(false);
      const element = chunkRef.current;
      if (element && typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "start" });
    }
    previousChunk.current = id;
  }, [current?.id]);

  useEffect(() => {
    if (editingNote || !restoreNoteFocus.current) return;
    restoreNoteFocus.current = false;
    noteButtonRef.current?.focus();
  }, [editingNote]);

  const goTo = (target: number): void => {
    const chunk = chunks[target];
    if (chunk) navigate(paths.review(reviewId, chunk.id), { replace: true });
  };

  useAppEvent("goto-chunk", (event) => {
    if (event.reviewId !== reviewId) return;
    if (event.chunkNumber >= 1 && event.chunkNumber <= chunks.length) goTo(event.chunkNumber - 1);
    else flashStatus(`There is no chunk ${event.chunkNumber}; this review has ${chunks.length}.`);
  });

  const save = (status: ChunkStatus, note: string, after?: () => void): void => {
    if (!current || readOnly) return;
    progress.mutate(
      { chunkId: current.id, status, note },
      {
        onSuccess: () => after?.(),
        onError: (error) => flashStatus(`Could not save progress: ${error.message}`),
      },
    );
  };

  const mark = (status: ChunkStatus): void => {
    if (!current) return;
    save(status, current.progress.note);
    if (status === "good" && index < chunks.length - 1) goTo(index + 1);
  };

  const patchSettings = (patch: UpdateSettingsRequest, label: string): void =>
    updateSettings.mutate(patch, {
      onSuccess: () => flashStatus(label),
      onError: (error) => flashStatus(`Could not save settings: ${error.message}`),
    });

  const next = (): void => (index < chunks.length - 1 ? goTo(index + 1) : navigate(paths.summary(reviewId)));
  const previous = (): void => goTo(Math.max(0, index - 1));
  const nextUnseen = (): void => {
    const target = findUnseen(chunks, index, 1);
    if (target === -1) flashStatus("No unseen chunks after this one");
    else goTo(target);
  };
  const previousUnseen = (): void => {
    const target = findUnseen(chunks, index, -1);
    if (target === -1) flashStatus("No unseen chunks before this one");
    else goTo(target);
  };
  const toggleLayout = (): void =>
    patchSettings({ diffLayout: settings.diffLayout === "split" ? "unified" : "split" }, `Layout: ${settings.diffLayout === "split" ? "unified" : "split"}`);
  const toggleWhitespace = (): void =>
    patchSettings({ hideWhitespace: !settings.hideWhitespace }, settings.hideWhitespace ? "Showing whitespace changes" : "Hiding whitespace changes");
  const toggleInline = (): void =>
    patchSettings({ inlineFindings: !settings.inlineFindings }, settings.inlineFindings ? "Findings hidden until the summary" : "Showing findings inline");
  const toggleContext = (): void =>
    setContextCommand((previousCommand) => ({ mode: previousCommand.mode === "expand" ? "collapse" : "expand", seq: previousCommand.seq + 1 }));
  const editNote = (): void => {
    if (!readOnly && current) setEditingNote(true);
  };
  const stopEditingNote = (): void => {
    restoreNoteFocus.current = true;
    setEditingNote(false);
  };

  const enabled = current !== undefined;
  const writable = enabled && !readOnly;
  useKeyBinding({ id: "review.next", key: "j", scope: "review", description: "next", handler: next }, enabled);
  useKeyBinding({ id: "review.previous", key: "k", scope: "review", description: "prev", handler: previous }, enabled);
  useKeyBinding({ id: "review.good", key: "g", scope: "review", description: "good", handler: () => mark("good") }, writable);
  useKeyBinding({ id: "review.flag", key: "f", scope: "review", description: "flag", handler: () => mark("flagged") }, writable);
  useKeyBinding({ id: "review.note", key: "n", scope: "review", description: "note", handler: editNote }, writable);
  useKeyBinding({ id: "review.unseen", key: "u", scope: "review", description: "unmark", showInStatusBar: false, handler: () => mark("unseen") }, writable);
  useKeyBinding({ id: "review.layout", key: "s", scope: "review", description: "split", showInStatusBar: false, handler: toggleLayout }, enabled);
  useKeyBinding({ id: "review.whitespace", key: "w", scope: "review", description: "whitespace", showInStatusBar: false, handler: toggleWhitespace }, enabled);
  useKeyBinding({ id: "review.inline", key: "i", scope: "review", description: "inline findings", showInStatusBar: false, handler: toggleInline }, enabled);
  useKeyBinding({ id: "review.expand", key: "e", scope: "review", description: "expand / collapse context", showInStatusBar: false, handler: toggleContext }, enabled);
  useKeyBinding({ id: "review.nextUnseen", key: "]", scope: "review", description: "next unseen", showInStatusBar: false, handler: nextUnseen }, enabled);
  useKeyBinding({ id: "review.prevUnseen", key: "[", scope: "review", description: "prev unseen", showInStatusBar: false, handler: previousUnseen }, enabled);

  const runStatus = review.reviewRunStatus;
  const header = (
    <Panel title={review.title} headingLevel={1} actions={<RefreshButton reviewId={reviewId} />}>
      <div className={styles.meta}>
        <a href={review.url} target="_blank" rel="noreferrer">
          {review.owner}/{review.repo}#{review.prNumber}
        </a>
        <span>by {review.author}</span>
        <span className={styles.muted}>{review.ghState}</span>
        {readOnly ? <span className={styles.tag}>past, read-only</span> : null}
        <span className={styles.muted}>{runStatus ? RUN_STATUS_TEXT[runStatus] : "Claude review not started"}</span>
        {!readOnly && (runStatus === "running" || runStatus === "failed") ? <RerunReviewButton reviewId={reviewId} status={runStatus} /> : null}
        <Link to={paths.summary(reviewId)}>summary →</Link>
      </div>
      {chunks.length > 0 ? <ChunkProgressBar chunks={chunks} currentIndex={index} onSelect={goTo} /> : null}
    </Panel>
  );

  if (!current) {
    return (
      <div className={styles.page}>
        {header}
        <Panel title="chunks">
          <PipelineState detail={detail} events={events} />
        </Panel>
      </div>
    );
  }

  const chunkFindings = detail.findings.filter((finding) => current.findingIds.includes(finding.id));
  const status = current.progress.status;
  const statusButton = (value: ChunkStatus, label: string, key: string | null): ReactElement => (
    <button type="button" aria-pressed={status === value} disabled={readOnly} onClick={() => mark(value)}>
      {label}
      {key ? <kbd> {key}</kbd> : null}
    </button>
  );

  const titleParts = [
    `chunk ${index + 1}/${chunks.length}`,
    current.roundNumber > 1 ? `Round ${current.roundNumber}` : null,
    current.kind === "skim" ? "skim" : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className={styles.page}>
      {header}
      <div ref={chunkRef} className={styles.chunkAnchor}>
        <Panel title={titleParts.join(" · ")}>
          <p className="visually-hidden" aria-live="polite">
            Chunk {index + 1} of {chunks.length}: {current.title}
          </p>
          <h3 className={styles.chunkTitle}>{current.title}</h3>
          <p className={styles.prose}>{current.explanation}</p>
          <div className={styles.statusRow}>
            <span className={`${styles.status} ${styles[`status_${status}`] ?? ""}`}>
              {STATUS_MARKS[status]} {STATUS_LABELS[status]}
            </span>
          </div>
          {readOnly ? null : (
            <div className={styles.buttons} role="group" aria-label="Mark this chunk">
              {statusButton("good", "Looks good", "g")}
              {statusButton("flagged", "Flag", "f")}
              {statusButton("question", "Question", null)}
              <button type="button" onClick={() => mark("unseen")}>
                Unmark<kbd> u</kbd>
              </button>
              <button ref={noteButtonRef} type="button" onClick={editNote} disabled={editingNote}>
                Note<kbd> n</kbd>
              </button>
            </div>
          )}
          {progress.error ? (
            <p role="alert" className={styles.error}>
              Could not save progress: {errorMessage(progress.error)}
            </p>
          ) : null}
          {editingNote ? (
            <NoteEditor
              key={current.id}
              initial={current.progress.note}
              saving={progress.isPending}
              onSave={(note) => save(status, note, stopEditingNote)}
              onCancel={stopEditingNote}
            />
          ) : current.progress.note.trim() !== "" ? (
            <blockquote className={styles.note} aria-label="Your note">
              {current.progress.note}
            </blockquote>
          ) : null}
          <ChunkQuestions reviewId={reviewId} chunkId={current.id} />
          <div className={styles.toolbar} role="group" aria-label="Diff options">
            <button type="button" aria-pressed={settings.diffLayout === "split"} onClick={toggleLayout}>
              Split view<kbd> s</kbd>
            </button>
            <button type="button" aria-pressed={settings.hideWhitespace} onClick={toggleWhitespace}>
              Hide whitespace<kbd> w</kbd>
            </button>
            <button type="button" aria-pressed={contextExpanded} onClick={toggleContext}>
              Expand context<kbd> e</kbd>
            </button>
            <button type="button" aria-pressed={settings.inlineFindings} onClick={toggleInline}>
              Inline findings<kbd> i</kbd>
            </button>
          </div>
          <DiffView
            reviewId={reviewId}
            chunkId={current.id}
            hunks={current.hunks}
            baseSha={review.baseSha}
            headSha={review.headSha}
            layout={settings.diffLayout}
            hideWhitespace={settings.hideWhitespace}
            contextCommand={contextCommand}
            findings={settings.inlineFindings ? chunkFindings : undefined}
          />
          <nav className={styles.stepNav} aria-label="Chunk navigation">
            <button type="button" onClick={previous} disabled={index === 0}>
              ← Previous<kbd> k</kbd>
            </button>
            {index < chunks.length - 1 ? (
              <button type="button" onClick={next}>
                Next<kbd> j</kbd> →
              </button>
            ) : (
              <Link to={paths.summary(reviewId)}>Go to summary →</Link>
            )}
          </nav>
        </Panel>
      </div>
    </div>
  );
};

/** Chunk stepper: title + explanation, diff, j/k navigation, g/f/n marking, progress bar, inline findings, round labels. */
export const ReviewPage = ({ reviewId, chunkId }: ReviewPageProps): ReactElement => {
  const { data, error, isPending } = useReview(reviewId);
  const settings = useSettings();
  const events = useProgressEvents(data ? reviewId : null);
  if (isPending) {
    return (
      <Panel title="review" headingLevel={1}>
        <p role="status">Loading review…</p>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title="review" headingLevel={1}>
        <p role="alert" className={styles.error}>
          Could not load review: {error.message}
        </p>
        <Link to={paths.list()}>Back to reviews</Link>
      </Panel>
    );
  }
  return <Stepper detail={data} chunkId={chunkId} settings={settings.data ?? DEFAULT_SETTINGS} events={events} />;
};
