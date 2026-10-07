import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 5180;
const API_PORT = 5181;

process.env.FOUR_EYES_E2E_HOME ??= mkdtempSync(join(tmpdir(), "four-eyes-e2e-"));
const home = process.env.FOUR_EYES_E2E_HOME;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec tsx server/main.ts",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: String(API_PORT),
        FOUR_EYES_HOME: home,
        FOUR_EYES_FAKE_CLAUDE: "1",
        FOUR_EYES_FAKE_GH: "1",
        FOUR_EYES_NO_OPEN: "1",
        FOUR_EYES_POLL_MS: "1500",
      },
    },
    {
      command: "pnpm exec vite",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        FOUR_EYES_WEB_PORT: String(WEB_PORT),
        FOUR_EYES_API_PORT: String(API_PORT),
      },
    },
  ],
});
