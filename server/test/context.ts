import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import { createFakeClaudeRunner } from "../claude/fake-runner";
import { createAppContext, type AppContextHandle, type AppContextOverrides } from "../context";

export interface TestContextHandle extends AppContextHandle {
  readonly home: string;
}

/** Isolated context for tests: temp FOUR_EYES_HOME, in-memory database, fake Claude runner. Call close() in afterEach. */
export const createTestContext = (overrides: AppContextOverrides = {}): TestContextHandle => {
  const home = mkdtempSync(join(tmpdir(), "four-eyes-test-"));
  const config = loadConfig({ FOUR_EYES_HOME: home, FOUR_EYES_FAKE_CLAUDE: "1", FOUR_EYES_FAKE_GH: "1" });
  const handle = createAppContext(config, {
    dbPath: ":memory:",
    claude: createFakeClaudeRunner({ latencyMs: 1 }),
    ...overrides,
  });
  return {
    ...handle,
    home,
    close: () => {
      handle.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
};
