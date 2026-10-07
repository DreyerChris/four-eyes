import type { ReactElement } from "react";
import { useQuestions } from "../../api/queries";
import { QuestionCard } from "../shell/qa/QaPanel";
import styles from "./review.module.css";

/** The questions asked on one chunk and Claude's answers, shown under the chunk's explanation. */
export const ChunkQuestions = ({ reviewId, chunkId }: { readonly reviewId: string; readonly chunkId: string }): ReactElement | null => {
  const questions = useQuestions(reviewId, chunkId);
  if (questions.error) {
    return (
      <p role="alert" className={styles.error}>
        Could not load the questions on this chunk: {questions.error.message}
      </p>
    );
  }
  const list = questions.data?.questions ?? [];
  if (list.length === 0) return null;
  return (
    <details className={styles.chunkQuestions} open>
      <summary>
        {list.length} question{list.length === 1 ? "" : "s"} asked on this chunk
      </summary>
      {list.map((question) => (
        <QuestionCard key={question.id} question={question} answer={question.answer} />
      ))}
    </details>
  );
};
