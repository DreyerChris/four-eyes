import { describe, expect, it } from "vitest";
import { buildCodeGroups, buildSegments, identifierRanges, parsePatch, splitRows, unifiedRows, wordDiffRanges } from "./model";

const patch = (lines: readonly string[], oldStart = 10, newStart = 10): ReturnType<typeof parsePatch> =>
  parsePatch({ patchText: lines.join("\n"), oldStart, newStart });

describe("parsePatch", () => {
  it("numbers context, removed and added lines from the hunk start", () => {
    const parsed = patch(["@@ -10,3 +10,3 @@ class A {", " keep", "-old", "+new", " tail"]);
    expect(parsed.header).toBe("@@ -10,3 +10,3 @@ class A {");
    expect(parsed.lines.map((line) => [line.kind, line.oldNumber, line.newNumber, line.text])).toEqual([
      ["context", 10, 10, "keep"],
      ["del", 11, null, "old"],
      ["add", null, 11, "new"],
      ["context", 12, 12, "tail"],
    ]);
    expect(parsed.oldSide).toEqual(["keep", "old", "tail"]);
    expect(parsed.newSide).toEqual(["keep", "new", "tail"]);
  });

  it("marks the line before a no-newline marker", () => {
    const parsed = patch(["@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file"], 1, 1);
    expect(parsed.lines.map((line) => line.noNewlineAtEof)).toEqual([true, true]);
  });

  it("starts added files at line 1", () => {
    const parsed = patch(["@@ -0,0 +1,2 @@", "+one", "+two"], 0, 1);
    expect(parsed.lines.map((line) => line.newNumber)).toEqual([1, 2]);
  });

  it("returns no lines for a binary placeholder", () => {
    expect(patch(["Binary files a/x.png and b/x.png differ"]).lines).toEqual([]);
  });

  it("keeps empty context lines that lost their leading space", () => {
    const parsed = patch(["@@ -1,3 +1,3 @@", " a", "", "+b", "-c"], 1, 1);
    expect(parsed.lines.map((line) => line.kind)).toEqual(["context", "context", "add", "del"]);
  });
});

describe("wordDiffRanges", () => {
  it("finds the changed words on each side", () => {
    const ranges = wordDiffRanges("const a = 1;", "const b = 1;", false);
    expect(ranges?.old).toEqual([{ start: 6, end: 7 }]);
    expect(ranges?.new).toEqual([{ start: 6, end: 7 }]);
  });

  it("returns null when the lines share nothing", () => {
    expect(wordDiffRanges("alpha", "omega", false)).toBeNull();
  });

  it("drops whitespace-only ranges when whitespace is hidden", () => {
    const ranges = wordDiffRanges("a  b c", "a b d", true);
    expect(ranges?.old.map((range) => "a  b c".slice(range.start, range.end))).toEqual(["c"]);
  });
});

describe("buildSegments", () => {
  const lines = patch(["@@ -1,4 +1,4 @@", " x", "-foo(1)", "-gone", "+foo(2)", " y"], 1, 1).lines;

  it("pairs removed and added lines and keeps unpaired ones", () => {
    const segments = buildSegments(lines, false);
    expect(segments.map((segment) => segment.type)).toEqual(["context", "change", "context"]);
    const change = segments[1];
    if (change?.type !== "change") throw new Error("expected a change block");
    expect(change.dels.map((row) => row.line.text)).toEqual(["foo(1)", "gone"]);
    expect(change.adds.map((row) => row.line.text)).toEqual(["foo(2)"]);
    expect(change.dels[0]?.changes.length).toBeGreaterThan(0);
    expect(change.dels[1]?.changes).toEqual([]);
  });

  it("lays out unified rows as removed then added", () => {
    expect(unifiedRows(buildSegments(lines, false)).map((row) => row.line.kind)).toEqual(["context", "del", "del", "add", "context"]);
  });

  it("lays out split rows side by side", () => {
    const rows = splitRows(buildSegments(lines, false));
    expect(rows.map((row) => [row.left?.line.text ?? null, row.right?.line.text ?? null])).toEqual([
      ["x", "x"],
      ["foo(1)", "foo(2)"],
      ["gone", null],
      ["y", "y"],
    ]);
  });

  it("turns whitespace-only changes into context when whitespace is hidden", () => {
    const indented = patch(["@@ -1,1 +1,1 @@", "-  call()", "+    call()"], 1, 1).lines;
    const segments = buildSegments(indented, true);
    expect(segments).toHaveLength(1);
    const only = segments[0];
    if (only?.type !== "context") throw new Error("expected context");
    expect([only.row.line.oldNumber, only.row.line.newNumber]).toEqual([1, 1]);
    expect(buildSegments(indented, false)[0]?.type).toBe("change");
  });

  it("starts a new block when a removal follows an addition", () => {
    const mixed = patch(["@@ -1,2 +1,2 @@", "-a", "+b", "-c", "+d"], 1, 1).lines;
    expect(buildSegments(mixed, false).map((segment) => segment.type)).toEqual(["change", "change"]);
  });
});

describe("identifierRanges", () => {
  it("skips keywords and words glued to digits", () => {
    const text = "const user = await getUser(0x1F, id);";
    expect(identifierRanges(text).map((range) => text.slice(range.start, range.end))).toEqual(["user", "getUser", "id"]);
  });
});

describe("buildCodeGroups", () => {
  it("groups identifiers into tokens and keeps colours and word changes", () => {
    const groups = buildCodeGroups("let fooBar = 1", [{ content: "let ", color: "#f00" }, { content: "fooBar = 1", color: "#0f0" }], [
      { start: 7, end: 14 },
    ]);
    const token = groups.find((group) => group.identifier === "fooBar");
    expect(token?.pieces.map((piece) => [piece.text, piece.color, piece.changed])).toEqual([
      ["foo", "#0f0", false],
      ["Bar", "#0f0", true],
    ]);
    expect(groups.map((group) => group.pieces.map((piece) => piece.text).join("")).join("")).toBe("let fooBar = 1");
  });

  it("does not make words inside strings or comments clickable", () => {
    const groups = buildCodeGroups('greet("Hello") // say hi', [
      { content: "greet(" },
      { content: '"Hello"', syntax: "string" },
      { content: ") " },
      { content: "// say hi", syntax: "comment" },
    ], []);
    expect(groups.flatMap((group) => (group.identifier === null ? [] : [group.identifier]))).toEqual(["greet"]);
  });

  it("ignores a highlight that does not match the text", () => {
    const groups = buildCodeGroups("abc", [{ content: "different", color: "#fff" }], []);
    expect(groups[0]?.pieces[0]?.color).toBeUndefined();
  });
});
