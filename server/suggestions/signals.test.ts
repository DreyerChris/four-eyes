import { describe, expect, it } from "vitest";
import type { Review } from "@shared/domain";
import { buildSearchQueries, collectSignals, MAX_AUTHORS_PER_HOST, SEARCH_QUERY_LIMIT, suggestionId } from "./signals";

const NOW = Date.parse("2026-06-30T12:00:00.000Z");

const review = (overrides: Partial<Review>): Review => ({
  id: "rev",
  host: "github.com",
  owner: "acme",
  repo: "widgets",
  prNumber: 1,
  title: "t",
  author: "alice",
  url: "u",
  baseSha: "a",
  headSha: "b",
  ghState: "open",
  status: "active",
  pipelineStatus: "ready",
  pipelineError: null,
  worktreePath: null,
  qaSessionId: null,
  remoteHeadSha: null,
  remoteCheckedAt: null,
  myReviewState: null,
  myReviewSubmittedAt: null,
  myReviewCommitSha: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  lastActivityAt: "2026-06-29T00:00:00.000Z",
  finishedAt: null,
  ...overrides,
});

describe("collectSignals", () => {
  it("watches repos with recent reviews and every reviewed author, per host, most recent first", () => {
    const signals = collectSignals(
      [
        review({ repo: "old", author: "carol", lastActivityAt: "2026-01-01T00:00:00.000Z" }),
        review({ repo: "widgets", author: "alice", lastActivityAt: "2026-06-20T00:00:00.000Z" }),
        review({ repo: "Gadgets", author: "Bob", lastActivityAt: "2026-06-29T00:00:00.000Z" }),
        review({ repo: "gadgets", author: "bob", lastActivityAt: "2026-06-28T00:00:00.000Z" }),
        review({ host: "ghe.example.com", owner: "team", repo: "svc", author: "dave" }),
        review({ repo: "placeholder", author: "", lastActivityAt: "2026-06-30T00:00:00.000Z" }),
        review({ repo: "deleted-user", author: "ghost", lastActivityAt: "2026-06-30T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(signals).toEqual([
      { host: "github.com", repos: ["acme/placeholder", "acme/deleted-user", "acme/Gadgets", "acme/widgets"], authors: ["Bob", "alice", "carol"] },
      { host: "ghe.example.com", repos: ["team/svc"], authors: ["dave"] },
    ]);
  });

  it("caps the authors per host", () => {
    const many = Array.from({ length: MAX_AUTHORS_PER_HOST + 5 }, (_, index) => review({ author: `user${index}` }));
    expect(collectSignals(many, NOW)[0]?.authors).toHaveLength(MAX_AUTHORS_PER_HOST);
  });
});

describe("buildSearchQueries", () => {
  it("packs qualifiers into as few queries as the length limit allows", () => {
    const authors = Array.from({ length: 40 }, (_, index) => `someone-with-a-long-name-${index}`);
    const queries = buildSearchQueries("author", authors);
    expect(queries.length).toBeGreaterThan(1);
    queries.forEach((query) => {
      expect(query.length).toBeLessThanOrEqual(SEARCH_QUERY_LIMIT);
      expect(query.startsWith("is:pr is:open draft:false archived:false -author:@me author:")).toBe(true);
    });
    expect(queries.join(" ").match(/ author:/g)).toHaveLength(40);
  });

  it("returns no queries without values and skips a value too long to search for", () => {
    expect(buildSearchQueries("repo", [])).toEqual([]);
    expect(buildSearchQueries("repo", ["x".repeat(300), "acme/widgets"])).toEqual([
      "is:pr is:open draft:false archived:false -author:@me repo:acme/widgets",
    ]);
  });
});

describe("suggestionId", () => {
  it("ignores case", () => {
    expect(suggestionId("GitHub.com", { owner: "Acme", repo: "Widgets", number: 7 })).toBe("github.com/acme/widgets#7");
  });
});
