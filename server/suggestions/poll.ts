import type { SuggestionsResponse } from "@shared/api";
import type { AppContext } from "../context";
import { reviewsRepo, settingsRepo, suggestionsRepo } from "../db/repositories";
import type { SeenSuggestion } from "../db/repositories/suggestions";
import type { PrSearchHit } from "../ingest/github-client";
import { errorMessage } from "../lib/errors";
import { nowIso } from "../lib/time";
import { buildSearchQueries, collectSignals, suggestionId, type HostSignals } from "./signals";

interface PollState {
  inflight: Promise<void> | null;
  lastCheckedAt: string | null;
  errors: readonly { readonly host: string; readonly message: string }[];
}

const states = new WeakMap<AppContext, PollState>();

const stateFor = (ctx: AppContext): PollState => {
  const existing = states.get(ctx);
  if (existing) return existing;
  const created: PollState = { inflight: null, lastCheckedAt: null, errors: [] };
  states.set(ctx, created);
  return created;
};

const toSuggestions = (signals: HostSignals, hits: readonly PrSearchHit[]): readonly SeenSuggestion[] => {
  const repos = new Set(signals.repos.map((repo) => repo.toLowerCase()));
  const authors = new Set(signals.authors.map((author) => author.toLowerCase()));
  const byId = new Map(hits.map((hit) => [suggestionId(signals.host, hit), hit] as const));
  return [...byId.entries()].map(([id, hit]) => ({
    id,
    host: signals.host,
    owner: hit.owner,
    repo: hit.repo,
    number: hit.number,
    title: hit.title,
    author: hit.author,
    url: hit.url,
    updatedAt: new Date(hit.updatedAt).toISOString(),
    recentRepo: repos.has(`${hit.owner}/${hit.repo}`.toLowerCase()),
    knownAuthor: authors.has(hit.author.toLowerCase()),
  }));
};

const searchHost = async (ctx: AppContext, signals: HostSignals): Promise<readonly PrSearchHit[]> => {
  const queries = [...buildSearchQueries("repo", signals.repos), ...buildSearchQueries("author", signals.authors)];
  return queries.reduce<Promise<readonly PrSearchHit[]>>(async (previous, query) => {
    const hits = await previous;
    return [...hits, ...(await ctx.github.searchOpenPrs(signals.host, query))];
  }, Promise.resolve([]));
};

const runPoll = async (ctx: AppContext, state: PollState): Promise<void> => {
  const seenAt = nowIso();
  const signals = collectSignals(reviewsRepo.listReviews(ctx.db), Date.parse(seenAt));
  const results = await Promise.all(
    signals.map(async (host) => {
      try {
        suggestionsRepo.upsertSeen(ctx.db, toSuggestions(host, await searchHost(ctx, host)), seenAt);
        suggestionsRepo.removeUnseen(ctx.db, host.host, seenAt);
        return null;
      } catch (error) {
        const message = errorMessage(error);
        console.error(`[four-eyes] PR suggestions search on ${host.host} failed: ${message}`);
        return { host: host.host, message };
      }
    }),
  );
  const polledHosts = new Set(signals.map((host) => host.host));
  suggestionsRepo
    .listHosts(ctx.db)
    .filter((host) => !polledHosts.has(host))
    .forEach((host) => suggestionsRepo.removeUnseen(ctx.db, host, seenAt));
  state.errors = results.flatMap((result) => (result === null ? [] : [result]));
  state.lastCheckedAt = seenAt;
};

/**
 * Searches each GitHub host the user has reviewed on for open PRs in recently reviewed repositories or by authors
 * reviewed before, and saves them as suggestions. Does nothing when suggestions are turned off. Never starts a review.
 * Concurrent calls share one search. Per-host failures are recorded and logged, never thrown.
 */
export const pollSuggestions = (ctx: AppContext): Promise<void> => {
  const state = stateFor(ctx);
  if (!settingsRepo.getSettings(ctx.db).suggestPrs) return Promise.resolve();
  state.inflight ??= runPoll(ctx, state).finally(() => {
    state.inflight = null;
  });
  return state.inflight;
};

const repoKey = (host: string, owner: string, repo: string): string => `${host}/${owner}/${repo}`.toLowerCase();

/**
 * Visible suggestions, leaving out PRs already added to four-eyes and, when the setting asks for it, PRs in repos
 * with no review at all. Includes when GitHub was last checked.
 */
export const listSuggestions = (ctx: AppContext): SuggestionsResponse => {
  const state = stateFor(ctx);
  const settings = settingsRepo.getSettings(ctx.db);
  const reviews = reviewsRepo.listReviews(ctx.db);
  const added = new Set(reviews.map((review) => suggestionId(review.host, { ...review, number: review.prNumber })));
  const reviewedRepos = new Set(reviews.map((review) => repoKey(review.host, review.owner, review.repo)));
  const suggestions = suggestionsRepo
    .listVisible(ctx.db)
    .filter((suggestion) => !added.has(suggestion.id))
    .filter((suggestion) => !settings.suggestOnlyReviewedRepos || reviewedRepos.has(repoKey(suggestion.host, suggestion.owner, suggestion.repo)));
  return {
    enabled: settings.suggestPrs,
    suggestions: [...suggestions],
    lastCheckedAt: state.lastCheckedAt,
    checking: state.inflight !== null,
    errors: [...state.errors],
  };
};

/** Polls on startup and then every config.suggestionPollMs. Returns a stop function. */
export const startSuggestionPoller = (ctx: AppContext): (() => void) => {
  const tick = (): void => {
    pollSuggestions(ctx).catch((error: unknown) => {
      console.error(`[four-eyes] PR suggestions poll failed: ${errorMessage(error)}`);
    });
  };
  const first = setTimeout(tick, 0);
  const timer = setInterval(tick, ctx.config.suggestionPollMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
};
