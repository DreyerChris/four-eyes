import type { FindingView, SummaryChunk, SummaryResponse } from "@shared/api";
import { SEVERITIES, type ChunkProgress, type FindingRange, type Hunk, type Question } from "@shared/domain";
import { rangeFitsHunk } from "@shared/findings";
import { LIFECYCLE_LABELS, SEVERITY_LABELS, STATUS_LABELS, SUGGESTION_LABELS, USER_VERDICT_LABELS } from "./labels";

const lineRange = (start: number, count: number): string => (count <= 1 ? `L${start}` : `L${start}-L${start + count - 1}`);

/** "`src/a.ts` L10-L17" for a hunk; removed-only hunks point at the old file. */
export const hunkLocation = (hunk: Hunk): string =>
  hunk.changeType === "deleted" || hunk.newLines === 0
    ? `\`${hunk.oldFilePath ?? hunk.filePath}\` ${lineRange(hunk.oldStart, hunk.oldLines)} (removed)`
    : `\`${hunk.filePath}\` ${lineRange(hunk.newStart, hunk.newLines)}`;

const locationLine = (hunks: readonly Hunk[]): readonly string[] =>
  hunks.length === 0 ? [] : [`<sub>Location: ${hunks.map(hunkLocation).join(", ")}</sub>`];

const paragraphs = (blocks: readonly (string | readonly string[])[]): string =>
  blocks
    .flatMap((block) => (typeof block === "string" ? [block] : block))
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .join("\n\n");

const rangeLocation = (range: FindingRange, hunks: readonly Hunk[]): readonly string[] | null => {
  const hunk = hunks.find((candidate) => rangeFitsHunk(range, candidate));
  if (hunk === undefined) return null;
  const path = range.side === "old" ? (hunk.oldFilePath ?? hunk.filePath) : hunk.filePath;
  const lines = lineRange(range.startLine, range.endLine - range.startLine + 1);
  return [`<sub>Location: \`${path}\` ${lines}${range.side === "old" ? " (removed)" : ""}</sub>`];
};

/** Markdown for one finding, ready to paste as a GitHub comment. Uses the finding's line range when it has one. */
export const findingToGitHubComment = (finding: FindingView, hunks: readonly Hunk[]): string => {
  const referenced = hunks.filter((hunk) => finding.hunkIds.includes(hunk.id));
  const location = (finding.range === null ? null : rangeLocation(finding.range, referenced)) ?? locationLine(referenced);
  return paragraphs([
    `**${SEVERITY_LABELS[finding.severity]}: ${finding.title}**`,
    finding.explanation,
    finding.suggestedFix ? ["**Suggested fix:**", finding.suggestedFix] : [],
    location,
  ]);
};

const NOTE_HEADINGS: Readonly<Record<ChunkProgress["status"], string>> = {
  unseen: "Note",
  good: "Note",
  flagged: "Flagged",
  question: "Question",
};

/** Markdown for a chunk note, ready to paste as a GitHub comment. */
export const noteToGitHubComment = (progress: ChunkProgress, chunkTitle: string, hunks: readonly Hunk[]): string =>
  paragraphs([`**${NOTE_HEADINGS[progress.status]}: ${chunkTitle}**`, progress.note, locationLine(hunks)]);

const indent = (text: string): string =>
  text
    .trim()
    .split("\n")
    .map((line) => (line === "" ? "" : `  ${line}`))
    .join("\n");

const chunkLabel = (chunks: readonly SummaryChunk[], chunkId: string): string | null => {
  const index = chunks.findIndex((chunk) => chunk.id === chunkId);
  const chunk = chunks[index];
  return chunk ? `chunk ${index + 1}: ${chunk.title}` : null;
};

const findingItem = (finding: FindingView, chunks: readonly SummaryChunk[]): string => {
  const tags = [
    finding.lifecycle === "new" ? null : LIFECYCLE_LABELS[finding.lifecycle],
    finding.userVerdict ? `you: ${USER_VERDICT_LABELS[finding.userVerdict].toLowerCase()}` : null,
  ].filter((tag): tag is string => tag !== null);
  const where = finding.chunkIds.map((id) => chunkLabel(chunks, id)).filter((label): label is string => label !== null);
  const head = `- **${finding.title}**${tags.length > 0 ? ` _(${tags.join(", ")})_` : ""}`;
  const body = [
    indent(finding.explanation),
    finding.suggestedFix ? indent(`Suggested fix:\n${finding.suggestedFix}`) : null,
    where.length > 0 ? indent(`In ${where.join("; ")}`) : null,
  ].filter((part): part is string => part !== null && part !== "");
  return [head, ...body].join("\n");
};

const findingsSection = (summary: SummaryResponse): readonly string[] => {
  if (summary.findings.length === 0) return ["## Findings", "No findings."];
  return [
    "## Findings",
    ...SEVERITIES.flatMap((severity) => {
      const group = summary.findings.filter((finding) => finding.severity === severity);
      return group.length === 0
        ? []
        : [`### ${SEVERITY_LABELS[severity]} (${group.length})`, group.map((finding) => findingItem(finding, summary.chunks)).join("\n")];
    }),
  ];
};

/** Chunks the reviewer flagged, questioned, or wrote a note on. */
export const notedChunks = (chunks: readonly SummaryChunk[]): readonly SummaryChunk[] =>
  chunks.filter((chunk) => chunk.progress.status === "flagged" || chunk.progress.status === "question" || chunk.progress.note.trim() !== "");

const notesSection = (summary: SummaryResponse): readonly string[] => {
  const noted = notedChunks(summary.chunks);
  if (noted.length === 0) return ["## Your flags and notes", "None."];
  const items = noted.map((chunk) => {
    const position = summary.chunks.indexOf(chunk) + 1;
    const head = `- **${STATUS_LABELS[chunk.progress.status]}**: chunk ${position}: ${chunk.title}`;
    return chunk.progress.note.trim() === "" ? head : `${head}\n${indent(chunk.progress.note)}`;
  });
  return ["## Your flags and notes", items.join("\n")];
};

const questionWhere = (question: Question): string => {
  if (!question.filePath) return "";
  if (question.startLine === null) return ` (\`${question.filePath}\`)`;
  const end = question.endLine ?? question.startLine;
  return ` (\`${question.filePath}\` ${end > question.startLine ? `L${question.startLine}-L${end}` : `L${question.startLine}`})`;
};

const questionsSection = (questions: readonly Question[]): readonly string[] => {
  if (questions.length === 0) return [];
  const items = questions.map((question) =>
    [
      `- **Q:** ${question.question.trim()}${questionWhere(question)}`,
      indent(`**A:** ${question.answer?.trim() ? question.answer.trim() : "_No answer yet._"}`),
    ].join("\n"),
  );
  return ["## Questions asked", items.join("\n")];
};

const coverageSection = (summary: SummaryResponse): readonly string[] => {
  const { coverage } = summary;
  return [
    "## Coverage",
    [
      `- Chunks reviewed: ${coverage.reviewedChunks} of ${coverage.totalChunks}`,
      `- Hunks reviewed: ${coverage.reviewedHunks} of ${coverage.presentHunks} still in the PR`,
      ...(coverage.missingHunks > 0 ? [`- Hunks no longer in the PR: ${coverage.missingHunks}`] : []),
    ].join("\n"),
  ];
};

/** The whole review (verdict, findings, notes, questions, coverage) as one markdown document. */
export const buildFullReviewMarkdown = (summary: SummaryResponse): string => {
  const { review, verdict } = summary;
  return [
    `# Review: ${review.title} (#${review.prNumber})`,
    review.url,
    ...(verdict ? [`## Verdict: ${SUGGESTION_LABELS[verdict.suggestion]}`, verdict.summary.trim()] : ["## Verdict", "No verdict from Claude yet."]),
    ...findingsSection(summary),
    ...notesSection(summary),
    ...questionsSection(summary.questions),
    ...coverageSection(summary),
  ]
    .filter((block) => block.trim() !== "")
    .join("\n\n")
    .concat("\n");
};
