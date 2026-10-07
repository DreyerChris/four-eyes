import { useId, type ReactElement, type ReactNode } from "react";
import styles from "./Panel.module.css";

export interface PanelProps {
  readonly title: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly fill?: boolean;
  readonly className?: string;
  readonly as?: "section" | "aside" | "div";
  readonly headingLevel?: 1 | 2 | 3;
}

/** Bordered terminal-style panel with its title drawn into the top border. */
export const Panel = ({ title, actions, children, fill = false, className, as = "section", headingLevel = 2 }: PanelProps): ReactElement => {
  const headingId = useId();
  const Tag = as;
  const Heading = `h${headingLevel}` as const;
  return (
    <Tag aria-labelledby={headingId} className={[styles.panel, fill ? styles.fill : "", className ?? ""].join(" ").trim()}>
      <Heading id={headingId} className={styles.title}>
        {title}
      </Heading>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
      {children}
    </Tag>
  );
};
