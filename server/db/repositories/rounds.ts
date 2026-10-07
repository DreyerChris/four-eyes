import { asc, desc, eq } from "drizzle-orm";
import type { Round } from "@shared/domain";
import { NotFoundError } from "../../lib/errors";
import { rounds } from "../schema";
import type { DbExecutor } from "../types";

export const insertRound = (db: DbExecutor, round: Round): Round => {
  db.insert(rounds).values(round).run();
  return round;
};

export const getRound = (db: DbExecutor, id: string): Round | undefined =>
  db.select().from(rounds).where(eq(rounds.id, id)).get();

export const requireRound = (db: DbExecutor, id: string): Round => {
  const round = getRound(db, id);
  if (!round) throw new NotFoundError("Round", id);
  return round;
};

export const listRounds = (db: DbExecutor, reviewId: string): readonly Round[] =>
  db.select().from(rounds).where(eq(rounds.reviewId, reviewId)).orderBy(asc(rounds.number)).all();

export const getLatestRound = (db: DbExecutor, reviewId: string): Round | undefined =>
  db.select().from(rounds).where(eq(rounds.reviewId, reviewId)).orderBy(desc(rounds.number)).limit(1).get();
