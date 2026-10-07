import type { ParsedHunk } from "@shared/domain";
import { parseHunkHeader } from "./diff";

export const MAX_CHANGED_LINES_PER_HUNK = 40;

type LineKind = "context" | "add" | "del";

interface BodyLine {
  readonly kind: LineKind;
  readonly text: string;
  readonly trailers: readonly string[];
}

interface NumberedLine extends BodyLine {
  readonly oldNumber: number;
  readonly newNumber: number;
}

interface Segment {
  readonly kind: "context" | "change";
  readonly lines: readonly NumberedLine[];
}

const kindOf = (line: string): LineKind => {
  const marker = line.charAt(0);
  if (marker === "+") return "add";
  if (marker === "-") return "del";
  return "context";
};

const parseBody = (body: readonly string[]): readonly BodyLine[] => {
  const lines: BodyLine[] = [];
  body.forEach((text) => {
    const last = lines[lines.length - 1];
    if (text.startsWith("\\")) {
      if (last !== undefined) lines[lines.length - 1] = { ...last, trailers: [...last.trailers, text] };
      return;
    }
    lines.push({ kind: kindOf(text), text, trailers: [] });
  });
  return lines;
};

const isChange = (line: BodyLine): boolean => line.kind !== "context";

const toSegments = (lines: readonly NumberedLine[]): readonly Segment[] => {
  const segments: { kind: Segment["kind"]; lines: NumberedLine[] }[] = [];
  lines.forEach((line) => {
    const kind = isChange(line) ? "change" : "context";
    const last = segments[segments.length - 1];
    if (last !== undefined && last.kind === kind) last.lines.push(line);
    else segments.push({ kind, lines: [line] });
  });
  return segments;
};

const sliceBlock = (block: Segment, max: number): readonly Segment[] =>
  Array.from({ length: Math.ceil(block.lines.length / max) }, (_, index) => ({
    kind: "change" as const,
    lines: block.lines.slice(index * max, index * max + max),
  }));

const withBoundedBlocks = (segments: readonly Segment[], max: number): readonly Segment[] =>
  segments.flatMap((segment) => {
    if (segment.kind === "context" || segment.lines.length <= max) return [segment];
    return sliceBlock(segment, max).flatMap((slice, index) =>
      index === 0 ? [slice] : [{ kind: "context" as const, lines: [] }, slice],
    );
  });

const groupSegments = (segments: readonly Segment[], max: number): readonly (readonly NumberedLine[])[] => {
  const pieces: NumberedLine[][] = [];
  let current: NumberedLine[] = [];
  let changed = 0;
  segments.forEach((segment, index) => {
    if (segment.kind === "change") {
      current.push(...segment.lines);
      changed += segment.lines.length;
      return;
    }
    const nextBlock = segments[index + 1];
    if (changed === 0 || nextBlock === undefined || changed + nextBlock.lines.length <= max) {
      current.push(...segment.lines);
      return;
    }
    const cut = Math.ceil(segment.lines.length / 2);
    pieces.push([...current, ...segment.lines.slice(0, cut)]);
    current = [...segment.lines.slice(cut)];
    changed = 0;
  });
  pieces.push(current);
  return pieces;
};

const numberLines = (lines: readonly BodyLine[], oldStart: number, newStart: number): readonly NumberedLine[] => {
  const numbered: NumberedLine[] = [];
  lines.reduce(
    (cursor, line) => {
      numbered.push({ ...line, oldNumber: cursor.old, newNumber: cursor.new });
      return {
        old: cursor.old + (line.kind === "add" ? 0 : 1),
        new: cursor.new + (line.kind === "del" ? 0 : 1),
      };
    },
    { old: oldStart, new: newStart },
  );
  return numbered;
};

const formatRange = (start: number, count: number): string => (count === 1 ? `${start}` : `${start},${count}`);

const rangeFor = (piece: readonly NumberedLine[], side: "old" | "new"): { readonly start: number; readonly count: number } => {
  const excluded: LineKind = side === "old" ? "add" : "del";
  const onSide = piece.filter((line) => line.kind !== excluded);
  const firstLine = piece[0];
  const firstOnSide = onSide[0];
  if (firstOnSide !== undefined) {
    return { start: side === "old" ? firstOnSide.oldNumber : firstOnSide.newNumber, count: onSide.length };
  }
  const cursor = firstLine === undefined ? 1 : side === "old" ? firstLine.oldNumber : firstLine.newNumber;
  return { start: cursor - 1, count: 0 };
};

const buildPiece = (hunk: ParsedHunk, piece: readonly NumberedLine[], section: string): ParsedHunk => {
  const oldRange = rangeFor(piece, "old");
  const newRange = rangeFor(piece, "new");
  const header = `@@ -${formatRange(oldRange.start, oldRange.count)} +${formatRange(newRange.start, newRange.count)} @@${section}`;
  return {
    ...hunk,
    oldStart: oldRange.start,
    oldLines: oldRange.count,
    newStart: newRange.start,
    newLines: newRange.count,
    patchText: [header, ...piece.flatMap((line) => [line.text, ...line.trailers])].join("\n"),
  };
};

/** Number of added plus removed lines in a hunk's patch text. */
export const countChangedLines = (patchText: string): number =>
  patchText
    .split("\n")
    .slice(1)
    .filter((line) => line.startsWith("+") || line.startsWith("-")).length;

const splitHunk = (hunk: ParsedHunk, max: number): readonly ParsedHunk[] => {
  const [headerLine, ...body] = hunk.patchText.split("\n");
  const header = headerLine === undefined ? null : parseHunkHeader(headerLine);
  if (header === null) return [hunk];
  const numbered = numberLines(
    parseBody(body),
    header.oldLines === 0 ? header.oldStart + 1 : header.oldStart,
    header.newLines === 0 ? header.newStart + 1 : header.newStart,
  );
  return groupSegments(withBoundedBlocks(toSegments(numbered), max), max)
    .filter((piece) => piece.some(isChange))
    .map((piece) => buildPiece(hunk, piece, header.section));
};

/** Splits hunks with more than `maxChangedLines` added+removed lines at context boundaries, keeping valid @@ headers. */
export const splitLargeHunks = (
  hunks: readonly ParsedHunk[],
  maxChangedLines: number = MAX_CHANGED_LINES_PER_HUNK,
): readonly ParsedHunk[] => {
  if (!Number.isInteger(maxChangedLines) || maxChangedLines < 1) {
    throw new Error(`splitLargeHunks: maxChangedLines must be a positive integer, got ${maxChangedLines}`);
  }
  return hunks.flatMap((hunk) => (countChangedLines(hunk.patchText) > maxChangedLines ? splitHunk(hunk, maxChangedLines) : [hunk]));
};
