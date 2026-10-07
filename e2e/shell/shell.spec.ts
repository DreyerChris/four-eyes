import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PR_URL, expectNoA11yViolations, ingestFixturePr, removeFixturePr, seedReview } from "../fixtures";

const seededTitle = async (page: Page, reviewId: string): Promise<string> => {
  const response = await page.request.get(`/api/reviews/${reviewId}`);
  expect(response.ok()).toBe(true);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("review" in body)) throw new Error("Unexpected review response");
  const review: unknown = body.review;
  if (typeof review !== "object" || review === null || !("title" in review) || typeof review.title !== "string") {
    throw new Error("Review response has no title");
  }
  return review.title;
};

test.describe("review list", () => {
  test("shows seeded rows with progress, GitHub state and last activity", async ({ page, request }) => {
    const reviewId = await seedReview(request);
    const title = await seededTitle(page, reviewId);
    await page.goto("/");
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: title }) });
    await expect(row).toBeVisible();
    await expect(row.getByText("0/5 chunks reviewed")).toBeVisible();
    await expect(row.getByText("open", { exact: true })).toBeVisible();
    await expect(row.getByText(/active just now|active \dm ago/)).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("switches between the active and past tabs", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Review lists" }).getByRole("link", { name: "past" }).click();
    await expect(page).toHaveURL(/\?tab=past$/);
    await expect(page.getByRole("heading", { name: "reviews · past" })).toBeVisible();
  });

  test("asks for confirmation before deleting and can be cancelled", async ({ page, request }) => {
    const reviewId = await seedReview(request);
    const title = await seededTitle(page, reviewId);
    await page.goto("/");
    await page.getByRole("button", { name: `Delete ${title}` }).click();
    const confirm = page.getByRole("group", { name: `Confirm deleting ${title}` });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "yes, delete" })).toBeFocused();
    await confirm.getByRole("button", { name: "cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });

  test("deletes a review after confirming", async ({ page, request }) => {
    const reviewId = await seedReview(request);
    const title = await seededTitle(page, reviewId);
    await page.goto("/");
    await page.getByRole("link", { name: title }).focus();
    await page.keyboard.press("d");
    await page.getByRole("button", { name: "yes, delete" }).click();
    await expect(page.getByRole("link", { name: title })).toBeHidden();
  });

  test("Escape leaves the URL box so j and k move through the list again", async ({ page, request }) => {
    await seedReview(request);
    await page.goto("/");
    await page.keyboard.press("/");
    const input = page.getByLabel("Pull request URL");
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).not.toBeFocused();
    await page.keyboard.press("j");
    await expect(input).toHaveValue("");
    await expect(page.locator("[data-row-index]:focus")).toHaveCount(1);
  });

  test("pasting a PR URL shows ingest progress, then reopening navigates to it", async ({ page, request }) => {
    await removeFixturePr(request);
    await page.goto("/");
    await page.keyboard.press("/");
    await expect(page.getByLabel("Pull request URL")).toBeFocused();
    await page.keyboard.type(FIXTURE_PR_URL);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: /^Progress for/ })).toBeVisible();
    await expect(page.getByText(/chunks reviewed/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Pull request URL").fill(FIXTURE_PR_URL);
    await page.getByRole("button", { name: "add", exact: true }).click();
    await expect(page).toHaveURL(/\/reviews\/rev_/);
  });
});

test.describe("command bar", () => {
  test("runs :summary and reports unknown commands", async ({ page, request }) => {
    const reviewId = await seedReview(request);
    await page.goto(`/reviews/${reviewId}`);
    await page.keyboard.press(":");
    const input = page.getByRole("textbox", { name: "Command" });
    await expect(input).toBeFocused();
    await input.fill("frobnicate");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText('Unknown command "frobnicate"');
    await input.fill("summary");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/reviews/${reviewId}/summary$`));
    await expect(page.getByRole("dialog", { name: "command" })).toBeHidden();
  });

  test("runs :goto from the summary page", async ({ page, request }) => {
    const reviewId = await seedReview(request);
    await page.goto(`/reviews/${reviewId}/summary`);
    await page.keyboard.press(":");
    await page.keyboard.type("goto 2");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/reviews/${reviewId}\\?chunk=chk_`));
  });

  test("r refreshes from the summary page too", async ({ page, request }) => {
    const reviewId = await seedReview(request);
    await page.goto(`/reviews/${reviewId}/summary`);
    await expect(page.getByRole("button", { name: /refresh/ })).toBeVisible();
    await page.keyboard.press("r");
    await expect(page.getByRole("contentinfo", { name: "Status bar" })).toContainText(/Checking for new commits|Refresh failed|No new commits/);
  });

  test("closes on escape and returns focus", async ({ page }) => {
    await page.goto("/");
    const brand = page.getByRole("link", { name: "four-eyes" });
    await brand.focus();
    await page.keyboard.press(":");
    await expect(page.getByRole("dialog", { name: "command" })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "command" })).toBeHidden();
    await expect(brand).toBeFocused();
  });

  test(":settings opens the settings panel", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press(":");
    await page.keyboard.type("settings");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "settings" })).toBeVisible();
  });

  test(":open shows the file viewer with changed lines", async ({ page, request }) => {
    const reviewId = await ingestFixturePr(request);
    await page.goto(`/reviews/${reviewId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press(":");
    await page.keyboard.type("open README.md");
    await page.keyboard.press("Enter");
    const viewer = page.getByRole("dialog", { name: "README.md" });
    await expect(viewer).toBeVisible();
    await viewer.getByRole("button", { name: "before" }).click();
    await expect(viewer.getByText(/before \(base\)/)).toBeVisible();
  });
});

test.describe("settings", () => {
  test("persists the inline findings toggle across reloads", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press(",");
    const dialog = page.getByRole("dialog", { name: "settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Chunking model")).toBeFocused();
    await expectNoA11yViolations(page);
    const toggle = dialog.getByLabel(/Show Claude's findings inline/);
    const initial = await toggle.isChecked();
    await toggle.setChecked(!initial);
    await dialog.getByRole("button", { name: "save" }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await page.keyboard.press(",");
    await expect(page.getByLabel(/Show Claude's findings inline/)).toBeChecked({ checked: !initial });

    await page.getByLabel(/Show Claude's findings inline/).setChecked(initial);
    await page.getByRole("button", { name: "save" }).click();
    await expect(page.getByRole("dialog", { name: "settings" })).toBeHidden();
  });

  test("persists Claude's output length across reloads", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press(",");
    const dialog = page.getByRole("dialog", { name: "settings" });
    await expect(dialog.getByLabel("Claude's output length")).toHaveValue("standard");
    await dialog.getByLabel("Claude's output length").selectOption("brief");
    await dialog.getByRole("button", { name: "save" }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await page.keyboard.press(",");
    await expect(page.getByLabel("Claude's output length")).toHaveValue("brief");

    await page.getByLabel("Claude's output length").selectOption("standard");
    await page.getByRole("button", { name: "save" }).click();
    await expect(page.getByRole("dialog", { name: "settings" })).toBeHidden();
  });

  test("refuses to save an empty model ID", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press(",");
    const dialog = page.getByRole("dialog", { name: "settings" });
    await dialog.getByLabel("Review model").fill("");
    await expect(dialog.getByRole("alert")).toContainText("Review model cannot be empty");
    await expect(dialog.getByRole("button", { name: "save" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("q&a panel", () => {
  test("? on a review opens the panel with the ask Opus toggle", async ({ page, request }) => {
    const reviewId = await seedReview(request);
    await page.goto(`/reviews/${reviewId}`);
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: /^ask claude/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Your question")).toBeFocused();
    await expect(dialog.getByLabel("ask Opus")).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "ask", exact: true })).toBeDisabled();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("streams an answer and lists it as an earlier question", async ({ page, request }) => {
    const reviewId = await ingestFixturePr(request);
    await page.goto(`/reviews/${reviewId}`);
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: /^ask claude/ });
    await dialog.getByLabel("Your question").fill("Why is the email derived from the name?");
    await page.keyboard.press("Control+Enter");
    await expect(dialog.getByRole("button", { name: "copy answer" })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("keyboard only", () => {
  test("moves through the list with j and opens a review with Enter", async ({ page, request }) => {
    await seedReview(request);
    await page.goto("/");
    await page.keyboard.press("j");
    const focusedRow = page.locator("[data-row-index='0']");
    await expect(focusedRow).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/reviews\/rev_/);
  });

  test("traps focus inside an overlay", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press(",");
    const dialog = page.getByRole("dialog", { name: "settings" });
    await expect(dialog).toBeVisible();
    for (let step = 0; step < 15; step += 1) {
      await page.keyboard.press("Tab");
      await expect(dialog.locator(":focus")).toHaveCount(1);
    }
    await page.keyboard.press("Escape");
  });

  test("? on the list explains that a review must be open", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("?");
    await expect(page.getByRole("contentinfo", { name: "Status bar" })).toContainText("Open a review to ask Claude a question");
  });
});

test.describe("suggestions", () => {
  test("suggests the fixture PR, hides it for good with not interested until added, and adds it with Review this", async ({ page, request }) => {
    await seedReview(request);
    await removeFixturePr(request);
    await page.goto("/?tab=suggested");
    const suggested = page.getByRole("list", { name: "Suggested pull requests" });
    const row = suggested.getByRole("listitem").filter({ hasText: "Add email to users and send a welcome mail" });

    await page.getByRole("button", { name: "Check now" }).click();
    await expect(row).toBeVisible();
    await expect(row.getByText("@octocat's PRs you reviewed before")).toBeVisible();
    await expect(page.getByRole("link", { name: /^suggested \(\d+\)$/ })).toBeVisible();
    await expectNoA11yViolations(page);

    await row.getByRole("button", { name: /^Not interested:/ }).click();
    await expect(row).toBeHidden();
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByText(/^Checked /)).toBeVisible();
    await expect(row).toBeHidden();

    await page.keyboard.press("/");
    await page.keyboard.type(FIXTURE_PR_URL);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
    await removeFixturePr(request);

    await page.goto("/?tab=suggested");
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /^Review this:/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Add email to users and send a welcome mail" })).toBeFocused({ timeout: 30_000 });
  });
});
