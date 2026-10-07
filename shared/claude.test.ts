import { describe, expect, it } from "vitest";
import { CHUNK_PLAN_JSON_SCHEMA, ChunkPlanSchema, REVIEW_RESULT_JSON_SCHEMA, ReviewResultSchema } from "./claude";
import { fakeChunkPlan, fakeReviewResult } from "../server/claude/fake-runner";

describe("Claude output schemas", () => {
  it("produce object JSON Schemas for outputFormat", () => {
    expect(CHUNK_PLAN_JSON_SCHEMA).toMatchObject({ type: "object", required: ["chunks"] });
    expect(REVIEW_RESULT_JSON_SCHEMA).toMatchObject({ type: "object", required: ["verdict", "findings"] });
    expect(CHUNK_PLAN_JSON_SCHEMA).not.toHaveProperty("$schema");
  });

  it("accept the fake runner's canned output", () => {
    const ids = ["h_1", "h_2", "h_3", "h_4", "h_5"];
    const plan = ChunkPlanSchema.parse(fakeChunkPlan(ids));
    expect(plan.chunks.flatMap((c) => c.hunkIds)).toEqual(ids);
    expect(ReviewResultSchema.parse(fakeReviewResult(ids)).findings).toHaveLength(2);
  });
});
