import type { DiffSide, Hunk } from "@shared/domain";

type HunkLines = Pick<Hunk, "filePath" | "oldFilePath" | "oldStart" | "newStart" | "patchText" | "present">;

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const changedInHunk = (hunk: HunkLines, side: DiffSide): readonly number[] => {
  const lines = hunk.patchText.split("\n");
  const header = HEADER.exec(lines[0] ?? "");
  const body = header ? lines.slice(1) : lines;
  const start = { old: header ? Number(header[1]) : hunk.oldStart, new: header ? Number(header[2]) : hunk.newStart };
  return body.reduce<{ readonly old: number; readonly new: number; readonly changed: readonly number[] }>(
    (acc, line) => {
      const marker = line[0];
      if (marker === "+") return { ...acc, new: acc.new + 1, changed: side === "new" ? [...acc.changed, acc.new] : acc.changed };
      if (marker === "-") return { ...acc, old: acc.old + 1, changed: side === "old" ? [...acc.changed, acc.old] : acc.changed };
      if (marker === "\\") return acc;
      return { ...acc, old: acc.old + 1, new: acc.new + 1 };
    },
    { ...start, changed: [] },
  ).changed;
};

/** Line numbers that a PR's present hunks add (side "new") or remove (side "old") in one file. */
export const changedLines = (hunks: readonly HunkLines[], path: string, side: DiffSide): ReadonlySet<number> =>
  new Set(
    hunks
      .filter((hunk) => hunk.present && (side === "new" ? hunk.filePath === path : (hunk.oldFilePath ?? hunk.filePath) === path))
      .flatMap((hunk) => changedInHunk(hunk, side)),
  );

/** Drops the newline that ends the last line so it is not shown as an extra empty line. */
export const withoutFinalNewline = (content: string): string => content.replace(/\r?\n$/, "");
