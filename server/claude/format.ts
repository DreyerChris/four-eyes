import type { Hunk } from "@shared/domain";

export interface ChangeCounts {
  readonly added: number;
  readonly removed: number;
}

/** Counts added and removed lines in a hunk's patch text, ignoring the @@ header. */
export const countChanges = (patchText: string): ChangeCounts =>
  patchText
    .split("\n")
    .filter((line) => !line.startsWith("@@"))
    .reduce<ChangeCounts>(
      (counts, line) =>
        line.startsWith("+")
          ? { ...counts, added: counts.added + 1 }
          : line.startsWith("-")
            ? { ...counts, removed: counts.removed + 1 }
            : counts,
      { added: 0, removed: 0 },
    );

const truncatePatch = (patchText: string, maxLines: number): string => {
  const lines = patchText.split("\n");
  return lines.length <= maxLines
    ? patchText
    : [...lines.slice(0, maxLines), `... (${lines.length - maxLines} more lines; read the file for the rest)`].join("\n");
};

interface NumberingState {
  readonly old: number;
  readonly new: number;
  readonly lines: readonly string[];
}

const numberCell = (value: number | null): string => (value === null ? "" : String(value)).padStart(5);

/** The patch with old and new line numbers in front of every line, as used for line-anchored findings. */
export const numberPatchLines = (hunk: Pick<Hunk, "patchText" | "oldStart" | "newStart">): string => {
  const body = hunk.patchText.split("\n").filter((line, index) => !(index === 0 && line.startsWith("@@")));
  const numbered = body.reduce<NumberingState>(
    (state, line) => {
      if (line.startsWith("\\")) return { ...state, lines: [...state.lines, `${numberCell(null)} ${numberCell(null)} | ${line}`] };
      if (line.startsWith("-")) return { ...state, old: state.old + 1, lines: [...state.lines, `${numberCell(state.old)} ${numberCell(null)} | ${line}`] };
      if (line.startsWith("+")) return { ...state, new: state.new + 1, lines: [...state.lines, `${numberCell(null)} ${numberCell(state.new)} | ${line}`] };
      return { old: state.old + 1, new: state.new + 1, lines: [...state.lines, `${numberCell(state.old)} ${numberCell(state.new)} | ${line}`] };
    },
    { old: hunk.oldStart, new: hunk.newStart, lines: [] },
  );
  return [`${"old".padStart(5)} ${"new".padStart(5)} |`, ...numbered.lines].join("\n");
};

const fileLabel = (hunk: Hunk): string =>
  hunk.oldFilePath !== null && hunk.oldFilePath !== hunk.filePath
    ? `${hunk.filePath} (renamed from ${hunk.oldFilePath})`
    : hunk.filePath;

export interface HunkPromptOptions {
  readonly maxPatchLines?: number;
  readonly numbered?: boolean;
}

/** One hunk rendered for a prompt: ID, file, change type, line counts and the patch in a fence, optionally line-numbered. */
export const formatHunkForPrompt = (hunk: Hunk, options: HunkPromptOptions = {}): string => {
  const { added, removed } = countChanges(hunk.patchText);
  const maxPatchLines = options.maxPatchLines ?? 120;
  return [
    `### ${hunk.id}`,
    `file: ${fileLabel(hunk)} | ${hunk.changeType} | +${added} -${removed}`,
    options.numbered ? "```" : "```diff",
    options.numbered ? truncatePatch(numberPatchLines(hunk), maxPatchLines + 1) : truncatePatch(hunk.patchText, maxPatchLines),
    "```",
  ].join("\n");
};

/** Every hunk rendered for a prompt, in the given order. */
export const formatHunksForPrompt = (hunks: readonly Hunk[], options?: HunkPromptOptions): string =>
  hunks.map((hunk) => formatHunkForPrompt(hunk, options)).join("\n\n");
