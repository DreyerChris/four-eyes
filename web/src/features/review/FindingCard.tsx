import type { ReactElement, ReactNode } from "react";
import type { Finding } from "@shared/domain";
import { InlineMarkdown, Markdown } from "../../ui/Markdown";
import { LIFECYCLE_LABELS, SEVERITY_LABELS } from "./labels";
import styles from "./review.module.css";

export interface FindingCardProps {
  readonly finding: Finding;
  readonly headingLevel: 3 | 4;
  readonly children?: ReactNode;
  readonly selected?: boolean;
  readonly cardRef?: (element: HTMLElement | null) => void;
  readonly onFocus?: () => void;
}

/** One Claude finding: severity, title, lifecycle, explanation and suggested fix, plus caller-supplied actions. */
export const FindingCard = ({ finding, headingLevel, children, selected = false, cardRef, onFocus }: FindingCardProps): ReactElement => {
  const Heading = `h${headingLevel}` as const;
  const headingId = `finding-${finding.id}`;
  return (
    <article
      ref={cardRef}
      aria-labelledby={headingId}
      tabIndex={cardRef ? -1 : undefined}
      onFocus={onFocus}
      className={`${styles.finding} ${styles[`severity_${finding.severity}`] ?? ""}${selected ? ` ${styles.selected}` : ""}${
        finding.lifecycle === "resolved" ? ` ${styles.resolved}` : ""
      }`}
    >
      <Heading id={headingId} className={styles.findingTitle}>
        <span className={styles.severity}>[{SEVERITY_LABELS[finding.severity]}]</span> <InlineMarkdown text={finding.title} />
        {finding.lifecycle === "new" ? null : <span className={styles.tag}>{LIFECYCLE_LABELS[finding.lifecycle]}</span>}
      </Heading>
      <Markdown className={styles.markdown} text={finding.explanation} />
      {finding.suggestedFix ? (
        <div className={styles.fix}>
          <span className={styles.fixLabel}>Suggested fix</span>
          <Markdown className={styles.markdown} text={finding.suggestedFix} />
        </div>
      ) : null}
      {children}
    </article>
  );
};
