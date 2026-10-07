import { SEVERITIES, type Finding, type FindingRange, type Hunk, type Severity } from "@shared/domain";
import { rangeFitsHunk } from "@shared/findings";
import { numberOnSide, type DiffLine } from "./model";

export type LineFinding = Finding & { readonly range: FindingRange };

export interface HunkFindings {
  readonly atHunk: readonly Finding[];
  readonly atLine: readonly LineFinding[];
}

const hasRange = (finding: Finding): finding is LineFinding => finding.range !== null;

const anchorHunkId = (finding: Finding, hunks: readonly Hunk[]): string | null => {
  const own = hunks.filter((hunk) => finding.hunkIds.includes(hunk.id));
  const range = finding.range;
  const containing = range === null ? undefined : own.find((hunk) => rangeFitsHunk(range, hunk));
  return (containing ?? own[0])?.id ?? null;
};

/** Assigns each finding to one hunk of the chunk: the hunk its line range falls in, otherwise its first hunk. */
export const anchorFindings = (findings: readonly Finding[], hunks: readonly Hunk[]): ReadonlyMap<string, readonly Finding[]> =>
  findings.reduce((anchored, finding) => {
    const hunkId = anchorHunkId(finding, hunks);
    return hunkId === null ? anchored : new Map(anchored).set(hunkId, [...(anchored.get(hunkId) ?? []), finding]);
  }, new Map<string, readonly Finding[]>());

/** Within a hunk, a finding goes under its last line when its range fits and that line is rendered; otherwise at the top. */
export const splitHunkFindings = (findings: readonly Finding[], hunk: Hunk, lines: readonly DiffLine[]): HunkFindings => {
  const onLine = (finding: Finding): finding is LineFinding =>
    hasRange(finding) &&
    rangeFitsHunk(finding.range, hunk) &&
    lines.some((line) => numberOnSide(line, finding.range.side) === finding.range.endLine);
  return { atLine: findings.filter(onLine), atHunk: findings.filter((finding) => !onLine(finding)) };
};

/** Findings whose range ends on this line on the given side. */
export const findingsEndingAt = (line: DiffLine | null, side: "old" | "new", findings: readonly LineFinding[]): readonly LineFinding[] =>
  line === null ? [] : findings.filter((finding) => finding.range.side === side && numberOnSide(line, side) === finding.range.endLine);

const covers = (line: DiffLine, finding: LineFinding): boolean => {
  const number = numberOnSide(line, finding.range.side);
  return number !== null && number >= finding.range.startLine && number <= finding.range.endLine;
};

/** The most severe unresolved finding covering this line, used for the gutter marker. */
export const rangeSeverityAt = (lines: readonly (DiffLine | null)[], findings: readonly LineFinding[]): Severity | null => {
  const severities = new Set(
    findings
      .filter((finding) => finding.lifecycle !== "resolved")
      .filter((finding) => lines.some((line) => line !== null && covers(line, finding)))
      .map((finding) => finding.severity),
  );
  return SEVERITIES.find((severity) => severities.has(severity)) ?? null;
};
