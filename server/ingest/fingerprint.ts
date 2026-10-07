import { createHash } from "node:crypto";
import type { ParsedHunk } from "@shared/domain";

/** Stable hash of file path + changed (+/-) lines, ignoring line numbers and context, so hunks match across rebases. */
export const fingerprintHunk = (hunk: ParsedHunk): string => {
  const changedLines = hunk.patchText
    .split("\n")
    .slice(1)
    .filter((line) => line.startsWith("+") || line.startsWith("-"));
  return createHash("sha256")
    .update(JSON.stringify([hunk.filePath, ...changedLines]))
    .digest("hex")
    .slice(0, 32);
};
