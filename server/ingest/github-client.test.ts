import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { HttpError } from "../lib/errors";
import {
  FAKE_PR_STATE_FILE,
  FAKE_PR_URL,
  FAKE_REVIEWS_FILE,
  createFakeGitHubClient,
  createGhCliClient,
  ghReviewArgs,
  githubApiErrorDetail,
  parseGhPrJson,
  parseGhSearchJson,
} from "./github-client";
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
    await expect(client.submitReview(other, { event: "approve", body: null, commitId: "abc" })).rejects.toThrow(/only knows/);
  });

  it("logs submitted reviews to the fake repo and links each one", async () => {
    const ref = parsePrUrl(FAKE_PR_URL);
    const client = createFakeGitHubClient(loadConfig({ FOUR_EYES_HOME: newHome() }));
    const first = await client.submitReview(ref, { event: "approve", body: null, commitId: "abc" });
    const second = await client.submitReview(ref, { event: "comment", body: "Looks good", commitId: "def" });
    expect(first.url).toBe(`${FAKE_PR_URL}#pullrequestreview-1`);
    expect(second.url).toBe(`${FAKE_PR_URL}#pullrequestreview-2`);
    const log = readFileSync(join(client.remoteUrl(ref), ".git", FAKE_REVIEWS_FILE), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(log).toEqual([
      { event: "approve", body: null, commitId: "abc" },
      { event: "comment", body: "Looks good", commitId: "def" },
    ]);
  });
});

describe("ghReviewArgs", () => {
  const ref = { host: "ghe.example.com", owner: "team", repo: "svc", number: 7 };

  it("posts a submitted review on the given commit and leaves out an empty body", () => {
    expect(ghReviewArgs(ref, { event: "approve", body: null, commitId: "abc123" })).toEqual([
      "api",
      "--hostname",
      "ghe.example.com",
      "--method",
      "POST",
      "repos/team/svc/pulls/7/reviews",
      "-f",
      "event=APPROVE",
      "-f",
      "commit_id=abc123",
    ]);
  });

  it("passes the comment as a raw field, so @ and = are sent as written", () => {
    const args = ghReviewArgs(ref, { event: "request_changes", body: "@octocat a=b", commitId: "abc123" });
    expect(args).toContain("event=REQUEST_CHANGES");
    expect(args.slice(-2)).toEqual(["-f", "body=@octocat a=b"]);
  });
});

describe("githubApiErrorDetail", () => {
  it("prefers GitHub's specific errors over its generic message", () => {
    const body = JSON.stringify({ message: "Unprocessable Entity", errors: ["Can not approve your own pull request"] });
    expect(githubApiErrorDetail(body)).toBe("Can not approve your own pull request");
  });

  it("reads errors given as objects and falls back to the message", () => {
    expect(githubApiErrorDetail(JSON.stringify({ errors: [{ message: "a" }, { message: "b" }] }))).toBe("a; b");
    expect(githubApiErrorDetail(JSON.stringify({ message: "Bad credentials" }))).toBe("Bad credentials");
  });

  it("returns null when there is no JSON reason", () => {
    expect(githubApiErrorDetail("")).toBeNull();
    expect(githubApiErrorDetail("not json")).toBeNull();
    expect(githubApiErrorDetail(JSON.stringify({ message: " " }))).toBeNull();
  });
});

describe("parseGhSearchJson", () => {
  const item = (repositoryUrl: string, login: string | null): unknown => ({
    html_url: "https://ghe.example.com/team/svc/pull/4",
    number: 4,
    title: "Retry uploads",
    user: login === null ? null : { login },
    updated_at: "2026-06-01T10:00:00Z",
    repository_url: repositoryUrl,
  });

  it("reads the owner and repo from github.com and GitHub Enterprise API URLs", () => {
    const hits = parseGhSearchJson(
      JSON.stringify({ items: [item("https://api.github.com/repos/acme/widgets", "alice"), item("https://ghe.example.com/api/v3/repos/team/svc", null)] }),
    );
    expect(hits.map((hit) => [hit.owner, hit.repo, hit.author])).toEqual([
      ["acme", "widgets", "alice"],
      ["team", "svc", "ghost"],
    ]);
  });

  it("throws a readable error for unexpected output", () => {
    expect(() => parseGhSearchJson("nope")).toThrow(/invalid JSON/);
    expect(() => parseGhSearchJson(JSON.stringify({ total_count: 0 }))).toThrow(/unexpected JSON/);
  });
});

describe("fake searchOpenPrs", () => {
  it("returns the fixture PR for its repo or author on github.com only", async () => {
    const client = createFakeGitHubClient(loadConfig({ FOUR_EYES_HOME: mkdtempSync(join(tmpdir(), "four-eyes-gh-")) }));
    expect(await client.searchOpenPrs("github.com", "is:pr author:octocat")).toHaveLength(1);
    expect(await client.searchOpenPrs("github.com", "is:pr repo:four-eyes-fixture/demo")).toHaveLength(1);
    expect(await client.searchOpenPrs("github.com", "is:pr author:someone")).toEqual([]);
    expect(await client.searchOpenPrs("ghe.example.com", "is:pr author:octocat")).toEqual([]);
  });
});
