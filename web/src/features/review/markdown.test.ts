import { describe, expect, it } from "vitest";
import { buildFullReviewMarkdown, findingToGitHubComment, hunkLocation, noteToGitHubComment } from "./markdown";
import { fixtureFinding, fixtureHunk, fixtureProgress, fixtureSummary } from "./testFixtures";

describe("hunkLocation", () => {
  it("points at new-side lines", () => {
    expect(hunkLocation(fixtureHunk())).toBe("`src/user.ts` L10-L13");
  });

  it("points at the old file for deletions", () => {
    expect(hunkLocation(fixtureHunk({ changeType: "deleted", oldFilePath: "src/old.ts", oldStart: 1, oldLines: 1, newStart: 0, newLines: 0 }))).toBe(
      "`src/old.ts` L1 (removed)",
    );
  });
});

describe("findingToGitHubComment", () => {
  it("includes severity, explanation, fix and only the referenced locations", () => {
    const text = findingToGitHubComment(fixtureFinding(), [fixtureHunk(), fixtureHunk({ id: "h_9", filePath: "other.ts" })]);
    expect(text).toBe(
      [
        "**Bug: Email can be undefined**",
        "loadUser may return a user without an email.",
        "**Suggested fix:**",
        "Guard with `user.email ?? null`.",
        "<sub>Location: `src/user.ts` L10-L13</sub>",
      ].join("\n\n"),
    );
  });

  it("points at the finding's own line range when it has one", () => {
    const hunks = [fixtureHunk(), fixtureHunk({ id: "h_2", filePath: "src/new.ts", oldFilePath: "src/old.ts", oldStart: 50, oldLines: 5 })];
    expect(findingToGitHubComment(fixtureFinding({ range: { side: "new", startLine: 11, endLine: 12 } }), hunks)).toContain(
      "<sub>Location: `src/user.ts` L11-L12</sub>",
    );
    expect(findingToGitHubComment(fixtureFinding({ hunkIds: ["h_2"], range: { side: "old", startLine: 52, endLine: 52 } }), hunks)).toContain(
      "<sub>Location: `src/old.ts` L52 (removed)</sub>",
    );
  });

  it("omits the fix and location when there are none", () => {
    expect(findingToGitHubComment(fixtureFinding({ suggestedFix: null, hunkIds: [] }), [fixtureHunk()])).toBe(
      "**Bug: Email can be undefined**\n\nloadUser may return a user without an email.",
    );
  });
});

describe("noteToGitHubComment", () => {
  it("labels flagged chunks and keeps the note", () => {
    expect(noteToGitHubComment(fixtureProgress({ status: "flagged", note: "Why?" }), "Load users", [fixtureHunk()])).toBe(
      "**Flagged: Load users**\n\nWhy?\n\n<sub>Location: `src/user.ts` L10-L13</sub>",
    );
  });

  it("uses a plain heading for notes on good chunks", () => {
    expect(noteToGitHubComment(fixtureProgress({ status: "good", note: "Nice" }), "Tests", [])).toBe("**Note: Tests**\n\nNice");
  });
});

describe("buildFullReviewMarkdown", () => {
  it("renders every section in order", () => {
    const markdown = buildFullReviewMarkdown(fixtureSummary());
    expect(markdown).toBe(
      [
        "# Review: Add email to users (#7)",
        "https://github.com/acme/widgets/pull/7",
        "## Verdict: Request changes",
        "Fix the email guard.",
        "## Findings",
        "### Bug (1)",
        [
          "- **Email can be undefined**",
          "  loadUser may return a user without an email.",
          "  Suggested fix:",
          "  Guard with `user.email ?? null`.",
          "  In chunk 1: Load users with email",
        ].join("\n"),
        "### Nit (1)",
        ["- **Rename variable**", "  Call it userEmail.", "  In chunk 2: Lockfile"].join("\n"),
        "## Your flags and notes",
        ["- **Flagged**: chunk 1: Load users with email", "  Check null emails.", "  Also the old callers."].join("\n"),
        "## Questions asked",
        ["- **Q:** Can loadUser throw? (`src/user.ts` L11-L12)", "  **A:** Yes, on a network error."].join("\n"),
        "## Coverage",
        ["- Chunks reviewed: 1 of 2", "- Hunks reviewed: 1 of 2 still in the PR", "- Hunks no longer in the PR: 1"].join("\n"),
      ].join("\n\n") + "\n",
    );
  });

  it("marks lifecycle and your verdict, and handles an empty review", () => {
    const markdown = buildFullReviewMarkdown(
      fixtureSummary({
        verdict: null,
        findings: [fixtureFinding({ lifecycle: "resolved", userVerdict: "disagree" })],
        questions: [],
        chunks: [],
      }),
    );
    expect(markdown).toContain("No verdict from Claude yet.");
    expect(markdown).toContain("- **Email can be undefined** _(resolved, you: disagree)_");
    expect(markdown).toContain("## Your flags and notes\n\nNone.");
    expect(markdown).not.toContain("## Questions asked");
  });
});
