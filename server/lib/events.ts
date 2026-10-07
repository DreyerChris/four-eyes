import type { ProgressEvent } from "@shared/domain";

export type ProgressListener = (event: ProgressEvent) => void;

export type ProgressEventInput = ProgressEvent extends infer E ? (E extends ProgressEvent ? Omit<E, "at"> : never) : never;

export interface EventBus {
  readonly publish: (reviewId: string, event: ProgressEventInput) => ProgressEvent;
  readonly subscribe: (reviewId: string, listener: ProgressListener) => () => void;
  readonly history: (reviewId: string) => readonly ProgressEvent[];
  readonly clear: (reviewId: string) => void;
  readonly hasSubscribers: (reviewId: string) => boolean;
}

const HISTORY_LIMIT = 200;

/** In-memory per-review pub/sub. Keeps recent events so late SSE subscribers can replay them. */
export const createEventBus = (): EventBus => {
  const listeners = new Map<string, Set<ProgressListener>>();
  const histories = new Map<string, ProgressEvent[]>();

  const publish = (reviewId: string, input: ProgressEventInput): ProgressEvent => {
    const event = { ...input, at: new Date().toISOString() } as ProgressEvent;
    const history = [...(histories.get(reviewId) ?? []), event].slice(-HISTORY_LIMIT);
    histories.set(reviewId, history);
    [...(listeners.get(reviewId) ?? [])].forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(`[events] listener for review ${reviewId} threw`, error);
      }
    });
    return event;
  };

  const subscribe = (reviewId: string, listener: ProgressListener): (() => void) => {
    const set = listeners.get(reviewId) ?? new Set<ProgressListener>();
    set.add(listener);
    listeners.set(reviewId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(reviewId);
    };
  };

  return {
    publish,
    subscribe,
    history: (reviewId) => histories.get(reviewId) ?? [],
    clear: (reviewId) => {
      histories.delete(reviewId);
    },
    hasSubscribers: (reviewId) => (listeners.get(reviewId)?.size ?? 0) > 0,
  };
};
