import { describe, expect, it, vi } from "vitest";
import type { Route } from "../../../app/router";
import { parseCommand } from "./commands";
import { runCommand, type CommandDeps } from "./run-command";

describe("parseCommand", () => {
  it("parses every supported command, with or without the leading colon", () => {
    expect(parseCommand(":open src/a b.ts")).toEqual({ ok: true, value: { name: "open", path: "src/a b.ts" } });
    expect(parseCommand("open ./src/a.ts")).toEqual({ ok: true, value: { name: "open", path: "src/a.ts" } });
    expect(parseCommand(":refresh")).toEqual({ ok: true, value: { name: "refresh" } });
    expect(parseCommand("  :summary  ")).toEqual({ ok: true, value: { name: "summary" } });
    expect(parseCommand(":goto 3")).toEqual({ ok: true, value: { name: "goto", chunkNumber: 3 } });
    expect(parseCommand(":7")).toEqual({ ok: true, value: { name: "goto", chunkNumber: 7 } });
    expect(parseCommand(":SETTINGS")).toEqual({ ok: true, value: { name: "settings" } });
  });

  it("rejects bad input with a readable message", () => {
    expect(parseCommand("")).toMatchObject({ ok: false });
    expect(parseCommand(":open")).toEqual({ ok: false, error: "Usage: open <path>" });
    expect(parseCommand(":goto two")).toMatchObject({ ok: false, error: expect.stringContaining("Usage: goto") });
    expect(parseCommand(":goto 0")).toEqual({ ok: false, error: "Chunk numbers start at 1" });
    expect(parseCommand(":0")).toEqual({ ok: false, error: "Chunk numbers start at 1" });
    expect(parseCommand(":refresh now")).toEqual({ ok: false, error: "refresh takes no arguments" });
    expect(parseCommand(":frobnicate")).toMatchObject({ ok: false, error: expect.stringContaining('Unknown command "frobnicate"') });
  });
});

const makeDeps = (route: Route, overrides: Partial<CommandDeps> = {}): CommandDeps => ({
  route,
  location: null,
  navigate: vi.fn(),
  emitOpenFile: vi.fn(),
  emitGotoChunk: vi.fn(),
  openSettings: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  loadChunkIds: vi.fn(() => Promise.resolve(["chk_a", "chk_b"])),
  ...overrides,
});

const reviewRoute: Route = { name: "review", reviewId: "rev_1", chunkId: null };
const listRoute: Route = { name: "list", tab: "active" };

describe("runCommand", () => {
  it("refuses review commands outside a review", async () => {
    const deps = makeDeps(listRoute);
    expect(await runCommand({ name: "summary" }, deps)).toEqual({ ok: false, error: "Open a review first" });
    expect(await runCommand({ name: "goto", chunkNumber: 1 }, deps)).toEqual({ ok: false, error: "Open a review first" });
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it("opens settings from anywhere", async () => {
    const deps = makeDeps(listRoute);
    expect(await runCommand({ name: "settings" }, deps)).toEqual({ ok: true, value: undefined });
    expect(deps.openSettings).toHaveBeenCalledOnce();
  });

  it("navigates to the summary and opens files for the current review", async () => {
    const deps = makeDeps(reviewRoute);
    await runCommand({ name: "summary" }, deps);
    expect(deps.navigate).toHaveBeenCalledWith("/reviews/rev_1/summary");
    await runCommand({ name: "open", path: "src/a.ts" }, deps);
    expect(deps.emitOpenFile).toHaveBeenCalledWith({ reviewId: "rev_1", path: "src/a.ts", oldPath: null, line: null, side: "new" });
  });

  it("emits goto-chunk on the review page when the chunk count is known", async () => {
    const deps = makeDeps(reviewRoute, { location: { reviewId: "rev_1", chunkId: "chk_a", chunkNumber: 1, chunkCount: 4 } });
    expect(await runCommand({ name: "goto", chunkNumber: 3 }, deps)).toMatchObject({ ok: true });
    expect(deps.emitGotoChunk).toHaveBeenCalledWith({ reviewId: "rev_1", chunkNumber: 3 });
    expect(await runCommand({ name: "goto", chunkNumber: 9 }, deps)).toEqual({ ok: false, error: "This review has 4 chunks" });
  });

  it("navigates to the chunk from the summary page", async () => {
    const deps = makeDeps({ name: "summary", reviewId: "rev_1" });
    expect(await runCommand({ name: "goto", chunkNumber: 2 }, deps)).toMatchObject({ ok: true });
    expect(deps.navigate).toHaveBeenCalledWith("/reviews/rev_1?chunk=chk_b");
    expect(await runCommand({ name: "goto", chunkNumber: 3 }, deps)).toEqual({ ok: false, error: "This review has 2 chunks" });
  });

  it("turns thrown errors into a readable failure", async () => {
    const deps = makeDeps(reviewRoute, { refresh: () => Promise.reject(new Error("network down")) });
    expect(await runCommand({ name: "refresh" }, deps)).toEqual({ ok: false, error: ":refresh failed: network down" });
  });
});
