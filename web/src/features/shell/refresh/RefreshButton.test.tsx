import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefreshStatus } from "@shared/domain";
import { api, ApiClientError } from "../../../api/client";
import { statusMessageStore } from "../../../bus/context";
import { RefreshButton } from "./RefreshButton";

const status = (hasNewCommits: boolean): RefreshStatus => ({
  reviewId: "rev_1",
  reviewHeadSha: "aaa",
  remoteHeadSha: hasNewCommits ? "bbb" : "aaa",
  hasNewCommits,
  ghState: "open",
  checkedAt: null,
  refreshing: false,
});

const renderButton = (): void => {
  vi.spyOn(api, "getReview").mockRejectedValue(new ApiClientError(404, "not found"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RefreshButton reviewId="rev_1" />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RefreshButton", () => {
  it("shows new commits and applies them after checking", async () => {
    vi.spyOn(api, "getRefreshStatus").mockResolvedValue(status(true));
    const check = vi.spyOn(api, "checkRefresh").mockResolvedValue(status(true));
    const apply = vi.spyOn(api, "applyRefresh").mockResolvedValue({
      status: status(false),
      roundId: "rnd_2",
      roundNumber: 2,
      matchedHunks: 4,
      addedHunks: 2,
      missingHunks: 1,
    });
    renderButton();
    const button = await screen.findByRole("button", { name: /new commits · refresh/ });
    fireEvent.click(button);
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(check).toHaveBeenCalledOnce();
    await waitFor(() => expect(statusMessageStore.get()).toBe("Refreshed. Round 2: 2 new hunks, 4 kept, 1 no longer in PR"));
  });

  it("does not apply when there is nothing new", async () => {
    vi.spyOn(api, "getRefreshStatus").mockResolvedValue(status(false));
    vi.spyOn(api, "checkRefresh").mockResolvedValue(status(false));
    const apply = vi.spyOn(api, "applyRefresh");
    renderButton();
    fireEvent.click(await screen.findByRole("button", { name: "refresh" }));
    await waitFor(() => expect(statusMessageStore.get()).toBe("No new commits"));
    expect(apply).not.toHaveBeenCalled();
  });

  it("reports a failed check in the status bar", async () => {
    vi.spyOn(api, "getRefreshStatus").mockRejectedValue(new ApiClientError(502, "GitHub unreachable"));
    vi.spyOn(api, "checkRefresh").mockRejectedValue(new ApiClientError(502, "gh failed"));
    renderButton();
    expect(await screen.findByText("status unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(statusMessageStore.get()).toBe("Refresh failed: gh failed"));
  });
});
