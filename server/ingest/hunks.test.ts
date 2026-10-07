import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeHunks } from "./hunks";
import { createTempRepo, numberedLines, type TempRepo } from "./testing";

describe("computeHunks", () => {
  const repos: TempRepo[] = [];
  const newRepo = async (): Promise<TempRepo> => {
    const repo = await createTempRepo();
    repos.push(repo);
    return repo;
  };
  afterEach(() => {
    repos.splice(0).forEach((repo) => repo.dispose());
  });

  it("keeps fingerprints stable across a rebase onto a moved base", async () => {
    const repo = await newRepo();
    repo.write("src/a.ts", numberedLines(100));
    const base = await repo.commit("base");
    await repo.git("checkout", "--quiet", "-b", "feature");
    repo.write("src/a.ts", numberedLines(100, (n) => (n === 50 ? "changed 50" : n === 80 ? "changed 80" : `line ${n}`)));
    const head = await repo.commit("feature");
    const before = await computeHunks(repo.path, base, head);

    await repo.git("checkout", "--quiet", "main");
    repo.write("src/a.ts", `${numberedLines(10, (n) => `header ${n}`)}${numberedLines(100)}`);
    const movedBase = await repo.commit("upstream adds a header");
    await repo.git("checkout", "--quiet", "feature");
    await repo.git("rebase", "--quiet", "main");
    const rebasedHead = (await repo.git("rev-parse", "HEAD")).trim();
    const after = await computeHunks(repo.path, movedBase, rebasedHead);

    expect(before).toHaveLength(2);
    expect(after.map((h) => h.fingerprint)).toEqual(before.map((h) => h.fingerprint));
    expect(after.map((h) => h.newStart)).toEqual(before.map((h) => h.newStart + 10));
  });

  it("diffs against the merge base so upstream-only changes are left out", async () => {
    const repo = await newRepo();
    repo.write("a.txt", numberedLines(20));
    repo.write("b.txt", "upstream\n");
    const base = await repo.commit("base");
    await repo.git("checkout", "--quiet", "-b", "feature");
    repo.write("a.txt", numberedLines(20, (n) => (n === 3 ? "feature 3" : `line ${n}`)));
    const head = await repo.commit("feature");
    await repo.git("checkout", "--quiet", "main");
    repo.write("b.txt", "upstream changed\n");
    const mainTip = await repo.commit("upstream");

    const hunks = await computeHunks(repo.path, mainTip, head);
    expect(hunks.map((h) => h.filePath)).toEqual(["a.txt"]);
    expect(base).not.toBe(mainTip);
  });

  it("splits large hunks into pieces that still apply as a patch", async () => {
    const repo = await newRepo();
    repo.write("big.txt", numberedLines(300));
    const base = await repo.commit("base");
    repo.write("big.txt", numberedLines(300, (n) => (n % 3 === 0 ? `edited ${n}` : `line ${n}`)));
    const head = await repo.commit("edit every third line");

    const hunks = await computeHunks(repo.path, base, head);
    expect(hunks.length).toBeGreaterThan(4);
    expect(new Set(hunks.map((h) => h.fingerprint)).size).toBe(hunks.length);

    const patch = ["diff --git a/big.txt b/big.txt", "--- a/big.txt", "+++ b/big.txt", ...hunks.map((h) => h.patchText), ""].join("\n");
    const patchFile = join(repo.path, "..", `${repo.path.split("/").pop() ?? "repo"}.patch`);
    writeFileSync(patchFile, patch);
    await repo.git("checkout", "--quiet", base);
    await expect(repo.git("apply", "--check", patchFile)).resolves.toBe("");
    await repo.git("apply", patchFile);
    expect(await repo.git("diff", "--stat", head, "--", "big.txt")).toBe("");
  });

  it("returns an empty list when nothing changed", async () => {
    const repo = await newRepo();
    repo.write("a.txt", "a\n");
    const base = await repo.commit("base");
    const head = await repo.commit("empty");
    expect(await computeHunks(repo.path, base, head)).toEqual([]);
  });

  it("fails with a readable error for unknown commits", async () => {
    const repo = await newRepo();
    repo.write("a.txt", "a\n");
    const base = await repo.commit("base");
    await expect(computeHunks(repo.path, base, "f".repeat(40))).rejects.toThrow(/git diff failed/);
  });
});
