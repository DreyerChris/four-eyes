import { describe, expect, it } from "vitest";
import type { Hunk } from "@shared/domain";
import { categorizeFile, fallbackChunkPlan } from "./fallback";

const hunk = (id: string, filePath: string, position: number): Hunk => ({
  id,
  reviewId: "rev_1",
  roundId: "rnd_1",
  fingerprint: id,
  position,
  present: true,
  filePath,
  oldFilePath: null,
  changeType: "modified",
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 2,
  patchText: "@@ -1,1 +1,2 @@\n-a\n+b\n+c",
});

describe("categorizeFile", () => {
  it.each([
    ["pnpm-lock.yaml", "skim"],
    ["web/package-lock.json", "skim"],
    ["go.sum", "skim"],
    ["src/__snapshots__/view.test.tsx.snap", "skim"],
    ["src/api/generated/client.ts", "skim"],
    ["dist/bundle.min.js", "skim"],
    ["src/user.test.ts", "tests"],
    ["tests/test_user.py", "tests"],
    ["pkg/user_test.go", "tests"],
    ["e2e/smoke.spec.ts", "tests"],
    ["src/types/user.ts", "types"],
    ["shared/domain.ts", "types"],
    ["src/global.d.ts", "types"],
    ["proto/user.proto", "types"],
    ["server/routes/users.ts", "wiring"],
    ["server/main.ts", "wiring"],
    ["package.json", "wiring"],
    ["vite.config.ts", "wiring"],
    ["src/services/user-service.ts", "logic"],
  ] as const)("%s is %s", (path, category) => {
    expect(categorizeFile(path)).toBe(category);
  });
});

describe("fallbackChunkPlan", () => {
  it("makes one chunk per file in types → logic → wiring → tests order with skim files last", () => {
    const hunks = [
      hunk("h_test", "src/user.test.ts", 0),
      hunk("h_lock", "pnpm-lock.yaml", 1),
      hunk("h_route", "server/routes/users.ts", 2),
      hunk("h_svc1", "src/services/user.ts", 3),
      hunk("h_type", "src/types/user.ts", 4),
      hunk("h_svc2", "src/services/user.ts", 5),
      hunk("h_snap", "src/__snapshots__/a.snap", 6),
    ];
    const plan = fallbackChunkPlan(hunks);
    expect(plan.chunks.map((chunk) => chunk.title)).toEqual([
      "src/types/user.ts",
      "src/services/user.ts",
      "server/routes/users.ts",
      "src/user.test.ts",
      "Skim: lockfiles, generated code and snapshots",
    ]);
    expect(plan.chunks[1]?.hunkIds).toEqual(["h_svc1", "h_svc2"]);
    expect(plan.chunks[4]).toMatchObject({ kind: "skim", hunkIds: ["h_lock", "h_snap"] });
    expect(plan.chunks.slice(0, 4).every((chunk) => chunk.kind === "core")).toBe(true);
  });

  it("keeps diff order within a category and orders hunks by position", () => {
    const plan = fallbackChunkPlan([hunk("h_b2", "src/b.ts", 3), hunk("h_a", "src/a.ts", 1), hunk("h_b1", "src/b.ts", 0)]);
    expect(plan.chunks.map((chunk) => chunk.hunkIds)).toEqual([["h_b1", "h_b2"], ["h_a"]]);
  });

  it("uses every hunk exactly once", () => {
    const hunks = ["a.ts", "b.ts", "yarn.lock", "c.test.ts", "a.ts"].map((path, index) => hunk(`h_${index}`, path, index));
    const ids = fallbackChunkPlan(hunks).chunks.flatMap((chunk) => chunk.hunkIds);
    expect([...ids].sort()).toEqual(hunks.map((h) => h.id).sort());
  });

  it("returns no chunks for no hunks", () => {
    expect(fallbackChunkPlan([])).toEqual({ chunks: [] });
  });

  it("summarises line counts in the explanation", () => {
    expect(fallbackChunkPlan([hunk("h_1", "src/a.ts", 0)]).chunks[0]?.explanation).toContain("1 hunk, +2 -1");
  });
});
