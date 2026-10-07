import type { FindingRange, Hunk } from "./domain";

export type HunkSpan = Pick<Hunk, "oldStart" | "oldLines" | "newStart" | "newLines">;

/** True when every line of the range lies inside the hunk on the range's side. */
export const rangeFitsHunk = (range: FindingRange, hunk: HunkSpan): boolean => {
  const [start, count] = range.side === "old" ? [hunk.oldStart, hunk.oldLines] : [hunk.newStart, hunk.newLines];
  return count > 0 && range.startLine >= 1 && range.startLine <= range.endLine && range.startLine >= start && range.endLine <= start + count - 1;
};
