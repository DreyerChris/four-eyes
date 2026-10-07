import { describe, expect, it } from "vitest";
import { matchRoute, paths } from "./router";

describe("matchRoute", () => {
  it("matches every page", () => {
    expect(matchRoute("/", "")).toEqual({ name: "list", tab: "active" });
    expect(matchRoute("/", "?tab=past")).toEqual({ name: "list", tab: "past" });
    expect(matchRoute("/reviews/rev_1", "?chunk=chk_2")).toEqual({ name: "review", reviewId: "rev_1", chunkId: "chk_2" });
    expect(matchRoute("/reviews/rev_1/summary", "")).toEqual({ name: "summary", reviewId: "rev_1" });
    expect(matchRoute("/nope", "")).toEqual({ name: "not-found", path: "/nope" });
  });

  it("round-trips paths", () => {
    const url = new URL(paths.review("rev 1", "chk_9"), "http://local");
    expect(matchRoute(url.pathname, url.search)).toEqual({ name: "review", reviewId: "rev 1", chunkId: "chk_9" });
  });
});
