import type { Route } from "../../app/router";

/** The review the current page belongs to, or null on pages outside a review. */
export const reviewIdForRoute = (route: Route): string | null =>
  route.name === "review" || route.name === "summary" ? route.reviewId : null;
