import { describe, expect, it } from "vitest";
import { selectionFromCells } from "./selection";

const location = { reviewId: "rev_1", chunkId: "chk_1" };

describe("selectionFromCells", () => {
  it("uses the new side and spans the touched lines", () => {
    const selection = selectionFromCells(
      [
        { file: "a.ts", side: "new", line: 4 },
        { file: "a.ts", side: "old", line: 3 },
        { file: "a.ts", side: "new", line: 6 },
      ],
      "text",
      location,
    );
    expect(selection).toEqual({ ...location, filePath: "a.ts", side: "new", startLine: 4, endLine: 6, text: "text" });
  });

  it("uses the old side when only removed lines are selected", () => {
    const selection = selectionFromCells([{ file: "old.ts", side: "old", line: 9 }], "gone", location);
    expect(selection?.side).toBe("old");
    expect(selection?.filePath).toBe("old.ts");
  });

  it("keeps only the first file when a selection crosses hunks", () => {
    const selection = selectionFromCells(
      [
        { file: "a.ts", side: "new", line: 1 },
        { file: "b.ts", side: "new", line: 50 },
      ],
      "x",
      location,
    );
    expect([selection?.filePath, selection?.endLine]).toEqual(["a.ts", 1]);
  });

  it("returns null for empty or whitespace selections", () => {
    expect(selectionFromCells([], "x", location)).toBeNull();
    expect(selectionFromCells([{ file: "a.ts", side: "new", line: 1 }], "  \n", location)).toBeNull();
  });
});
