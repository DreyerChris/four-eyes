import { and, asc, eq } from "drizzle-orm";
import type { Question } from "@shared/domain";
import { NotFoundError } from "../../lib/errors";
import { questions } from "../schema";
import type { DbExecutor } from "../types";

export const insertQuestion = (db: DbExecutor, question: Question): Question => {
  db.insert(questions).values(question).run();
  return question;
};

export const getQuestion = (db: DbExecutor, id: string): Question | undefined =>
  db.select().from(questions).where(eq(questions.id, id)).get();

export const updateQuestion = (
  db: DbExecutor,
  id: string,
  patch: Partial<Pick<Question, "answer" | "model">>,
): Question => {
  const updated = db.update(questions).set(patch).where(eq(questions.id, id)).returning().get();
  if (!updated) throw new NotFoundError("Question", id);
  return updated;
};

export const listQuestions = (db: DbExecutor, reviewId: string, chunkId?: string): readonly Question[] =>
  db
    .select()
    .from(questions)
    .where(and(eq(questions.reviewId, reviewId), chunkId ? eq(questions.chunkId, chunkId) : undefined))
    .orderBy(asc(questions.createdAt))
    .all();
