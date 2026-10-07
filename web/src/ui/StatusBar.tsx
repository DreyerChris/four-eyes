import type { ReactElement } from "react";
import { useStatusMessage } from "../bus/context";
import { useKeyHints } from "../keys/hooks";
import styles from "./StatusBar.module.css";

/** Bottom bar: key hints for the active scopes on the left, transient status messages on the right. */
export const StatusBar = (): ReactElement => {
  const hints = useKeyHints();
  const message = useStatusMessage();
  return (
    <footer className={styles.bar} aria-label="Status bar">
      <ul className={styles.hints} aria-label="Keyboard shortcuts">
        {hints.map((hint) => (
          <li key={hint.key} className={styles.hint}>
            <kbd>{hint.key}</kbd>
            {hint.description}
          </li>
        ))}
      </ul>
      <output className={styles.message} aria-live="polite">
        {message}
      </output>
    </footer>
  );
};
