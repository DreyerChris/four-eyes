import { describe, expect, it } from "vitest";
import { HttpError } from "../lib/errors";
import { parsePrUrl, prWebUrl } from "./pr-url";

describe("parsePrUrl", () => {
  it.each([
    ["https://github.com/octo/widgets/pull/12", { host: "github.com", owner: "octo", repo: "widgets", number: 12 }],
    ["https://ghe.example.com/team/svc/pull/7/files", { host: "ghe.example.com", owner: "team", repo: "svc", number: 7 }],
    ["  https://GitHub.com/o/r.js/pull/3/commits/abc?diff=split#r1  ", { host: "github.com", owner: "o", repo: "r.js", number: 3 }],
    ["github.com/o/r/pull/99", { host: "github.com", owner: "o", repo: "r", number: 99 }],
    ["http://localhost:8080/o/r/pull/1", { host: "localhost:8080", owner: "o", repo: "r", number: 1 }],
    ["https://github.com/o/r.git/pull/5", { host: "github.com", owner: "o", repo: "r", number: 5 }],
  ])("parses %s", (input, expected) => {
    expect(parsePrUrl(input)).toEqual(expected);
  });

  it.each([
    ["", /empty/],
    ["https://github.com/o/r/issues/12", /expected "\/pull\/"/],
    ["https://github.com/o/r", /path must be/],
    ["https://github.com/o/r/pull/abc", /not a pull request number/],
    ["https://github.com/o/r/pull/0", /not a pull request number/],
    ["ftp://github.com/o/r/pull/1", /http and https/],
    ["https://github.com/o w/r/pull/1", /invalid characters/],
    ["not a url at all", /path must be|not a valid URL/],
  ])("rejects %j with a 400", (input, message) => {
    const attempt = (): unknown => parsePrUrl(input);
    expect(attempt).toThrow(HttpError);
    expect(attempt).toThrow(message);
    try {
      attempt();
    } catch (error) {
      expect(error instanceof HttpError && error.status).toBe(400);
    }
  });

  it("builds the canonical web URL", () => {
    expect(prWebUrl({ host: "github.com", owner: "o", repo: "r", number: 4 })).toBe("https://github.com/o/r/pull/4");
  });
});
