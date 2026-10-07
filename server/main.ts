import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createAppContext } from "./context";
import { errorMessage } from "./lib/errors";
import { startRefreshPoller } from "./refresh/poller";

const WEB_DIST = join(import.meta.dirname, "..", "dist", "web");

const openBrowser = (url: string): void => {
  if (process.platform !== "darwin" || process.env.FOUR_EYES_NO_OPEN === "1") return;
  spawn("open", [url], { stdio: "ignore", detached: true }).on("error", (error) => {
    console.warn(`[four-eyes] could not open a browser: ${error.message}`);
  });
};

const main = (): void => {
  const config = loadConfig();
  const { ctx, close } = createAppContext(config);
  const app = createApp(ctx);

  if (config.production) {
    if (!existsSync(WEB_DIST)) throw new Error(`Web build not found at ${WEB_DIST}. Run "pnpm build" first.`);
    app.use("/*", serveStatic({ root: WEB_DIST }));
    app.get("/*", serveStatic({ root: WEB_DIST, path: "index.html" }));
  }

  const stopPoller = startRefreshPoller(ctx);
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    const url = `http://localhost:${info.port}`;
    console.log(`[four-eyes] server on ${url} (home ${config.home}${config.fakeClaude ? ", fake Claude" : ""})`);
    if (config.production) openBrowser(url);
  });

  const shutdown = (): void => {
    stopPoller();
    server.close(() => {
      close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

try {
  main();
} catch (error) {
  console.error(`[four-eyes] failed to start: ${errorMessage(error)}`);
  process.exit(1);
}
