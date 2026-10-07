import { and, asc, eq } from "drizzle-orm";
import type { DiffSide, Finding, FindingLifecycle, FindingRange, UserVerdict } from "@shared/domain";
import { NotFoundError } from "../../lib/errors";
import { findingHunks, findings, rounds } from "../schema";
import type { DbExecutor } from "../types";

export interface FindingPatch {
  readonly lifecycle?: FindingLifecycle;
  readonly userVerdict?: UserVerdict | null;
}

type FindingRow = Omit<Finding, "hunkIds" | "range"> & {
  readonly rangeSide: DiffSide | null;
  readonly rangeStartLine: number | null;
  readonly rangeEndLine: number | null;
};

const rangeOf = (row: FindingRow): FindingRange | null =>
  row.rangeSide === null || row.rangeStartLine === null || row.rangeEndLine === null
    ? null
    : { side: row.rangeSide, startLine: row.rangeStartLine, endLine: row.rangeEndLine };

const toFinding = (row: FindingRow, hunkIds: readonly string[]): Finding => {
  const { rangeSide, rangeStartLine, rangeEndLine, ...rest } = row;
  return { ...rest, hunkIds, range: rangeOf(row) };
};

const toRow = ({ hunkIds: _hunkIds, range, ...finding }: Finding): FindingRow => ({
  ...finding,
  rangeSide: range?.side ?? null,
  rangeStartLine: range?.startLine ?? null,
  rangeEndLine: range?.endLine ?? null,
});

const hunkIdsByFinding = (db: DbExecutor, reviewId: string): ReadonlyMap<string, readonly string[]> =>
  db
    .select({ findingId: findingHunks.findingId, hunkId: findingHunks.hunkId })
    .from(findingHunks)
    .innerJoin(findings, eq(findings.id, findingHunks.findingId))
    .where(eq(findings.reviewId, reviewId))
    .all()
    .reduce((map, { findingId, hunkId }) => map.set(findingId, [...(map.get(findingId) ?? []), hunkId]), new Map<string, string[]>());

const withHunkIds = (row: FindingRow, map: ReadonlyMap<string, readonly string[]>): Finding => toFinding(row, map.get(row.id) ?? []);

/** Inserts findings together with their hunk links. Callers should wrap in a transaction. */
export const insertFindings = (db: DbExecutor, rows: readonly Finding[]): readonly Finding[] => {
  rows.forEach((finding) => {
    db.insert(findings).values(toRow(finding)).run();
    if (finding.hunkIds.length > 0) {
      db.insert(findingHunks)
        .values(finding.hunkIds.map((hunkId) => ({ findingId: finding.id, hunkId })))
        .run();
    }
  });
  return rows;
};

export const listFindings = (db: DbExecutor, reviewId: string, filter: { readonly roundId?: string } = {}): readonly Finding[] => {
  const map = hunkIdsByFinding(db, reviewId);
  return db
    .select({
      id: findings.id,
      reviewId: findings.reviewId,
      roundId: findings.roundId,
      severity: findings.severity,
      title: findings.title,
      explanation: findings.explanation,
      suggestedFix: findings.suggestedFix,
      lifecycle: findings.lifecycle,
      userVerdict: findings.userVerdict,
      rangeSide: findings.rangeSide,
      rangeStartLine: findings.rangeStartLine,
      rangeEndLine: findings.rangeEndLine,
    })
    .from(findings)
    .innerJoin(rounds, eq(rounds.id, findings.roundId))
    .where(and(eq(findings.reviewId, reviewId), filter.roundId ? eq(findings.roundId, filter.roundId) : undefined))
    .orderBy(asc(rounds.number))
    .all()
    .map((row) => withHunkIds(row, map));
};

export const getFinding = (db: DbExecutor, id: string): Finding | undefined => {
  const row = db.select().from(findings).where(eq(findings.id, id)).get();
  if (!row) return undefined;
  const hunkIds = db
    .select({ hunkId: findingHunks.hunkId })
    .from(findingHunks)
    .where(eq(findingHunks.findingId, id))
    .all()
    .map((link) => link.hunkId);
  return toFinding(row, hunkIds);
};

export const requireFinding = (db: DbExecutor, id: string): Finding => {
  const finding = getFinding(db, id);
  if (!finding) throw new NotFoundError("Finding", id);
  return finding;
};

export const updateFinding = (db: DbExecutor, id: string, patch: FindingPatch): Finding => {
  const updated = db.update(findings).set(patch).where(eq(findings.id, id)).returning({ id: findings.id }).get();
  if (!updated) throw new NotFoundError("Finding", id);
  return requireFinding(db, id);
};

export const deleteFindingsForRound = (db: DbExecutor, roundId: string): void => {
  db.delete(findings).where(eq(findings.roundId, roundId)).run();
};

export const deleteFinding = (db: DbExecutor, id: string): void => {
  db.delete(findings).where(eq(findings.id, id)).run();
};
