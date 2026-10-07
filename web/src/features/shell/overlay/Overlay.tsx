import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { useKeyBinding, useKeyScope } from "../../../keys/hooks";
import { Panel } from "../../../ui/Panel";
import styles from "./Overlay.module.css";
import { closeOverlay, type OverlayName } from "./store";

export interface OverlayProps {
  readonly name: OverlayName;
  readonly title: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly placement?: "center" | "bottom" | "side";
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const focusablesIn = (root: HTMLElement): readonly HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.hasAttribute("inert"));

const PLACEMENT_CLASS = { center: styles.center, bottom: styles.bottom, side: styles.side } as const;

/** Fixed-position modal shell: pushes the overlay key scope, traps focus, closes on escape or backdrop click. */
export const Overlay = ({ name, title, children, actions, placement = "center", initialFocusRef }: OverlayProps): ReactElement => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useKeyScope("overlay");
  useKeyBinding({
    id: "shell-overlay-escape",
    key: "escape",
    scope: "overlay",
    description: "close",
    allowInInput: true,
    handler: () => closeOverlay(name),
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const target = initialFocusRef?.current ?? (bodyRef.current ? focusablesIn(bodyRef.current)[0] : undefined) ?? dialog;
    target.focus();
  }, [initialFocusRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusables = focusablesIn(dialogRef.current);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.backdrop} aria-hidden="true" onClick={() => closeOverlay(name)} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`${styles.dialog} ${PLACEMENT_CLASS[placement]}`}
        onKeyDown={onKeyDown}
      >
        <Panel
          title={title}
          className={styles.panel}
          actions={
            <>
              {actions}
              <button type="button" onClick={() => closeOverlay(name)} aria-label={`Close ${title}`}>
                esc
              </button>
            </>
          }
        >
          <div ref={bodyRef} className={styles.body}>{children}</div>
        </Panel>
      </div>
    </div>
  );
};
