import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { api } from "../../../api/client";
import { queryKeys } from "../../../api/queries";
import { navigate, type Route } from "../../../app/router";
import { reviewLocationStore } from "../../../bus/context";
import { appEvents, useAppEvent } from "../../../bus/events";
import { useKeyBinding } from "../../../keys/hooks";
import { Overlay } from "../overlay/Overlay";
import { closeOverlay, openOverlay, useIsOverlayOpen } from "../overlay/store";
import { useRefreshAction } from "../refresh/useRefreshAction";
import { reviewIdForRoute } from "../route";
import styles from "./CommandBar.module.css";
import { COMMAND_HELP, parseCommand } from "./commands";
import { runCommand } from "./run-command";

export interface CommandBarProps {
  readonly route: Route;
}

const CommandBarDialog = ({ route }: CommandBarProps): ReactElement => {
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const errorId = `${baseId}-error`;
  const inputId = `${baseId}-input`;
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { refresh } = useRefreshAction(reviewIdForRoute(route) ?? "");

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const parsed = parseCommand(input);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setRunning(true);
    const result = await runCommand(parsed.value, {
      route,
      location: reviewLocationStore.get(),
      navigate,
      emitOpenFile: (payload) => appEvents.emit("open-file", payload),
      emitGotoChunk: (payload) => appEvents.emit("goto-chunk", payload),
      openSettings: () => openOverlay("settings"),
      refresh,
      loadChunkIds: async (reviewId) => {
        const detail = await client.fetchQuery({ queryKey: queryKeys.review(reviewId), queryFn: () => api.getReview(reviewId) });
        return detail.chunks.map((chunk) => chunk.id);
      },
    });
    setRunning(false);
    if (result.ok) closeOverlay("command-bar");
    else setError(result.error);
  };

  return (
    <Overlay name="command-bar" title="command" placement="bottom" initialFocusRef={inputRef}>
      <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
        <label className={styles.prompt} htmlFor={inputId}>
          <span aria-hidden="true">:</span>
          <span className="visually-hidden">Command</span>
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          readOnly={running}
        />
      </form>
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <ul className={styles.help} aria-label="Commands">
        {COMMAND_HELP.map((help) => (
          <li key={help.usage}>
            <code>:{help.usage}</code> <span className={styles.muted}>{help.description}</span>
          </li>
        ))}
      </ul>
    </Overlay>
  );
};

/** : command bar (:open, :refresh, :summary, :goto N). Renders as a fixed-position overlay; returns null while closed. */
export const CommandBar = ({ route }: CommandBarProps): ReactElement | null => {
  const open = useIsOverlayOpen("command-bar");
  useKeyBinding({ id: "shell-command-bar", key: ":", scope: "global", description: "command", handler: () => openOverlay("command-bar") });
  useAppEvent("open-command-bar", () => openOverlay("command-bar"));
  return open ? <CommandBarDialog route={route} /> : null;
};
