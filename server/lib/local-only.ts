import type { MiddlewareHandler } from "hono";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const isLoopbackUrl = (value: string): boolean => {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
};

/**
 * Serves only requests addressed to this machine: the Host must be a loopback name, which stops DNS rebinding, and
 * requests that change state must not come from another site's page. Requests without an Origin (curl, tests) pass.
 */
export const localOnly = (): MiddlewareHandler => async (c, next) => {
  if (!isLoopbackUrl(c.req.url)) {
    return c.json({ error: "four-eyes only answers requests addressed to localhost" }, 403);
  }
  const origin = c.req.header("origin");
  if (!SAFE_METHODS.has(c.req.method) && origin !== undefined && !isLoopbackUrl(origin)) {
    return c.json({ error: `four-eyes does not accept ${c.req.method} requests from ${origin}` }, 403);
  }
  await next();
};
