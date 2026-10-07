import { afterEach, describe, expect, it } from "vitest";
import { seedReviewWithHunks } from "../claude/test-support";
import { reviewsRepo } from "../db/repositories";
import { createTestContext, type TestContextHandle } from "../test/context";
import type { GitHubClient, ViewerReview } from "./github-client";
import { syncMyReview } from "./my-review";
import { refuseReviewSubmission } from "./testing";

const githubWith = (latest: () => Promise<ViewerReview | null>): GitHubClient => ({
  fetchPr: async () => Promise.reject(new Error("not used")),
  remoteUrl: () => "",
  submitReview: refuseReviewSubmission,
  searchOpenPrs: async () => [],
  fetchViewerReview: latest,
});

describe("syncMyReview", () => {
  let handle: TestContextHandle | undefined;
  afterEach(() => handle?.close());

  it("stores your latest GitHub review and clears it when GitHub has none", async () => {
    let latest: ViewerReview | null = { state: "approved", submittedAt: "2026-06-01T10:00:00.000Z", commitSha: "abc" };
    handle = createTestContext({ github: githubWith(async () => latest) });
    const { review } = seedReviewWithHunks(handle.ctx, ["src/a.ts"]);

    await syncMyReview(handle.ctx, review.id);
    expect(reviewsRepo.requireReview(handle.ctx.db, review.id)).toMatchObject({
      myReviewState: "approved",
      myReviewSubmittedAt: "2026-06-01T10:00:00.000Z",
      myReviewCommitSha: "abc",
    });

    latest = null;
    await syncMyReview(handle.ctx, review.id);
    expect(reviewsRepo.requireReview(handle.ctx.db, review.id).myReviewState).toBeNull();
  });

  it("keeps the stored review when GitHub cannot be reached", async () => {
    let fail = false;
    handle = createTestContext({
      github: githubWith(async () => {
        if (fail) throw new Error("gh is not logged in");
        return { state: "commented", submittedAt: "2026-06-01T10:00:00.000Z", commitSha: null };
      }),
    });
    const { review } = seedReviewWithHunks(handle.ctx, ["src/a.ts"]);
    await syncMyReview(handle.ctx, review.id);
    fail = true;
    await expect(syncMyReview(handle.ctx, review.id)).resolves.toBeUndefined();
    expect(reviewsRepo.requireReview(handle.ctx.db, review.id).myReviewState).toBe("commented");
  });
});
