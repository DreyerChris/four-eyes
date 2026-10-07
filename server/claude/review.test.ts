import { afterEach, describe, expect, it } from "vitest";
import { claudeRunsRepo, findingsRepo, hunksRepo, verdictsRepo } from "../db/repositories";
import { createTestContext, type TestContextHandle } from "../test/context";
import { createScriptedRunner, seedReviewWithHunks } from "./test-support";
import { numberPatchLines } from "./format";
import { buildReviewPrompt, runReview, validateReviewResult } from "./review";

interface ResultFinding {
  readonly hunkIds: readonly string[];
  readonly title?: string;
  readonly range?: { readonly side: "old" | "new"; readonly startLine: number; readonly endLine: number };
}

const result = (findings: readonly ResultFinding[]): unknown => ({
  verdict: { summary: "Looks fine.", suggestion: "approve_with_nits" },
  findings: findings.map((finding, index) => ({
    severity: "nit",
    title: finding.title ?? `Finding ${index + 1}`,
    explanation: "Because.",
    hunkIds: finding.hunkIds,
    ...(finding.range === undefined ? {} : { range: finding.range }),
  })),
});

describe("validateReviewResult", () => {
  const ids = [
    { id: "h_1", oldStart: 10, oldLines: 4, newStart: 10, newLines: 6 },
    { id: "h_2", oldStart: 40, oldLines: 3, newStart: 42, newLines: 0 },
  ];

  it("removes unknown hunk IDs and drops findings left without any", () => {
    const validated = validateReviewResult(
      result([
        { hunkIds: ["h_1", "h_9"], title: "kept" },
        { hunkIds: ["h_9"], title: "dropped" },
        { hunkIds: ["h_2", "h_2"], title: "deduped" },
      ]),
      ids,
    );
    if (!validated.ok) throw new Error(validated.error);
    expect(validated.value.findings.map((finding) => [finding.title, finding.hunkIds])).toEqual([
      ["kept", ["h_1"]],
      ["deduped", ["h_2"]],
    ]);
    expect(validated.value.verdict.suggestion).toBe("approve_with_nits");
  });

  it("rejects output that does not match the schema", () => {
    const validated = validateReviewResult({ verdict: { summary: "x", suggestion: "ship it" }, findings: [] }, ids);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.error).toMatch(/verdict\.suggestion/);
  });

  it("keeps a line range that fits inside one of the finding's hunks", () => {
    const validated = validateReviewResult(
      result([
        { hunkIds: ["h_1"], title: "new side", range: { side: "new", startLine: 11, endLine: 15 } },
        { hunkIds: ["h_2", "h_1"], title: "old side", range: { side: "old", startLine: 40, endLine: 42 } },
      ]),
      ids,
    );
    if (!validated.ok) throw new Error(validated.error);
    expect(validated.value.findings.map((finding) => finding.range)).toEqual([
      { side: "new", startLine: 11, endLine: 15 },
      { side: "old", startLine: 40, endLine: 42 },
    ]);
  });

  it("drops ranges outside the hunks, on an empty side, reversed, or pointing at another finding's hunk, but keeps the finding", () => {
    const validated = validateReviewResult(
      result([
        { hunkIds: ["h_1"], title: "past the end", range: { side: "new", startLine: 14, endLine: 16 } },
        { hunkIds: ["h_2"], title: "empty new side", range: { side: "new", startLine: 42, endLine: 42 } },
        { hunkIds: ["h_1"], title: "reversed", range: { side: "new", startLine: 12, endLine: 11 } },
        { hunkIds: ["h_2"], title: "other hunk", range: { side: "new", startLine: 11, endLine: 11 } },
        { hunkIds: ["h_1"], title: "zero", range: { side: "old", startLine: 0, endLine: 10 } },
      ]),
      ids,
    );
    if (!validated.ok) throw new Error(validated.error);
    expect(validated.value.findings.map((finding) => [finding.title, finding.range])).toEqual([
      ["past the end", undefined],
      ["empty new side", undefined],
      ["reversed", undefined],
      ["other hunk", undefined],
      ["zero", undefined],
    ]);
  });
});

describe("runReview", () => {
  let handle: TestContextHandle | undefined;
  afterEach(() => handle?.close());

  it("reviews present hunks, saves findings as new with the verdict, and publishes review_updated", async () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review, round, hunks } = seedReviewWithHunks(ctx, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    hunksRepo.setHunksPresent(ctx.db, [hunks[2]?.id ?? ""], false);

    const findings = await runReview(ctx, { reviewId: review.id, roundId: round.id });

    expect(findings.map((finding) => finding.severity)).toEqual(["bug", "nit"]);
    expect(findings.every((finding) => finding.lifecycle === "new" && finding.roundId === round.id)).toBe(true);
    expect(findings[1]?.hunkIds).toEqual([hunks[1]?.id]);
    expect(findingsRepo.listFindings(ctx.db, review.id)).toHaveLength(2);
    expect(verdictsRepo.getLatestVerdict(ctx.db, review.id)?.suggestion).toBe("request_changes");
    expect(claudeRunsRepo.getLatestRun(ctx.db, review.id, "review")?.status).toBe("succeeded");
    expect(ctx.events.history(review.id).some((event) => event.type === "review_updated")).toBe(true);
  });

  it("drops findings that only reference unknown hunks", async () => {
    const steps: { output: unknown }[] = [{ output: null }];
    const runner = createScriptedRunner(steps);
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review, round, hunks } = seedReviewWithHunks(ctx, ["src/a.ts"]);
    steps[0] = { output: result([{ hunkIds: [hunks[0]?.id ?? ""] }, { hunkIds: ["h_ghost"] }]) };

    const findings = await runReview(ctx, { reviewId: review.id, roundId: round.id });
    expect(findings).toHaveLength(1);
  });

  it("throws and logs a failed run when both attempts are invalid", async () => {
    const runner = createScriptedRunner([{ output: "garbage" }, { output: { findings: "nope" } }]);
    handle = createTestContext({ claude: runner });
    const { ctx } = handle;
    const { review, round } = seedReviewWithHunks(ctx, ["src/a.ts"]);

    await expect(runReview(ctx, { reviewId: review.id, roundId: round.id })).rejects.toThrow(/Review failed/);
    expect(runner.structuredRequests).toHaveLength(2);
    expect(claudeRunsRepo.getLatestRun(ctx.db, review.id, "review")?.status).toBe("failed");
    expect(findingsRepo.listFindings(ctx.db, review.id)).toHaveLength(0);
    expect(ctx.events.history(review.id).some((event) => event.type === "step" && event.step === "review" && event.state === "failed")).toBe(true);
  });

  it("replaces earlier findings for the same round when re-run", async () => {
    handle = createTestContext();
    const { ctx } = handle;
    const { review, round } = seedReviewWithHunks(ctx, ["src/a.ts", "src/b.ts"]);
    await runReview(ctx, { reviewId: review.id, roundId: round.id });
    await runReview(ctx, { reviewId: review.id, roundId: round.id });
    expect(findingsRepo.listFindings(ctx.db, review.id)).toHaveLength(2);
  });

  it("includes PR metadata and hunk IDs in the prompt", () => {
    handle = createTestContext();
    const { review, hunks } = seedReviewWithHunks(handle.ctx, ["src/a.ts"]);
    const prompt = buildReviewPrompt(review, hunks);
    expect(prompt).toContain(review.title);
    expect(prompt).toContain(`### ${hunks[0]?.id}`);
    expect(prompt).toContain("  old   new |");
    expect(prompt).toContain("range:");
  });
});

describe("numberPatchLines", () => {
  it("prefixes every line with its old and new line numbers", () => {
    const patchText = ["@@ -10,3 +10,3 @@", " keep", "-old", "+new", "\\ No newline at end of file", " tail"].join("\n");
    expect(numberPatchLines({ patchText, oldStart: 10, newStart: 10 }).split("\n")).toEqual([
      "  old   new |",
      "   10    10 |  keep",
      "   11       | -old",
      "         11 | +new",
      "            | \\ No newline at end of file",
      "   12    12 |  tail",
    ]);
  });
});
