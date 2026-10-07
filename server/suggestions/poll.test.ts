import { afterEach, describe, expect, it } from "vitest";
import { buildPath, routes, SuggestionsResponseSchema } from "@shared/api";
import { createApp } from "../app";
import { seedReviewWithHunks } from "../claude/test-support";
import { claudeRunsRepo, reviewsRepo, settingsRepo, suggestionsRepo } from "../db/repositories";
import type { GitHubClient, PrSearchHit } from "../ingest/github-client";
import { startIngest } from "../ingest/pipeline";
import { refuseReviewSubmission } from "../ingest/testing";
import { createTestContext, type TestContextHandle } from "../test/context";
import { listSuggestions, pollSuggestions } from "./poll";

const hit = (overrides: Partial<PrSearchHit>): PrSearchHit => ({
  owner: "acme",
  repo: "widgets",
  number: 20,
  title: "Add caching",
  author: "alice",
  url: "https://github.com/acme/widgets/pull/20",
  updatedAt: "2026-06-01T10:00:00Z",
  ...overrides,
});

interface Search {
  results: readonly PrSearchHit[];
  failure: Error | null;
  readonly queries: string[];
}

const searchingGitHub = (search: Search): GitHubClient => ({
  fetchPr: async () => Promise.reject(new Error("not used")),
  remoteUrl: () => "",
  submitReview: refuseReviewSubmission,
  fetchViewerReview: async () => null,
  searchOpenPrs: async (_host, query) => {
    search.queries.push(query);
    if (search.failure) throw search.failure;
    return search.results.filter((result) => query.includes(`repo:${result.owner}/${result.repo}`) || query.includes(`author:${result.author}`));
  },
});

describe("PR suggestions", () => {
  let handle: TestContextHandle | undefined;
  afterEach(() => handle?.close());

  const setup = (results: readonly PrSearchHit[]): { readonly search: Search; readonly ctx: TestContextHandle["ctx"] } => {
    const search: Search = { results, failure: null, queries: [] };
    handle = createTestContext({ github: searchingGitHub(search) });
    seedReviewWithHunks(handle.ctx, ["src/a.ts"]);
    return { search, ctx: handle.ctx };
  };

  const visible = (ctx: TestContextHandle["ctx"]): readonly string[] => listSuggestions(ctx).suggestions.map((suggestion) => suggestion.id);

  it("suggests open PRs in reviewed repos and by reviewed authors, with the reasons, without starting a review", async () => {
    const { ctx, search } = setup([
      hit({ number: 20, author: "octocat" }),
      hit({ number: 21, author: "zoe" }),
      hit({ owner: "other", repo: "lib", number: 3, author: "octocat", url: "https://github.com/other/lib/pull/3" }),
    ]);
    settingsRepo.updateSettings(ctx.db, { suggestOnlyReviewedRepos: false });

    await pollSuggestions(ctx);

    const { suggestions, lastCheckedAt, errors } = listSuggestions(ctx);
    expect(suggestions.map((suggestion) => [suggestion.id, suggestion.recentRepo, suggestion.knownAuthor])).toEqual([
      ["github.com/acme/widgets#20", true, true],
      ["github.com/acme/widgets#21", true, false],
      ["github.com/other/lib#3", false, true],
    ]);
    expect(lastCheckedAt).not.toBeNull();
    expect(errors).toEqual([]);
    expect(search.queries).toEqual([
      "is:pr is:open draft:false archived:false -author:@me repo:acme/widgets",
      "is:pr is:open draft:false archived:false -author:@me author:octocat",
    ]);
    expect(reviewsRepo.listReviews(ctx.db)).toHaveLength(1);
    expect(claudeRunsRepo.listRuns(ctx.db, reviewsRepo.listReviews(ctx.db)[0]?.id ?? "")).toEqual([]);
  });

  it("by default leaves out a reviewed author's PRs in repos you have never reviewed, and shows them when the setting is off", async () => {
    const { ctx } = setup([
      hit({ number: 20, author: "octocat" }),
      hit({ owner: "other", repo: "lib", number: 3, author: "octocat", url: "https://github.com/other/lib/pull/3" }),
    ]);
    await pollSuggestions(ctx);
    expect(visible(ctx)).toEqual(["github.com/acme/widgets#20"]);

    settingsRepo.updateSettings(ctx.db, { suggestOnlyReviewedRepos: false });
    expect(visible(ctx)).toEqual(["github.com/acme/widgets#20", "github.com/other/lib#3"]);
  });

  it("leaves out PRs that are already in four-eyes", async () => {
    const { ctx } = setup([hit({ number: 7 }), hit({ number: 20 })]);
    await pollSuggestions(ctx);
    expect(visible(ctx)).toEqual(["github.com/acme/widgets#20"]);
  });

  it("hides a dismissed PR until it is updated, and a not interested PR for good", async () => {
    const { ctx, search } = setup([hit({ number: 20 }), hit({ number: 21 })]);
    await pollSuggestions(ctx);
    suggestionsRepo.dismiss(ctx.db, "github.com/acme/widgets#20", "2026-06-02T00:00:00.000Z");
    suggestionsRepo.ignore(ctx.db, "github.com/acme/widgets#21", "2026-06-02T00:00:00.000Z");
    await pollSuggestions(ctx);
    expect(visible(ctx)).toEqual([]);

    search.results = [hit({ number: 20, updatedAt: "2026-06-03T00:00:00Z" }), hit({ number: 21, updatedAt: "2026-06-03T00:00:00Z" })];
    await pollSuggestions(ctx);
    expect(visible(ctx)).toEqual(["github.com/acme/widgets#20"]);
  });

  it("cleans up PRs GitHub stops returning but remembers not interested ones", async () => {
    const { ctx, search } = setup([hit({ number: 20 }), hit({ number: 21 })]);
    await pollSuggestions(ctx);
    suggestionsRepo.ignore(ctx.db, "github.com/acme/widgets#21", "2026-06-02T00:00:00.000Z");

    search.results = [];
    await pollSuggestions(ctx);
    search.results = [hit({ number: 20 }), hit({ number: 21 })];
    await pollSuggestions(ctx);

    expect(visible(ctx)).toEqual(["github.com/acme/widgets#20"]);
  });

  it("forgets not interested when the PR is added through the normal flow", async () => {
    const { ctx } = setup([hit({ number: 21 })]);
    await pollSuggestions(ctx);
    suggestionsRepo.ignore(ctx.db, "github.com/acme/widgets#21", "2026-06-02T00:00:00.000Z");

    const { review } = await startIngest(ctx, { url: "https://github.com/ACME/widgets/pull/21" });
    reviewsRepo.deleteReview(ctx.db, review.id);
    await pollSuggestions(ctx);

    expect(visible(ctx)).toEqual(["github.com/acme/widgets#21"]);
  });

  it("keeps the last results and reports the error when a search fails", async () => {
    const { ctx, search } = setup([hit({ number: 20 })]);
    await pollSuggestions(ctx);
    search.failure = new Error("gh is not logged in to github.com");
    await pollSuggestions(ctx);
    expect(visible(ctx)).toEqual(["github.com/acme/widgets#20"]);
    expect(listSuggestions(ctx).errors).toEqual([{ host: "github.com", message: "gh is not logged in to github.com" }]);
  });

  it("does not search GitHub when suggestions are turned off", async () => {
    const { ctx, search } = setup([hit({ number: 20 })]);
    settingsRepo.updateSettings(ctx.db, { suggestPrs: false });
    await pollSuggestions(ctx);
    expect(search.queries).toEqual([]);
    expect(listSuggestions(ctx).enabled).toBe(false);
  });

  it("checks, dismisses and ignores through the API, with IDs that contain / and #", async () => {
    const { ctx } = setup([hit({ number: 20 }), hit({ number: 21 })]);
    const app = createApp(ctx);
    const checked = SuggestionsResponseSchema.parse(await (await app.request(routes.checkSuggestions.path, { method: "POST" })).json());
    expect(checked.suggestions).toHaveLength(2);

    const dismissed = await app.request(buildPath(routes.dismissSuggestion.path, { suggestionId: "github.com/acme/widgets#20" }), { method: "POST" });
    const ignored = await app.request(buildPath(routes.ignoreSuggestion.path, { suggestionId: "github.com/acme/widgets#21" }), { method: "POST" });
    const unknown = await app.request(buildPath(routes.ignoreSuggestion.path, { suggestionId: "github.com/acme/widgets#99" }), { method: "POST" });

    expect([dismissed.status, ignored.status, unknown.status]).toEqual([200, 200, 404]);
    const listed = SuggestionsResponseSchema.parse(await (await app.request(routes.listSuggestions.path)).json());
    expect(listed.suggestions).toEqual([]);
  });
});
