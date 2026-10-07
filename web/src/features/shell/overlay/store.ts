import { createStore, useStore } from "../../../bus/store";

export type OverlayName = "file-viewer" | "definitions" | "qa" | "command-bar" | "settings";

const activeOverlayStore = createStore<OverlayName | null>(null);
let returnFocusTarget: HTMLElement | null = null;

const focusedElement = (): HTMLElement | null => (document.activeElement instanceof HTMLElement ? document.activeElement : null);

/** Opens an overlay, closing any other. Remembers where focus was so closing can return it. */
export const openOverlay = (name: OverlayName): void => {
  if (activeOverlayStore.get() === null) returnFocusTarget = focusedElement();
  activeOverlayStore.set(name);
};

/** Closes the overlay if it is the open one and returns focus to where it was before any overlay opened. */
export const closeOverlay = (name: OverlayName): void => {
  if (activeOverlayStore.get() !== name) return;
  activeOverlayStore.set(null);
  const target = returnFocusTarget;
  returnFocusTarget = null;
  if (target?.isConnected) target.focus();
};

export const useIsOverlayOpen = (name: OverlayName): boolean => useStore(activeOverlayStore) === name;
