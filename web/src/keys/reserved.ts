import type { KeyScope } from "./registry";

export type KeyOwner = "web-review" | "web-shell";

/** Which owner may bind which key in which scope. Bind only keys listed for your owner; add new ones here additively. */
export const RESERVED_KEYS: Readonly<Record<KeyScope, Readonly<Record<string, KeyOwner>>>> = {
  global: { "?": "web-shell", ":": "web-shell", ",": "web-shell", r: "web-shell" },
  list: { j: "web-shell", k: "web-shell", enter: "web-shell", d: "web-shell", "/": "web-shell", tab: "web-shell" },
  review: {
    j: "web-review",
    k: "web-review",
    g: "web-review",
    f: "web-review",
    n: "web-review",
    u: "web-review",
    s: "web-review",
    w: "web-review",
    i: "web-review",
    e: "web-review",
    "]": "web-review",
    "[": "web-review",
  },
  summary: { j: "web-review", k: "web-review", a: "web-review", x: "web-review", c: "web-review", C: "web-review", enter: "web-review" },
  overlay: { escape: "web-shell", enter: "web-shell", j: "web-shell", k: "web-shell" },
};
