import type { DiffSide } from "@shared/domain";
import type { CodeSelection } from "../../../bus/events";

export interface SelectedCell {
  readonly file: string;
  readonly side: DiffSide;
  readonly line: number;
}

/**
 * Reduces the code cells a selection touches to one file, side and line range.
 * Prefers the new side unless every touched line is a removed line.
 */
export const selectionFromCells = (
  cells: readonly SelectedCell[],
  text: string,
  location: { readonly reviewId: string; readonly chunkId: string | null },
): CodeSelection | null => {
  if (cells.length === 0 || text.trim() === "") return null;
  const side: DiffSide = cells.every((cell) => cell.side === "old") ? "old" : "new";
  const onSide = cells.filter((cell) => cell.side === side);
  const file = onSide[0]?.file;
  if (file === undefined) return null;
  const lines = onSide.filter((cell) => cell.file === file).map((cell) => cell.line);
  return {
    reviewId: location.reviewId,
    chunkId: location.chunkId,
    filePath: file,
    side,
    startLine: Math.min(...lines),
    endLine: Math.max(...lines),
    text,
  };
};

/** Reads file, side and line from a `[data-code]` cell, or null when the cell has no line number. */
export const readCell = (element: Element): SelectedCell | null => {
  if (!(element instanceof HTMLElement)) return null;
  const { file, side, line } = element.dataset;
  const number = Number(line);
  if (!file || (side !== "old" && side !== "new") || !Number.isInteger(number) || number < 1) return null;
  return { file, side, line: number };
};

/** Maps the document selection inside `root` to a CodeSelection, or null when nothing in the diff is selected. */
export const selectionInDiff = (
  root: HTMLElement,
  selection: Selection | null,
  location: { readonly reviewId: string; readonly chunkId: string | null },
): CodeSelection | null => {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const cells = [...root.querySelectorAll("[data-code]")]
    .filter((cell) => range.intersectsNode(cell))
    .map(readCell)
    .filter((cell): cell is SelectedCell => cell !== null);
  return selectionFromCells(cells, selection.toString(), location);
};
