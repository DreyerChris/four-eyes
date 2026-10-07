import type { Hunk } from "@shared/domain";
import type { FingerprintedHunk } from "../ingest/types";

export interface HunkMatchResult {
  readonly matched: readonly { readonly previous: Hunk; readonly next: FingerprintedHunk }[];
  readonly added: readonly FingerprintedHunk[];
  readonly missing: readonly Hunk[];
}

type Pair = HunkMatchResult["matched"][number];

interface PassState {
  readonly pairs: readonly Pair[];
  readonly unusedPrevious: readonly Hunk[];
}

/** The changed (+/-) lines of a hunk without its @@ header, context lines or line numbers. */
export const changedLinesSignature = (patchText: string): string =>
  patchText
    .split("\n")
    .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"))
    .join("\n");

const isChangedLine = (line: string): boolean => line.startsWith("+") || line.startsWith("-");

/** The changed lines plus the unchanged lines between them and one unchanged line on each side. */
export const placementSignature = (patchText: string): string => {
  const body = patchText
    .split("\n")
    .slice(1)
    .filter((line) => !line.startsWith("\\"));
  const first = body.findIndex(isChangedLine);
  if (first === -1) return "";
  const last = body.findLastIndex(isChangedLine);
  return body.slice(Math.max(0, first - 1), last + 2).join("\n");
};

const samePlacement = (previous: Hunk, next: FingerprintedHunk): boolean =>
  placementSignature(previous.patchText) === placementSignature(next.patchText);

const byPresenceThenPosition = (a: Hunk, b: Hunk): number =>
  Number(b.present) - Number(a.present) || a.position - b.position;

const isRenameOf = (previous: Hunk, next: FingerprintedHunk): boolean =>
  (next.oldFilePath !== null && next.oldFilePath === previous.filePath) ||
  (previous.oldFilePath !== null && previous.oldFilePath === next.filePath) ||
  (previous.oldFilePath !== null && previous.oldFilePath === next.oldFilePath);

const runPass = (
  state: PassState,
  candidates: readonly FingerprintedHunk[],
  isMatch: (previous: Hunk, next: FingerprintedHunk) => boolean,
): PassState =>
  candidates.reduce<PassState>((acc, next) => {
    const previous = acc.unusedPrevious.find((candidate) => isMatch(candidate, next));
    return previous === undefined
      ? acc
      : {
          pairs: [...acc.pairs, { previous, next }],
          unusedPrevious: acc.unusedPrevious.filter((candidate) => candidate !== previous),
        };
  }, state);

/**
 * Pairs previous hunks with new ones by fingerprint (each used at most once) when the changed lines also sit in the
 * same place relative to the unchanged lines around them. Unpaired new hunks are added; unpaired old ones are missing.
 */
export const matchHunks = (previous: readonly Hunk[], next: readonly FingerprintedHunk[]): HunkMatchResult => {
  const ordered = [...previous].sort(byPresenceThenPosition);
  const byFingerprint = runPass({ pairs: [], unusedPrevious: ordered }, next, (p, n) => p.fingerprint === n.fingerprint && samePlacement(p, n));
  const pairedNext = (state: PassState): ReadonlySet<FingerprintedHunk> => new Set(state.pairs.map((pair) => pair.next));
  const firstPaired = pairedNext(byFingerprint);
  const afterRenames = runPass(
    byFingerprint,
    next.filter((hunk) => !firstPaired.has(hunk)),
    (p, n) => isRenameOf(p, n) && samePlacement(p, n),
  );
  const allPaired = pairedNext(afterRenames);
  return {
    matched: [...afterRenames.pairs].sort((a, b) => next.indexOf(a.next) - next.indexOf(b.next)),
    added: next.filter((hunk) => !allPaired.has(hunk)),
    missing: [...afterRenames.unusedPrevious].sort((a, b) => a.position - b.position),
  };
};
