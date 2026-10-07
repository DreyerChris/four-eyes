import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHunkHeader, parseUnifiedDiff, unquoteGitPath } from "./diff";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/diffs/${name}.diff`, import.meta.url), "utf8");

describe("parseUnifiedDiff", () => {
  it("parses a modified file into separate hunks with headers and line ranges", () => {
    const hunks = parseUnifiedDiff(fixture("modified"));
    expect(hunks).toHaveLength(2);
    expect(hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      [2, 7, 2, 7],
      [27, 7, 27, 8],
    ]);
    expect(hunks.every((h) => h.filePath === "src/app.ts" && h.changeType === "modified" && h.oldFilePath === null)).toBe(true);
    const first = hunks[0];
    expect(first?.patchText.split("\n")[0]).toBe("@@ -2,7 +2,7 @@ export const value1 = 1;");
    expect(first?.patchText).toContain("-export const value5 = 5;\n+export const value5 = 500;");
    expect(first?.patchText.endsWith("\n")).toBe(false);
  });

  it("marks added and deleted files and uses the surviving path", () => {
    const hunks = parseUnifiedDiff(fixture("added-deleted"));
    expect(hunks.map((h) => ({ path: h.filePath, type: h.changeType, old: h.oldFilePath }))).toEqual([
      { path: "new/fresh.ts", type: "added", old: null },
      { path: "old/gone.ts", type: "deleted", old: null },
    ]);
    expect(hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 3 });
    expect(hunks[1]).toMatchObject({ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0 });
    expect(hunks[0]?.patchText.split("\n")).toEqual([
      "@@ -0,0 +1,3 @@",
      "+export const fresh = 1;",
      "+",
      "+export const alsoFresh = 2;",
    ]);
  });

  it("keeps the old path for renames with changes and skips pure renames", () => {
    const hunks = parseUnifiedDiff(fixture("rename"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      filePath: "src/formatting.ts",
      oldFilePath: "src/format.ts",
      changeType: "renamed",
      oldStart: 7,
      newStart: 7,
    });
  });

  it("yields no hunks for binary files but keeps text files around them", () => {
    const hunks = parseUnifiedDiff(fixture("binary"));
    expect(hunks.map((h) => h.filePath)).toEqual(["notes.txt"]);
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 });
  });

  it("keeps the no-newline-at-end-of-file markers inside the hunk", () => {
    const hunks = parseUnifiedDiff(fixture("no-newline"));
    expect(hunks.map((h) => h.filePath)).toEqual(["README.md", "keep.txt"]);
    expect(hunks[0]?.patchText.split("\n")).toEqual([
      "@@ -1,3 +1,3 @@",
      " # Title",
      " ",
      "-Last line",
      "\\ No newline at end of file",
      "+Last line changed",
    ]);
    expect(hunks[1]?.patchText.split("\n")).toEqual([
      "@@ -1,2 +1,3 @@",
      " a",
      "-b",
      "\\ No newline at end of file",
      "+b",
      "+c",
      "\\ No newline at end of file",
    ]);
  });

  it("decodes quoted paths, paths with spaces and skips mode-only changes", () => {
    const hunks = parseUnifiedDiff(fixture("mode-and-quoted"));
    expect(hunks.map((h) => [h.filePath, h.changeType])).toEqual([
      ["docs/café.md", "modified"],
      ["docs/tab\tname.md", "added"],
      ["docs/with space.md", "modified"],
    ]);
  });

  it("does not mistake removed lines that look like file headers for headers", () => {
    const hunks = parseUnifiedDiff(fixture("tricky-content"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.filePath).toBe("src/dashes.txt");
    expect(hunks[0]?.patchText.split("\n")).toEqual([
      "@@ -1,4 +1,5 @@",
      " keep",
      "--- a/not-a-header",
      " ++ b/also-not",
      "++++ b/still-not",
      " end",
      "+@@ -1 +1 @@ not a header",
    ]);
  });

  it("parses the large fixture with hunks for every changed file", () => {
    const hunks = parseUnifiedDiff(fixture("large"));
    expect(new Set(hunks.map((h) => h.filePath))).toEqual(new Set(["src/big.ts", "src/generated.ts"]));
    expect(hunks.find((h) => h.filePath === "src/generated.ts")).toMatchObject({ changeType: "added", newLines: 130 });
  });

  it("returns nothing for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("accepts plain unified diffs without a diff --git line", () => {
    const raw = ["--- a/x.txt", "+++ b/x.txt", "@@ -1 +1 @@", "-a", "+b", "--- a/y.txt", "+++ b/y.txt", "@@ -1 +1 @@", "-c", "+d", ""].join("\n");
    expect(parseUnifiedDiff(raw).map((h) => h.filePath)).toEqual(["x.txt", "y.txt"]);
  });

  it("treats a blank line inside a hunk as an empty context line", () => {
    const raw = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,3 +1,3 @@", " a", "", "-b", "+c", ""].join("\n");
    const hunks = parseUnifiedDiff(raw);
    expect(hunks[0]?.patchText.split("\n")).toEqual(["@@ -1,3 +1,3 @@", " a", "", "-b", "+c"]);
  });
});

describe("parseHunkHeader", () => {
  it("defaults omitted counts to 1 and keeps the section text", () => {
    expect(parseHunkHeader("@@ -5 +7,0 @@ fn main()")).toEqual({ oldStart: 5, oldLines: 1, newStart: 7, newLines: 0, section: " fn main()" });
    expect(parseHunkHeader("not a header")).toBeNull();
  });
});

describe("unquoteGitPath", () => {
  it("decodes octal UTF-8 escapes and simple escapes", () => {
    expect(unquoteGitPath('"a/caf\\303\\251 \\"q\\" \\\\ \\t"')).toBe('a/café "q" \\ \t');
    expect(unquoteGitPath("plain/path.ts")).toBe("plain/path.ts");
  });
});
