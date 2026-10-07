import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewDetailResponse } from "@shared/api";
import { DEFAULT_SETTINGS, type Settings } from "@shared/domain";
import { useRoute } from "../../app/router";
import { reviewLocationStore } from "../../bus/context";
import { appEvents } from "../../bus/events";
import { useGlobalKeyListener, useKeyScope } from "../../keys/hooks";
import { ReviewPage } from "./ReviewPage";
import { fixtureChunk, fixtureDetail, fixtureHunk, fixtureProgress, fixtureReviewItem } from "./testFixtures";

vi.mock("../../lib/highlight", () => ({
  languageForPath: (): string => "text",
  highlightCode: async (code: string): Promise<readonly (readonly { readonly content: string }[])[]> =>
    code.split("\n").map((line) => [{ content: line }]),
}));

const mocks = vi.hoisted(() => ({
  getReview: vi.fn(),
  getSettings: vi.fn(),
  updateChunkProgress: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: {
    getReview: mocks.getReview,
    getSettings: mocks.getSettings,
    updateChunkProgress: mocks.updateChunkProgress,
    updateSettings: mocks.updateSettings,
    subscribeProgress: (): (() => void) => () => undefined,
    getSummary: vi.fn(),
    getRefreshStatus: vi.fn(),
    listQuestions: vi.fn(),
    listReviews: vi.fn(),
  },
}));

const Harness = (): ReactElement => {
  useGlobalKeyListener();
  useKeyScope("review");
  const route = useRoute();
  return route.name === "review" ? <ReviewPage reviewId={route.reviewId} chunkId={route.chunkId} /> : <p>at {route.name}</p>;
};

const setup = (detail: ReviewDetailResponse = fixtureDetail(), settings: Settings = DEFAULT_SETTINGS): void => {
  mocks.getReview.mockResolvedValue(detail);
  mocks.getSettings.mockResolvedValue(settings);
  mocks.updateChunkProgress.mockImplementation(async (_reviewId: string, chunkId: string, body: { status: string; note: string }) => ({
    chunkId,
    ...body,
    updatedAt: "now",
  }));
  mocks.updateSettings.mockImplementation(async (patch: Partial<Settings>) => ({ ...settings, ...patch }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
};

const press = (key: string, init: KeyboardEventInit = {}): void => {
  fireEvent.keyDown(document.body, { key, ...init });
};

beforeEach(() => {
  window.history.replaceState(null, "", "/reviews/rev_1");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReviewPage", () => {
  it("shows the review and first unseen chunk, and records the location", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Add email to users" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "chunk 1/2" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Load users with email" })).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe("?chunk=chk_1"));
    expect(reviewLocationStore.get()).toEqual({ reviewId: "rev_1", chunkId: "chk_1", chunkNumber: 1, chunkCount: 2 });
  });

  it("hides findings unless inline findings are on", async () => {
    setup();
    await screen.findByRole("heading", { name: "chunk 1/2" });
    expect(screen.queryByText("Email can be undefined")).toBeNull();
    cleanup();
    setup(fixtureDetail(), { ...DEFAULT_SETTINGS, inlineFindings: true });
    expect(await screen.findByText("Email can be undefined")).toBeTruthy();
  });

  it("marks good with g and moves to the next chunk", async () => {
    setup();
    await screen.findByRole("heading", { name: "chunk 1/2" });
    press("g");
    await waitFor(() => expect(mocks.updateChunkProgress).toHaveBeenCalledWith("rev_1", "chk_1", { status: "good", note: "" }));
    expect(await screen.findByRole("heading", { name: "chunk 2/2 · skim" })).toBeTruthy();
    expect(window.location.search).toBe("?chunk=chk_2");
  });

  it("steps with j and k and goes to the summary after the last chunk", async () => {
    setup();
    await screen.findByRole("heading", { name: "chunk 1/2" });
    press("j");
    expect(await screen.findByRole("heading", { name: "chunk 2/2 · skim" })).toBeTruthy();
    press("k");
    expect(await screen.findByRole("heading", { name: "chunk 1/2" })).toBeTruthy();
    press("j");
    await screen.findByRole("heading", { name: "chunk 2/2 · skim" });
    press("j");
    expect(await screen.findByText("at summary")).toBeTruthy();
  });

  it("flags with f and saves a note written after n", async () => {
    setup();
    await screen.findByRole("heading", { name: "chunk 1/2" });
    press("f");
    await waitFor(() => expect(mocks.updateChunkProgress).toHaveBeenCalledWith("rev_1", "chk_1", { status: "flagged", note: "" }));
    press("n");
    const textarea = await screen.findByLabelText("Note");
    expect(document.activeElement).toBe(textarea);
    fireEvent.change(textarea, { target: { value: "Why load twice?" } });
    fireEvent.keyDown(textarea, { key: "j" });
    expect(screen.getByRole("heading", { name: "chunk 1/2" })).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(mocks.updateChunkProgress).toHaveBeenLastCalledWith("rev_1", "chk_1", { status: "unseen", note: "Why load twice?" }));
  });

  it("toggles the split layout with s", async () => {
    setup();
    await screen.findByRole("heading", { name: "chunk 1/2" });
    press("s");
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith({ diffLayout: "split" }));
  });

  it("jumps on goto-chunk and honours ?chunk= in the URL", async () => {
    window.history.replaceState(null, "", "/reviews/rev_1?chunk=chk_2");
    setup();
    expect(await screen.findByRole("heading", { name: "chunk 2/2 · skim" })).toBeTruthy();
    act(() => appEvents.emit("goto-chunk", { reviewId: "rev_1", chunkNumber: 1 }));
    expect(await screen.findByRole("heading", { name: "chunk 1/2" })).toBeTruthy();
  });

  it("labels later rounds and hunks that left the PR", async () => {
    const detail = fixtureDetail({
      chunks: [
        fixtureChunk({
          roundNumber: 2,
          roundId: "rnd_2",
          hunks: [fixtureHunk({ present: false })],
        }),
      ],
    });
    setup(detail);
    expect(await screen.findByRole("heading", { name: "chunk 1/1 · Round 2" })).toBeTruthy();
    expect(screen.getByText("no longer in PR")).toBeTruthy();
  });

  it("is read-only for past reviews", async () => {
    setup(fixtureDetail({ review: fixtureReviewItem({ status: "past" }) }));
    await screen.findByRole("heading", { name: "chunk 1/2" });
    expect(screen.queryByRole("group", { name: "Mark this chunk" })).toBeNull();
    press("g");
    expect(mocks.updateChunkProgress).not.toHaveBeenCalled();
  });

  it("explains a failed pipeline", async () => {
    setup(fixtureDetail({ chunks: [], review: fixtureReviewItem({ pipelineStatus: "failed", pipelineError: "gh: not found" }) }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Preparing this review failed: gh: not found");
  });

  it("starts at the first unseen chunk", async () => {
    const detail = fixtureDetail();
    const [first, second] = detail.chunks;
    if (!first || !second) throw new Error("fixture chunks missing");
    setup({ ...detail, chunks: [{ ...first, progress: fixtureProgress({ status: "good" }) }, second] });
    expect(await screen.findByRole("heading", { name: "chunk 2/2 · skim" })).toBeTruthy();
  });
});
