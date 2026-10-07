import { describe, expect, it } from "vitest";
import type { Finding } from "@shared/domain";
import { fixtureFinding, fixtureHunk } from "../testFixtures";
import { anchorFindings, findingsEndingAt, rangeSeverityAt, splitHunkFindings, type LineFinding } from "./findings";
import { parsePatch } from "./model";

const hunk = fixtureHunk();
const otherHunk = fixtureHunk({ id: "h_2", filePath: "src/other.ts", oldStart: 100, newStart: 120 });
const lines = parsePatch(hunk).lines;
const lineAt = (side: "old" | "new", number: number) => {
  const line = lines.find((candidate) => (side === "old" ? candidate.oldNumber : candidate.newNumber) === number);
  if (!line) throw new Error(`no ${side} line ${number}`);
  return line;
};

const finding = (overrides: Partial<Finding>): Finding => fixtureFinding(overrides);
const lineFinding = (overrides: Partial<Finding> & Pick<LineFinding, "range">): LineFinding => ({ ...fixtureFinding(), ...overrides });

describe("anchorFindings", () => {
  it("puts a finding on the hunk its range falls in, otherwise on its first hunk in chunk order", () => {
    const ranged = finding({ id: "f_range", hunkIds: ["h_1", "h_2"], range: { side: "new", startLine: 121, endLine: 122 } });
    const plain = finding({ id: "f_plain", hunkIds: ["h_2", "h_1"] });
    const outside = finding({ id: "f_outside", hunkIds: ["h_2"], range: { side: "new", startLine: 1, endLine: 2 } });
    const elsewhere = finding({ id: "f_elsewhere", hunkIds: ["h_9"] });
    const anchored = anchorFindings([ranged, plain, outside, elsewhere], [hunk, otherHunk]);
    expect(anchored.get("h_1")?.map((item) => item.id)).toEqual(["f_plain"]);
    expect(anchored.get("h_2")?.map((item) => item.id)).toEqual(["f_range", "f_outside"]);
  });
});

describe("splitHunkFindings", () => {
  it("places ranged findings on their line and everything else at the top of the hunk", () => {
    const onAdd = finding({ id: "f_add", range: { side: "new", startLine: 11, endLine: 12 } });
    const onDel = finding({ id: "f_del", range: { side: "old", startLine: 11, endLine: 11 } });
    const noRange = finding({ id: "f_none" });
    const tooFar = finding({ id: "f_far", range: { side: "new", startLine: 12, endLine: 20 } });
    const split = splitHunkFindings([onAdd, onDel, noRange, tooFar], hunk, lines);
    expect(split.atLine.map((item) => item.id)).toEqual(["f_add", "f_del"]);
    expect(split.atHunk.map((item) => item.id)).toEqual(["f_none", "f_far"]);
  });

  it("falls back to the top when the end line is not rendered", () => {
    const ranged = finding({ range: { side: "new", startLine: 11, endLine: 12 } });
    expect(splitHunkFindings([ranged], hunk, []).atHunk).toHaveLength(1);
  });
});

describe("findingsEndingAt", () => {
  it("matches the range's side only", () => {
    const newSide = lineFinding({ id: "f_new", range: { side: "new", startLine: 10, endLine: 13 } });
    const oldSide = lineFinding({ id: "f_old", range: { side: "old", startLine: 10, endLine: 12 } });
    const context = lineAt("new", 13);
    expect(findingsEndingAt(context, "new", [newSide, oldSide]).map((item) => item.id)).toEqual(["f_new"]);
    expect(findingsEndingAt(context, "old", [newSide, oldSide]).map((item) => item.id)).toEqual(["f_old"]);
    expect(findingsEndingAt(null, "new", [newSide])).toEqual([]);
  });
});

describe("rangeSeverityAt", () => {
  it("returns the most severe unresolved finding covering the line", () => {
    const nit = lineFinding({ id: "f_nit", severity: "nit", range: { side: "new", startLine: 11, endLine: 12 } });
    const bug = lineFinding({ id: "f_bug", severity: "bug", range: { side: "new", startLine: 12, endLine: 12 } });
    const resolvedRisk = lineFinding({ id: "f_risk", severity: "risk", lifecycle: "resolved", range: { side: "new", startLine: 11, endLine: 11 } });
    expect(rangeSeverityAt([lineAt("new", 11)], [nit, bug, resolvedRisk])).toBe("nit");
    expect(rangeSeverityAt([lineAt("new", 12)], [nit, bug, resolvedRisk])).toBe("bug");
    expect(rangeSeverityAt([lineAt("old", 11)], [nit, bug])).toBeNull();
    expect(rangeSeverityAt([null], [nit])).toBeNull();
  });
});
