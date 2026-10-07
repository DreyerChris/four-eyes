import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding, Hunk } from "@shared/domain";
import { findingsRepo, hunksRepo, reviewsRepo, roundsRepo } from "../db/repositories";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { createTestContext, type TestContextHandle } from "../test/context";
import { matchFindings, reconcileFindings } from "./lifecycle";

const finding = (overrides: Partial<Finding>): Finding => ({
  id: newId("fnd"),
  reviewId: "rev_x",
  roundId: "rnd_1",
  severity: "bug",
  title: "Title",
  explanation: "Explanation",
  suggestedFix: null,
  lifecycle: "new",
  userVerdict: null,
  hunkIds: [],
  range: null,
  ...overrides,
});

describe("matchFindings", () => {
  it("pairs by normalized title and severity first, then by shared hunk", () => {
    const a = finding({ title: "Missing null check", hunkIds: ["h_1"] });
    const b = finding({ severity: "nit", title: "Rename variable", hunkIds: ["h_2"] });
    const result = matchFindings(
      [finding({ title: "missing NULL check.", hunkIds: ["h_9"] }), finding({ severity: "nit", title: "Variable naming", hunkIds: ["h_2"] })],
      [b, a],
    );
    expect(result.pairs.map((pair) => pair.earlier.id)).toEqual([a.id, b.id]);
    expect(result.unmatchedEarlier).toEqual([]);
  });

  it("does not pair different severities on a shared hunk with different titles", () => {
    const result = matchFindings([finding({ severity: "risk", title: "A", hunkIds: ["h_1"] })], [finding({ title: "B", hunkIds: ["h_1"] })]);
    expect(result.pairs).toEqual([]);
  });
});

describe("reconcileFindings", () => {
  const state: { handle: TestContextHandle | null; reviewId: string; round1: string; round2: string; hunks: readonly Hunk[] } = {
    handle: null,
    reviewId: "",
    round1: "",
    round2: "",
    hunks: [],
  };

  beforeEach(() => {
    const handle = createTestContext();
    const db = handle.ctx.db;
    const now = nowIso();
    const reviewId = newId("rev");
    reviewsRepo.insertReview(db, {
      id: reviewId,
      host: "github.com",
      owner: "o",
      repo: "r",
      prNumber: 1,
      title: "t",
      author: "a",
      url: "u",
      baseSha: "b",
      headSha: "h2",
      ghState: "open",
      status: "active",
      pipelineStatus: "ready",
      pipelineError: null,
      worktreePath: null,
      qaSessionId: null,
      remoteHeadSha: null,
      remoteCheckedAt: null,
      myReviewState: null,
      myReviewSubmittedAt: null,
      myReviewCommitSha: null,
      createdAt: now,
      lastActivityAt: now,
      finishedAt: null,
    });
    const round1 = roundsRepo.insertRound(db, { id: newId("rnd"), reviewId, number: 1, headSha: "h1", createdAt: now }).id;
    const round2 = roundsRepo.insertRound(db, { id: newId("rnd"), reviewId, number: 2, headSha: "h2", createdAt: now }).id;
    const hunks = hunksRepo.insertHunks(
      db,
      [0, 1, 2].map((position) => ({
        id: newId("h"),
        reviewId,
        roundId: round1,
        fingerprint: `fp${position}`,
        filePath: "a.ts",
        oldFilePath: null,
        changeType: "modified" as const,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        patchText: "@@ -1 +1 @@\n-a\n+b",
        position,
        present: true,
      })),
    );
    Object.assign(state, { handle, reviewId, round1, round2, hunks });
  });

  afterEach(() => {
    state.handle?.close();
    state.handle = null;
  });

  const insert = (rows: readonly Partial<Finding>[]): readonly Finding[] => {
    if (!state.handle) throw new Error("no context");
    return findingsRepo.insertFindings(
      state.handle.ctx.db,
      rows.map((row) => finding({ reviewId: state.reviewId, ...row })),
    );
  };

  const hunkId = (index: number): string => state.hunks[index]?.id ?? "";

  it("keeps a finding's line range through storage and through being resolved", async () => {
    if (!state.handle) throw new Error("no context");
    const range = { side: "new", startLine: 3, endLine: 4 } as const;
    const [ranged] = insert([{ roundId: state.round1, title: "Ranged", hunkIds: [hunkId(0)], range }]);
    expect(findingsRepo.getFinding(state.handle.ctx.db, ranged?.id ?? "")?.range).toEqual(range);

    await reconcileFindings(state.handle.ctx, state.reviewId, state.round2);

    const after = findingsRepo.listFindings(state.handle.ctx.db, state.reviewId).find((row) => row.title === "Ranged");
    expect(after?.lifecycle).toBe("resolved");
    expect(after?.range).toEqual(range);
  });

  it("marks matches still_present with the earlier verdict, resolves the rest, and leaves each issue once", async () => {
    if (!state.handle) throw new Error("no context");
    const [kept, gone, alreadyResolved] = insert([
      { roundId: state.round1, title: "Race condition", hunkIds: [hunkId(0)], userVerdict: "agree" },
      { roundId: state.round1, severity: "nit", title: "Spacing", hunkIds: [hunkId(1)], userVerdict: "disagree" },
      { roundId: state.round1, severity: "risk", title: "Old", hunkIds: [hunkId(2)], lifecycle: "resolved" },
    ]);
    insert([
      { roundId: state.round2, title: "Race condition", hunkIds: [hunkId(0)] },
      { roundId: state.round2, severity: "improvement", title: "Extract helper", hunkIds: [hunkId(2)] },
    ]);

    await reconcileFindings(state.handle.ctx, state.reviewId, state.round2);

    const after = findingsRepo.listFindings(state.handle.ctx.db, state.reviewId);
    const byTitle = (title: string): Finding | undefined => after.find((row) => row.title === title);
    expect(after).toHaveLength(4);
    expect(after.some((row) => row.id === kept?.id)).toBe(false);
    expect(byTitle("Race condition")).toMatchObject({ roundId: state.round2, lifecycle: "still_present", userVerdict: "agree" });
    expect(byTitle("Spacing")).toMatchObject({ id: gone?.id, lifecycle: "resolved", userVerdict: "disagree" });
    expect(byTitle("Old")).toMatchObject({ id: alreadyResolved?.id, lifecycle: "resolved" });
    expect(byTitle("Extract helper")?.lifecycle).toBe("new");
  });

  it("is a no-op for the first round", async () => {
    if (!state.handle) throw new Error("no context");
    insert([{ roundId: state.round1, title: "Only", hunkIds: [hunkId(0)] }]);
    await reconcileFindings(state.handle.ctx, state.reviewId, state.round1);
    expect(findingsRepo.listFindings(state.handle.ctx.db, state.reviewId)[0]?.lifecycle).toBe("new");
  });
});
