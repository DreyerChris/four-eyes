import { useEffect, useRef } from "react";
import type { DiffSide } from "@shared/domain";

export interface CodeSelection {
  readonly reviewId: string;
  readonly chunkId: string | null;
  readonly filePath: string;
  readonly side: DiffSide;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

export interface TokenClickEvent {
  readonly reviewId: string;
  readonly token: string;
  readonly filePath: string;
  readonly line: number;
  readonly side: DiffSide;
  readonly sha: string;
}

export interface OpenFileEvent {
  readonly reviewId: string;
  readonly path: string;
  readonly oldPath: string | null;
  readonly line: number | null;
  readonly side: DiffSide;
}

export interface AskClaudeEvent {
  readonly reviewId: string;
  readonly selection: CodeSelection | null;
  readonly prefill: string;
}

export interface GotoChunkEvent {
  readonly reviewId: string;
  readonly chunkNumber: number;
}

/** Cross-feature events. web-review emits token-click/open-file/ask-claude; web-shell emits goto-chunk and opens overlays. */
export interface AppEventMap {
  readonly "token-click": TokenClickEvent;
  readonly "open-file": OpenFileEvent;
  readonly "ask-claude": AskClaudeEvent;
  readonly "goto-chunk": GotoChunkEvent;
  readonly "open-command-bar": Record<string, never>;
  readonly "open-settings": Record<string, never>;
}

export type AppEventName = keyof AppEventMap;
type Handler<N extends AppEventName> = (payload: AppEventMap[N]) => void;

const handlers = new Map<AppEventName, Set<(payload: never) => void>>();

export const appEvents = {
  emit: <N extends AppEventName>(name: N, payload: AppEventMap[N]): void => {
    [...(handlers.get(name) ?? [])].forEach((handler) => {
      try {
        (handler as Handler<N>)(payload);
      } catch (error) {
        console.error(`[events] handler for "${name}" threw`, error);
      }
    });
  },
  on: <N extends AppEventName>(name: N, handler: Handler<N>): (() => void) => {
    const set = handlers.get(name) ?? new Set();
    set.add(handler as (payload: never) => void);
    handlers.set(name, set);
    return () => {
      set.delete(handler as (payload: never) => void);
    };
  },
} as const;

/** Subscribes to an app event while mounted; always calls the latest handler. */
export const useAppEvent = <N extends AppEventName>(name: N, handler: Handler<N>): void => {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => appEvents.on(name, (payload) => ref.current(payload)), [name]);
};
