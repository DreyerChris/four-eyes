import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeClaudeExecutable, resolveClaudeExecutable } from "./executable";

let dir: string;

const makeExecutable = (path: string, body = 'echo "9.9.9 (Claude Code)"'): string => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fe-claude-exe-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveClaudeExecutable", () => {
  it("finds claude on PATH when nothing is configured", () => {
    const bin = makeExecutable(join(dir, "bin", "claude"));
    const searchPath = [join(dir, "missing"), join(dir, "bin")].join(":");
    expect(resolveClaudeExecutable({ settingPath: null, envPath: null, searchPath })).toEqual({ ok: true, path: bin, source: "path" });
  });

  it("prefers the settings path over the env var and PATH", () => {
    makeExecutable(join(dir, "bin", "claude"));
    const fromEnv = makeExecutable(join(dir, "env", "claude"));
    const fromSettings = makeExecutable(join(dir, "custom", "my-claude"));
    const searchPath = join(dir, "bin");
    expect(resolveClaudeExecutable({ settingPath: fromSettings, envPath: fromEnv, searchPath })).toEqual({
      ok: true,
      path: fromSettings,
      source: "settings",
    });
    expect(resolveClaudeExecutable({ settingPath: null, envPath: fromEnv, searchPath })).toEqual({ ok: true, path: fromEnv, source: "env" });
  });

  it("looks up a bare command name on PATH", () => {
    const bin = makeExecutable(join(dir, "bin", "claude-work"));
    expect(resolveClaudeExecutable({ settingPath: "claude-work", envPath: null, searchPath: join(dir, "bin") })).toEqual({
      ok: true,
      path: bin,
      source: "settings",
    });
  });

  it("expands ~ to the home directory", () => {
    const result = resolveClaudeExecutable({ settingPath: `~/${relative(homedir(), join(dir, "nope"))}`, envPath: null, searchPath: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no executable file was found");
  });

  it("rejects a configured path that does not exist or is not executable", () => {
    const plain = join(dir, "not-executable");
    writeFileSync(plain, "hello");
    expect(resolveClaudeExecutable({ settingPath: plain, envPath: null, searchPath: "" })).toMatchObject({ ok: false, source: "settings" });
    expect(resolveClaudeExecutable({ settingPath: null, envPath: join(dir, "missing"), searchPath: "" })).toMatchObject({
      ok: false,
      source: "env",
    });
    expect(resolveClaudeExecutable({ settingPath: dir, envPath: null, searchPath: "" })).toMatchObject({ ok: false });
  });

  it("explains how to fix a missing claude on PATH", () => {
    const result = resolveClaudeExecutable({ settingPath: null, envPath: null, searchPath: join(dir, "empty") });
    expect(result).toMatchObject({ ok: false, source: "path" });
    if (!result.ok) expect(result.error).toContain("set its path in settings");
  });
});

describe("describeClaudeExecutable", () => {
  it("reports the version printed by --version", async () => {
    const bin = makeExecutable(join(dir, "bin", "claude"));
    await expect(describeClaudeExecutable({ settingPath: bin, envPath: null, searchPath: "" })).resolves.toEqual({
      ok: true,
      path: bin,
      source: "settings",
      version: "9.9.9 (Claude Code)",
    });
  });

  it("reports a binary that fails to run", async () => {
    const bin = makeExecutable(join(dir, "bin", "claude"), "exit 3");
    const status = await describeClaudeExecutable({ settingPath: bin, envPath: null, searchPath: "" });
    expect(status).toMatchObject({ ok: false, source: "settings" });
    if (!status.ok) expect(status.error).toContain("did not run with --version");
  });
});
