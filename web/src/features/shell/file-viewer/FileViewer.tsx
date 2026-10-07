import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { DiffSide, Hunk } from "@shared/domain";
import { useFileContents, useReview, useTheme } from "../../../api/queries";
import type { Route } from "../../../app/router";
import { useAppEvent, type OpenFileEvent } from "../../../bus/events";
import { useKeyBinding } from "../../../keys/hooks";
import { highlightCode, languageForPath, type HighlightedLine } from "../../../lib/highlight";
import { Overlay } from "../overlay/Overlay";
import { openOverlay, useIsOverlayOpen } from "../overlay/store";
import { changedLines, withoutFinalNewline } from "./changed-lines";
import styles from "./FileViewer.module.css";

export interface FileViewerProps {
  readonly route: Route;
}

const plainLines = (content: string): readonly HighlightedLine[] => content.split("\n").map((line) => [{ content: line }]);

const useHighlightedLines = (content: string | null, path: string): readonly HighlightedLine[] => {
  const theme = useTheme();
  const [highlighted, setHighlighted] = useState<{ readonly source: string; readonly lines: readonly HighlightedLine[] } | null>(null);
  useEffect(() => {
    if (content === null) return undefined;
    let cancelled = false;
    highlightCode(content, languageForPath(path), theme)
      .then((lines) => {
        if (!cancelled) setHighlighted({ source: content, lines });
      })
      .catch((error: unknown) => {
        console.warn(`[file-viewer] highlighting ${path} failed; showing plain text`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [content, path, theme]);
  if (content === null) return [];
  return highlighted?.source === content ? highlighted.lines : plainLines(content);
};

const derivedOldPath = (hunks: readonly Hunk[], path: string): string | null =>
  hunks.find((hunk) => hunk.filePath === path && hunk.oldFilePath !== null)?.oldFilePath ?? null;

const shortSha = (sha: string): string => sha.slice(0, 8);

const FileViewerDialog = ({ target }: { readonly target: OpenFileEvent }): ReactElement => {
  const [side, setSide] = useState<DiffSide>(target.side);
  const [focusLine, setFocusLine] = useState<number | null>(target.line);
  const codeRef = useRef<HTMLDivElement>(null);
  const review = useReview(target.reviewId);
  const hunks = useMemo(() => review.data?.chunks.flatMap((chunk) => chunk.hunks) ?? [], [review.data]);
  const oldPath = target.oldPath ?? derivedOldPath(hunks, target.path) ?? target.path;
  const displayPath = side === "new" ? target.path : oldPath;
  const baseSha = review.data?.review.baseSha;
  const head = useFileContents(target.reviewId, side === "new" ? target.path : null);
  const base = useFileContents(target.reviewId, side === "old" && baseSha ? oldPath : null, baseSha);
  const file = side === "new" ? head : base;
  const content = file.data?.content ?? null;
  const lines = useHighlightedLines(content === null ? null : withoutFinalNewline(content), displayPath);
  const changed = useMemo(() => changedLines(hunks, displayPath, side), [hunks, displayPath, side]);
  const sortedChanged = useMemo(() => [...changed].sort((a, b) => a - b), [changed]);

  useEffect(() => {
    if (focusLine === null || lines.length === 0) return;
    codeRef.current?.querySelector(`[data-line="${focusLine}"]`)?.scrollIntoView({ block: "center" });
  }, [focusLine, lines.length, side]);

  const jumpChange = (direction: 1 | -1): void => {
    const current = focusLine ?? 0;
    const next =
      direction === 1 ? sortedChanged.find((line) => line > current) : [...sortedChanged].reverse().find((line) => line < current);
    if (next !== undefined) setFocusLine(next);
  };

  useKeyBinding({ id: "shell-file-viewer-next", key: "j", scope: "overlay", description: "next change", handler: () => jumpChange(1) });
  useKeyBinding({ id: "shell-file-viewer-prev", key: "k", scope: "overlay", description: "previous change", handler: () => jumpChange(-1) });

  const switchSide = (next: DiffSide): void => {
    setSide(next);
    setFocusLine(null);
  };

  const marker = side === "new" ? "+" : "-";
  const sha = side === "new" ? (file.data?.sha ?? review.data?.review.headSha) : baseSha;
  const missingMessage =
    side === "old" ? "This file does not exist at the base commit. The PR adds it." : "This file does not exist at the head commit. The PR deletes it.";

  return (
    <Overlay
      name="file-viewer"
      title={displayPath}
      actions={
        <span role="group" aria-label="Revision" className={styles.toggle}>
          <button type="button" aria-pressed={side === "new"} onClick={() => switchSide("new")}>
            after
          </button>
          <button type="button" aria-pressed={side === "old"} onClick={() => switchSide("old")}>
            before
          </button>
        </span>
      }
    >
      <p className={styles.meta}>
        {side === "new" ? "after (head)" : "before (base)"}
        {sha ? ` · ${shortSha(sha)}` : ""}
        {` · ${changed.size} ${side === "new" ? "added" : "removed"} line${changed.size === 1 ? "" : "s"}`}
        {sortedChanged.length > 0 ? " · j/k jump between changes" : ""}
      </p>
      {review.error ? <p role="alert">Could not load the review: {review.error.message}</p> : null}
      {file.error ? <p role="alert">Could not load {displayPath}: {file.error.message}</p> : null}
      {file.isLoading || (side === "old" && !baseSha && !review.error) ? <p>Loading {displayPath}…</p> : null}
      {file.data && content === null ? <p>{missingMessage}</p> : null}
      {content !== null ? (
        <div ref={codeRef} className={styles.code} tabIndex={0} role="region" aria-label={`${displayPath} source`}>
          {lines.map((tokens, index) => {
            const number = index + 1;
            const isChanged = changed.has(number);
            const className = [
              styles.line,
              isChanged ? (side === "new" ? styles.added : styles.removed) : "",
              number === focusLine ? styles.focus : "",
            ].join(" ");
            return (
              <div key={number} className={className} data-line={number}>
                <span className={styles.gutter} aria-hidden="true">
                  {number}
                </span>
                <span className={styles.marker} aria-hidden="true">
                  {isChanged ? marker : " "}
                </span>
                <code className={styles.text}>
                  {isChanged ? <span className="visually-hidden">{side === "new" ? "added: " : "removed: "}</span> : null}
                  {tokens.map((token, tokenIndex) => (
                    <span key={tokenIndex} style={token.color ? { color: token.color } : undefined}>
                      {token.content}
                    </span>
                  ))}
                </code>
              </div>
            );
          })}
        </div>
      ) : null}
    </Overlay>
  );
};

/** File viewer panel (whole file at head, changed lines highlighted, before/after toggle). Renders as a fixed-position overlay; returns null while closed. */
export const FileViewer = (_props: FileViewerProps): ReactElement | null => {
  const open = useIsOverlayOpen("file-viewer");
  const [target, setTarget] = useState<OpenFileEvent | null>(null);
  const [openCount, setOpenCount] = useState(0);
  useAppEvent("open-file", (event) => {
    setTarget(event);
    setOpenCount((count) => count + 1);
    openOverlay("file-viewer");
  });
  return open && target ? <FileViewerDialog key={openCount} target={target} /> : null;
};
