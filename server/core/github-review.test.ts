import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SeedFixtureResponseSchema, SubmitGitHubReviewResponseSchema, buildPath, routes } from "@shared/api";
import type { PrRef } from "@shared/domain";
import { createApp } from "../app";
import { reviewsRepo } from "../db/repositories";
import type { GitHubReviewSubmission } from "../ingest/github-client";
import { createTestContext, type TestContextHandle } from "../test/context";

interface Submitted {
  readonly ref: PrRef;
  readonly submission: GitHubReviewSubmission;
}

describe("submitGitHubReview route", () => {
  let handle: TestContextHandle;
  let app: ReturnType<typeof createApp>;
  let submitted: Submitted[];

  beforeEach(() => {
    submitted = [];
    handle = createTestContext({
      github: {
        fetchPr: async () => Promise.reject(new Error("not used")),
        remoteUrl: () => "",
        submitReview: async (ref, submission) => {
          submitted.push({ ref, submission });
          return { url: `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}#pullrequestreview-1` };
        },
      },
    });
    app = createApp(handle.ctx);
  });

  afterEach(() => handle.close());

  const seed = async (): Promise<string> => {
    const res = await app.request(routes.seedFixture.path, { method: "POST" });
    return SeedFixtureResponseSchema.parse(await res.json()).reviewId;
  };

  const submit = async (reviewId: string, body: unknown): Promise<Response> =>
    app.request(buildPath(routes.submitGitHubReview.path, { reviewId }), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("approves without a comment on the reviewed head commit", async () => {
    const reviewId = await seed();
    const review = reviewsRepo.requireReview(handle.ctx.db, reviewId);

    const res = await submit(reviewId, { event: "approve", body: "   " });

    expect(res.status).toBe(200);
    expect(SubmitGitHubReviewResponseSchema.parse(await res.json()).url).toContain("#pullrequestreview-1");
    expect(submitted).toEqual([
      {
        ref: { host: review.host, owner: review.owner, repo: review.repo, number: review.prNumber },
        submission: { event: "approve", body: null, commitId: review.headSha },
      },
    ]);
  });

  it("sends a trimmed comment with a change request", async () => {
    const reviewId = await seed();
    const res = await submit(reviewId, { event: "request_changes", body: "\n Please add a test.\n" });
    expect(res.status).toBe(200);
    expect(submitted[0]?.submission).toMatchObject({ event: "request_changes", body: "Please add a test." });
  });

  it.each(["comment", "request_changes"])("refuses a %s without a comment", async (event) => {
    const reviewId = await seed();
    const res = await submit(reviewId, { event, body: " " });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("GitHub needs a comment unless you approve");
    expect(submitted).toEqual([]);
  });

  it("refuses reviews in Past and PRs that are no longer open", async () => {
    const pastId = await seed();
    reviewsRepo.updateReview(handle.ctx.db, pastId, { status: "past" });
    expect((await submit(pastId, { event: "approve", body: "" })).status).toBe(409);

    reviewsRepo.updateReview(handle.ctx.db, pastId, { status: "active", ghState: "merged" });
    const merged = await submit(pastId, { event: "approve", body: "" });
    expect(merged.status).toBe(409);
    expect(await merged.text()).toContain("is merged");
    expect(submitted).toEqual([]);
  });
});
