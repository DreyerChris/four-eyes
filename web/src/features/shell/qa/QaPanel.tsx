import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import type { AskQuestionRequest } from "@shared/api";
import type { Question } from "@shared/domain";
import { useAskQuestion, useQuestions, useReview } from "../../../api/queries";
import type { Route } from "../../../app/router";
import { flashStatus, reviewLocationStore, selectionStore } from "../../../bus/context";
import { useAppEvent, type CodeSelection } from "../../../bus/events";
import { useKeyBinding } from "../../../keys/hooks";
import { copyText } from "../../../lib/clipboard";
import { Markdown } from "../../../ui/Markdown";
import { Overlay } from "../overlay/Overlay";
import { openOverlay, useIsOverlayOpen } from "../overlay/store";
import { reviewIdForRoute } from "../route";
import styles from "./QaPanel.module.css";

export interface QaPanelProps {
  readonly route: Route;
}

export interface QaTarget {
  readonly reviewId: string;
  readonly chunkId: string | null;
  readonly chunkNumber: number | null;
  readonly selection: CodeSelection | null;
  readonly prefill: string;
}

const MAX_PREVIEW_LINES = 12;

/** Builds the API request for a question about an optional code selection. */
export const buildAskRequest = (target: QaTarget, question: string, useOpus: boolean, includeSelection: boolean): AskQuestionRequest => {
  const selection = includeSelection ? target.selection : null;
  return {
    chunkId: selection?.chunkId ?? target.chunkId,
    filePath: selection?.filePath ?? null,
    startLine: selection ? Math.max(1, Math.min(selection.startLine, selection.endLine)) : null,
    endLine: selection ? Math.max(1, selection.startLine, selection.endLine) : null,
    selectedText: selection?.text ?? null,
    question: question.trim(),
    useOpus,
  };
};

const lineRange = (start: number | null, end: number | null): string =>
  start === null ? "" : end === null || end === start ? `:${start}` : `:${start}-${end}`;

const previewText = (text: string): string => {
  const lines = text.split("\n");
  return lines.length > MAX_PREVIEW_LINES ? `${lines.slice(0, MAX_PREVIEW_LINES).join("\n")}\n…` : text;
};

const copyAnswer = (answer: string): void => {
  copyText(answer, "Answer copied").catch((error: unknown) => console.warn("[qa] copy failed", error));
};

/** One question and its answer, rendered as markdown. */
export const QuestionCard = ({ question, answer, streaming }: { readonly question: Question; readonly answer: string | null; readonly streaming?: boolean }): ReactElement => (
  <article className={styles.card} aria-busy={streaming === true}>
    <header className={styles.cardHeader}>
      <span className={styles.who}>you</span>
      {question.filePath ? (
        <span className={styles.where}>
          {question.filePath}
          {lineRange(question.startLine, question.endLine)}
        </span>
      ) : null}
      <span className={styles.where}>{question.model}</span>
    </header>
    <p className={styles.question}>{question.question}</p>
    <div className={styles.answer}>
      {answer === null || answer === "" ? <span className={styles.muted}>{streaming ? "Thinking…" : "No answer was saved."}</span> : <Markdown text={answer} />}
    </div>
    {answer && !streaming ? (
      <button type="button" onClick={() => copyAnswer(answer)}>
        copy answer
      </button>
    ) : null}
  </article>
);

const QaDialog = ({ target }: { readonly target: QaTarget }): ReactElement => {
  const baseId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState(target.prefill);
  const [useOpus, setUseOpus] = useState(false);
  const [includeSelection, setIncludeSelection] = useState(target.selection !== null);
  const history = useQuestions(target.reviewId, target.chunkId ?? undefined);
  const { state, ask, cancel } = useAskQuestion(target.reviewId);
  const readOnly = useReview(target.reviewId).data?.review.status === "past";
  const streaming = state.status === "streaming";
  const selection = includeSelection ? target.selection : null;
  const past = (history.data?.questions ?? []).filter((item) => item.id !== state.question?.id);

  const submit = (): void => {
    if (question.trim() === "" || streaming || readOnly) return;
    const request = buildAskRequest(target, question, useOpus, includeSelection);
    setQuestion("");
    ask(request).catch((error: unknown) => flashStatus(`Question failed: ${error instanceof Error ? error.message : String(error)}`));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  const scope = target.chunkNumber !== null ? `chunk ${target.chunkNumber}` : target.chunkId ? "this chunk" : "this review";

  return (
    <Overlay name="qa" title={`ask claude · ${scope}`} placement="side" initialFocusRef={textareaRef}>
      <section aria-label="Context" className={styles.context}>
        {readOnly ? (
          <p className={styles.muted}>This review is in Past and read-only, so you cannot ask new questions. Add the PR again to reopen it.</p>
        ) : selection ? (
          <>
            <p className={styles.where}>
              {selection.filePath}
              {lineRange(Math.min(selection.startLine, selection.endLine), Math.max(selection.startLine, selection.endLine))} ({selection.side === "old" ? "before" : "after"})
            </p>
            <pre className={styles.selection}>{previewText(selection.text)}</pre>
            <button type="button" onClick={() => setIncludeSelection(false)}>
              ask without this selection
            </button>
          </>
        ) : (
          <p className={styles.muted}>
            No code selected. The question is about {scope}. Select lines in the diff (drag with the mouse, or Shift+Down and Shift+Up from the keyboard) and press <kbd>?</kbd> to ask about them.
          </p>
        )}
      </section>

      <section aria-label="Questions" className={styles.thread}>
        {history.error ? <p role="alert">Could not load earlier questions: {history.error.message}</p> : null}
        {past.length > 0 ? <h3 className={styles.heading}>Earlier questions on {scope}</h3> : null}
        {past.map((item) => (
          <QuestionCard key={item.id} question={item} answer={item.answer} />
        ))}
        <div aria-live="polite">
          {state.question ? <QuestionCard question={state.question} answer={state.answer} streaming={streaming} /> : null}
          {streaming && !state.question ? <p className={styles.muted}>Sending…</p> : null}
        </div>
        {state.status === "error" ? (
          <p role="alert" className={styles.error}>
            Claude could not answer: {state.error}
          </p>
        ) : null}
      </section>

      {readOnly ? null : (
        <form className={styles.form} onSubmit={onSubmit}>
          <label htmlFor={`${baseId}-question`}>Your question</label>
          <textarea
            id={`${baseId}-question`}
            ref={textareaRef}
            rows={4}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            aria-describedby={`${baseId}-hint`}
          />
          <p id={`${baseId}-hint`} className={styles.muted}>
            Ctrl+Enter or ⌘+Enter to send.
          </p>
          <div className={styles.controls}>
            <span className={styles.check}>
              <input id={`${baseId}-opus`} type="checkbox" checked={useOpus} onChange={(event) => setUseOpus(event.target.checked)} />
              <label htmlFor={`${baseId}-opus`}>ask Opus</label>
            </span>
            {streaming ? (
              <button type="button" onClick={cancel}>
                stop
              </button>
            ) : (
              <button type="submit" disabled={question.trim() === ""}>
                ask
              </button>
            )}
          </div>
        </form>
      )}
    </Overlay>
  );
};

/** Q&A panel (? on a selection, streamed answer, past Q&A for the chunk, ask Opus toggle). Renders as a fixed-position overlay; returns null while closed. */
export const QaPanel = ({ route }: QaPanelProps): ReactElement | null => {
  const open = useIsOverlayOpen("qa");
  const [target, setTarget] = useState<QaTarget | null>(null);
  const [openCount, setOpenCount] = useState(0);

  const show = (next: QaTarget): void => {
    setTarget(next);
    setOpenCount((count) => count + 1);
    openOverlay("qa");
  };

  const locationFor = (reviewId: string): { readonly chunkId: string | null; readonly chunkNumber: number | null } => {
    const location = reviewLocationStore.get();
    return location?.reviewId === reviewId ? { chunkId: location.chunkId, chunkNumber: location.chunkNumber } : { chunkId: null, chunkNumber: null };
  };

  useKeyBinding({
    id: "shell-ask",
    key: "?",
    scope: "global",
    description: "ask claude",
    handler: () => {
      const selection = selectionStore.get();
      const reviewId = reviewIdForRoute(route);
      if (reviewId === null) {
        flashStatus("Open a review to ask Claude a question");
        return;
      }
      const location = locationFor(reviewId);
      const usable = selection?.reviewId === reviewId ? selection : null;
      show({ reviewId, chunkId: usable?.chunkId ?? location.chunkId, chunkNumber: location.chunkNumber, selection: usable, prefill: "" });
    },
  });

  useAppEvent("ask-claude", (event) => {
    const location = locationFor(event.reviewId);
    show({
      reviewId: event.reviewId,
      chunkId: event.selection?.chunkId ?? location.chunkId,
      chunkNumber: location.chunkNumber,
      selection: event.selection,
      prefill: event.prefill,
    });
  });

  return open && target ? <QaDialog key={openCount} target={target} /> : null;
};
