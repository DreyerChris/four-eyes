import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, seedReview } from "../fixtures";

test("step through a review with the keyboard only, then copy the summary", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const reviewId = await seedReview(request);
  await page.goto(`/reviews/${reviewId}`);

  await expect(page.getByRole("heading", { level: 1, name: /Add email to users/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "chunk 1/5" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add email to the User type" })).toBeVisible();
  await expect(page.locator("[data-marker='+']").first()).toBeVisible();

  await page.keyboard.press("g");
  await expect(page.getByRole("heading", { name: "chunk 2/5" })).toBeVisible();
  await expect(page).toHaveURL(/\?chunk=chk_/);

  await page.keyboard.press("f");
  await expect(page.getByRole("button", { name: /^Flag/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("n");
  await page.keyboard.type("Mail goes out before save.");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByLabel("Your note")).toHaveText("Mail goes out before save.");

  await page.keyboard.press("k");
  await expect(page.getByRole("heading", { name: "chunk 1/5" })).toBeVisible();
  for (const expected of ["chunk 2/5", "chunk 3/5", "chunk 4/5", "chunk 5/5 · skim"]) {
    await page.keyboard.press("j");
    await expect(page.getByRole("heading", { name: expected })).toBeVisible();
  }
  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`/reviews/${reviewId}/summary$`));

  await expect(page.getByRole("region", { name: "verdict" }).getByText("Request changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bug (1)" })).toBeVisible();
  await expect(page.getByText("Mail goes out before save.")).toBeVisible();
  await expect(page.getByText("Chunks reviewed: 2 of 5")).toBeVisible();

  await page.keyboard.press("a");
  const verdicts = page.getByRole("group", { name: "Your verdict on Welcome mail is sent before the user is saved" });
  await expect(verdicts.getByRole("button", { name: "Agree", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Shift+C");
  await expect(page.getByRole("contentinfo", { name: "Status bar" })).toContainText("Full review copied");
  const copied = String(await page.evaluate("navigator.clipboard.readText()"));
  expect(copied).toContain("# Review: Add email to users");
  expect(copied).toContain("## Verdict: Request changes");
  expect(copied).toContain("_(you: agree)_");
  expect(copied).toContain("Mail goes out before save.");

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/reviews\/[^/]+\?chunk=chk_/);
  await expect(page.getByRole("heading", { name: "chunk 2/5" })).toBeVisible();
});

test("select lines with Shift+Down from the keyboard and ask about them", async ({ page, request }) => {
  const reviewId = await seedReview(request);
  await page.goto(`/reviews/${reviewId}`);
  await expect(page.getByRole("heading", { name: "chunk 1/5" })).toBeVisible();
  await page.getByRole("group", { name: /^Diff\./ }).focus();
  await page.keyboard.press("ArrowRight");
  const startLine = await page.evaluate('document.activeElement?.closest("[data-code]")?.getAttribute("data-line") ?? null');
  expect(startLine).not.toBeNull();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator("[data-line-selected]")).toHaveCount(2);
  await expect(page.getByText(/^Selected lines \d+ to \d+ of /)).toBeAttached();
  await page.keyboard.press("?");
  const qa = page.getByRole("dialog", { name: /^ask claude · chunk 1/ });
  await expect(qa).toBeVisible();
  await expect(qa.getByText(/^src\/[\w/.-]+:\d+-\d+ \((after|before)\)$/)).toBeVisible();
  await expect(qa.getByText("No code selected.", { exact: false })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("review page passes axe in unified and split layouts", async ({ page, request }) => {
  const reviewId = await seedReview(request);
  await page.goto(`/reviews/${reviewId}`);
  await expect(page.getByRole("heading", { name: "chunk 1/5" })).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.getByRole("heading", { name: "chunk 2/5" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: /Split view/ })).toHaveAttribute("aria-pressed", "true");
  await expectNoA11yViolations(page);
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: /Split view/ })).toHaveAttribute("aria-pressed", "false");
});

test("summary page passes axe", async ({ page, request }) => {
  const reviewId = await seedReview(request);
  await page.goto(`/reviews/${reviewId}/summary`);
  await expect(page.getByRole("heading", { name: "Bug (1)" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("identifier tokens are reachable with arrow keys", async ({ page, request }) => {
  const reviewId = await seedReview(request);
  await page.goto(`/reviews/${reviewId}`);
  const diff = page.getByRole("group", { name: /^Diff\./ });
  await diff.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-token]:focus")).toHaveCount(1);
  const first = await page.locator("[data-token]:focus").getAttribute("data-token");
  await page.keyboard.press("ArrowRight");
  const second = await page.locator("[data-token]:focus").getAttribute("data-token");
  expect(second).not.toBe(first);
});
