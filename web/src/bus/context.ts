import type { CodeSelection } from "./events";
import { createStore, useStore } from "./store";

export interface ReviewLocation {
  readonly reviewId: string;
  readonly chunkId: string | null;
  readonly chunkNumber: number | null;
  readonly chunkCount: number;
}

/** Where the user is in a review. Written by the Review page (web-review), read by shell features. */
export const reviewLocationStore = createStore<ReviewLocation | null>(null);

/** The current diff selection. Written by the diff renderer (web-review), read by the Q&A panel (web-shell). */
export const selectionStore = createStore<CodeSelection | null>(null);

/** Transient status-bar message, e.g. "Copied". */
export const statusMessageStore = createStore<string | null>(null);

export const useReviewLocation = (): ReviewLocation | null => useStore(reviewLocationStore);
export const useSelection = (): CodeSelection | null => useStore(selectionStore);
export const useStatusMessage = (): string | null => useStore(statusMessageStore);

let statusTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a message in the status bar for a few seconds. */
export const flashStatus = (message: string, ms = 3000): void => {
  clearTimeout(statusTimer);
  statusMessageStore.set(message);
  statusTimer = setTimeout(() => statusMessageStore.set(null), ms);
};
