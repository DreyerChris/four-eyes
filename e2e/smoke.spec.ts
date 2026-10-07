import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, seedReview } from "./fixtures";

test("app shell loads the review list and passes axe", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "four-eyes" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("a seeded review opens on the review page", async ({ page, request }) => {
  const reviewId = await seedReview(request);
  await page.goto(`/reviews/${reviewId}`);
  await expect(page.getByText(/Add email to users/).first()).toBeVisible();
});

test("pages load without console errors, and a missing review does not open its event stream", async ({ page }) => {
  const errors: string[] = [];
  const eventRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (/\/api\/reviews\/[^/]+\/events/.test(request.url())) eventRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "four-eyes" })).toBeVisible();
  expect(errors).toEqual([]);

  await page.goto("/reviews/does-not-exist");
  await expect(page.getByText(/Could not load review/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  expect(eventRequests).toEqual([]);
});
