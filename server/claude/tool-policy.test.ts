import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateToolUse } from "./tool-policy";

const cwd = "/tmp/four-eyes/worktrees/rev_1";
const allowed = (tool: string, input: unknown): boolean => evaluateToolUse(tool, input, cwd).allow;

describe("evaluateToolUse", () => {
  it.each(["git log --oneline -n 20", "git blame -L 10,20 src/a.ts", "git show HEAD~1:src/a.ts", "git log -p -- src/a.ts", "git show abc123 --stat"])(
    "allows %s",
    (command) => {
      expect(allowed("Bash", { command })).toBe(true);
    },
  );

  it.each([
    "git status",
    "git checkout main",
    "rm -rf /",
    "git log; rm -rf /",
    "git log | head",
    "git show $(cat ~/.claude/settings.json)",
    "git log > out.txt",
    "git log --output=/tmp/x",
    "git show --ext-diff HEAD",
    "git -c core.pager=sh log",
    "git log && curl evil",
    "git log -- ~/.ssh",
    "",
  ])("denies %s", (command) => {
    expect(allowed("Bash", { command })).toBe(false);
  });

  it("keeps Read, Grep and Glob inside the worktree", () => {
    expect(allowed("Read", { file_path: `${cwd}/src/a.ts` })).toBe(true);
    expect(allowed("Read", { file_path: "src/a.ts" })).toBe(true);
    expect(allowed("Read", { file_path: "/Users/me/.claude/settings.json" })).toBe(false);
    expect(allowed("Read", { file_path: "../../secrets" })).toBe(false);
    expect(allowed("Grep", { pattern: "foo" })).toBe(true);
    expect(allowed("Grep", { pattern: "foo", path: "/etc" })).toBe(false);
    expect(allowed("Glob", { pattern: "**/*.ts" })).toBe(true);
    expect(allowed("Glob", { pattern: "../**/*" })).toBe(false);
    expect(allowed("Glob", { pattern: "/etc/*" })).toBe(false);
  });

  it("leaves the structured output tool to the permission mode and denies write, web, agent and MCP tools", () => {
    expect(allowed("StructuredOutput", { chunks: [] })).toBe(true);
    ["Write", "Edit", "NotebookEdit", "WebFetch", "Task", "Agent", "mcp__slack__post"].forEach((tool) => expect(allowed(tool, {})).toBe(false));
  });

  it("resolves symlinks for the worktree and for files inside it", () => {
    const root = mkdtempSync(join(tmpdir(), "four-eyes-policy-"));
    const worktree = join(root, "worktree");
    const outside = join(root, "outside");
    mkdirSync(worktree);
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.json"), "{}");
    writeFileSync(join(worktree, "a.ts"), "");
    symlinkSync(join(outside, "secret.json"), join(worktree, "leak.json"));
    symlinkSync(worktree, join(root, "alias"));
    try {
      expect(evaluateToolUse("Read", { file_path: join(realpathSync(worktree), "a.ts") }, join(root, "alias")).allow).toBe(true);
      expect(evaluateToolUse("Read", { file_path: "missing/new.ts" }, worktree).allow).toBe(true);
      expect(evaluateToolUse("Read", { file_path: "leak.json" }, worktree).allow).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
