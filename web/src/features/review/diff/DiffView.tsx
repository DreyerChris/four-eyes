import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import type { DiffLayout, DiffSide, Finding, Hunk } from "@shared/domain";
import { selectionStore } from "../../../bus/context";
import { appEvents } from "../../../bus/events";
import { anchorFindings } from "./findings";
import { HunkView, type ContextCommand } from "./HunkView";
import { readCell, selectionFromCells, selectionInDiff, type SelectedCell } from "./selection";
import styles from "./DiffView.module.css";

const INITIAL_CONTEXT: ContextCommand = { mode: "collapse", seq: 0 };
const NO_FINDINGS: readonly Finding[] = [];

export interface DiffViewProps {
  readonly reviewId: string;
  readonly chunkId: string | null;
  readonly hunks: readonly Hunk[];
  readonly baseSha: string;
  readonly headSha: string;
  readonly layout: DiffLayout;
  readonly hideWhitespace: boolean;
  readonly contextCommand?: ContextCommand;
  readonly findings?: readonly Finding[];
}

const tokensIn = (root: HTMLElement): readonly HTMLElement[] =>
  [...root.querySelectorAll("[data-token]")].filter((element): element is HTMLElement => element instanceof HTMLElement);

const SELECTED_ATTRIBUTE = "data-line-selected";

interface LineRange {
  readonly anchor: HTMLElement;
  readonly head: HTMLElement;
}

const codeCellsIn = (root: HTMLElement, side: DiffSide | null): readonly HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>("[data-code]")].filter(
    (cell) => readCell(cell) !== null && (side === null || cell.dataset.side === side),
  );

const sideOf = (cell: HTMLElement): DiffSide => (cell.dataset.side === "old" ? "old" : "new");

const rowOf = (element: Element): Element | null => element.closest("tr");

const nextLineToken = (tokens: readonly HTMLElement[], index: number, step: 1 | -1): HTMLElement | undefined => {
  const current = tokens[index];
  if (!current) return tokens[0];
  const row = rowOf(current);
  const candidates = step === 1 ? tokens.slice(index + 1) : tokens.slice(0, index).reverse();
  const target = candidates.find((token) => rowOf(token) !== row);
  if (!target || step === 1) return target;
  const targetRow = rowOf(target);
  return tokens.find((token) => rowOf(token) === targetRow);
};

/**
 * Custom diff renderer: unified/split, word-level highlights, lazy Shiki, expandable context, file header per hunk,
 * +/- markers, clickable identifier tokens (emits "token-click"), selection → selectionStore.
 */
export const DiffView = ({ reviewId, chunkId, hunks, baseSha, headSha, layout, hideWhitespace, contextCommand = INITIAL_CONTEXT, findings = NO_FINDINGS }: DiffViewProps): ReactElement => {
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRangeRef = useRef<LineRange | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const findingsByHunk = useMemo(() => anchorFindings(findings, hunks), [findings, hunks]);

  useEffect(
    () => () => {
      const current = selectionStore.get();
      if (current?.reviewId === reviewId && current.chunkId === chunkId) selectionStore.set(null);
    },
    [reviewId, chunkId],
  );

  const activateToken = (token: HTMLElement): void => {
    const cell = token.closest<HTMLElement>("[data-code]");
    const name = token.dataset.token;
    const { file, side, line } = cell?.dataset ?? {};
    const lineNumber = Number(line);
    if (!name || !file || (side !== "old" && side !== "new") || !Number.isInteger(lineNumber) || lineNumber < 1) return;
    appEvents.emit("token-click", { reviewId, token: name, filePath: file, line: lineNumber, side, sha: side === "old" ? baseSha : headSha });
  };

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element)) return;
    const token = event.target.closest<HTMLElement>("[data-token]");
    if (!token) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    activateToken(token);
  };

  const clearLineRange = (): void => {
    if (lineRangeRef.current === null) return;
    lineRangeRef.current = null;
    rootRef.current?.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`).forEach((cell) => cell.removeAttribute(SELECTED_ATTRIBUTE));
    const current = selectionStore.get();
    if (current?.reviewId === reviewId && current.chunkId === chunkId) selectionStore.set(null);
    setAnnouncement("Line selection cleared");
  };

  const extendLineRange = (root: HTMLElement, from: HTMLElement, step: 1 | -1): void => {
    const previous = lineRangeRef.current;
    const startCell = from.closest<HTMLElement>("[data-code]") ?? codeCellsIn(root, null)[0];
    if (!startCell) return;
    const anchor = previous?.anchor.isConnected ? previous.anchor : startCell;
    const cells = codeCellsIn(root, layout === "split" ? sideOf(anchor) : null);
    const anchorIndex = cells.indexOf(anchor);
    if (anchorIndex === -1) return;
    const headIndex = previous?.head.isConnected ? cells.indexOf(previous.head) : -1;
    const nextHeadIndex = headIndex === -1 ? anchorIndex : Math.min(cells.length - 1, Math.max(0, headIndex + step));
    const head = cells[nextHeadIndex] ?? anchor;
    const selected = cells.slice(Math.min(anchorIndex, nextHeadIndex), Math.max(anchorIndex, nextHeadIndex) + 1);
    root.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`).forEach((cell) => cell.removeAttribute(SELECTED_ATTRIBUTE));
    selected.forEach((cell) => cell.setAttribute(SELECTED_ATTRIBUTE, ""));
    lineRangeRef.current = { anchor, head };
    window.getSelection()?.removeAllRanges();
    const read = selected.map(readCell).filter((cell): cell is SelectedCell => cell !== null);
    const text = selected.map((cell) => cell.textContent ?? "").join("\n");
    const selection = selectionFromCells(read, text, { reviewId, chunkId });
    selectionStore.set(selection);
    head.scrollIntoView?.({ block: "nearest" });
    setAnnouncement(
      selection === null
        ? "Selected a blank line"
        : selection.startLine === selection.endLine
          ? `Selected line ${selection.startLine} of ${selection.filePath}. Press ? to ask about it.`
          : `Selected lines ${selection.startLine} to ${selection.endLine} of ${selection.filePath}. Press ? to ask about them.`,
    );
  };

  const updateSelection = (): void => {
    const root = rootRef.current;
    if (!root || lineRangeRef.current !== null) return;
    const selection = selectionInDiff(root, window.getSelection(), { reviewId, chunkId });
    const current = selectionStore.get();
    if (selection) selectionStore.set(selection);
    else if (current?.reviewId === reviewId && current.chunkId === chunkId) selectionStore.set(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const root = rootRef.current;
    if (!root || !(event.target instanceof HTMLElement)) return;
    const onToken = event.target.dataset.token !== undefined;
    if (onToken && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      activateToken(event.target);
      return;
    }
    if (!onToken && event.target !== root) return;
    if (event.key === "Escape" && lineRangeRef.current !== null) {
      clearLineRange();
      return;
    }
    if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      extendLineRange(root, event.target, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    const moves: Readonly<Record<string, true>> = { ArrowRight: true, ArrowLeft: true, ArrowDown: true, ArrowUp: true, Home: true, End: true };
    if (!moves[event.key] || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    clearLineRange();
    const tokens = tokensIn(root);
    if (tokens.length === 0) return;
    const index = onToken ? tokens.indexOf(event.target) : -1;
    const target = (() => {
      if (index === -1) return event.key === "End" ? tokens.at(-1) : tokens[0];
      switch (event.key) {
        case "ArrowRight":
          return tokens[index + 1];
        case "ArrowLeft":
          return tokens[index - 1];
        case "ArrowDown":
          return nextLineToken(tokens, index, 1);
        case "ArrowUp":
          return nextLineToken(tokens, index, -1);
        case "Home":
          return tokens[0];
        default:
          return tokens.at(-1);
      }
    })();
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <div
      ref={rootRef}
      className={styles.diff}
      role="group"
      aria-label="Diff. Use arrow keys to move between identifiers and Enter to look one up. Shift+Down and Shift+Up select lines to ask about with ?."
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseDown={clearLineRange}
      onMouseUp={updateSelection}
      onKeyUp={updateSelection}
    >
      <span className={styles.visuallyHidden} aria-live="polite">
        {announcement}
      </span>
      {hunks.length === 0 ? <p className={styles.muted}>This chunk has no hunks.</p> : null}
      {hunks.map((hunk) => (
        <HunkView
          key={hunk.id}
          reviewId={reviewId}
          hunk={hunk}
          baseSha={baseSha}
          headSha={headSha}
          layout={layout}
          hideWhitespace={hideWhitespace}
          contextCommand={contextCommand}
          findings={findingsByHunk.get(hunk.id)}
        />
      ))}
    </div>
  );
};
