import { randomBytes } from "node:crypto";

export type IdPrefix = "rev" | "rnd" | "h" | "chk" | "fnd" | "q" | "run";

/** Short random ID such as `h_3fa9c2d81b07`. Hunk IDs are shown to Claude, so they stay short. */
export const newId = (prefix: IdPrefix): string => `${prefix}_${randomBytes(6).toString("hex")}`;
