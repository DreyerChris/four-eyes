import { memo, type CSSProperties, type ReactElement } from "react";
import type { DiffSide } from "@shared/domain";
import type { HighlightedLine } from "../../../lib/highlight";
import { buildCodeGroups, numberOnSide, type CodePiece, type DiffRow } from "./model";
import styles from "./DiffView.module.css";

const MARKERS = { add: "+", del: "-", context: " " } as const;
const KIND_CLASS = { add: styles.add, del: styles.del, context: styles.context } as const;

const pieceStyle = (piece: CodePiece): CSSProperties | undefined =>
  piece.color || piece.fontStyle
    ? {
        color: piece.changed ? undefined : piece.color,
        fontStyle: piece.fontStyle === "italic" ? "italic" : undefined,
        fontWeight: piece.fontStyle === "bold" ? 700 : undefined,
        textDecoration: piece.fontStyle === "underline" ? "underline" : undefined,
      }
    : undefined;

const Piece = ({ piece }: { readonly piece: CodePiece }): ReactElement => (
  <span className={piece.changed ? styles.word : undefined} style={pieceStyle(piece)}>
    {piece.text}
  </span>
);

interface CodeTextProps {
  readonly text: string;
  readonly highlight: HighlightedLine | null;
  readonly row: DiffRow;
}

const CodeText = memo(({ text, highlight, row }: CodeTextProps): ReactElement => (
  <>
    {buildCodeGroups(text, highlight, row.changes).flatMap((group) =>
      group.identifier === null
        ? group.pieces.map((piece) => <Piece key={piece.start} piece={piece} />)
        : [
            <span key={group.pieces[0]?.start ?? 0} role="button" tabIndex={-1} className={styles.token} data-token={group.identifier}>
              {group.pieces.map((piece) => (
                <Piece key={piece.start} piece={piece} />
              ))}
            </span>,
          ],
    )}
  </>
));
CodeText.displayName = "CodeText";

export interface CellContext {
  readonly oldPath: string;
  readonly newPath: string;
  readonly highlightFor: (row: DiffRow, side: DiffSide) => HighlightedLine | null;
}

export interface SideCellsProps {
  readonly row: DiffRow | null;
  readonly side: DiffSide;
  readonly context: CellContext;
  readonly showOtherNumber?: boolean;
}

/** Line number, +/- marker and code cells for one side of a row. In unified mode both numbers are shown. */
export const SideCells = ({ row, side, context, showOtherNumber = false }: SideCellsProps): ReactElement => {
  if (row === null) {
    return (
      <>
        <td className={`${styles.number} ${styles.empty}`} />
        <td className={`${styles.marker} ${styles.empty}`} />
        <td className={`${styles.code} ${styles.empty}`} />
      </>
    );
  }
  const { line } = row;
  const kindClass = KIND_CLASS[line.kind];
  const number = numberOnSide(line, side);
  const file = side === "old" ? context.oldPath : context.newPath;
  return (
    <>
      {showOtherNumber ? <td className={`${styles.number} ${kindClass}`} data-n={line.oldNumber ?? ""} /> : null}
      <td className={`${styles.number} ${kindClass}`} data-n={(showOtherNumber ? line.newNumber : number) ?? ""} />
      <td className={`${styles.marker} ${kindClass}`} data-marker={MARKERS[line.kind]} />
      <td
        className={`${styles.code} ${kindClass}${line.noNewlineAtEof ? ` ${styles.noEol}` : ""}`}
        data-code=""
        data-file={file}
        data-side={side}
        data-line={number ?? ""}
      >
        <CodeText text={line.text} highlight={context.highlightFor(row, side)} row={row} />
      </td>
    </>
  );
};
