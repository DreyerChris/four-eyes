import type { ChangeType, ParsedHunk } from "@shared/domain";

interface FileState {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly renameFrom: string | null;
  readonly renameTo: string | null;
  readonly isNew: boolean;
  readonly isDeleted: boolean;
  readonly isBinary: boolean;
}

interface HunkState {
  readonly header: HunkHeader;
  readonly lines: string[];
  oldRemaining: number;
  newRemaining: number;
}

export interface HunkHeader {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly section: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

const EMPTY_FILE: FileState = {
  oldPath: null,
  newPath: null,
  renameFrom: null,
  renameTo: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
};

const OCTAL_ESCAPE = /^[0-7]{3}/;
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", a: "\x07", b: "\b", f: "\f", v: "\v" };

/** Decodes a C-style quoted path as git prints it when core.quotePath applies (octal UTF-8 bytes, \t, \", ...). */
export const unquoteGitPath = (raw: string): string => {
  if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  const pushText = (text: string): void => {
    bytes.push(...Buffer.from(text, "utf8"));
  };
  let index = 0;
  while (index < body.length) {
    const char = body.charAt(index);
    if (char !== "\\") {
      pushText(char);
      index += 1;
      continue;
    }
    const rest = body.slice(index + 1);
    const octal = OCTAL_ESCAPE.exec(rest);
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 4;
      continue;
    }
    const next = rest.charAt(0);
    pushText(SIMPLE_ESCAPES[next] ?? next);
    index += 2;
  }
  return Buffer.from(bytes).toString("utf8");
};

const parseMarkerPath = (rest: string): string | null => {
  const trimmed = rest.replace(/\t.*$/, "").replace(/\r$/, "");
  const path = unquoteGitPath(trimmed);
  if (path === "/dev/null") return null;
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path;
};

/** Parses an @@ header line, or returns null when the line is not one. */
export const parseHunkHeader = (line: string): HunkHeader | null => {
  const match = HUNK_HEADER.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newLines: match[4] === undefined ? 1 : Number(match[4]),
    section: match[5] ?? "",
  };
};

const changeTypeOf = (file: FileState): ChangeType => {
  if (file.isNew || file.oldPath === null) return "added";
  if (file.isDeleted || file.newPath === null) return "deleted";
  if (file.renameFrom !== null || file.oldPath !== file.newPath) return "renamed";
  return "modified";
};

const toParsedHunk = (file: FileState, hunk: HunkState): ParsedHunk => {
  const oldPath = file.oldPath ?? file.renameFrom;
  const newPath = file.newPath ?? file.renameTo;
  const changeType = changeTypeOf({ ...file, oldPath, newPath });
  const filePath = newPath ?? oldPath ?? "";
  return {
    filePath,
    oldFilePath: changeType === "renamed" ? oldPath : null,
    changeType,
    oldStart: hunk.header.oldStart,
    oldLines: hunk.header.oldLines,
    newStart: hunk.header.newStart,
    newLines: hunk.header.newLines,
    patchText: hunk.lines.join("\n"),
  };
};

const applyFileHeader = (file: FileState, line: string): FileState => {
  if (line.startsWith("new file mode")) return { ...file, isNew: true };
  if (line.startsWith("deleted file mode")) return { ...file, isDeleted: true };
  if (line.startsWith("rename from ")) return { ...file, renameFrom: unquoteGitPath(line.slice("rename from ".length)) };
  if (line.startsWith("rename to ")) return { ...file, renameTo: unquoteGitPath(line.slice("rename to ".length)) };
  if (line.startsWith("--- ")) return { ...file, oldPath: parseMarkerPath(line.slice(4)) };
  if (line.startsWith("+++ ")) return { ...file, newPath: parseMarkerPath(line.slice(4)) };
  if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) return { ...file, isBinary: true };
  return file;
};

/** Parses `git diff` output into hunks. patchText holds the @@ header line plus the hunk body. Binary files yield no hunks. */
export const parseUnifiedDiff = (raw: string): readonly ParsedHunk[] => {
  const lines = raw.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  const result: ParsedHunk[] = [];
  let file: FileState | null = null;
  let fileHasHunks = false;
  let hunk: HunkState | null = null;

  const closeHunk = (): void => {
    if (hunk !== null && file !== null && !file.isBinary) result.push(toParsedHunk(file, hunk));
    hunk = null;
  };

  const startFile = (): void => {
    closeHunk();
    file = { ...EMPTY_FILE };
    fileHasHunks = false;
  };

  lines.forEach((line, index) => {
    const open: HunkState | null = hunk;
    if (open !== null && (open.oldRemaining > 0 || open.newRemaining > 0)) {
      const marker = line.charAt(0);
      if (marker === " " || marker === "" || marker === "-" || marker === "+" || marker === "\\") {
        open.lines.push(line);
        if (marker === " " || marker === "") {
          open.oldRemaining -= 1;
          open.newRemaining -= 1;
        } else if (marker === "-") {
          open.oldRemaining -= 1;
        } else if (marker === "+") {
          open.newRemaining -= 1;
        }
        return;
      }
      closeHunk();
    }

    const current: HunkState | null = hunk;
    if (current !== null && line.startsWith("\\")) {
      current.lines.push(line);
      return;
    }

    if (line.startsWith("diff --git ") || line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) {
      startFile();
      return;
    }

    const header = parseHunkHeader(line);
    if (header !== null) {
      closeHunk();
      if (file === null) file = { ...EMPTY_FILE };
      fileHasHunks = true;
      hunk = { header, lines: [line], oldRemaining: header.oldLines, newRemaining: header.newLines };
      return;
    }

    if (line.startsWith("--- ") && (lines[index + 1] ?? "").startsWith("+++ ") && (file === null || fileHasHunks)) {
      startFile();
    }

    if (file !== null && !fileHasHunks) {
      file = applyFileHeader(file, line);
    }
  });
  closeHunk();
  return result;
};
