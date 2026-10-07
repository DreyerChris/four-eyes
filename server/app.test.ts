import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CreateReviewResponseSchema,
  ListReviewsResponseSchema,
  ReviewDetailResponseSchema,
  SeedFixtureResponseSchema,
  SummaryResponseSchema,
  buildPath,
  routes,
} from "@shared/api";
import { ChunkProgressSchema, DEFAULT_SETTINGS, SettingsSchema } from "@shared/domain";
import { createApp } from "./app";
import { FAKE_PR_URL } from "./ingest/github-client";
import { waitForIngest } from "./ingest/pipeline";
import { createTestContext, type TestContextHandle } from "./test/context";

describe("app", () => {
  let handle: TestContextHandle;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    handle = createTestContext();
    app = createApp(handle.ctx);
  });

  afterEach(() => handle.close());

  const seed = async (): Promise<string> => {
    const res = await app.request(routes.seedFixture.path, { method: "POST" });
    expect(res.status).toBe(200);
    return SeedFixtureResponseSchema.parse(await res.json()).reviewId;
  };

  it("answers health checks", async () => {
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ ok: true, fakeClaude: true });
  });

  it("serves a seeded review through list, detail and summary", async () => {
    const reviewId = await seed();

    const list = ListReviewsResponseSchema.parse(await (await app.request("/api/reviews?status=active")).json());
    expect(list.reviews.map((r) => r.id)).toEqual([reviewId]);
    expect(list.reviews[0]?.progress).toEqual({ totalChunks: 5, good: 0, flagged: 0, question: 0, unseen: 5 });

    const detail = ReviewDetailResponseSchema.parse(
      await (await app.request(buildPath(routes.getReview.path, { reviewId }))).json(),
    );
    expect(detail.chunks).toHaveLength(5);
    expect(detail.chunks[1]?.findingIds).toHaveLength(1);

    const chunkId = detail.chunks[0]?.id ?? "";
    const progressRes = await app.request(buildPath(routes.updateChunkProgress.path, { reviewId, chunkId }), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "good", note: "fine" }),
    });
    expect(ChunkProgressSchema.parse(await progressRes.json()).status).toBe("good");

    const summary = SummaryResponseSchema.parse(
      await (await app.request(buildPath(routes.getSummary.path, { reviewId }))).json(),
    );
    expect(summary.coverage.reviewedChunks).toBe(1);
    expect(summary.findings.map((f) => f.severity)).toEqual(["bug", "nit"]);
    expect(summary.findings[0]?.chunkIds).toEqual([detail.chunks[1]?.id]);
    expect(summary.verdict?.suggestion).toBe("request_changes");
  });

  it("rejects invalid bodies with 400", async () => {
    const reviewId = await seed();
    const res = await app.request(buildPath(routes.updateChunkProgress.path, { reviewId, chunkId: "x" }), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown reviews", async () => {
    const res = await app.request(buildPath(routes.getReview.path, { reviewId: "rev_missing" }));
    expect(res.status).toBe(404);
  });

  it("creates a review for a PR link and rejects other links with 400", async () => {
    const post = async (url: string): Promise<Response> =>
      app.request(routes.createReview.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
    const bad = await post("https://github.com/a/b/issues/1");
    expect(bad.status).toBe(400);
    const res = await post(FAKE_PR_URL);
    expect(res.status).toBe(200);
    const created = CreateReviewResponseSchema.parse(await res.json());
    expect(created).toMatchObject({ reopened: false, review: { pipelineStatus: "ingesting", prNumber: 1 } });
    await waitForIngest(created.review.id);
  });

  it("reads and patches settings", async () => {
    expect(SettingsSchema.parse(await (await app.request("/api/settings")).json())).toEqual(DEFAULT_SETTINGS);
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inlineFindings: true, models: { qa: "claude-haiku-4-5-20251001" } }),
    });
    const updated = SettingsSchema.parse(await res.json());
    expect(updated.inlineFindings).toBe(true);
    expect(updated.models).toEqual({ ...DEFAULT_SETTINGS.models, qa: "claude-haiku-4-5-20251001" });
  });

  it("rejects a Claude path that is not an executable and keeps the old value", async () => {
    const patch = async (claudePath: string | null): Promise<Response> =>
      await app.request("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claudePath }),
      });
    const bad = await patch("/definitely/not/here/claude");
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("no executable file was found");
    expect(SettingsSchema.parse(await (await app.request("/api/settings")).json()).claudePath).toBeNull();

    const good = SettingsSchema.parse(await (await patch("/bin/sh")).json());
    expect(good.claudePath).toBe("/bin/sh");
    expect(SettingsSchema.parse(await (await patch(null)).json()).claudePath).toBeNull();
  });
});
