import { expect, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  CreateReviewResponseSchema,
  ListReviewsResponseSchema,
  ReviewDetailResponseSchema,
  SeedFixtureResponseSchema,
  buildPath,
  routes,
} from "../shared/api";

export const FIXTURE_PR_URL = "https://github.com/four-eyes-fixture/demo/pull/1";

/** Inserts a complete fixture review through the fake-mode seed route and returns its ID. */
export const seedReview = async (request: APIRequestContext): Promise<string> => {
  const response = await request.post(routes.seedFixture.path);
  expect(response.ok()).toBe(true);
  return SeedFixtureResponseSchema.parse(await response.json()).reviewId;
};

/** Deletes any review of the fake-GitHub fixture PR so the next paste starts a fresh ingest. */
export const removeFixturePr = async (request: APIRequestContext): Promise<void> => {
  const response = await request.get(routes.listReviews.path);
  expect(response.ok()).toBe(true);
  const { reviews } = ListReviewsResponseSchema.parse(await response.json());
  const matching = reviews.filter((review) => review.url === FIXTURE_PR_URL);
  for (const review of matching) {
    const deleted = await request.delete(buildPath(routes.deleteReview.path, { reviewId: review.id }));
    expect(deleted.ok()).toBe(true);
  }
};

/** Ingests the fixture PR from scratch with fake Claude and resolves with its ID once chunks are ready. */
export const ingestFixturePr = async (request: APIRequestContext): Promise<string> => {
  await removeFixturePr(request);
  const response = await request.post(routes.createReview.path, { data: { url: FIXTURE_PR_URL } });
  expect(response.ok()).toBe(true);
  const reviewId = CreateReviewResponseSchema.parse(await response.json()).review.id;
  await expect
    .poll(
      async () => {
        const detail = await request.get(buildPath(routes.getReview.path, { reviewId }));
        return ReviewDetailResponseSchema.parse(await detail.json()).review.pipelineStatus;
      },
      { timeout: 30_000 },
    )
    .toBe("ready");
  return reviewId;
};

/** Fails the test on any serious or critical axe violation. */
export const expectNoA11yViolations = async (page: Page): Promise<void> => {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
};
