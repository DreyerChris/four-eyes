import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffLayout, Finding, Hunk } from "@shared/domain";
import { selectionStore } from "../../../bus/context";
import { appEvents, type OpenFileEvent, type TokenClickEvent } from "../../../bus/events";
import { fixtureFinding, fixtureHunk } from "../testFixtures";
import { DiffView } from "./DiffView";
import type { ContextCommand } from "./HunkView";

vi.mock("../../../lib/highlight", () => ({
  languageForPath: (): string => "text",
  highlightCode: async (code: string): Promise<readonly (readonly { readonly content: string }[])[]> =>
    code.split("\n").map((line) => [{ content: line }]),
}));

const getContextLines = vi.fn();
vi.mock("../../../api/client", () => ({
  api: { getContextLines: (...args: readonly unknown[]): unknown => getContextLines(...args) },
}));

const diffElement = (
  client: QueryClient,
  hunks: readonly Hunk[],
  layout: DiffLayout,
  contextCommand?: ContextCommand,
  findings?: readonly Finding[],
): ReactElement => (
  <QueryClientProvider client={client}>
    <DiffView
      reviewId="rev_1"
      chunkId="chk_1"
      hunks={hunks}
      baseSha="base"
      headSha="head"
      layout={layout}
      hideWhitespace={false}
      contextCommand={contextCommand}
      findings={findings}
    />
  </QueryClientProvider>
);

const newClient = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderDiff = (hunks: readonly Hunk[], layout: DiffLayout = "unified"): ReturnType<typeof render> =>
  render(diffElement(newClient(), hunks, layout));

const isCodeLine =
  (text: string) =>
  (_: string, element: Element | null): boolean =>
    element?.matches("[data-code]") === true && element.textContent === text;

const mockContextAbove = (): void => {
  getContextLines.mockResolvedValue({
    path: "src/user.ts",
    sha: "head",
    totalLines: 40,
    lines: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, text: `line ${index + 1}` })),
  });
};

afterEach(() => {
  cleanup();
  getContextLines.mockReset();
});

describe("DiffView", () => {
  it("renders a file header, markers and line numbers", () => {
    const { container } = renderDiff([fixtureHunk()]);
    expect(screen.getByRole("button", { name: "Open file src/user.ts" })).toBeTruthy();
    const markers = [...container.querySelectorAll("[data-marker]")].map((cell) => cell.getAttribute("data-marker"));
    expect(markers).toEqual([" ", "-", "+", "+", " "]);
    const removed = container.querySelector('[data-code][data-side="old"]');
    expect(removed?.getAttribute("data-line")).toBe("11");
  });

  it("highlights changed words within a replaced line", () => {
    const { container } = renderDiff([fixtureHunk()]);
    const removed = container.querySelector('[data-code][data-side="old"]');
    expect(removed?.querySelector("[class*='word']")?.textContent).toBe("load");
  });

  it("emits token-click with file, side, line and sha", () => {
    const events: TokenClickEvent[] = [];
    const off = appEvents.on("token-click", (event) => events.push(event));
    const { container } = renderDiff([fixtureHunk()]);
    const token = container.querySelector('[data-code][data-side="old"] [data-token="load"]');
    if (!(token instanceof HTMLElement)) throw new Error("token not rendered");
    fireEvent.click(token);
    fireEvent.keyDown(token, { key: "Enter" });
    off();
    expect(events).toEqual([
      { reviewId: "rev_1", token: "load", filePath: "src/user.ts", line: 11, side: "old", sha: "base" },
      { reviewId: "rev_1", token: "load", filePath: "src/user.ts", line: 11, side: "old", sha: "base" },
    ]);
  });

  it("moves focus between identifier tokens with arrow keys", () => {
    const { container } = renderDiff([fixtureHunk()]);
    const root = screen.getByRole("group", { name: /Diff\./ });
    fireEvent.keyDown(root, { key: "ArrowRight" });
    const tokens = [...container.querySelectorAll("[data-token]")];
    expect(document.activeElement).toBe(tokens[0]);
    fireEvent.keyDown(tokens[0] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tokens[1]);
    fireEvent.keyDown(tokens[1] as HTMLElement, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).closest("tr")).not.toBe(tokens[1]?.closest("tr"));
  });

  it("selects a line range from the keyboard with Shift+Down and Shift+Up", () => {
    const { container } = renderDiff([fixtureHunk()]);
    const root = screen.getByRole("group", { name: /Diff\./ });
    fireEvent.keyDown(root, { key: "ArrowRight" });
    const start = document.activeElement as HTMLElement;
    expect(start.closest("[data-code]")?.getAttribute("data-line")).toBe("10");

    fireEvent.keyDown(start, { key: "ArrowDown", shiftKey: true });
    expect(selectionStore.get()).toMatchObject({ filePath: "src/user.ts", startLine: 10, endLine: 10, text: "const a = 1;" });

    fireEvent.keyDown(start, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(start, { key: "ArrowDown", shiftKey: true });
    expect(selectionStore.get()).toMatchObject({ side: "new", startLine: 10, endLine: 11 });
    expect(selectionStore.get()?.text).toBe("const a = 1;\nconst user = load();\nconst user = loadUser();");
    expect(container.querySelectorAll("[data-line-selected]")).toHaveLength(3);
    expect(screen.getByText(/Selected lines 10 to 11 of src\/user.ts/)).toBeTruthy();

    fireEvent.keyDown(start, { key: "ArrowUp", shiftKey: true });
    expect(container.querySelectorAll("[data-line-selected]")).toHaveLength(2);

    fireEvent.keyDown(start, { key: "Escape" });
    expect(selectionStore.get()).toBeNull();
    expect(container.querySelectorAll("[data-line-selected]")).toHaveLength(0);
  });

  it("emits open-file from the file name", () => {
    const events: OpenFileEvent[] = [];
    const off = appEvents.on("open-file", (event) => events.push(event));
    renderDiff([fixtureHunk({ changeType: "renamed", oldFilePath: "src/old-user.ts" })]);
    fireEvent.click(screen.getByRole("button", { name: "Open file src/user.ts" }));
    off();
    expect(events).toEqual([{ reviewId: "rev_1", path: "src/user.ts", oldPath: "src/old-user.ts", line: 10, side: "new" }]);
    expect(screen.getByText("from src/old-user.ts")).toBeTruthy();
  });

  it("pairs removed and added lines side by side in split layout", () => {
    const { container } = renderDiff([fixtureHunk()], "split");
    const rows = [...container.querySelectorAll("tbody tr")].filter((row) => row.querySelector("[data-code]"));
    expect(rows).toHaveLength(4);
    const replaced = rows[1];
    if (!replaced) throw new Error("missing row");
    expect([...replaced.querySelectorAll("[data-code]")].map((cell) => cell.textContent)).toEqual(["const user = load();", "const user = loadUser();"]);
  });

  it("labels hunks that are no longer in the PR and hides expansion", () => {
    renderDiff([fixtureHunk({ present: false })]);
    expect(screen.getByText("no longer in PR")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more lines/ })).toBeNull();
  });

  it("expands context above using head-side line numbers", async () => {
    getContextLines.mockResolvedValue({
      path: "src/user.ts",
      sha: "head",
      totalLines: 40,
      lines: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, text: `line ${index + 1}` })),
    });
    renderDiff([fixtureHunk()]);
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more lines above in src/user.ts" }));
    expect(await screen.findByText((_, element) => element?.matches("[data-code]") === true && element.textContent === "line 9")).toBeTruthy();
    expect(getContextLines).toHaveBeenCalledWith("rev_1", { path: "src/user.ts", sha: "head", start: 1, end: 9 });
    expect(screen.queryByRole("button", { name: "Show 20 more lines above in src/user.ts" })).toBeNull();
  });

  it("shows a readable error when context fails to load", async () => {
    getContextLines.mockRejectedValue(new Error("worktree missing"));
    renderDiff([fixtureHunk()]);
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more lines below in src/user.ts" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/worktree missing/)).toBeTruthy();
  });

  it("hides expanded lines again from the hunk header and returns focus to the file name", async () => {
    mockContextAbove();
    renderDiff([fixtureHunk()]);
    expect(screen.queryByRole("button", { name: "Hide expanded lines in src/user.ts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more lines above in src/user.ts" }));
    expect(await screen.findByText(isCodeLine("line 9"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide expanded lines in src/user.ts" }));
    expect(screen.queryByText(isCodeLine("line 9"))).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide expanded lines in src/user.ts" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show 20 more lines above in src/user.ts" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open file src/user.ts" }));
  });

  it("expands and collapses every hunk from the context command", async () => {
    mockContextAbove();
    const client = newClient();
    const hunks = [fixtureHunk()];
    const { rerender } = render(diffElement(client, hunks, "unified", { mode: "collapse", seq: 0 }));
    expect(getContextLines).not.toHaveBeenCalled();

    rerender(diffElement(client, hunks, "unified", { mode: "expand", seq: 1 }));
    expect((await screen.findAllByText(isCodeLine("line 9"))).length).toBeGreaterThan(0);

    rerender(diffElement(client, hunks, "unified", { mode: "collapse", seq: 2 }));
    expect(screen.queryByText(isCodeLine("line 9"))).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide expanded lines in src/user.ts" })).toBeNull();
  });

  const rowTexts = (): readonly string[] =>
    [...document.querySelectorAll("tbody > tr")].map((row) => {
      const heading = row.querySelector("h4");
      return heading ? `finding: ${heading.textContent ?? ""}` : [...row.querySelectorAll("[data-code]")].map((cell) => cell.textContent).join(" | ");
    });

  it("shows a finding directly under the last line of its range in the unified layout", () => {
    const finding = fixtureFinding({ title: "Email can be undefined", range: { side: "new", startLine: 11, endLine: 12 } });
    render(diffElement(newClient(), [fixtureHunk()], "unified", undefined, [finding]));
    const rows = rowTexts();
    const emailRow = rows.indexOf("const email = user.email;");
    expect(rows[emailRow + 1]).toBe("finding: [Bug] Email can be undefined");
    expect(document.querySelectorAll("[class*=marked_bug]")).toHaveLength(2);
  });

  it("anchors removed-line findings on the old side in the split layout", () => {
    const finding = fixtureFinding({ title: "Old loader was safer", severity: "nit", range: { side: "old", startLine: 11, endLine: 11 } });
    render(diffElement(newClient(), [fixtureHunk()], "split", undefined, [finding]));
    const rows = rowTexts();
    const pairRow = rows.findIndex((text) => text.startsWith("const user = load();"));
    expect(rows[pairRow + 1]).toBe("finding: [Nit] Old loader was safer");
  });

  it("puts findings without a usable range at the top of the hunk", () => {
    const finding = fixtureFinding({ title: "Whole hunk", severity: "improvement" });
    render(diffElement(newClient(), [fixtureHunk()], "unified", undefined, [finding]));
    const header = [...document.querySelectorAll("tbody > tr")].findIndex((row) => row.textContent?.includes("@@ -10,3 +10,4 @@"));
    expect(header).toBeGreaterThanOrEqual(0);
    expect(rowTexts()[header + 1]).toBe("finding: [Improvement] Whole hunk");
    expect(document.querySelectorAll("[class*=marked_]")).toHaveLength(0);
  });
});
