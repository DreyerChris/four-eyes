import { describe, expect, it } from "vitest";
import type { Hunk } from "@shared/domain";
import type { FingerprintedHunk } from "../ingest/types";
import { changedLinesSignature, matchHunks, placementSignature } from "./match";

const next = (fingerprint: string, overrides: Partial<FingerprintedHunk> = {}): FingerprintedHunk => ({
  filePath: "a.ts",
  oldFilePath: null,
  changeType: "modified",
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 3,
  patchText: `@@ -1,3 +1,3 @@\n ctx\n-${fingerprint} old\n+${fingerprint} new`,
  fingerprint,
  ...overrides,
});

const previous = (id: string, fingerprint: string, overrides: Partial<Hunk> = {}): Hunk => ({
  ...next(fingerprint),
  id,
  reviewId: "rev_1",
  roundId: "rnd_1",
  position: 0,
  present: true,
  ...overrides,
});

describe("matchHunks", () => {
  it("pairs by fingerprint and reports added and missing hunks", () => {
    const result = matchHunks(
      [previous("h_a", "fa", { position: 0 }), previous("h_b", "fb", { position: 1 })],
      [next("fb"), next("fc")],
    );
    expect(result.matched.map((pair) => [pair.previous.id, pair.next.fingerprint])).toEqual([["h_b", "fb"]]);
    expect(result.added.map((hunk) => hunk.fingerprint)).toEqual(["fc"]);
    expect(result.missing.map((hunk) => hunk.id)).toEqual(["h_a"]);
  });

  it("uses each previous hunk at most once when fingerprints repeat", () => {
    const result = matchHunks(
      [previous("h_1", "dup", { position: 0 }), previous("h_2", "dup", { position: 1 })],
      [next("dup"), next("dup"), next("dup")],
    );
    expect(result.matched.map((pair) => pair.previous.id)).toEqual(["h_1", "h_2"]);
    expect(result.added).toHaveLength(1);
    expect(result.missing).toEqual([]);
  });

  it("prefers present hunks over ones already marked missing", () => {
    const result = matchHunks(
      [previous("h_gone", "dup", { position: 0, present: false }), previous("h_live", "dup", { position: 1 })],
      [next("dup")],
    );
    expect(result.matched[0]?.previous.id).toBe("h_live");
    expect(result.missing.map((hunk) => hunk.id)).toEqual(["h_gone"]);
  });

  it("matches a renamed file's hunk by its changed lines", () => {
    const result = matchHunks(
      [previous("h_r", "old-path-fp", { filePath: "old.ts" })],
      [next("new-path-fp", { filePath: "new.ts", oldFilePath: "old.ts", changeType: "renamed", patchText: previous("x", "old-path-fp").patchText })],
    );
    expect(result.matched.map((pair) => pair.previous.id)).toEqual(["h_r"]);
    expect(result.added).toEqual([]);
  });

  it("does not match same changed lines in an unrelated file", () => {
    const result = matchHunks(
      [previous("h_r", "fp-1", { filePath: "one.ts" })],
      [next("fp-2", { filePath: "two.ts", patchText: previous("x", "fp-1").patchText })],
    );
    expect(result.matched).toEqual([]);
  });

  it("treats a hunk whose added line moved past an unchanged line as missing plus added", () => {
    const before = "@@ -1,3 +1,4 @@\n const user = make();\n+await mailer.sendWelcome(email);\n await store.save(user);\n return user;";
    const after = "@@ -1,3 +1,4 @@\n const user = make();\n await store.save(user);\n+await mailer.sendWelcome(email);\n return user;";
    const result = matchHunks([previous("h_1", "same", { patchText: before })], [next("same", { patchText: after })]);
    expect(result.matched).toEqual([]);
    expect(result.added.map((hunk) => hunk.fingerprint)).toEqual(["same"]);
    expect(result.missing.map((hunk) => hunk.id)).toEqual(["h_1"]);
  });

  it("still matches when only far-away context and line numbers changed", () => {
    const before = "@@ -1,5 +1,6 @@\n a\n b\n c\n+added\n d\n e";
    const after = "@@ -9,5 +9,6 @@\n x\n y\n c\n+added\n d\n z";
    const result = matchHunks([previous("h_1", "same", { patchText: before })], [next("same", { patchText: after })]);
    expect(result.matched.map((pair) => pair.previous.id)).toEqual(["h_1"]);
  });

  it("handles empty inputs", () => {
    expect(matchHunks([], [])).toEqual({ matched: [], added: [], missing: [] });
  });
});

describe("changedLinesSignature", () => {
  it("keeps only +/- lines, ignoring the header and context", () => {
    expect(changedLinesSignature("@@ -1,2 +5,2 @@\n ctx\n-old\n+new\n\\ No newline at end of file")).toBe("-old\n+new");
  });
});

describe("placementSignature", () => {
  it("keeps changed lines, the context between them and one context line on each side", () => {
    expect(placementSignature("@@ -1,7 +1,7 @@\n a\n b\n-old\n mid\n+new\n c\n d\n\\ No newline at end of file")).toBe(" b\n-old\n mid\n+new\n c");
  });
});
