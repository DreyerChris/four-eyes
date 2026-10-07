import type { Finding } from "@shared/domain";
import type { AppContext } from "../context";
import { findingsRepo } from "../db/repositories";

export interface FindingPair {
  readonly newcomer: Finding;
  readonly earlier: Finding;
}

export interface FindingMatchResult {
  readonly pairs: readonly FindingPair[];
  readonly unmatchedNewcomers: readonly Finding[];
  readonly unmatchedEarlier: readonly Finding[];
}

const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const sharesHunk = (a: Finding, b: Finding): boolean => a.hunkIds.some((id) => b.hunkIds.includes(id));

const sameTitle = (a: Finding, b: Finding): boolean => normalizeTitle(a.title) === normalizeTitle(b.title);

const MATCH_PASSES: readonly ((newcomer: Finding, earlier: Finding) => boolean)[] = [
  (n, e) => n.severity === e.severity && sameTitle(n, e) && sharesHunk(n, e),
  (n, e) => n.severity === e.severity && sameTitle(n, e),
  (n, e) => n.severity === e.severity && sharesHunk(n, e),
  (n, e) => sameTitle(n, e),
];

/** One-to-one pairing of re-review findings with earlier ones: same title/severity/hunks first, then looser criteria. */
export const matchFindings = (newcomers: readonly Finding[], earlier: readonly Finding[]): FindingMatchResult =>
  MATCH_PASSES.reduce<FindingMatchResult>(
    (acc, isMatch) =>
      acc.unmatchedNewcomers.reduce<FindingMatchResult>((inner, newcomer) => {
        const partner = inner.unmatchedEarlier.find((candidate) => isMatch(newcomer, candidate));
        return partner === undefined
          ? inner
          : {
              pairs: [...inner.pairs, { newcomer, earlier: partner }],
              unmatchedNewcomers: inner.unmatchedNewcomers.filter((f) => f !== newcomer),
              unmatchedEarlier: inner.unmatchedEarlier.filter((f) => f !== partner),
            };
      }, acc),
    { pairs: [], unmatchedNewcomers: newcomers, unmatchedEarlier: earlier },
  );

/**
 * Applies lifecycles for explicit sets: matched newcomers become "still_present" and inherit the earlier verdict
 * (the earlier row is deleted), unmatched earlier findings become "resolved". Earlier findings that no longer
 * exist in the database (for example removed by a re-run of the same round) are re-inserted when resolved.
 */
export const reconcileFindingSets = (
  ctx: AppContext,
  newcomers: readonly Finding[],
  earlier: readonly Finding[],
): FindingMatchResult => {
  const result = matchFindings(newcomers, earlier);
  ctx.db.transaction((tx) => {
    result.pairs.forEach(({ newcomer, earlier: previous }) => {
      findingsRepo.updateFinding(tx, newcomer.id, {
        lifecycle: "still_present",
        userVerdict: newcomer.userVerdict ?? previous.userVerdict,
      });
      findingsRepo.deleteFinding(tx, previous.id);
    });
    result.unmatchedEarlier.forEach((finding) => {
      if (findingsRepo.getFinding(tx, finding.id) === undefined) {
        findingsRepo.insertFindings(tx, [{ ...finding, lifecycle: "resolved" }]);
      } else {
        findingsRepo.updateFinding(tx, finding.id, { lifecycle: "resolved" });
      }
    });
  });
  return result;
};

/**
 * After runReview saved Round N findings as "new": a new finding matching an earlier one becomes "still_present",
 * takes over its user_verdict, and the earlier row is deleted. Earlier findings with no match become "resolved".
 * The summary shows every finding row, so after this runs each issue appears once.
 */
export const reconcileFindings = async (ctx: AppContext, reviewId: string, roundId: string): Promise<void> => {
  const all = findingsRepo.listFindings(ctx.db, reviewId);
  const newcomers = all.filter((finding) => finding.roundId === roundId && finding.lifecycle === "new");
  const newcomerIds = new Set(newcomers.map((finding) => finding.id));
  reconcileFindingSets(
    ctx,
    newcomers,
    all.filter((finding) => !newcomerIds.has(finding.id)),
  );
};
