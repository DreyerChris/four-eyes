import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding, Hunk } from "@shared/domain";
import {
  chunkProgressRepo,
  chunksRepo,
  findingsRepo,
  hunksRepo,
  reviewsRepo,
  roundsRepo,
} from "../db/repositories";
import { newId } from "../lib/ids";
import { createTestContext, type TestContextHandle } from "../test/context";
import { startApplyRefresh } from "./apply";
import { createTempRepo, joinLines, numberedLines, type TempRepo } from "./testing/git-repo";
import { createFakeDeps, createFakeGitHub, prMeta, seedReview, type FakeGitHub, type ScriptedReview, type SeededReview } from "./testing/fixture";

const replaceLine = (lines: readonly string[], lineNumber: number, text: string): readonly string[] =>
  lines.map((line, index) => (index === lineNumber - 1 ? text : line));

const TYPES = numberedLines(30, "type");
const LOGIC = numberedLines(40, "logic");
const UTIL = numberedLines(30, "util");

const FEATURE_FILES = {
  "src/types.ts": joinLines(replaceLine(TYPES, 5, "type 5 changed")),
  "src/logic.ts": joinLines(replaceLine(LOGIC, 20, "logic 20 changed")),
  "src/util.ts": joinLines(replaceLine(UTIL, 25, "util 25 changed")),
};

interface Setup {
  readonly handle: TestContextHandle;
  readonly repo: TempRepo;
  readonly github: FakeGitHub;
  readonly baseSha: string;
  readonly headSha: string;
  readonly seeded: SeededReview;
}

const hunkFor = (hunks: readonly Hunk[], filePath: string): Hunk => {
  const hunk = hunks.find((candidate) => candidate.filePath === filePath);
  if (!hunk) throw new Error(`No hunk for ${filePath}`);
  return hunk;
};

const seedFinding = (setup: Setup, input: Pick<Finding, "severity" | "title" | "hunkIds" | "userVerdict">): Finding => {
  const [row] = findingsRepo.insertFindings(setup.handle.ctx.db, [
    {
      ...input,
      id: newId("fnd"),
      reviewId: setup.seeded.review.id,
      roundId: setup.seeded.round.id,
      explanation: "Seeded",
      suggestedFix: null,
      lifecycle: "new",
      range: null,
    },
  ]);
  if (!row) throw new Error("finding not inserted");
  return row;
};

describe("applyRefresh with real temp git repos", () => {
  const state: { setup: Setup | null } = { setup: null };

  const setup = (): Setup => {
    if (!state.setup) throw new Error("setup missing");
    return state.setup;
  };

  beforeEach(async () => {
    const repo = createTempRepo();
    const baseSha = repo.commit("base", {
      "src/types.ts": joinLines(TYPES),
      "src/logic.ts": joinLines(LOGIC),
      "src/util.ts": joinLines(UTIL),
    });
    repo.git("checkout", "--quiet", "-b", "feature");
    const headSha = repo.commit("feature", FEATURE_FILES);
    const github = createFakeGitHub(prMeta(baseSha, headSha));
    const handle = createTestContext({ github });
    const seeded = await seedReview(handle.ctx, repo, baseSha, headSha);
    state.setup = { handle, repo, github, baseSha, headSha, seeded };
  });

  afterEach(() => {
    state.setup?.handle.close();
    state.setup?.repo.remove();
    state.setup = null;
  });

  const refresh = async (
    headSha: string,
    baseSha: string = setup().baseSha,
    review: ScriptedReview = () => [],
  ): Promise<{ readonly response: Awaited<ReturnType<typeof startApplyRefresh>>["response"]; readonly moved: readonly string[] }> => {
    const { handle, github, repo, seeded } = setup();
    github.setPr({ headSha, baseSha });
    const fake = createFakeDeps(repo, review);
    const started = await startApplyRefresh(handle.ctx, seeded.review.id, fake.deps);
    await started.background;
    return { response: started.response, moved: fake.movedTo() };
  };

  it("seeds three hunks, one per file", () => {
    expect(setup().seeded.hunks.map((hunk) => hunk.filePath)).toEqual(["src/logic.ts", "src/types.ts", "src/util.ts"]);
  });

  it("normal push: keeps existing hunks and progress, adds Round 2 for the new hunk", async () => {
    const { handle, repo, seeded } = setup();
    const db = handle.ctx.db;
    const logicHunk = hunkFor(seeded.hunks, "src/logic.ts");
    const logicChunk = seeded.chunks[seeded.hunks.indexOf(logicHunk)];
    if (!logicChunk) throw new Error("missing chunk");
    chunkProgressRepo.upsertChunkProgress(db, logicChunk.id, { status: "good", note: "checked" });

    const pushed = repo.commit("more logic", {
      "src/logic.ts": joinLines(replaceLine(replaceLine(LOGIC, 20, "logic 20 changed"), 36, "logic 36 changed")),
    });
    const { response, moved } = await refresh(pushed);

    expect(moved).toEqual([pushed]);
    expect(response).toMatchObject({ matchedHunks: 3, addedHunks: 1, missingHunks: 0, roundNumber: 2 });
    const review = reviewsRepo.requireReview(db, seeded.review.id);
    expect(review.headSha).toBe(pushed);
    expect(review.remoteHeadSha).toBe(pushed);
    expect(review.pipelineStatus).toBe("ready");

    const hunks = hunksRepo.listHunks(db, seeded.review.id);
    expect(hunks).toHaveLength(4);
    expect(hunks.slice(0, 3).map((hunk) => hunk.id)).toEqual(seeded.hunks.map((hunk) => hunk.id));
    const added = hunks[3];
    expect(added?.roundId).toBe(response.roundId);
    expect(added?.position).toBe(3);
    expect(added?.patchText).toContain("+logic 36 changed");
    expect(hunks.every((hunk) => hunk.present)).toBe(true);

    expect(chunkProgressRepo.getChunkProgress(db, logicChunk.id)).toMatchObject({ status: "good", note: "checked" });
    const round2Chunks = chunksRepo.listChunks(db, seeded.review.id).filter((chunk) => chunk.roundId === response.roundId);
    expect(round2Chunks).toHaveLength(1);
    expect(roundsRepo.listRounds(db, seeded.review.id).map((round) => round.number)).toEqual([1, 2]);
  });

  it("moving a changed line past an unchanged one: the old hunk goes missing and the moved code lands in Round 2", async () => {
    const { handle, repo, seeded } = setup();
    const db = handle.ctx.db;
    const logicHunk = hunkFor(seeded.hunks, "src/logic.ts");
    const logicChunk = seeded.chunks[seeded.hunks.indexOf(logicHunk)];
    if (!logicChunk) throw new Error("missing chunk");
    chunkProgressRepo.upsertChunkProgress(db, logicChunk.id, { status: "good", note: "" });

    const swapped = LOGIC.map((line, index) => (index === 19 ? "logic 21" : index === 20 ? "logic 20 changed" : line));
    const pushed = repo.commit("move the call", { "src/logic.ts": joinLines(swapped) });
    const { response } = await refresh(pushed);

    expect(response).toMatchObject({ matchedHunks: 2, addedHunks: 1, missingHunks: 1, roundNumber: 2 });
    const hunks = hunksRepo.listHunks(db, seeded.review.id);
    expect(hunks.find((hunk) => hunk.id === logicHunk.id)?.present).toBe(false);
    expect(hunks.find((hunk) => hunk.roundId === response.roundId)?.patchText).toContain("+logic 20 changed");
  });

  it("normal push: reconciles findings into still_present and resolved", async () => {
    const current = setup();
    const { handle, repo, seeded } = current;
    const logicHunk = hunkFor(seeded.hunks, "src/logic.ts");
    const utilHunk = hunkFor(seeded.hunks, "src/util.ts");
    const kept = seedFinding(current, { severity: "bug", title: "Null check missing", hunkIds: [logicHunk.id], userVerdict: "agree" });
    const fixed = seedFinding(current, { severity: "nit", title: "Typo in util", hunkIds: [utilHunk.id], userVerdict: null });

    const pushed = repo.commit("more logic", {
      "src/logic.ts": joinLines(replaceLine(replaceLine(LOGIC, 20, "logic 20 changed"), 36, "logic 36 changed")),
    });
    await refresh(pushed, current.baseSha, (present) => [
      { severity: "bug", title: "Null check missing!", hunkIds: [hunkFor(present, "src/logic.ts").id] },
      { severity: "risk", title: "New risk", hunkIds: [present[present.length - 1]?.id ?? ""] },
    ]);

    const findings = findingsRepo.listFindings(handle.ctx.db, seeded.review.id);
    expect(findings.find((finding) => finding.id === kept.id)).toBeUndefined();
    expect(findings.find((finding) => finding.title === "Null check missing!")).toMatchObject({
      lifecycle: "still_present",
      userVerdict: "agree",
    });
    expect(findings.find((finding) => finding.id === fixed.id)?.lifecycle).toBe("resolved");
    expect(findings.find((finding) => finding.title === "New risk")?.lifecycle).toBe("new");
    expect(findings).toHaveLength(3);
  });

  it("rebase onto a moved base: matches every hunk, updates line numbers, reuses the latest round", async () => {
    const current = setup();
    const { handle, repo, seeded } = current;
    const db = handle.ctx.db;
    const finding = seedFinding(current, {
      severity: "bug",
      title: "Off by one",
      hunkIds: [hunkFor(seeded.hunks, "src/logic.ts").id],
      userVerdict: "unsure",
    });
    repo.git("checkout", "--quiet", "main");
    const movedBase = repo.commit("main moves", {
      "src/logic.ts": joinLines(["header 1", "header 2", "header 3", "header 4", "header 5", ...LOGIC]),
    });
    repo.git("checkout", "--quiet", "feature");
    repo.git("rebase", "--quiet", "main");
    const rebased = repo.head();

    const { response } = await refresh(rebased, movedBase, (present) => [
      { severity: "bug", title: "Off by one", hunkIds: [hunkFor(present, "src/logic.ts").id] },
    ]);

    expect(response).toMatchObject({ matchedHunks: 3, addedHunks: 0, missingHunks: 0, roundNumber: 1, roundId: seeded.round.id });
    const logic = hunksRepo.requireHunk(db, hunkFor(seeded.hunks, "src/logic.ts").id);
    expect(logic.newStart).toBe(hunkFor(seeded.hunks, "src/logic.ts").newStart + 5);
    expect(reviewsRepo.requireReview(db, seeded.review.id)).toMatchObject({ baseSha: movedBase, headSha: rebased });
    expect(roundsRepo.listRounds(db, seeded.review.id)).toHaveLength(1);

    const findings = findingsRepo.listFindings(db, seeded.review.id);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ title: "Off by one", lifecycle: "still_present", userVerdict: "unsure" });
    expect(findings[0]?.id).not.toBe(finding.id);
  });

  it("force-push that rewrites one hunk: old hunk goes missing, rewrite lands in Round 2", async () => {
    const { handle, repo, seeded, baseSha } = setup();
    const db = handle.ctx.db;
    repo.git("reset", "--quiet", "--hard", baseSha);
    const forced = repo.commit("feature rewritten", {
      ...FEATURE_FILES,
      "src/logic.ts": joinLines(replaceLine(LOGIC, 20, "logic 20 rewritten differently")),
    });

    const { response } = await refresh(forced);

    expect(response).toMatchObject({ matchedHunks: 2, addedHunks: 1, missingHunks: 1, roundNumber: 2 });
    const oldLogic = hunksRepo.requireHunk(db, hunkFor(seeded.hunks, "src/logic.ts").id);
    expect(oldLogic.present).toBe(false);
    expect(hunksRepo.requireHunk(db, hunkFor(seeded.hunks, "src/types.ts").id).present).toBe(true);
    const round2 = hunksRepo.listHunks(db, seeded.review.id, { roundId: response.roundId ?? "" });
    expect(round2).toHaveLength(1);
    expect(round2[0]?.patchText).toContain("+logic 20 rewritten differently");
  });

  it("revert of a hunk: the reverted hunk is no longer in the PR and no round is added", async () => {
    const { handle, repo, seeded } = setup();
    const db = handle.ctx.db;
    const reverted = repo.commit("revert util", { "src/util.ts": joinLines(UTIL) });

    const { response } = await refresh(reverted);

    expect(response).toMatchObject({ matchedHunks: 2, addedHunks: 0, missingHunks: 1, roundNumber: 1 });
    expect(hunksRepo.requireHunk(db, hunkFor(seeded.hunks, "src/util.ts").id).present).toBe(false);
    expect(hunksRepo.listHunks(db, seeded.review.id, { presentOnly: true })).toHaveLength(2);
    expect(roundsRepo.listRounds(db, seeded.review.id)).toHaveLength(1);
  });

  it("revert then re-apply: the missing hunk comes back with its original row", async () => {
    const { handle, repo, seeded } = setup();
    const db = handle.ctx.db;
    const utilId = hunkFor(seeded.hunks, "src/util.ts").id;
    await refresh(repo.commit("revert util", { "src/util.ts": joinLines(UTIL) }));
    const { response } = await refresh(repo.commit("reapply util", { "src/util.ts": FEATURE_FILES["src/util.ts"] }));

    expect(response).toMatchObject({ matchedHunks: 3, addedHunks: 0, missingHunks: 0 });
    expect(hunksRepo.requireHunk(db, utilId).present).toBe(true);
  });

  it("file rename: the renamed file's hunk keeps its row and takes the new path", async () => {
    const { handle, repo, seeded } = setup();
    const db = handle.ctx.db;
    repo.git("mv", "src/util.ts", "src/helpers.ts");
    const renamed = repo.commit("rename util to helpers");

    const { response } = await refresh(renamed);

    expect(response).toMatchObject({ matchedHunks: 3, addedHunks: 0, missingHunks: 0 });
    const hunk = hunksRepo.requireHunk(db, hunkFor(seeded.hunks, "src/util.ts").id);
    expect(hunk).toMatchObject({ filePath: "src/helpers.ts", oldFilePath: "src/util.ts", changeType: "renamed", present: true });
  });

  it("returns an up-to-date response without background work when the head is unchanged", async () => {
    const { handle, seeded, headSha } = setup();
    const { response, moved } = await refresh(headSha);
    expect(moved).toEqual([]);
    expect(response).toMatchObject({ matchedHunks: 3, addedHunks: 0, missingHunks: 0, roundId: seeded.round.id });
    expect(handle.ctx.events.history(seeded.review.id).some((event) => event.type === "step" && event.state === "skipped")).toBe(true);
  });

  it("moves the review to past instead of refreshing when the PR was merged", async () => {
    const { handle, github, repo, seeded } = setup();
    github.setPr({ state: "merged" });
    const fake = createFakeDeps(repo);
    await expect(startApplyRefresh(handle.ctx, seeded.review.id, fake.deps)).rejects.toThrow(/merged/);
    expect(fake.pastCalls()).toEqual([seeded.review.id]);
    expect(reviewsRepo.requireReview(handle.ctx.db, seeded.review.id)).toMatchObject({ status: "past", ghState: "merged" });
  });

  it("rejects refreshing a past review and a second concurrent refresh", async () => {
    const { handle, repo, seeded } = setup();
    const pushed = repo.commit("more", { "src/types.ts": joinLines(replaceLine(replaceLine(TYPES, 5, "type 5 changed"), 25, "x")) });
    setup().github.setPr({ headSha: pushed });
    const fake = createFakeDeps(repo);
    const first = await startApplyRefresh(handle.ctx, seeded.review.id, fake.deps);
    await expect(startApplyRefresh(handle.ctx, seeded.review.id, fake.deps)).rejects.toThrow(/already running/);
    expect(first.response.status.refreshing).toBe(true);
    await first.background;

    reviewsRepo.updateReview(handle.ctx.db, seeded.review.id, { status: "past" });
    await expect(startApplyRefresh(handle.ctx, seeded.review.id, fake.deps)).rejects.toThrow(/read-only/);
  });

  it("publishes refresh step events and a failed step when the background review throws", async () => {
    const { handle, repo, seeded } = setup();
    const pushed = repo.commit("revert util", { "src/util.ts": joinLines(UTIL) });
    setup().github.setPr({ headSha: pushed });
    const fake = createFakeDeps(repo);
    const failing = { ...fake.deps, runReview: async (): Promise<readonly Finding[]> => Promise.reject(new Error("model unavailable")) };
    const started = await startApplyRefresh(handle.ctx, seeded.review.id, failing);
    await started.background;
    const steps = handle.ctx.events
      .history(seeded.review.id)
      .flatMap((event) => (event.type === "step" && event.step === "refresh" ? [event.state] : []));
    expect(steps[0]).toBe("started");
    expect(steps[steps.length - 1]).toBe("failed");
    expect(started.response.status.refreshing).toBe(true);
    expect(handle.ctx.events.history(seeded.review.id).at(-1)).toMatchObject({ type: "refresh_status", status: { refreshing: false } });
  });
});
