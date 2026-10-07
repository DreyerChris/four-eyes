import { describe, expect, it } from "vitest";
import { changedLines, withoutFinalNewline } from "./changed-lines";

const hunk = {
  filePath: "src/a.ts",
  oldFilePath: null,
  oldStart: 10,
  newStart: 10,
  present: true,
  patchText: ["@@ -10,4 +10,5 @@ class A {", " keep", "-old one", "+new one", "+new two", " keep", "\\ No newline at end of file"].join("\n"),
};

describe("changedLines", () => {
  it("maps added lines to new-side numbers", () => {
    expect([...changedLines([hunk], "src/a.ts", "new")]).toEqual([11, 12]);
  });

  it("maps removed lines to old-side numbers", () => {
    expect([...changedLines([hunk], "src/a.ts", "old")]).toEqual([11]);
  });

  it("ignores other files and hunks no longer in the PR", () => {
    expect(changedLines([hunk], "src/b.ts", "new").size).toBe(0);
    expect(changedLines([{ ...hunk, present: false }], "src/a.ts", "new").size).toBe(0);
  });

  it("uses the old path of a renamed file for the before side", () => {
    const renamed = { ...hunk, filePath: "src/new-name.ts", oldFilePath: "src/old-name.ts" };
    expect([...changedLines([renamed], "src/old-name.ts", "old")]).toEqual([11]);
    expect(changedLines([renamed], "src/old-name.ts", "new").size).toBe(0);
  });
});

describe("withoutFinalNewline", () => {
  it("drops only the newline that ends the last line", () => {
    expect(withoutFinalNewline("a\nb\n").split("\n")).toEqual(["a", "b"]);
    expect(withoutFinalNewline("a\r\nb\r\n")).toBe("a\r\nb");
    expect(withoutFinalNewline("a\n\n")).toBe("a\n");
    expect(withoutFinalNewline("a")).toBe("a");
  });
});
