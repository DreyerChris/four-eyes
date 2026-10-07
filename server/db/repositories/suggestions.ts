import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { PrSuggestion } from "@shared/domain";
import { NotFoundError } from "../../lib/errors";
import { prSuggestions } from "../schema";
import type { DbExecutor } from "../types";

export type SeenSuggestion = Omit<PrSuggestion, "firstSeenAt" | "lastSeenAt" | "dismissedAt" | "ignoredAt">;

/** Inserts newly seen PRs and refreshes the details of known ones, keeping when each was first seen, dismissed or ignored. */
export const upsertSeen = (db: DbExecutor, seen: readonly SeenSuggestion[], seenAt: string): void => {
  seen.forEach((suggestion) => {
    const details = {
      title: suggestion.title,
      author: suggestion.author,
      url: suggestion.url,
      updatedAt: suggestion.updatedAt,
      recentRepo: suggestion.recentRepo,
      knownAuthor: suggestion.knownAuthor,
      lastSeenAt: seenAt,
    };
    db.insert(prSuggestions)
      .values({ ...suggestion, ...details, firstSeenAt: seenAt, dismissedAt: null, ignoredAt: null })
      .onConflictDoUpdate({ target: prSuggestions.id, set: details })
      .run();
  });
};

/** Deletes the host's suggestions that the latest search no longer returned. PRs marked not interested are kept for good. */
export const removeUnseen = (db: DbExecutor, host: string, seenAt: string): void => {
  db.delete(prSuggestions)
    .where(and(eq(prSuggestions.host, host), lt(prSuggestions.lastSeenAt, seenAt), isNull(prSuggestions.ignoredAt)))
    .run();
};

/** Suggestions not marked not interested, and not dismissed unless the PR changed since; most recently updated first. */
export const listVisible = (db: DbExecutor): readonly PrSuggestion[] =>
  db
    .select()
    .from(prSuggestions)
    .where(
      and(
        isNull(prSuggestions.ignoredAt),
        or(isNull(prSuggestions.dismissedAt), gt(prSuggestions.updatedAt, prSuggestions.dismissedAt)),
      ),
    )
    .orderBy(desc(prSuggestions.updatedAt))
    .all();

/** Every host that has stored suggestions. */
export const listHosts = (db: DbExecutor): readonly string[] =>
  db.selectDistinct({ host: prSuggestions.host }).from(prSuggestions).all().map((row) => row.host);

const mark = (db: DbExecutor, id: string, patch: Pick<Partial<PrSuggestion>, "dismissedAt" | "ignoredAt">): PrSuggestion => {
  const updated = db.update(prSuggestions).set(patch).where(eq(prSuggestions.id, id)).returning().get();
  if (!updated) throw new NotFoundError("Suggestion", id);
  return updated;
};

/** Hides the suggestion until the PR is updated after `at`. */
export const dismiss = (db: DbExecutor, id: string, at: string): PrSuggestion => mark(db, id, { dismissedAt: at });

/** Hides the suggestion for good, until the PR is added to four-eyes. */
export const ignore = (db: DbExecutor, id: string, at: string): PrSuggestion => mark(db, id, { ignoredAt: at });

/** Deletes any suggestion for the PR, including a not interested mark. */
export const forget = (db: DbExecutor, id: string): void => {
  db.delete(prSuggestions).where(eq(prSuggestions.id, id)).run();
};
