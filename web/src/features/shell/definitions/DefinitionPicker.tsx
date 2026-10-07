import { useEffect, useRef, useState, type ReactElement } from "react";
import type { DefinitionMatch } from "@shared/api";
import { useDefinitions } from "../../../api/queries";
import type { Route } from "../../../app/router";
import { reviewLocationStore } from "../../../bus/context";
import { appEvents, useAppEvent, type CodeSelection, type TokenClickEvent } from "../../../bus/events";
import { useKeyBinding } from "../../../keys/hooks";
import { Overlay } from "../overlay/Overlay";
import { openOverlay, useIsOverlayOpen } from "../overlay/store";
import styles from "./DefinitionPicker.module.css";

export interface DefinitionPickerProps {
  readonly route: Route;
}

const openMatch = (reviewId: string, match: DefinitionMatch): void =>
  appEvents.emit("open-file", { reviewId, path: match.path, oldPath: null, line: match.line, side: "new" });

const askClaudeAbout = (target: TokenClickEvent): void => {
  const location = reviewLocationStore.get();
  const selection: CodeSelection = {
    reviewId: target.reviewId,
    chunkId: location?.reviewId === target.reviewId ? location.chunkId : null,
    filePath: target.filePath,
    side: target.side,
    startLine: target.line,
    endLine: target.line,
    text: target.token,
  };
  appEvents.emit("ask-claude", {
    reviewId: target.reviewId,
    selection,
    prefill: `Where is \`${target.token}\` defined, and what does it do here?`,
  });
};

const MatchList = ({ target, matches }: { readonly target: TokenClickEvent; readonly matches: readonly DefinitionMatch[] }): ReactElement => {
  const listRef = useRef<HTMLUListElement>(null);
  const move = (direction: 1 | -1): void => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = buttons[index === -1 ? 0 : Math.min(buttons.length - 1, Math.max(0, index + direction))];
    next?.focus();
  };
  useKeyBinding({ id: "shell-definitions-next", key: "j", scope: "overlay", description: "next match", handler: () => move(1) });
  useKeyBinding({ id: "shell-definitions-prev", key: "k", scope: "overlay", description: "previous match", handler: () => move(-1) });
  return (
    <>
      <p>
        {matches.length} possible definitions of <code className={styles.symbol}>{target.token}</code>. Pick one:
      </p>
      <ul ref={listRef} className={styles.list}>
        {matches.map((match, index) => (
          <li key={`${match.path}:${match.line}:${match.column}`}>
            <button type="button" autoFocus={index === 0} className={styles.match} onClick={() => openMatch(target.reviewId, match)}>
              <span className={styles.location}>
                {match.path}:{match.line}
              </span>
              <code className={styles.preview}>{match.preview.trim()}</code>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};

/** Body of the picker for one clicked token. Exported for tests. */
export const DefinitionResults = ({ target }: { readonly target: TokenClickEvent }): ReactElement => {
  const { data, error, isPending } = useDefinitions(target.reviewId, target.token, target.filePath);
  const single = data?.matches.length === 1 ? data.matches[0] : undefined;

  useEffect(() => {
    if (single) openMatch(target.reviewId, single);
  }, [single, target.reviewId]);

  if (isPending) {
    return (
      <p role="status">
        Searching for the definition of <code className={styles.symbol}>{target.token}</code>…
      </p>
    );
  }
  if (single) {
    return (
      <p role="status">
        Opening {single.path}:{single.line}…
      </p>
    );
  }
  if (data && data.matches.length > 1) return <MatchList target={target} matches={data.matches} />;
  const askButton = (
    <button type="button" autoFocus onClick={() => askClaudeAbout(target)}>
      Ask Claude about <code className={styles.symbol}>{target.token}</code>
    </button>
  );
  if (error) {
    return (
      <>
        <p role="alert">Definition search failed: {error.message}</p>
        {askButton}
      </>
    );
  }
  return (
    <>
      <p role="status">
        No definition found for <code className={styles.symbol}>{target.token}</code>.
      </p>
      {askButton}
    </>
  );
};

/** Click-to-definition (listens for token-click, one match opens, several list, none offers Ask Claude). Renders as a fixed-position overlay; returns null while closed. */
export const DefinitionPicker = (_props: DefinitionPickerProps): ReactElement | null => {
  const open = useIsOverlayOpen("definitions");
  const [target, setTarget] = useState<TokenClickEvent | null>(null);
  useAppEvent("token-click", (event) => {
    setTarget(event);
    openOverlay("definitions");
  });
  if (!open || !target) return null;
  return (
    <Overlay name="definitions" title={`definition · ${target.token}`}>
      <DefinitionResults key={`${target.reviewId}:${target.token}:${target.filePath}:${target.line}`} target={target} />
    </Overlay>
  );
};
