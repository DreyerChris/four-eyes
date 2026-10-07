import { useId, useState, type KeyboardEvent, type ReactElement } from "react";
import styles from "./review.module.css";

export interface NoteEditorProps {
  readonly initial: string;
  readonly saving: boolean;
  readonly onSave: (note: string) => void;
  readonly onCancel: () => void;
}

/** Note textarea for the current chunk. Ctrl/Cmd+Enter saves, Escape cancels. */
export const NoteEditor = ({ initial, saving, onSave, onCancel }: NoteEditorProps): ReactElement => {
  const [draft, setDraft] = useState(initial);
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSave(draft);
    }
  };
  return (
    <form
      className={styles.noteEditor}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <label htmlFor={id}>Note</label>
      <textarea id={id} value={draft} rows={4} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} />
      <div className={styles.buttons}>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save note"} <kbd>ctrl+enter</kbd>
        </button>
        <button type="button" onClick={onCancel}>
          Cancel <kbd>esc</kbd>
        </button>
      </div>
    </form>
  );
};
