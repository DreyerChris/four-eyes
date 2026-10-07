import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { HttpError } from "../lib/errors";
import { FAKE_PR_STATE_FILE, FAKE_PR_URL, createFakeGitHubClient, createGhCliClient, parseGhPrJson } from "./github-client";
import { parsePrUrl } from "./pr-url";

describe("parseGhPrJson", () => {
  const sample = {
    title: "Add a thing",
    author: { login: "octocat", name: "Octo" },
    url: "https://github.com/o/r/pull/3",
    state: "MERGED",
    headRefOid: "a".repeat(40),
    baseRefOid: "b".repeat(40),
    headRefName: "feature",
    baseRefName: "main",
  };

  it("maps gh JSON to PrMeta", () => {
    expect(parseGhPrJson(JSON.stringify(sample))).toEqual({
      title: "Add a thing",
      author: "octocat",
      url: "https://github.com/o/r/pull/3",
      state: "merged",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      headRefName: "feature",
      baseRefName: "main",
    });
  });

  it("uses ghost for deleted authors", () => {
    expect(parseGhPrJson(JSON.stringify({ ...sample, author: null, state: "OPEN" }))).toMatchObject({ author: "ghost", state: "open" });
  });

  it("rejects malformed output with a readable message", () => {
    expect(() => parseGhPrJson("not json")).toThrow(/invalid JSON/);
    expect(() => parseGhPrJson(JSON.stringify({ ...sample, state: "DRAFT" }))).toThrow(/unexpected JSON/);
  });
});

describe("createGhCliClient", () => {
  it("builds an https remote URL for the host", () => {
    expect(createGhCliClient().remoteUrl({ host: "ghe.example.com", owner: "t", repo: "svc", number: 1 })).toBe(
      "https://ghe.example.com/t/svc.git",
    );
  });
});

describe("createFakeGitHubClient", () => {
  const homes: string[] = [];
  const newHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "four-eyes-fakegh-"));
    homes.push(home);
    return home;
  };
  afterEach(() => {
    homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true }));
  });

  it("serves the fixture PR from a deterministic local repository", async () => {
    const ref = parsePrUrl(FAKE_PR_URL);
    const first = createFakeGitHubClient(loadConfig({ FOUR_EYES_HOME: newHome() }));
    const second = createFakeGitHubClient(loadConfig({ FOUR_EYES_HOME: newHome() }));
    const [a, b] = await Promise.all([first.fetchPr(ref), second.fetchPr(ref)]);
    expect(a).toMatchObject({ url: FAKE_PR_URL, state: "open", author: "octocat", baseRefName: "main" });
    expect(a.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(a.headSha).not.toBe(a.baseSha);
    expect(b).toEqual(a);
    expect(await first.fetchPr(ref)).toEqual(a);
    expect(first.remoteUrl(ref)).toContain(join("fake-gh", "four-eyes-fixture", "demo"));
  });

  it("reports the PR state written to the fake repo's state file", async () => {
    const ref = parsePrUrl(FAKE_PR_URL);
    const client = createFakeGitHubClient(loadConfig({ FOUR_EYES_HOME: newHome() }));
    await client.fetchPr(ref);
    const stateFile = join(client.remoteUrl(ref), ".git", FAKE_PR_STATE_FILE);
    writeFileSync(stateFile, "merged\n");
    expect((await client.fetchPr(ref)).state).toBe("merged");
    writeFileSync(stateFile, "sideways");
    await expect(client.fetchPr(ref)).rejects.toThrow(/expected open, merged or closed/);
  });

  it("refuses unknown PRs with a 404", async () => {
    const client = createFakeGitHubClient(loadConfig({ FOUR_EYES_HOME: newHome() }));
    const other = parsePrUrl("https://github.com/someone/else/pull/2");
    await expect(client.fetchPr(other)).rejects.toThrow(HttpError);
    await expect(client.fetchPr(other)).rejects.toThrow(/only knows/);
  });
});
