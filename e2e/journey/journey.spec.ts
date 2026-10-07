import { expect, test, type Locator, type Page } from "@playwright/test";
import { ApplyRefreshResponseSchema, ReviewDetailResponseSchema, buildPath, routes } from "../../shared/api";
import { FIXTURE_PR_URL, expectNoA11yViolations, ingestFixturePr, removeFixturePr } from "../fixtures";
import { prHead, pushCommit, resetPrHead, setPrState, submittedReviews } from "./fake-remote";

const TITLE = "Add email to users and send a welcome mail";

const tabUntilFocused = async (page: Page, target: Locator, maxPresses = 40): Promise<void> => {
  for (let press = 0; press < maxPresses; press += 1) {
    if (await target.evaluate((element) => element.matches(":focus"))) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
};

const chunkHeading = (page: Page, text: string | RegExp): Locator => page.getByRole("main").getByRole("heading", { level: 2, name: text });

const statusBar = (page: Page): Locator => page.getByRole("contentinfo", { name: "Status bar" });

const selectLines = async (page: Page, file: string, from: number, to: number): Promise<void> => {
  const start = await page.locator(`[data-code][data-file="${file}"][data-side="new"][data-line="${from}"]`).boundingBox();
  const end = await page.locator(`[data-code][data-file="${file}"][data-side="new"][data-line="${to}"]`).boundingBox();
  if (start === null || end === null) throw new Error(`Lines ${from}-${to} of ${file} are not on screen`);
  await page.mouse.move(start.x + 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 4, end.y + end.height / 2, { steps: 5 });
  await page.mouse.up();
};

test.describe.configure({ mode: "serial" });

test("full review journey: paste, step with the keyboard, ask, summary, copy, finish, past", async ({ page, request, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await removeFixturePr(request);

  await page.goto("/");
  await expectNoA11yViolations(page);
  await page.keyboard.press("/");
  await expect(page.getByLabel("Pull request URL")).toBeFocused();
  await page.keyboard.type(FIXTURE_PR_URL);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: /^Progress for/ })).toBeVisible();
  await expectNoA11yViolations(page);
  const row = page.getByRole("link", { name: TITLE });
  await expect(row).toBeFocused({ timeout: 30_000 });
  await expect(page.getByText("0/5 chunks reviewed")).toBeVisible({ timeout: 30_000 });

  await tabUntilFocused(page, row);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/reviews\/rev_[^/]+\?chunk=chk_/);
  const reviewId = /\/reviews\/(rev_[^/?]+)/.exec(page.url())?.[1];
  if (reviewId === undefined) throw new Error(`No review ID in ${page.url()}`);

  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(chunkHeading(page, "chunk 1/5")).toBeVisible();
  await expect(page.getByText("Claude review done")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.keyboard.press("g");
  await expect(chunkHeading(page, "chunk 2/5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Chunk 1: Fake chunk 1, Looks good" })).toBeVisible();

  await page.keyboard.press("f");
  await expect(page.getByRole("button", { name: /^Flag/ })).toHaveAttribute("aria-pressed", "true");
  await expect(chunkHeading(page, "chunk 2/5")).toBeVisible();

  await page.keyboard.press("n");
  await expect(page.getByRole("textbox", { name: "Note" })).toBeFocused();
  await page.keyboard.type("Routes j and k must not navigate while typing.");
  await expect(chunkHeading(page, "chunk 2/5")).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByLabel("Your note")).toHaveText("Routes j and k must not navigate while typing.");
  await expect(page.getByRole("button", { name: /^Note/ })).toBeFocused();

  await selectLines(page, "src/routes/users.ts", 4, 6);
  await page.keyboard.press("?");
  const qa = page.getByRole("dialog", { name: /^ask claude · chunk 2/ });
  await expect(qa).toBeVisible();
  await expect(qa.getByText("src/routes/users.ts:4-6 (after)")).toBeVisible();
  await expect(qa.getByLabel("Your question")).toBeFocused();
  await page.keyboard.type("Why build a new router here?");
  await page.keyboard.press("Control+Enter");
  await expect(qa.getByText("This is a fake answer from the fake Claude runner.")).toBeVisible({ timeout: 20_000 });
  await expect(qa.getByRole("button", { name: "copy answer" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(qa).toBeHidden();
  await expect(page.getByText("1 question asked on this chunk")).toBeVisible();

  const openUsers = page.getByRole("button", { name: "Open file src/routes/users.ts" });
  await openUsers.focus();
  await page.keyboard.press("Enter");
  const viewer = page.getByRole("dialog", { name: "src/routes/users.ts" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText(/after \(head\) · [0-9a-f]{8} · 2 added lines/)).toBeVisible();
  await expect(viewer.getByRole("region", { name: "src/routes/users.ts source" })).toContainText("findUserEmailHandler");
  await expectNoA11yViolations(page);
  await tabUntilFocused(page, viewer.getByRole("button", { name: "before" }), 6);
  await page.keyboard.press("Enter");
  await expect(viewer.getByText(/before \(base\) · [0-9a-f]{8} · 1 removed line/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(openUsers).toBeFocused();

  const diff = page.getByRole("group", { name: /^Diff\./ });
  await diff.focus();
  for (let press = 0; press < 80; press += 1) {
    await page.keyboard.press("ArrowRight");
    if ((await page.locator("[data-token]:focus").getAttribute("data-token")) === "Router") break;
  }
  await expect(page.locator("[data-token]:focus")).toHaveAttribute("data-token", "Router");
  await page.keyboard.press("Enter");
  const definition = page.getByRole("dialog", { name: /Router/ });
  await expect(definition).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(definition).toBeHidden();

  await page.keyboard.press("j");
  await expect(chunkHeading(page, "chunk 3/5")).toBeVisible();
  await page.keyboard.press("k");
  await expect(chunkHeading(page, "chunk 2/5")).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("g");
  await expect(chunkHeading(page, "chunk 4/5")).toBeVisible();
  await page.keyboard.press("j");
  await expect(chunkHeading(page, "chunk 5/5 · skim")).toBeVisible();
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: /Split view/ })).toHaveAttribute("aria-pressed", "true");
  await expectNoA11yViolations(page);
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: /Split view/ })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("j");

  await expect(page).toHaveURL(new RegExp(`/reviews/${reviewId}/summary$`));
  await expect(page.getByRole("heading", { level: 1, name: `summary: ${TITLE}` })).toBeVisible();
  await expect(page.getByRole("region", { name: "verdict" }).getByText("Request changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bug (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nit (1)" })).toBeVisible();
  await expect(page.getByText("Chunks reviewed: 3 of 5")).toBeVisible();
  await expect(page.getByText("Routes j and k must not navigate while typing.")).toBeVisible();
  await expect(page.getByText("Show 1 question")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.keyboard.press("c");
  await expect(statusBar(page)).toContainText("Finding copied as a GitHub comment");
  const findingComment = String(await page.evaluate("navigator.clipboard.readText()"));
  expect(findingComment).toContain("Fake bug finding");
  expect(findingComment).toContain("Canned bug explanation from the fake Claude runner.");
  expect(findingComment).toContain("Apply the canned fix.");

  await page.keyboard.press("j");
  await page.keyboard.press("x");
  const nitVerdicts = page.getByRole("group", { name: "Your verdict on Fake nit finding" });
  await expect(nitVerdicts.getByRole("button", { name: "Disagree", exact: true })).toHaveAttribute("aria-pressed", "true");

  const notes = page.getByRole("region", { name: /your flags and notes/ });
  await notes.getByRole("button", { name: "Copy as GitHub comment" }).focus();
  await page.keyboard.press("Enter");
  await expect(statusBar(page)).toContainText("Note copied as a GitHub comment");
  expect(String(await page.evaluate("navigator.clipboard.readText()"))).toContain("Routes j and k must not navigate while typing.");

  await page.keyboard.press("Shift+C");
  await expect(statusBar(page)).toContainText("Full review copied");
  const full = String(await page.evaluate("navigator.clipboard.readText()"));
  expect(full).toContain(`# Review: ${TITLE}`);
  expect(full).toContain("Why build a new router here?");

  const finish = page.getByRole("button", { name: "Finish review" });
  await finish.focus();
  await page.keyboard.press("Enter");
  await expect(statusBar(page)).toContainText("Review finished and moved to Past");
  await expect(page.getByText("past, read-only")).toBeVisible();
  await expect(page.getByText("past, read-only")).toBeFocused();
  await expect(page.getByRole("group", { name: "Your verdict on Fake bug finding" }).getByRole("button", { name: "Agree", exact: true })).toBeDisabled();

  await tabUntilFocused(page, page.getByRole("link", { name: "four-eyes", exact: true }), 80);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "reviews · active" })).toBeVisible();
  await expect(page.getByRole("link", { name: TITLE })).toBeHidden();
  await tabUntilFocused(page, page.getByRole("navigation", { name: "Review lists" }).getByRole("link", { name: "past" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\?tab=past$/);
  const pastRow = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: TITLE }) });
  await expect(pastRow).toBeVisible();
  await expect(pastRow.getByText("3/5 chunks reviewed")).toBeVisible();
  await expectNoA11yViolations(page);

  await tabUntilFocused(page, pastRow.getByRole("link", { name: TITLE }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("past, read-only")).toBeVisible();
  await expect(page.getByRole("group", { name: "Mark this chunk" })).toBeHidden();
  await expect(page.getByRole("button", { name: /refresh/ })).toBeDisabled();
  await expectNoA11yViolations(page);

  await page.keyboard.press("?");
  const pastQa = page.getByRole("dialog", { name: /^ask claude/ });
  await expect(pastQa.getByText(/This review is in Past and read-only/)).toBeVisible();
  await expect(pastQa.getByLabel("Your question")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(pastQa).toBeHidden();

  const openReadme = page.getByRole("button", { name: /^Open file / }).first();
  await openReadme.focus();
  await page.keyboard.press("Enter");
  const pastViewer = page.getByRole("dialog").filter({ has: page.getByRole("region", { name: / source$/ }) });
  await expect(pastViewer).toBeVisible({ timeout: 20_000 });
  await expect(pastViewer.getByRole("region", { name: / source$/ })).not.toBeEmpty();
  await page.keyboard.press("Escape");

  const detail = ReviewDetailResponseSchema.parse(await (await request.get(buildPath(routes.getReview.path, { reviewId }))).json());
  expect(detail.review.status).toBe("past");
});

test("refresh after a new commit: badge, Round 2 chunks, kept progress and finding lifecycle", async ({ page, request }) => {
  test.setTimeout(90_000);
  const reviewId = await ingestFixturePr(request);
  const originalHead = prHead();
  try {
    await page.goto(`/reviews/${reviewId}`);
    await expect(chunkHeading(page, "chunk 1/5")).toBeVisible();
    await page.keyboard.press("g");
    await expect(chunkHeading(page, "chunk 2/5")).toBeVisible();
    await page.keyboard.press(":");
    await page.keyboard.type("summary");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Bug (1)" })).toBeVisible();
    await page.keyboard.press("a");
    await expect(
      page.getByRole("group", { name: "Your verdict on Fake bug finding" }).getByRole("button", { name: "Agree", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    const newHead = pushCommit("Compare names with localeCompare and add slugs", [
      {
        path: "src/services/user-service.ts",
        edit: (content) =>
          content.replace(
            "return this.store.all().find((u) => u.name.toLowerCase() === name.toLowerCase());",
            'return this.store.all().find((u) => u.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);',
          ),
      },
      { path: "src/utils/slug.ts", edit: () => 'export const slug = (name: string): string => name.toLowerCase().replace(/\\s+/g, "-");\n' },
    ]);
    expect(newHead).not.toBe(originalHead);

    const checked = await request.post(buildPath(routes.checkRefresh.path, { reviewId }));
    expect(checked.ok()).toBe(true);
    await page.goto("/");
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: TITLE }) });
    await expect(row.getByText("new commits")).toBeVisible();
    await expectNoA11yViolations(page);

    await row.getByRole("link", { name: TITLE }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /new commits · refresh/ })).toBeVisible();
    await page.keyboard.press("r");
    await expect(statusBar(page)).toContainText(/Refreshed\. Round 2: \d+ new hunks?/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /new commits/ })).toBeHidden();

    const readDetail = async (): Promise<ReturnType<typeof ReviewDetailResponseSchema.parse>> =>
      ReviewDetailResponseSchema.parse(await (await request.get(buildPath(routes.getReview.path, { reviewId }))).json());
    await expect.poll(async () => (await readDetail()).review.pipelineStatus, { timeout: 30_000 }).toBe("ready");
    const detail = await readDetail();
    expect(detail.rounds.map((round) => round.number)).toEqual([1, 2]);
    expect(detail.review.headSha).toBe(newHead);
    const total = detail.chunks.length;
    expect(total).toBeGreaterThan(5);
    await expect(page.getByRole("button", { name: "Chunk 1: Fake chunk 1, Looks good" })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^Chunk ${total}, round 2: `) })).toBeVisible();

    await page.keyboard.press(":");
    await page.keyboard.type(`goto ${total}`);
    await page.keyboard.press("Enter");
    await expect(chunkHeading(page, new RegExp(`^chunk ${total}/${total} · Round 2`))).toBeVisible();
    await expectNoA11yViolations(page);

    const missing = detail.chunks.flatMap((chunk) => chunk.hunks).filter((hunk) => !hunk.present);
    expect(missing.map((hunk) => hunk.filePath)).toEqual(["src/services/user-service.ts"]);
    const missingChunk = detail.chunks.findIndex((chunk) => chunk.hunks.some((hunk) => !hunk.present));
    await page.keyboard.press(":");
    await page.keyboard.type(`goto ${missingChunk + 1}`);
    await page.keyboard.press("Enter");
    await expect(page.getByText("no longer in PR").first()).toBeVisible();

    await page.keyboard.press(":");
    await page.keyboard.type("summary");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Hunks no longer in the PR: 1/)).toBeVisible();
    await expect(page.getByText(new RegExp(`Chunks reviewed: 1 of ${total}`))).toBeVisible();
    await expect.poll(async () => (await readDetail()).review.reviewRunStatus, { timeout: 30_000 }).toBe("succeeded");
    const bug = page.getByRole("article").filter({ hasText: "Fake bug finding" });
    await expect(bug.getByText("still present")).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Your verdict on Fake bug finding" }).getByRole("button", { name: "Agree", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expectNoA11yViolations(page);
  } finally {
    resetPrHead(originalHead);
  }
});

test("a merged PR moves its open review to Past on the next poll", async ({ page, request }) => {
  test.setTimeout(60_000);
  const reviewId = await ingestFixturePr(request);
  try {
    await page.goto(`/reviews/${reviewId}`);
    await expect(chunkHeading(page, "chunk 1/5")).toBeVisible();
    setPrState("merged");
    await expect(page.getByText("past, read-only")).toBeVisible({ timeout: 20_000 });
    const detail = ReviewDetailResponseSchema.parse(await (await request.get(buildPath(routes.getReview.path, { reviewId }))).json());
    expect(detail.review).toMatchObject({ status: "past", ghState: "merged", worktreePath: null });
    await page.goto("/?tab=past");
    const pastRow = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: TITLE }) });
    await expect(pastRow.getByText("merged")).toBeVisible();
  } finally {
    setPrState("open");
  }
});

test("a commit that only moves an added line past an unchanged one lands in a new round", async ({ request }) => {
  test.setTimeout(60_000);
  const reviewId = await ingestFixturePr(request);
  const originalHead = prHead();
  try {
    pushCommit("Send the welcome mail after saving", [
      {
        path: "src/services/user-service.ts",
        edit: (content) =>
          content.replace(
            "    await this.mailer.sendWelcome(email);\n    await this.store.save(user);",
            "    await this.store.save(user);\n    await this.mailer.sendWelcome(email);",
          ),
      },
    ]);
    expect((await request.post(buildPath(routes.checkRefresh.path, { reviewId }))).ok()).toBe(true);
    const applied = await request.post(buildPath(routes.applyRefresh.path, { reviewId }));
    expect(applied.ok()).toBe(true);
    const result = ApplyRefreshResponseSchema.parse(await applied.json());
    expect(result.roundNumber).toBe(2);
    expect(result.addedHunks).toBeGreaterThan(0);
    expect(result.missingHunks).toBeGreaterThan(0);
  } finally {
    resetPrHead(originalHead);
  }
});

test("submits an approval without a comment and a change request with one to GitHub", async ({ page, request }) => {
  const reviewId = await ingestFixturePr(request);
  const before = submittedReviews().length;
  await page.goto(`/reviews/${reviewId}/summary`);
  const panel = page.getByRole("region", { name: "submit to GitHub" });
  await expect(panel.getByText(`on commit ${prHead().slice(0, 7)}`)).toBeVisible();

  await panel.getByRole("radio", { name: "Approve" }).check();
  await panel.getByRole("button", { name: "Approve on GitHub" }).click();
  await expect(panel.getByRole("link", { name: "View it on GitHub" })).toHaveAttribute("href", `${FIXTURE_PR_URL}#pullrequestreview-${before + 1}`);

  await panel.getByRole("radio", { name: "Request changes" }).check();
  await expect(panel.getByRole("button", { name: "Request changes on GitHub" })).toBeDisabled();
  await panel.getByLabel("Your comment").fill("Send the welcome mail after saving.");
  await expectNoA11yViolations(page);
  await panel.getByRole("button", { name: "Request changes on GitHub" }).click();
  await expect(panel.getByRole("link", { name: "View it on GitHub" })).toHaveAttribute("href", `${FIXTURE_PR_URL}#pullrequestreview-${before + 2}`);

  expect(submittedReviews().slice(before)).toEqual([
    { event: "approve", body: null, commitId: prHead() },
    { event: "request_changes", body: "Send the welcome mail after saving.", commitId: prHead() },
  ]);
});

test("runs Claude's review again from the summary and logs a second review run", async ({ page, request }) => {
  const reviewId = await ingestFixturePr(request);
  await page.goto(`/reviews/${reviewId}/summary`);
  const verdict = page.getByRole("region", { name: "verdict" });
  await expect(verdict.getByText("Request changes", { exact: true })).toBeVisible({ timeout: 30_000 });

  await verdict.getByRole("button", { name: "Run review again" }).click();
  await expect(statusBar(page)).toContainText("Started a new Claude review");
  const runs = page.getByRole("table", { name: "Claude runs for this review" });
  await expect(runs.getByRole("row").filter({ hasText: /^Review/ })).toHaveCount(2, { timeout: 30_000 });
  await expect(runs.getByRole("row").filter({ hasText: /^Review/ }).filter({ hasText: "succeeded" })).toHaveCount(2, { timeout: 30_000 });
  await expect(verdict.getByText("Request changes", { exact: true })).toBeVisible();
});
