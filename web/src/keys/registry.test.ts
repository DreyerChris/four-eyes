import { describe, expect, it, vi } from "vitest";
import { comboFromEvent, createKeyRegistry, normalizeCombo } from "./registry";

const keydown = (key: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent("keydown", { key, cancelable: true, ...init });

describe("key registry", () => {
  it("normalises combos", () => {
    expect(normalizeCombo("Shift+Ctrl+Enter")).toBe("ctrl+shift+enter");
    expect(normalizeCombo("?")).toBe("?");
    expect(comboFromEvent(keydown("?", { shiftKey: true }))).toBe("?");
    expect(comboFromEvent(keydown("Escape"))).toBe("escape");
  });

  it("prefers the top scope, falls back to global, and blocks global under overlays", () => {
    const registry = createKeyRegistry();
    const global = vi.fn();
    const review = vi.fn();
    registry.register({ id: "g", key: "?", scope: "global", description: "ask", handler: global });
    registry.register({ id: "r", key: "j", scope: "review", description: "next", handler: review });

    expect(registry.dispatch(keydown("j"))).toBe(false);
    const popReview = registry.pushScope("review");
    registry.dispatch(keydown("j"));
    registry.dispatch(keydown("?"));
    expect(review).toHaveBeenCalledTimes(1);
    expect(global).toHaveBeenCalledTimes(1);

    const popOverlay = registry.pushScope("overlay");
    expect(registry.dispatch(keydown("?"))).toBe(false);
    popOverlay();
    popReview();
    expect(registry.hints().map((h) => h.key)).toEqual(["?"]);
  });

  it("warns on duplicate keys in one scope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const registry = createKeyRegistry();
    registry.register({ id: "a", key: "j", scope: "list", description: "a", handler: () => undefined });
    registry.register({ id: "b", key: "j", scope: "list", description: "b", handler: () => undefined });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
