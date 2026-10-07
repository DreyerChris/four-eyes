import { Fragment, type ReactElement } from "react";
import type { ChunkView } from "@shared/api";
import { STATUS_LABELS, STATUS_MARKS } from "./labels";
import styles from "./review.module.css";

export interface ChunkProgressBarProps {
  readonly chunks: readonly ChunkView[];
  readonly currentIndex: number;
  readonly onSelect: (index: number) => void;
}

/** One segment per chunk, marked by status, with round boundaries labelled. Keyboard users step with j/k instead. */
export const ChunkProgressBar = ({ chunks, currentIndex, onSelect }: ChunkProgressBarProps): ReactElement => {
  const reviewed = chunks.filter((chunk) => chunk.progress.status !== "unseen").length;
  return (
    <div className={styles.progress}>
      <span className={styles.progressText}>
        {reviewed}/{chunks.length} reviewed
      </span>
      <ol className={styles.segments} aria-label="Chunks">
        {chunks.map((chunk, index) => {
          const previous = chunks[index - 1];
          const newRound = previous !== undefined && previous.roundNumber !== chunk.roundNumber;
          return (
            <Fragment key={chunk.id}>
              {newRound ? (
                <li className={styles.roundMark} aria-hidden="true">
                  R{chunk.roundNumber}
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`${styles.segment} ${styles[`status_${chunk.progress.status}`] ?? ""}`}
                  aria-current={index === currentIndex ? "step" : undefined}
                  aria-label={`Chunk ${index + 1}${chunk.roundNumber > 1 ? `, round ${chunk.roundNumber}` : ""}: ${chunk.title}, ${STATUS_LABELS[chunk.progress.status]}`}
                  title={chunk.title}
                  onClick={() => onSelect(index)}
                >
                  {STATUS_MARKS[chunk.progress.status]}
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
};
