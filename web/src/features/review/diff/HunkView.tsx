import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { ContextLinesQuery, ContextLinesResponse } from "@shared/api";
import type { DiffLayout, DiffSide, Finding, Hunk, Severity } from "@shared/domain";
import { useContextLines } from "../../../api/queries";
import { appEvents } from "../../../bus/events";
import { languageForPath } from "../../../lib/highlight";
import { FindingCard } from "../FindingCard";
import { SideCells, type CellContext } from "./CodeCells";
import { findingsEndingAt, rangeSeverityAt, splitHunkFindings } from "./findings";
import { buildSegments, parsePatch, sideOfLine, splitRows, unifiedRows, type DiffLine, type DiffRow } from "./model";
import { useHighlightedLines } from "./useHighlight";
import styles from "./DiffView.module.css";

export const CONTEXT_STEP = 20;

export interface ContextCommand {
  readonly mode: "expand" | "collapse";
  readonly seq: number;
}

const CHANGE_LABELS = { added: "added", modified: "modified", deleted: "deleted", renamed: "renamed" } as const;

interface ContextSource {
  readonly side: DiffSide;
  readonly sha: string;
  readonly path: string;
  readonly firstLine: number;
  readonly lastLine: number;
  readonly otherFirst: number | null;
  readonly otherLast: number | null;
}

const spanOf = (start: number, count: number): { readonly first: number; readonly last: number } => {
  const first = count === 0 ? start + 1 : start;
  return { first, last: first + count - 1 };
};

const contextSource = (hunk: Hunk, baseSha: string, headSha: string): ContextSource => {
  const oldSpan = spanOf(hunk.oldStart, hunk.oldLines);
  const newSpan = spanOf(hunk.newStart, hunk.newLines);
  if (hunk.changeType === "deleted") {
    return { side: "old", sha: baseSha, path: hunk.oldFilePath ?? hunk.filePath, firstLine: oldSpan.first, lastLine: oldSpan.last, otherFirst: null, otherLast: null };
  }
  const hasOld = hunk.changeType !== "added";
  return {
    side: "new",
    sha: headSha,
    path: hunk.filePath,
    firstLine: newSpan.first,
    lastLine: newSpan.last,
    otherFirst: hasOld ? oldSpan.first : null,
    otherLast: hasOld ? oldSpan.last : null,
  };
};

const contextRows = (
  response: ContextLinesResponse | undefined,
  source: ContextSource,
  anchor: "above" | "below",
): readonly DiffRow[] =>
  (response?.lines ?? []).map((sourceLine, index): DiffRow => {
    const other =
      anchor === "above"
        ? source.otherFirst === null
          ? null
          : sourceLine.number - source.firstLine + source.otherFirst
        : source.otherLast === null
          ? null
          : sourceLine.number - source.lastLine + source.otherLast;
    const line: DiffLine = {
      kind: "context",
      text: sourceLine.text,
      oldNumber: source.side === "old" ? sourceLine.number : other,
      newNumber: source.side === "new" ? sourceLine.number : other,
      oldIndex: index,
      newIndex: index,
      noNewlineAtEof: false,
    };
    return { line, changes: [] };
  });

export interface HunkViewProps {
  readonly reviewId: string;
  readonly hunk: Hunk;
  readonly baseSha: string;
  readonly headSha: string;
  readonly layout: DiffLayout;
  readonly hideWhitespace: boolean;
  readonly contextCommand: ContextCommand;
  readonly findings?: readonly Finding[];
}

const NO_FINDINGS: readonly Finding[] = [];

const FindingRows = ({ findings, columns }: { readonly findings: readonly Finding[]; readonly columns: number }): ReactElement | null =>
  findings.length === 0 ? null : (
    <>
      {findings.map((finding) => (
        <tr key={`f-${finding.id}`} className={styles.findingRow}>
          <td colSpan={columns}>
            <FindingCard finding={finding} headingLevel={4} />
          </td>
        </tr>
      ))}
    </>
  );

interface ExpandRowProps {
  readonly label: string;
  readonly direction: "above" | "below";
  readonly columns: number;
  readonly loading: boolean;
  readonly onExpand: () => void;
}

const ExpandRow = ({ label, direction, columns, loading, onExpand }: ExpandRowProps): ReactElement => (
  <tr className={styles.expandRow}>
    <td colSpan={columns}>
      <button type="button" className={styles.expand} onClick={onExpand} disabled={loading} aria-label={label}>
        {direction === "above" ? "↑" : "↓"} {loading ? "loading…" : `expand ${CONTEXT_STEP} lines`}
      </button>
    </td>
  </tr>
);

const ErrorRow = ({ message, columns }: { readonly message: string; readonly columns: number }): ReactElement => (
  <tr>
    <td colSpan={columns} role="alert" className={styles.error}>
      Could not load context lines: {message}
    </td>
  </tr>
);

/** One hunk: file header, @@ header, rows in the chosen layout, and expandable context above and below. */
export const HunkView = ({ reviewId, hunk, baseSha, headSha, layout, hideWhitespace, contextCommand, findings = NO_FINDINGS }: HunkViewProps): ReactElement => {
  const parsed = useMemo(() => parsePatch(hunk), [hunk]);
  const segments = useMemo(() => buildSegments(parsed.lines, hideWhitespace), [parsed, hideWhitespace]);
  const bodyRows = useMemo(() => unifiedRows(segments), [segments]);
  const placed = useMemo(() => splitHunkFindings(findings, hunk, bodyRows.map((row) => row.line)), [findings, hunk, bodyRows]);
  const language = languageForPath(hunk.filePath);
  const oldHighlight = useHighlightedLines(parsed.oldSide, language);
  const newHighlight = useHighlightedLines(parsed.newSide, language);

  const source = useMemo(() => contextSource(hunk, baseSha, headSha), [hunk, baseSha, headSha]);
  const [above, setAbove] = useState(0);
  const [below, setBelow] = useState(0);
  const [totalLines, setTotalLines] = useState<number | null>(null);

  const aboveQuery: ContextLinesQuery | null =
    above > 0 && source.firstLine > 1
      ? { path: source.path, sha: source.sha, start: Math.max(1, source.firstLine - above), end: source.firstLine - 1 }
      : null;
  const belowEnd = totalLines === null ? source.lastLine + below : Math.min(totalLines, source.lastLine + below);
  const belowQuery: ContextLinesQuery | null =
    below > 0 && belowEnd > source.lastLine ? { path: source.path, sha: source.sha, start: source.lastLine + 1, end: belowEnd } : null;

  const aboveResult = useContextLines(reviewId, aboveQuery);
  const belowResult = useContextLines(reviewId, belowQuery);

  useEffect(() => {
    const total = belowResult.data?.totalLines ?? aboveResult.data?.totalLines;
    if (total !== undefined) setTotalLines(total);
  }, [aboveResult.data?.totalLines, belowResult.data?.totalLines]);

  const aboveRows = useMemo(() => contextRows(aboveResult.data, source, "above"), [aboveResult.data, source]);
  const belowRows = useMemo(() => contextRows(belowResult.data, source, "below"), [belowResult.data, source]);
  const aboveHighlight = useHighlightedLines(useMemo(() => aboveRows.map((row) => row.line.text), [aboveRows]), language);
  const belowHighlight = useHighlightedLines(useMemo(() => belowRows.map((row) => row.line.text), [belowRows]), language);

  const canExpandAbove = hunk.present && source.firstLine - above > 1;
  const belowExhausted =
    totalLines !== null ? source.lastLine + below >= totalLines : belowResult.data !== undefined && belowResult.data.lines.length < below;
  const canExpandBelow = hunk.present && !belowExhausted;

  const expandAbove = useCallback(() => setAbove((value) => value + CONTEXT_STEP), []);
  const expandBelow = useCallback(() => setBelow((value) => value + CONTEXT_STEP), []);
  const collapse = useCallback(() => {
    setAbove(0);
    setBelow(0);
  }, []);
  const expanded = above > 0 || below > 0;
  const fileNameRef = useRef<HTMLButtonElement>(null);

  const mountedSeq = useRef(contextCommand.seq);
  useEffect(() => {
    if (contextCommand.seq === mountedSeq.current) return;
    if (contextCommand.mode === "collapse") {
      collapse();
      return;
    }
    if (!hunk.present) return;
    expandAbove();
    expandBelow();
  }, [contextCommand, hunk.present, expandAbove, expandBelow, collapse]);

  const oldPath = hunk.oldFilePath ?? hunk.filePath;
  const cellContext: CellContext = useMemo(
    () => ({
      oldPath,
      newPath: hunk.filePath,
      highlightFor: (row: DiffRow, side: DiffSide) => {
        if (aboveRows.includes(row)) return aboveHighlight?.[row.line.newIndex ?? -1] ?? null;
        if (belowRows.includes(row)) return belowHighlight?.[row.line.newIndex ?? -1] ?? null;
        const index = side === "old" ? row.line.oldIndex : row.line.newIndex;
        const lines = side === "old" ? oldHighlight : newHighlight;
        return index === null ? null : (lines?.[index] ?? null);
      },
    }),
    [oldPath, hunk.filePath, aboveRows, belowRows, aboveHighlight, belowHighlight, oldHighlight, newHighlight],
  );

  const columns = layout === "split" ? 6 : 4;
  const rowClass = (severity: Severity | null): string => (severity === null ? (styles.row ?? "") : `${styles.row ?? ""} ${styles[`marked_${severity}`] ?? ""}`);
  const renderRow = (row: DiffRow, key: string, severity: Severity | null = null): ReactElement =>
    layout === "split" ? (
      <tr key={key} className={rowClass(severity)}>
        <SideCells row={row.line.kind === "add" ? null : row} side="old" context={cellContext} />
        <SideCells row={row.line.kind === "del" ? null : row} side="new" context={cellContext} />
      </tr>
    ) : (
      <tr key={key} className={rowClass(severity)}>
        <SideCells row={row} side={sideOfLine(row.line)} context={cellContext} showOtherNumber />
      </tr>
    );

  const body =
    layout === "split"
      ? splitRows(segments).flatMap((pair, index) => [
          <tr key={`r${index}`} className={rowClass(rangeSeverityAt([pair.left?.line ?? null, pair.right?.line ?? null], placed.atLine))}>
            <SideCells row={pair.left} side="old" context={cellContext} />
            <SideCells row={pair.right} side="new" context={cellContext} />
          </tr>,
          <FindingRows
            key={`f${index}`}
            columns={columns}
            findings={[
              ...findingsEndingAt(pair.left?.line ?? null, "old", placed.atLine),
              ...findingsEndingAt(pair.right?.line ?? null, "new", placed.atLine),
            ]}
          />,
        ])
      : bodyRows.flatMap((row, index) => [
          renderRow(row, `r${index}`, rangeSeverityAt([row.line], placed.atLine)),
          <FindingRows
            key={`f${index}`}
            columns={columns}
            findings={[...findingsEndingAt(row.line, "old", placed.atLine), ...findingsEndingAt(row.line, "new", placed.atLine)]}
          />,
        ]);

  const openFile = (): void =>
    appEvents.emit("open-file", {
      reviewId,
      path: hunk.filePath,
      oldPath: hunk.oldFilePath,
      line: hunk.changeType === "deleted" ? source.firstLine : spanOf(hunk.newStart, hunk.newLines).first,
      side: source.side,
    });

  const rangeLabel = `lines ${source.firstLine}–${Math.max(source.firstLine, source.lastLine)}`;

  return (
    <div role="group" aria-label={`${hunk.filePath}, ${rangeLabel}`} className={`${styles.hunk}${hunk.present ? "" : ` ${styles.gone}`}`}>
      <div className={styles.fileHeader}>
        <span className={`${styles.badge} ${styles[`change_${hunk.changeType}`] ?? ""}`}>{CHANGE_LABELS[hunk.changeType]}</span>
        <button ref={fileNameRef} type="button" className={styles.fileName} onClick={openFile} aria-label={`Open file ${hunk.filePath}`}>
          {hunk.filePath}
        </button>
        {hunk.oldFilePath && hunk.oldFilePath !== hunk.filePath ? <span className={styles.muted}>from {hunk.oldFilePath}</span> : null}
        {hunk.present ? null : <span className={styles.goneLabel}>no longer in PR</span>}
        {expanded ? (
          <button
            type="button"
            className={styles.collapse}
            onClick={() => {
              collapse();
              fileNameRef.current?.focus();
            }}
            aria-label={`Hide expanded lines in ${hunk.filePath}`}
          >
            ↕ hide expanded lines
          </button>
        ) : null}
      </div>
      <div className={styles.scroll}>
        <table className={`${styles.table} ${layout === "split" ? styles.split : styles.unified}`} aria-label={`Diff of ${hunk.filePath}, ${rangeLabel}`}>
          {layout === "split" ? (
            <colgroup>
              <col className={styles.numberCol} />
              <col className={styles.markerCol} />
              <col />
              <col className={styles.numberCol} />
              <col className={styles.markerCol} />
              <col />
            </colgroup>
          ) : null}
          <tbody>
            {canExpandAbove ? (
              <ExpandRow
                label={`Show ${CONTEXT_STEP} more lines above in ${hunk.filePath}`}
                direction="above"
                columns={columns}
                loading={aboveResult.isFetching}
                onExpand={expandAbove}
              />
            ) : null}
            {aboveResult.error ? <ErrorRow message={aboveResult.error.message} columns={columns} /> : null}
            {aboveRows.map((row, index) => renderRow(row, `a${index}`))}
            <tr className={styles.hunkHeader}>
              <td colSpan={columns}>{parsed.header ?? `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</td>
            </tr>
            <FindingRows findings={placed.atHunk} columns={columns} />
            {parsed.lines.length === 0 ? (
              <tr>
                <td colSpan={columns} className={styles.muted}>
                  No text changes to show (binary file or mode change).
                </td>
              </tr>
            ) : (
              body
            )}
            {belowRows.map((row, index) => renderRow(row, `b${index}`))}
            {belowResult.error ? <ErrorRow message={belowResult.error.message} columns={columns} /> : null}
            {canExpandBelow ? (
              <ExpandRow
                label={`Show ${CONTEXT_STEP} more lines below in ${hunk.filePath}`}
                direction="below"
                columns={columns}
                loading={belowResult.isFetching}
                onExpand={expandBelow}
              />
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
};
