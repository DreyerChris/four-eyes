import { describe, expect, it } from "vitest";
import { toolProgressText } from "./sdk-runner";

describe("toolProgressText", () => {
  it("describes allowed calls by their target", () => {
    expect(toolProgressText("Read", { file_path: "src/a.ts" }, true)).toBe("Read: src/a.ts");
    expect(toolProgressText("Glob", {}, true)).toBe("Using Glob");
  });

  it("marks refused calls as blocked", () => {
    expect(toolProgressText("Bash", { command: 'grep -n "x" a.ts | head' }, false)).toBe(
      'Blocked (not allowed in read-only mode) Bash: grep -n "x" a.ts | head',
    );
  });

  it("skips the internal structured output tool", () => {
    expect(toolProgressText("StructuredOutput", { chunks: [] }, true)).toBeNull();
  });
});
