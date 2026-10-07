import { diffWordsWithSpace } from "diff";
import type { DiffSide, Hunk } from "@shared/domain";
import type { HighlightedLine, SyntaxKind } from "../../../lib/highlight";

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
  readonly oldIndex: number | null;
  readonly newIndex: number | null;
  readonly noNewlineAtEof: boolean;
}

export interface ParsedPatch {
  readonly header: string | null;
  readonly lines: readonly DiffLine[];
  readonly oldSide: readonly string[];
  readonly newSide: readonly string[];
}

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface DiffRow {
  readonly line: DiffLine;
  readonly changes: readonly TextRange[];
}

export type DiffSegment =
  | { readonly type: "context"; readonly row: DiffRow }
  | { readonly type: "change"; readonly dels: readonly DiffRow[]; readonly adds: readonly DiffRow[] };

export interface SplitRow {
  readonly left: DiffRow | null;
  readonly right: DiffRow | null;
}

const HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

interface ParseState {
  readonly lines: readonly DiffLine[];
  readonly oldSide: readonly string[];
  readonly newSide: readonly string[];
  readonly oldNumber: number;
  readonly newNumber: number;
}

const markNoNewline = (lines: readonly DiffLine[]): readonly DiffLine[] => {
  const last = lines.at(-1);
  return last ? [...lines.slice(0, -1), { ...last, noNewlineAtEof: true }] : lines;
};

const parseLine = (state: ParseState, raw: string): ParseState => {
  if (raw.startsWith("\\")) return { ...state, lines: markNoNewline(state.lines) };
  const marker = raw[0];
  const text = raw.slice(1);
  if (marker === "+") {
    return {
      ...state,
      lines: [
        ...state.lines,
        { kind: "add", text, oldNumber: null, newNumber: state.newNumber, oldIndex: null, newIndex: state.newSide.length, noNewlineAtEof: false },
      ],
      newSide: [...state.newSide, text],
      newNumber: state.newNumber + 1,
    };
  }
  if (marker === "-") {
    return {
      ...state,
      lines: [
        ...state.lines,
        { kind: "del", text, oldNumber: state.oldNumber, newNumber: null, oldIndex: state.oldSide.length, newIndex: null, noNewlineAtEof: false },
      ],
      oldSide: [...state.oldSide, text],
      oldNumber: state.oldNumber + 1,
    };
  }
  const contextText = marker === " " ? text : raw;
  return {
    lines: [
      ...state.lines,
      {
        kind: "context",
        text: contextText,
        oldNumber: state.oldNumber,
        newNumber: state.newNumber,
        oldIndex: state.oldSide.length,
        newIndex: state.newSide.length,
        noNewlineAtEof: false,
      },
    ],
    oldSide: [...state.oldSide, contextText],
    newSide: [...state.newSide, contextText],
    oldNumber: state.oldNumber + 1,
    newNumber: state.newNumber + 1,
  };
};

/** Parses a hunk's patch text into numbered lines. Line numbers come from the hunk, not the header. */
export const parsePatch = (hunk: Pick<Hunk, "patchText" | "oldStart" | "newStart">): ParsedPatch => {
  const rawLines = hunk.patchText.replace(/\r\n/g, "\n").split("\n");
  const first = rawLines[0] ?? "";
  const header = HEADER_PATTERN.test(first) ? first : null;
  const body = (header === null ? rawLines : rawLines.slice(1)).filter(
    (line, index, all) => !(line === "" && index === all.length - 1),
  );
  const isDiffBody = body.every((line) => line === "" || [" ", "+", "-", "\\"].includes(line[0] ?? ""));
  if (!isDiffBody) return { header, lines: [], oldSide: [], newSide: [] };
  const initial: ParseState = {
    lines: [],
    oldSide: [],
    newSide: [],
    oldNumber: Math.max(1, hunk.oldStart),
    newNumber: Math.max(1, hunk.newStart),
  };
  const final = body.reduce(parseLine, initial);
  return { header, lines: final.lines, oldSide: final.oldSide, newSide: final.newSide };
};

const compact = (text: string): string => text.replace(/\s+/g, "");

const mergeRanges = (ranges: readonly TextRange[]): readonly TextRange[] =>
  ranges.reduce<readonly TextRange[]>((merged, range) => {
    const last = merged.at(-1);
    if (last && last.end >= range.start) return [...merged.slice(0, -1), { start: last.start, end: Math.max(last.end, range.end) }];
    return [...merged, range];
  }, []);

/**
 * Word-level changed ranges for a removed/added line pair. Returns null when the lines share no
 * non-whitespace text, since highlighting every word of an unrelated pair adds only noise.
 */
export const wordDiffRanges = (
  oldText: string,
  newText: string,
  ignoreWhitespace: boolean,
): { readonly old: readonly TextRange[]; readonly new: readonly TextRange[] } | null => {
  const changes = diffWordsWithSpace(oldText, newText);
  const shared = changes.filter((change) => !change.added && !change.removed).some((change) => change.value.trim() !== "");
  if (!shared) return null;
  const initial = { oldOffset: 0, newOffset: 0, old: [] as readonly TextRange[], new: [] as readonly TextRange[] };
  const result = changes.reduce((acc, change) => {
    const length = change.value.length;
    const keep = !(ignoreWhitespace && change.value.trim() === "");
    if (change.removed) {
      return {
        ...acc,
        oldOffset: acc.oldOffset + length,
        old: keep ? [...acc.old, { start: acc.oldOffset, end: acc.oldOffset + length }] : acc.old,
      };
    }
    if (change.added) {
      return {
        ...acc,
        newOffset: acc.newOffset + length,
        new: keep ? [...acc.new, { start: acc.newOffset, end: acc.newOffset + length }] : acc.new,
      };
    }
    return { ...acc, oldOffset: acc.oldOffset + length, newOffset: acc.newOffset + length };
  }, initial);
  return { old: mergeRanges(result.old), new: mergeRanges(result.new) };
};

interface PendingChange {
  readonly dels: readonly DiffLine[];
  readonly adds: readonly DiffLine[];
}

interface PairState {
  readonly segments: readonly DiffSegment[];
  readonly dels: readonly DiffRow[];
  readonly adds: readonly DiffRow[];
}

const contextSegment = (line: DiffLine): DiffSegment => ({ type: "context", row: { line, changes: [] } });

const flushPairs = (state: PairState): readonly DiffSegment[] =>
  state.dels.length + state.adds.length === 0 ? state.segments : [...state.segments, { type: "change", dels: state.dels, adds: state.adds }];

const plainRow = (line: DiffLine): DiffRow => ({ line, changes: [] });

const pairRows = (change: PendingChange, ignoreWhitespace: boolean): readonly DiffSegment[] => {
  const pairCount = Math.min(change.dels.length, change.adds.length);
  const initial: PairState = { segments: [], dels: [], adds: [] };
  const paired = change.dels.slice(0, pairCount).reduce((state: PairState, del: DiffLine, index: number): PairState => {
    const add = change.adds[index];
    if (!add) return state;
    if (ignoreWhitespace && compact(del.text) === compact(add.text)) {
      const merged: DiffLine = { ...add, kind: "context", oldNumber: del.oldNumber, oldIndex: del.oldIndex };
      return { segments: [...flushPairs(state), contextSegment(merged)], dels: [], adds: [] };
    }
    const ranges = wordDiffRanges(del.text, add.text, ignoreWhitespace);
    return {
      segments: state.segments,
      dels: [...state.dels, { line: del, changes: ranges?.old ?? [] }],
      adds: [...state.adds, { line: add, changes: ranges?.new ?? [] }],
    };
  }, initial);
  return flushPairs({
    segments: paired.segments,
    dels: [...paired.dels, ...change.dels.slice(pairCount).map(plainRow)],
    adds: [...paired.adds, ...change.adds.slice(pairCount).map(plainRow)],
  });
};

interface SegmentState {
  readonly segments: readonly DiffSegment[];
  readonly pending: PendingChange;
}

const EMPTY_CHANGE: PendingChange = { dels: [], adds: [] };

/** Groups lines into context rows and change blocks, pairing removed/added lines for word highlights. */
export const buildSegments = (lines: readonly DiffLine[], ignoreWhitespace: boolean): readonly DiffSegment[] => {
  const flush = (state: SegmentState): readonly DiffSegment[] =>
    state.pending.dels.length + state.pending.adds.length === 0 ? state.segments : [...state.segments, ...pairRows(state.pending, ignoreWhitespace)];
  const initial: SegmentState = { segments: [], pending: EMPTY_CHANGE };
  const result = lines.reduce((state: SegmentState, line: DiffLine): SegmentState => {
    if (line.kind === "context") return { segments: [...flush(state), contextSegment(line)], pending: EMPTY_CHANGE };
    if (line.kind === "del" && state.pending.adds.length > 0) return { segments: flush(state), pending: { dels: [line], adds: [] } };
    return {
      segments: state.segments,
      pending:
        line.kind === "del"
          ? { dels: [...state.pending.dels, line], adds: state.pending.adds }
          : { dels: state.pending.dels, adds: [...state.pending.adds, line] },
    };
  }, initial);
  return flush(result);
};

/** Rows for the unified layout: context in place, then each block's removed lines followed by its added lines. */
export const unifiedRows = (segments: readonly DiffSegment[]): readonly DiffRow[] =>
  segments.flatMap((segment) => (segment.type === "context" ? [segment.row] : [...segment.dels, ...segment.adds]));

/** Rows for the split layout: removed lines on the left, added lines on the right, context on both sides. */
export const splitRows = (segments: readonly DiffSegment[]): readonly SplitRow[] =>
  segments.flatMap((segment): readonly SplitRow[] => {
    if (segment.type === "context") return [{ left: segment.row, right: segment.row }];
    const length = Math.max(segment.dels.length, segment.adds.length);
    return Array.from({ length }, (_, index) => ({ left: segment.dels[index] ?? null, right: segment.adds[index] ?? null }));
  });

/** The side a unified row belongs to for line numbers and token clicks. */
export const sideOfLine = (line: DiffLine): DiffSide => (line.kind === "del" ? "old" : "new");

export const numberOnSide = (line: DiffLine, side: DiffSide): number | null => (side === "old" ? line.oldNumber : line.newNumber);

const KEYWORDS: ReadonlySet<string> = new Set([
  "abstract", "and", "as", "assert", "async", "await", "boolean", "break", "case", "catch", "class", "const", "continue",
  "declare", "def", "default", "defer", "del", "delete", "do", "elif", "else", "enum", "except", "export", "extends", "false",
  "final", "finally", "fn", "for", "from", "func", "function", "go", "if", "impl", "implements", "import", "in", "infer",
  "instanceof", "interface", "is", "keyof", "let", "match", "mod", "module", "mut", "namespace", "never", "new", "nil", "None",
  "not", "null", "number", "object", "of", "or", "override", "package", "pass", "private", "protected", "pub", "public",
  "readonly", "return", "satisfies", "self", "static", "string", "struct", "super", "switch", "symbol", "this", "throw",
  "throws", "trait", "True", "False", "true", "try", "type", "typeof", "undefined", "unknown", "use", "var", "void", "where",
  "while", "with", "yield",
]);

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

/** Ranges of identifier-like words in a line, skipping language keywords and words glued to digits. */
export const identifierRanges = (text: string): readonly TextRange[] =>
  [...text.matchAll(IDENTIFIER)]
    .filter((match) => {
      const before = match.index > 0 ? (text[match.index - 1] ?? "") : "";
      return !/[\w$]/.test(before) && !KEYWORDS.has(match[0]);
    })
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));

export interface CodePiece {
  readonly text: string;
  readonly start: number;
  readonly color: string | undefined;
  readonly fontStyle: "italic" | "bold" | "underline" | undefined;
  readonly changed: boolean;
}

export interface CodeGroup {
  readonly identifier: string | null;
  readonly pieces: readonly CodePiece[];
}

interface StyledRange extends TextRange {
  readonly color: string | undefined;
  readonly fontStyle: "italic" | "bold" | "underline" | undefined;
  readonly syntax: SyntaxKind | undefined;
}

const styledRanges = (text: string, highlight: HighlightedLine | null): readonly StyledRange[] => {
  const total = highlight?.reduce((sum, token) => sum + token.content.length, 0);
  if (!highlight || total !== text.length) return [];
  return highlight.reduce<{ readonly offset: number; readonly ranges: readonly StyledRange[] }>(
    (acc, token) => ({
      offset: acc.offset + token.content.length,
      ranges: [
        ...acc.ranges,
        { start: acc.offset, end: acc.offset + token.content.length, color: token.color, fontStyle: token.fontStyle, syntax: token.syntax },
      ],
    }),
    { offset: 0, ranges: [] },
  ).ranges;
};

const contains = (ranges: readonly TextRange[], offset: number): number => ranges.findIndex((range) => range.start <= offset && offset < range.end);

/**
 * Splits a line into render groups: each identifier outside comments and strings becomes its own group (rendered as a clickable token),
 * and every piece carries its syntax colour and whether it is part of a word-level change.
 */
export const buildCodeGroups = (text: string, highlight: HighlightedLine | null, changes: readonly TextRange[]): readonly CodeGroup[] => {
  if (text === "") return [];
  const styles = styledRanges(text, highlight);
  const identifiers = identifierRanges(text).filter((range) => styles[contains(styles, range.start)]?.syntax === undefined);
  const boundaries = [
    ...new Set([0, text.length, ...[...styles, ...identifiers, ...changes].flatMap((range) => [range.start, range.end])]),
  ]
    .filter((offset) => offset >= 0 && offset <= text.length)
    .sort((a, b) => a - b);
  const pieces = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1] ?? text.length;
    const style = styles[contains(styles, start)];
    return {
      piece: {
        text: text.slice(start, end),
        start,
        color: style?.color,
        fontStyle: style?.fontStyle,
        changed: contains(changes, start) !== -1,
      },
      identifierIndex: contains(identifiers, start),
    };
  });
  return pieces.reduce<{ readonly groups: readonly CodeGroup[]; readonly lastIdentifier: number }>(
    (acc, { piece, identifierIndex }) => {
      const last = acc.groups.at(-1);
      const sameIdentifier = identifierIndex !== -1 && identifierIndex === acc.lastIdentifier && last;
      if (sameIdentifier) {
        return { groups: [...acc.groups.slice(0, -1), { ...last, pieces: [...last.pieces, piece] }], lastIdentifier: identifierIndex };
      }
      const range = identifiers[identifierIndex];
      const identifier = range ? text.slice(range.start, range.end) : null;
      return { groups: [...acc.groups, { identifier, pieces: [piece] }], lastIdentifier: identifierIndex };
    },
    { groups: [], lastIdentifier: -1 },
  ).groups;
};
