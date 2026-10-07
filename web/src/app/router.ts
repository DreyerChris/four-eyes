import { useSyncExternalStore } from "react";

export type Route =
  | { readonly name: "list"; readonly tab: "active" | "past" }
  | { readonly name: "review"; readonly reviewId: string; readonly chunkId: string | null }
  | { readonly name: "summary"; readonly reviewId: string }
  | { readonly name: "not-found"; readonly path: string };

export const paths = {
  list: (tab: "active" | "past" = "active"): string => (tab === "active" ? "/" : "/?tab=past"),
  review: (reviewId: string, chunkId?: string): string =>
    `/reviews/${encodeURIComponent(reviewId)}${chunkId ? `?chunk=${encodeURIComponent(chunkId)}` : ""}`,
  summary: (reviewId: string): string => `/reviews/${encodeURIComponent(reviewId)}/summary`,
} as const;

/** Maps a pathname + search string to a Route. */
export const matchRoute = (pathname: string, search: string): Route => {
  const query = new URLSearchParams(search);
  if (pathname === "/" || pathname === "") return { name: "list", tab: query.get("tab") === "past" ? "past" : "active" };
  const summary = /^\/reviews\/([^/]+)\/summary\/?$/.exec(pathname);
  if (summary?.[1]) return { name: "summary", reviewId: decodeURIComponent(summary[1]) };
  const review = /^\/reviews\/([^/]+)\/?$/.exec(pathname);
  if (review?.[1]) return { name: "review", reviewId: decodeURIComponent(review[1]), chunkId: query.get("chunk") };
  return { name: "not-found", path: pathname };
};

const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
};

const currentLocation = (): string => `${window.location.pathname}${window.location.search}`;

/** Pushes (or replaces) a history entry and re-renders route consumers. */
export const navigate = (to: string, options: { readonly replace?: boolean } = {}): void => {
  if (to === currentLocation()) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  notify();
};

export const useRoute = (): Route => {
  const location = useSyncExternalStore(subscribe, currentLocation);
  const url = new URL(location, "http://local");
  return matchRoute(url.pathname, url.search);
};
