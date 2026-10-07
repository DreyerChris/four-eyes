import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DefinitionMatch, DefinitionSearchResponse } from "@shared/api";
import { api } from "../../../api/client";
import { appEvents, type AppEventMap, type TokenClickEvent } from "../../../bus/events";
import { DefinitionResults } from "./DefinitionPicker";

const target: TokenClickEvent = {
  reviewId: "rev_1",
  token: "createUser",
  filePath: "src/routes/users.ts",
  line: 12,
  side: "new",
  sha: "abc",
};

const match = (path: string, line: number): DefinitionMatch => ({ path, line, column: 3, preview: `  export function createUser() {` });

const renderWith = (response: Promise<DefinitionSearchResponse>): void => {
  vi.spyOn(api, "searchDefinitions").mockReturnValue(response);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = (): ReactElement => (
    <QueryClientProvider client={client}>
      <DefinitionResults target={target} />
    </QueryClientProvider>
  );
  render(<Wrapper />);
};

const listen = <N extends "open-file" | "ask-claude">(name: N): ReturnType<typeof vi.fn<(payload: AppEventMap[N]) => void>> => {
  const handler = vi.fn<(payload: AppEventMap[N]) => void>();
  const off = appEvents.on(name, handler);
  cleanups.push(off);
  return handler;
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((off) => off());
  vi.restoreAllMocks();
});

describe("DefinitionResults", () => {
  it("shows a searching state while the request is pending", () => {
    renderWith(new Promise(() => undefined));
    expect(screen.getByRole("status").textContent).toContain("Searching for the definition of createUser");
  });

  it("opens the file directly when there is exactly one match", async () => {
    const openFile = listen("open-file");
    renderWith(Promise.resolve({ symbol: "createUser", matches: [match("src/services/user-service.ts", 10)] }));
    expect(await screen.findByText(/Opening src\/services\/user-service.ts:10/)).toBeTruthy();
    expect(openFile).toHaveBeenCalledWith({ reviewId: "rev_1", path: "src/services/user-service.ts", oldPath: null, line: 10, side: "new" });
  });

  it("lists several matches and opens the chosen one", async () => {
    const openFile = listen("open-file");
    renderWith(Promise.resolve({ symbol: "createUser", matches: [match("src/a.ts", 1), match("src/b.ts", 20)] }));
    const second = await screen.findByRole("button", { name: /src\/b.ts:20/ });
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(second);
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "src/b.ts", line: 20 }));
  });

  it("offers Ask Claude when nothing matches", async () => {
    const askClaude = listen("ask-claude");
    renderWith(Promise.resolve({ symbol: "createUser", matches: [] }));
    expect(await screen.findByText(/No definition found for/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude about createUser/ }));
    expect(askClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: "rev_1",
        selection: expect.objectContaining({ filePath: "src/routes/users.ts", startLine: 12, endLine: 12, text: "createUser" }),
      }),
    );
  });

  it("shows the error and still offers Ask Claude when the search fails", async () => {
    renderWith(Promise.reject(new Error("rg exited with code 2")));
    expect((await screen.findByRole("alert")).textContent).toContain("Definition search failed: rg exited with code 2");
    expect(screen.getByRole("button", { name: /Ask Claude/ })).toBeTruthy();
  });
});
