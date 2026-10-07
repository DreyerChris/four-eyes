import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuggestionsResponse } from "@shared/api";
import type { PrSuggestion } from "@shared/domain";
import { SuggestionsPanel } from "./SuggestionsPanel";

const mocks = vi.hoisted(() => ({
  listSuggestions: vi.fn(),
  checkSuggestions: vi.fn(),
  dismissSuggestion: vi.fn(),
  ignoreSuggestion: vi.fn(),
  createReview: vi.fn(),
}));

vi.mock("../../../api/client", () => ({ api: mocks }));

const NOW = Date.parse("2026-06-30T12:00:00.000Z");

const suggestion = (overrides: Partial<PrSuggestion> = {}): PrSuggestion => ({
  id: "github.com/acme/widgets#20",
  host: "github.com",
  owner: "acme",
  repo: "widgets",
  number: 20,
  title: "Add caching",
  author: "alice",
  url: "https://github.com/acme/widgets/pull/20",
  updatedAt: "2026-06-30T11:00:00.000Z",
  recentRepo: true,
  knownAuthor: true,
  firstSeenAt: "2026-06-30T11:00:00.000Z",
  lastSeenAt: "2026-06-30T11:00:00.000Z",
  dismissedAt: null,
  ignoredAt: null,
  ...overrides,
});

const response = (overrides: Partial<SuggestionsResponse> = {}): SuggestionsResponse => ({
  enabled: true,
  suggestions: [suggestion()],
  lastCheckedAt: "2026-06-30T11:55:00.000Z",
  checking: false,
  errors: [],
  ...overrides,
});

const setup = (data: SuggestionsResponse, onAdded = vi.fn()): typeof onAdded => {
  mocks.listSuggestions.mockResolvedValue(data);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SuggestionsPanel now={NOW} onAdded={onAdded} />
    </QueryClientProvider>,
  );
  return onAdded;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SuggestionsPanel", () => {
  it("shows each PR with why it was suggested, a GitHub link and when it was last checked", async () => {
    setup(response());
    const row = (await screen.findByText("Add caching")).closest("li");
    if (!row) throw new Error("no row");
    expect(within(row).getByText("repo you reviewed recently")).toBeTruthy();
    expect(within(row).getByText("@alice's PRs you reviewed before")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Open on GitHub: acme/widgets#20" }).getAttribute("href")).toBe(
      "https://github.com/acme/widgets/pull/20",
    );
    expect(screen.getByText("Checked 5m ago")).toBeTruthy();
  });

  it("adds the PR through the normal flow with Review this", async () => {
    mocks.createReview.mockResolvedValue({ review: { id: "rev_9", owner: "acme", repo: "widgets", prNumber: 20 }, reopened: false });
    const onAdded = setup(response());
    fireEvent.click(await screen.findByRole("button", { name: "Review this: acme/widgets#20" }));
    await waitFor(() => expect(mocks.createReview).toHaveBeenCalledWith({ url: "https://github.com/acme/widgets/pull/20" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith("rev_9"));
  });

  it("dismisses or marks a PR not interested", async () => {
    mocks.dismissSuggestion.mockResolvedValue({ ok: true });
    mocks.ignoreSuggestion.mockResolvedValue({ ok: true });
    setup(response());
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss: acme/widgets#20" }));
    await waitFor(() => expect(mocks.dismissSuggestion).toHaveBeenCalledWith("github.com/acme/widgets#20"));
    fireEvent.click(screen.getByRole("button", { name: "Not interested: acme/widgets#20" }));
    await waitFor(() => expect(mocks.ignoreSuggestion).toHaveBeenCalledWith("github.com/acme/widgets#20"));
  });

  it("checks GitHub on demand and reports a host that failed", async () => {
    mocks.checkSuggestions.mockResolvedValue(response({ suggestions: [] }));
    setup(response({ errors: [{ host: "ghe.example.com", message: "gh is not logged in" }] }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not check ghe.example.com: gh is not logged in");
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(mocks.checkSuggestions).toHaveBeenCalled());
    expect(await screen.findByText(/No suggestions right now/)).toBeTruthy();
  });

  it("says when suggestions are turned off", async () => {
    setup(response({ enabled: false, suggestions: [] }));
    expect(await screen.findByText(/PR suggestions are turned off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
  });
});
