import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ParsedHunk } from "@shared/domain";
import { parseHunkHeader, parseUnifiedDiff } from "./diff";
import { countChangedLines, splitLargeHunks } from "./split";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/diffs/${name}.diff`, import.meta.url), "utf8");

const bodyOf = (hunk: ParsedHunk): readonly string[] => hunk.patchText.split("\n").slice(1);

const expectConsistent = (hunk: ParsedHunk): void => {
  const header = parseHunkHeader(hunk.patchText.split("\n")[0] ?? "");
  expect(header).not.toBeNull();
  const body = bodyOf(hunk).filter((line) => !line.startsWith("\\"));
  const oldCount = body.filter((line) => !line.startsWith("+")).length;
  const newCount = body.filter((line) => !line.startsWith("-")).length;
  expect(header).toMatchObject({ oldStart: hunk.oldStart, oldLines: oldCount, newStart: hunk.newStart, newLines: newCount });
  expect([hunk.oldLines, hunk.newLines]).toEqual([oldCount, newCount]);
};

const makeHunk = (header: string, body: readonly string[], overrides: Partial<ParsedHunk> = {}): ParsedHunk => {
  const parsed = parseHunkHeader(header);
  if (parsed === null) throw new Error(`bad header ${header}`);
  return {
    filePath: "src/file.ts",
    oldFilePath: null,
    changeType: "modified",
    oldStart: parsed.oldStart,
    oldLines: parsed.oldLines,
    newStart: parsed.newStart,
    newLines: parsed.newLines,
    patchText: [header, ...body].join("\n"),
    ...overrides,
  };
};

describe("splitLargeHunks", () => {
  it("returns small hunks untouched", () => {
    const hunks = parseUnifiedDiff(fixture("modified"));
    expect(splitLargeHunks(hunks)).toEqual(hunks);
  });

  it("splits at context boundaries without losing or duplicating lines", () => {
    const [big] = parseUnifiedDiff(fixture("large")).filter((h) => h.filePath === "src/big.ts");
    if (big === undefined) throw new Error("fixture missing src/big.ts");
    expect(countChangedLines(big.patchText)).toBe(100);

    const pieces = splitLargeHunks([big], 40);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    pieces.forEach((piece) => {
      expect(countChangedLines(piece.patchText)).toBeLessThanOrEqual(40);
      expect(piece).toMatchObject({ filePath: "src/big.ts", changeType: "modified", oldFilePath: null });
      expectConsistent(piece);
      expect(bodyOf(piece)[0]?.startsWith(" ")).toBe(true);
    });
    expect(pieces.flatMap(bodyOf)).toEqual(bodyOf(big));
    pieces.slice(1).forEach((piece, index) => {
      const previous = pieces[index];
      if (previous === undefined) throw new Error("unreachable");
      expect(piece.oldStart).toBe(previous.oldStart + previous.oldLines);
      expect(piece.newStart).toBe(previous.newStart + previous.newLines);
    });
  });

  it("slices one oversized block of additions into valid zero-context hunks", () => {
    const [generated] = parseUnifiedDiff(fixture("large")).filter((h) => h.filePath === "src/generated.ts");
    if (generated === undefined) throw new Error("fixture missing src/generated.ts");
    const pieces = splitLargeHunks([generated], 40);
    expect(pieces.map((p) => [p.oldStart, p.oldLines, p.newStart, p.newLines])).toEqual([
      [0, 0, 1, 40],
      [0, 0, 41, 40],
      [0, 0, 81, 40],
      [0, 0, 121, 10],
    ]);
    expect(pieces[1]?.patchText.split("\n")[0]).toBe("@@ -0,0 +41,40 @@");
    expect(pieces[3]?.patchText.split("\n")[1]).toBe("+export const g121 = 121;");
    pieces.forEach((piece) => {
      expectConsistent(piece);
      expect(piece.changeType).toBe("added");
    });
    expect(pieces.flatMap(bodyOf)).toEqual(bodyOf(generated));
  });

  it("uses the preceding line number for empty ranges in the middle of a file", () => {
    const body = [" ctx", ...Array.from({ length: 6 }, (_, i) => `-old ${i}`), ...Array.from({ length: 6 }, (_, i) => `+new ${i}`), " tail"];
    const pieces = splitLargeHunks([makeHunk("@@ -10,8 +10,8 @@ section", body)], 6);
    expect(pieces.map((p) => p.patchText.split("\n")[0])).toEqual(["@@ -10,7 +10 @@ section", "@@ -17 +11,7 @@ section"]);
    pieces.forEach(expectConsistent);
    expect(pieces.flatMap(bodyOf)).toEqual(body);
  });

  it("keeps no-newline markers attached to their line", () => {
    const body = [...Array.from({ length: 3 }, (_, i) => `-a${i}`), "\\ No newline at end of file", ...Array.from({ length: 3 }, (_, i) => `+b${i}`), "\\ No newline at end of file"];
    const pieces = splitLargeHunks([makeHunk("@@ -1,3 +1,3 @@", body)], 3);
    expect(pieces.map((p) => bodyOf(p))).toEqual([
      ["-a0", "-a1", "-a2", "\\ No newline at end of file"],
      ["+b0", "+b1", "+b2", "\\ No newline at end of file"],
    ]);
    pieces.forEach(expectConsistent);
  });

  it("groups several small blocks into one piece while they fit", () => {
    const body = [" c1", "-x1", "+y1", " c2", " c3", "-x2", "+y2", " c4", "-x3", "+y3", " c5"];
    const hunk = makeHunk("@@ -1,8 +1,8 @@", body);
    const pieces = splitLargeHunks([hunk], 4);
    expect(pieces.map(bodyOf)).toEqual([
      [" c1", "-x1", "+y1", " c2", " c3", "-x2", "+y2", " c4"],
      ["-x3", "+y3", " c5"],
    ]);
    pieces.forEach(expectConsistent);
  });

  it("rejects a non-positive limit", () => {
    expect(() => splitLargeHunks([], 0)).toThrow(/positive integer/);
  });
});
