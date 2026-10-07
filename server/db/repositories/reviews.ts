import { and, desc, eq } from "drizzle-orm";
import type { PrRef, Review, ReviewStatus } from "@shared/domain";
import { NotFoundError } from "../../lib/errors";
import { nowIso } from "../../lib/time";
import { reviews } from "../schema";
import type { DbExecutor } from "../types";

export type ReviewPatch = Partial<Omit<Review, "id">>;

export const insertReview = (db: DbExecutor, review: Review): Review => {
  db.insert(reviews).values(review).run();
  return review;
};

export const getReview = (db: DbExecutor, id: string): Review | undefined =>
  db.select().from(reviews).where(eq(reviews.id, id)).get();

export const requireReview = (db: DbExecutor, id: string): Review => {
  const review = getReview(db, id);
  if (!review) throw new NotFoundError("Review", id);
  return review;
};

export const findReviewByPr = (db: DbExecutor, ref: PrRef): Review | undefined =>
  db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.host, ref.host),
        eq(reviews.owner, ref.owner),
        eq(reviews.repo, ref.repo),
        eq(reviews.prNumber, ref.number),
      ),
    )
    .get();

export const listReviews = (db: DbExecutor, status?: ReviewStatus): readonly Review[] =>
  db
    .select()
    .from(reviews)
    .where(status ? eq(reviews.status, status) : undefined)
    .orderBy(desc(reviews.lastActivityAt))
    .all();

export const updateReview = (db: DbExecutor, id: string, patch: ReviewPatch): Review => {
  const updated = db.update(reviews).set(patch).where(eq(reviews.id, id)).returning().get();
  if (!updated) throw new NotFoundError("Review", id);
  return updated;
};

export const touchReview = (db: DbExecutor, id: string): Review => updateReview(db, id, { lastActivityAt: nowIso() });

export const deleteReview = (db: DbExecutor, id: string): void => {
  db.delete(reviews).where(eq(reviews.id, id)).run();
};
