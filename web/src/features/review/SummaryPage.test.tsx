import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryResponse } from "@shared/api";
import type { ClaudeRun } from "@shared/domain";
import { useGlobalKeyListener, useKeyScope } from "../../keys/hooks";
import { buildFullReviewMarkdown, findingToGitHubComment } from "./markdown";
import { SummaryPage } from "./SummaryPage";
import { fixtureDetail, fixtureFinding, fixtureHunk, fixtureReviewItem, fixtureSummary } from "./testFixtures";

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getReview: vi.fn(),
  setFindingVerdict: vi.fn(),
  finishReview: vi.fn(),
  submitGitHubReview: vi.fn(),
  rerunReview: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: {
    getSummary: mocks.getSummary,
    getReview: mocks.getReview,
    setFindingVerdict: mocks.setFindingVerdict,
    finishReview: mocks.finishReview,
    submitGitHubReview: mocks.submitGitHubReview,
    rerunReview: mocks.rerunReview,
    getRefreshStatus: vi.fn(),
    listQuestions: vi.fn(),
    listReviews: vi.fn(),
    subscribeProgress: vi.fn(() => () => undefined),
  },
}));

vi.mock("../../lib/clipboard", () => ({ copyText: mocks.copyText }));

const Harness = (): ReactElement => {
  useGlobalKeyListener();
  useKeyScope("summary");
  return <SummaryPage reviewId="rev_1" />;
};

const setup = (summary: SummaryResponse = fixtureSummary()): void => {
  mocks.getSummary.mockResolvedValue(summary);
  mocks.getReview.mockResolvedValue(fixtureDetail());
  mocks.setFindingVerdict.mockImplementation(async (_reviewId: string, findingId: string, body: { verdict: string | null }) => ({
    ...fixtureFinding({ id: findingId }),
    userVerdict: body.verdict,
  }));
  mocks.copyText.mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const run = (kind: "chunking" | "review" | "qa", costUsd: number, startedAt: string): ClaudeRun => ({
  id: `run_${kind}_${startedAt}`,
  reviewId: "rev_1",
  kind,
  model: kind === "review" ? "claude-opus-5-5" : "claude-sonnet-5-5",
  status: "succeeded",
  sessionId: null,
  inputTokens: 100,
  outputTokens: 10,
  costUsd,
  error: null,
  startedAt,
  finishedAt: startedAt,
});

describe("SummaryPage", () => {
  it("lists every Claude run and the review's total cost", async () => {
    mocks.getReview.mockResolvedValue(
      fixtureDetail({
        runs: [run("review", 0.271, "2026-01-01T00:00:02.000Z"), run("chunking", 0.06, "2026-01-01T00:00:01.000Z"), run("qa", 0.04, "2026-01-01T00:00:03.000Z")],
      }),
    );
    mocks.getSummary.mockResolvedValue(fixtureSummary());
    mocks.copyText.mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Harness />
      </QueryClientProvider>,
    );
    const table = await screen.findByRole("table", { name: "Claude runs for this review" });
    expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "runmodelstatustokens in / outcost",
      "Chunkingclaude-sonnet-5-5succeeded100 / 10$0.06",
      "Reviewclaude-opus-5-5succeeded100 / 10$0.27",
      "Questionclaude-sonnet-5-5succeeded100 / 10$0.04",
      "total$0.37",
    ]);
  });

  it("shows the verdict, grouped findings, notes, questions and coverage", async () => {
    setup();
    expect(within(await screen.findByRole("region", { name: "verdict" })).getByText("Request changes")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Bug (1)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Nit (1)" })).toBeTruthy();
    expect(screen.getByText(/Check null emails/)).toBeTruthy();
    expect(screen.getByText("Show 1 question")).toBeTruthy();
    expect(screen.getByText("Chunks reviewed: 1 of 2")).toBeTruthy();
    expect(screen.getByText("Hunks no longer in the PR: 1")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "go to chunk 1" })[0]?.getAttribute("href")).toBe("/reviews/rev_1?chunk=chk_1");
  });

  it("records agree / disagree with the buttons and toggles off a repeated choice", async () => {
    setup(fixtureSummary({ findings: [fixtureFinding({ userVerdict: "agree" })] }));
    const group = await screen.findByRole("group", { name: "Your verdict on Email can be undefined" });
    expect(within(group).getByRole("button", { name: "Agree" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(mocks.setFindingVerdict).toHaveBeenCalledWith("rev_1", "fnd_1", { verdict: null }));
    fireEvent.click(within(group).getByRole("button", { name: "Unsure" }));
    await waitFor(() => expect(mocks.setFindingVerdict).toHaveBeenLastCalledWith("rev_1", "fnd_1", { verdict: "unsure" }));
  });

  it("removes the copy and verdict buttons from resolved findings, keeps go to chunk, and ignores a/x/c on them", async () => {
    setup(fixtureSummary({ findings: [fixtureFinding({ severity: "nit", lifecycle: "resolved", userVerdict: "agree" })] }));
    const card = await screen.findByRole("article", { name: /Email can be undefined/ });
    expect(within(card).queryByRole("button", { name: "Copy as GitHub comment" })).toBeNull();
    expect(within(card).queryByRole("group", { name: /Your verdict/ })).toBeNull();
    expect(within(card).getByText("You marked this agree")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "go to chunk 1" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "x" });
    fireEvent.keyDown(document.body, { key: "c" });
    fireEvent.keyDown(document.body, { key: "C", shiftKey: true });
    expect(mocks.setFindingVerdict).not.toHaveBeenCalled();
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).toHaveBeenLastCalledWith(expect.any(String), "Full review copied");
  });

  it("supports the summary keys: j/k select, a/x vote, c copies, shift+C copies everything", async () => {
    const summary = fixtureSummary();
    setup(summary);
    await screen.findByRole("region", { name: "verdict" });
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "x" });
    await waitFor(() => expect(mocks.setFindingVerdict).toHaveBeenCalledWith("rev_1", "fnd_2", { verdict: "disagree" }));
    fireEvent.keyDown(document.body, { key: "k" });
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(mocks.setFindingVerdict).toHaveBeenLastCalledWith("rev_1", "fnd_1", { verdict: "agree" }));
    await waitFor(() => expect(mocks.getReview).toHaveBeenCalled());
    await screen.findByRole("heading", { name: "Bug (1)" });
    await waitFor(() => {
      fireEvent.keyDown(document.body, { key: "c" });
      expect(mocks.copyText).toHaveBeenLastCalledWith(
        findingToGitHubComment(fixtureFinding(), [fixtureHunk()]),
        expect.any(String),
      );
    });
    fireEvent.keyDown(document.body, { key: "C", shiftKey: true });
    expect(mocks.copyText).toHaveBeenLastCalledWith(buildFullReviewMarkdown(summary), "Full review copied");
  });

  it("finishes the review and goes read-only once past", async () => {
    mocks.finishReview.mockResolvedValue({ review: fixtureReviewItem({ status: "past" }) });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Finish review" }));
    await waitFor(() => expect(mocks.finishReview).toHaveBeenCalledWith("rev_1"));
    cleanup();
    setup(fixtureSummary({ review: fixtureReviewItem({ status: "past" }) }));
    expect(await screen.findByText("past, read-only")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Agree" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("explains a failed Claude review", async () => {
    setup(
      fixtureSummary({
        verdict: null,
        reviewRun: {
          id: "run_1",
          reviewId: "rev_1",
          kind: "review",
          model: "claude-opus-5-5",
          status: "failed",
          sessionId: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          error: "gateway timeout",
          startedAt: "now",
          finishedAt: "now",
        },
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("Claude's review failed: gateway timeout");
  });
});

describe("SubmitReviewPanel", () => {
  const panel = async (): Promise<HTMLElement> => screen.findByRole("region", { name: "submit to GitHub" });

  it("approves without a comment and links to the submitted review", async () => {
    mocks.submitGitHubReview.mockResolvedValue({ url: "https://github.com/acme/widgets/pull/7#pullrequestreview-1" });
    setup();
    const region = await panel();
    expect((within(region).getByRole("button", { name: "Submit to GitHub" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(region).getByRole("radio", { name: "Approve" }));
    fireEvent.click(within(region).getByRole("button", { name: "Approve on GitHub" }));
    await waitFor(() => expect(mocks.submitGitHubReview).toHaveBeenCalledWith("rev_1", { event: "approve", body: "" }));
    const link = await within(region).findByRole("link", { name: "View it on GitHub" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/widgets/pull/7#pullrequestreview-1");
    expect((within(region).getByRole("radio", { name: "Approve" }) as HTMLInputElement).checked).toBe(false);
  });

  it("requires a comment to request changes", async () => {
    mocks.submitGitHubReview.mockResolvedValue({ url: "https://github.com/acme/widgets/pull/7" });
    setup();
    const region = await panel();
    fireEvent.click(within(region).getByRole("radio", { name: "Request changes" }));
    const button = within(region).getByRole("button", { name: "Request changes on GitHub" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(within(region).getByRole("alert").textContent).toContain("GitHub requires one unless you approve");
    fireEvent.change(within(region).getByLabelText("Your comment"), { target: { value: "Please handle null emails." } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.submitGitHubReview).toHaveBeenCalledWith("rev_1", { event: "request_changes", body: "Please handle null emails." }),
    );
  });

  it("adds the full review below what you already wrote", async () => {
    const summary = fixtureSummary();
    setup(summary);
    const region = await panel();
    const comment = within(region).getByLabelText("Your comment") as HTMLTextAreaElement;
    fireEvent.change(comment, { target: { value: "Thanks!" } });
    fireEvent.click(within(region).getByRole("button", { name: "Add full review to comment" }));
    expect(comment.value).toBe(`Thanks!\n\n${buildFullReviewMarkdown(summary)}`);
  });

  it("shows GitHub's refusal", async () => {
    mocks.submitGitHubReview.mockRejectedValue(new Error("GitHub refused the review: Can not approve your own pull request"));
    setup();
    const region = await panel();
    fireEvent.click(within(region).getByRole("radio", { name: "Approve" }));
    fireEvent.click(within(region).getByRole("button", { name: "Approve on GitHub" }));
    expect((await within(region).findByRole("alert")).textContent).toContain("Can not approve your own pull request");
  });

  it("says how you already reviewed the PR on GitHub and whether it changed since", async () => {
    setup(
      fixtureSummary({
        review: fixtureReviewItem({
          myReviewState: "approved",
          myReviewSubmittedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          myReviewCommitSha: "older",
        }),
      }),
    );
    expect((await panel()).textContent).toContain("You approved this PR on GitHub 2h ago, and it has new commits since.");
  });

  it("explains why Past reviews and closed PRs cannot be submitted", async () => {
    setup(fixtureSummary({ review: fixtureReviewItem({ status: "past" }) }));
    expect((await panel()).textContent).toContain("This review is in Past");
    expect(within(await panel()).queryByRole("radio")).toBeNull();
    cleanup();
    setup(fixtureSummary({ review: fixtureReviewItem({ ghState: "merged" }) }));
    expect((await panel()).textContent).toContain("is merged, so it cannot take a new review");
  });
});

describe("review re-run", () => {
  const reviewRun = (status: ClaudeRun["status"], startedAt: string): ClaudeRun => ({
    id: "run_1",
    reviewId: "rev_1",
    kind: "review",
    model: "claude-opus-5-5",
    status,
    sessionId: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    error: status === "failed" ? "gateway timeout" : null,
    startedAt,
    finishedAt: null,
  });

  const verdictPanel = async (): Promise<HTMLElement> => screen.findByRole("region", { name: "verdict" });

  it("retries a failed review", async () => {
    mocks.rerunReview.mockResolvedValue({ ok: true });
    setup(fixtureSummary({ verdict: null, reviewRun: reviewRun("failed", "2026-01-01T00:00:00.000Z") }));
    fireEvent.click(within(await verdictPanel()).getByRole("button", { name: "Retry review" }));
    await waitFor(() => expect(mocks.rerunReview).toHaveBeenCalledWith("rev_1"));
  });

  it("offers a restart while a review is running and says when it started", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    setup(fixtureSummary({ verdict: null, reviewRun: reviewRun("running", tenMinutesAgo) }));
    const panel = await verdictPanel();
    expect(within(panel).getByRole("status").textContent).toContain("started 10m ago");
    expect(within(panel).getByRole("button", { name: "Restart review" })).toBeTruthy();
  });

  it("has no re-run button on a Past review", async () => {
    setup(fixtureSummary({ review: fixtureReviewItem({ status: "past" }), reviewRun: reviewRun("failed", "2026-01-01T00:00:00.000Z") }));
    expect(within(await verdictPanel()).queryByRole("button")).toBeNull();
  });
});
