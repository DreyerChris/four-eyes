import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  ContextLinesResponseSchema,
  CreateReviewResponseSchema,
  DefinitionSearchResponseSchema,
  FileContentsResponseSchema,
  ReviewDetailResponseSchema,
  buildPath,
  routes,
} from "../../shared/api";
import { removeFixturePr } from "../fixtures";

const FIXTURE_PR = "https://github.com/four-eyes-fixture/demo/pull/1";

const createReview = async (request: APIRequestContext): Promise<ReturnType<typeof CreateReviewResponseSchema.parse>> => {
  const response = await request.post(routes.createReview.path, { data: { url: FIXTURE_PR } });
  expect(response.ok()).toBe(true);
  return CreateReviewResponseSchema.parse(await response.json());
};

const reviewDetail = async (request: APIRequestContext, reviewId: string): Promise<ReturnType<typeof ReviewDetailResponseSchema.parse>> => {
  const response = await request.get(buildPath(routes.getReview.path, { reviewId }));
  expect(response.ok()).toBe(true);
  return ReviewDetailResponseSchema.parse(await response.json());
};

test("pasting the fixture PR ingests it and serves its source", async ({ request }) => {
  await removeFixturePr(request);
  const created = await createReview(request);
  const reviewId = created.review.id;

  await expect
    .poll(async () => (await reviewDetail(request, reviewId)).review.pipelineStatus, { timeout: 30_000 })
    .toBe("ready");
  const detail = await reviewDetail(request, reviewId);
  expect(detail.review.pipelineError).toBeNull();
  expect(detail.chunks.length).toBeGreaterThan(0);
  expect(detail.review.title).toBe("Add email to users and send a welcome mail");
  expect(detail.rounds.map((round) => round.number)).toEqual([1]);

  const file = FileContentsResponseSchema.parse(
    await (await request.get(buildPath(routes.getFileContents.path, { reviewId }), { params: { path: "src/types/user.ts" } })).json(),
  );
  expect(file.content).toContain("readonly email: string;");

  const context = ContextLinesResponseSchema.parse(
    await (
      await request.get(buildPath(routes.getContextLines.path, { reviewId }), {
        params: { path: "src/types/user.ts", sha: detail.review.headSha, start: "1", end: "2" },
      })
    ).json(),
  );
  expect(context.lines.map((line) => line.number)).toEqual([1, 2]);

  const definitions = DefinitionSearchResponseSchema.parse(
    await (await request.get(buildPath(routes.searchDefinitions.path, { reviewId }), { params: { symbol: "UserService" } })).json(),
  );
  expect(definitions.matches.map((match) => match.path)).toEqual(["src/services/user-service.ts"]);

  const again = await createReview(request);
  expect(again.reopened).toBe(true);
  expect(again.review.id).toBe(reviewId);
});

test("a link that is not a pull request is rejected with a readable 400", async ({ request }) => {
  const response = await request.post(routes.createReview.path, { data: { url: "https://github.com/o/r/issues/3" } });
  expect(response.status()).toBe(400);
  expect(((await response.json()) as { error: string }).error).toMatch(/not a pull request link/);
});
