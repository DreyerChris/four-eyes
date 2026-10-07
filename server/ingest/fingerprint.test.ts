import { describe, expect, it } from "vitest";
import type { ParsedHunk } from "@shared/domain";
import { parseUnifiedDiff } from "./diff";
import { fingerprintHunk } from "./fingerprint";

const diffFor = (path: string, header: string, body: readonly string[]): string =>
  [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`, header, ...body, ""].join("\n");

const only = (raw: string): ParsedHunk => {
  const [hunk] = parseUnifiedDiff(raw);
  if (hunk === undefined) throw new Error("expected one hunk");
  return hunk;
};

const BODY = [" const a = 1;", "-const b = 2;", "+const b = 3;", " const c = 4;"];

describe("fingerprintHunk", () => {
  it("is stable when the hunk moves to other line numbers", () => {
    const original = only(diffFor("src/x.ts", "@@ -10,3 +10,3 @@ function f() {", BODY));
    const shifted = only(diffFor("src/x.ts", "@@ -42,3 +57,3 @@ class Other {", BODY));
    expect(fingerprintHunk(shifted)).toBe(fingerprintHunk(original));
  });

  it("ignores surrounding context lines", () => {
    const original = only(diffFor("src/x.ts", "@@ -10,3 +10,3 @@", BODY));
    const newContext = only(diffFor("src/x.ts", "@@ -10,3 +10,3 @@", [" // renamed above", "-const b = 2;", "+const b = 3;", " return;"]));
    expect(fingerprintHunk(newContext)).toBe(fingerprintHunk(original));
  });

  it("changes when the changed lines change", () => {
    const original = only(diffFor("src/x.ts", "@@ -10,3 +10,3 @@", BODY));
    const rewritten = only(diffFor("src/x.ts", "@@ -10,3 +10,3 @@", [" const a = 1;", "-const b = 2;", "+const b = 30;", " const c = 4;"]));
    const whitespace = only(diffFor("src/x.ts", "@@ -10,3 +10,3 @@", [" const a = 1;", "-const b = 2;", "+const b = 3; ", " const c = 4;"]));
    expect(fingerprintHunk(rewritten)).not.toBe(fingerprintHunk(original));
    expect(fingerprintHunk(whitespace)).not.toBe(fingerprintHunk(original));
  });

  it("changes when the file path changes", () => {
    const original = only(diffFor("src/x.ts", "@@ -10,3 +10,3 @@", BODY));
    const moved = only(diffFor("src/y.ts", "@@ -10,3 +10,3 @@", BODY));
    expect(fingerprintHunk(moved)).not.toBe(fingerprintHunk(original));
  });

  it("distinguishes additions from removals of the same text", () => {
    const added = only(diffFor("src/x.ts", "@@ -1,0 +1 @@", ["+line"]));
    const removed = only(diffFor("src/x.ts", "@@ -1 +0,0 @@", ["-line"]));
    expect(fingerprintHunk(added)).not.toBe(fingerprintHunk(removed));
  });

  it("returns a 32 character hex digest", () => {
    expect(fingerprintHunk(only(diffFor("a", "@@ -1,0 +1,2 @@", ["+b", "+c"])))).toMatch(/^[0-9a-f]{32}$/);
  });
});
