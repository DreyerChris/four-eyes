import type { PrRef, Review } from "@shared/domain";

/** How long after its last activity a review keeps its repository on the watch list. */
export const RECENT_REPO_DAYS = 30;
/** Caps on watched repositories and authors per host, most recent first, to keep searches small. */
export const MAX_REPOS_PER_HOST = 30;
export const MAX_AUTHORS_PER_HOST = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_AUTHOR = new Set(["", "ghost"]);

export interface HostSignals {
  readonly host: string;
  readonly repos: readonly string[];
  readonly authors: readonly string[];
}

const distinctFirst = (values: readonly string[], limit: number): readonly string[] => {
  const seen = new Set<string>();
  return values
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
};

/**
 * Per GitHub host: repositories with a review active in the last RECENT_REPO_DAYS days, and the authors of every
 * reviewed PR. Both are ordered by most recent review activity and capped.
 */
export const collectSignals = (reviews: readonly Review[], nowMs: number): readonly HostSignals[] => {
  const recentCutoff = nowMs - RECENT_REPO_DAYS * DAY_MS;
  const byRecency = [...reviews].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const hosts = distinctFirst(
    byRecency.map((review) => review.host),
    Number.POSITIVE_INFINITY,
  );
  return hosts.map((host) => {
    const onHost = byRecency.filter((review) => review.host.toLowerCase() === host.toLowerCase());
    return {
      host,
      repos: distinctFirst(
        onHost.filter((review) => Date.parse(review.lastActivityAt) >= recentCutoff).map((review) => `${review.owner}/${review.repo}`),
        MAX_REPOS_PER_HOST,
      ),
      authors: distinctFirst(
        onHost.map((review) => review.author).filter((author) => !NO_AUTHOR.has(author)),
        MAX_AUTHORS_PER_HOST,
      ),
    };
  });
};

/** GitHub's limit on the length of a search query. */
export const SEARCH_QUERY_LIMIT = 256;
const BASE_QUERY = "is:pr is:open draft:false archived:false -author:@me";

/**
 * Search queries for open, non-draft PRs not written by the viewer, matching any of the values. GitHub ORs repeated
 * repo: or author: qualifiers, so values are packed into as few queries as the length limit allows.
 */
export const buildSearchQueries = (qualifier: "repo" | "author", values: readonly string[]): readonly string[] =>
  values
    .map((value) => `${qualifier}:${value}`)
    .filter((term) => BASE_QUERY.length + 1 + term.length <= SEARCH_QUERY_LIMIT)
    .reduce<readonly string[]>((queries, term) => {
      const last = queries.at(-1);
      if (last !== undefined && last.length + 1 + term.length <= SEARCH_QUERY_LIMIT) return [...queries.slice(0, -1), `${last} ${term}`];
      return [...queries, `${BASE_QUERY} ${term}`];
    }, []);

/** Stable, case-insensitive key for a PR, used as the suggestion ID. */
export const suggestionId = (host: string, pr: Pick<PrRef, "owner" | "repo" | "number">): string =>
  `${host}/${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
