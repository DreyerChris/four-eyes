# four-eyes — design

A local PR review tool that sits on top of Claude. You paste a PR link. The tool breaks the PR into small, ordered chunks that you step through one at a time. Claude runs a review in the background, and you see its findings at the end.

Single user, runs locally. The only write to GitHub is submitting your review from the summary page.

---

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Calling Claude | `@anthropic-ai/claude-agent-sdk`, pointed at the user's own Claude Code binary (settings path → `FOUR_EYES_CLAUDE_PATH` → `claude` on PATH) and loading user settings, so requests use whatever login, gateway or proxy the user's `claude` command already uses. |
| 2 | App type | Local web app. One command starts a Node server and opens `localhost`. |
| 3 | Chunking | The server splits the diff into hunks with IDs. Claude only groups and orders hunk IDs; it never rewrites code. The server checks that every hunk is used exactly once, and leftovers go into an "Other changes" chunk. Target 5–40 changed lines per chunk. Order: types/models → logic → wiring → tests → "skim this" (lockfiles, generated code, snapshots). |
| 4 | Findings timing | The review runs in the background right after chunking. Findings stay hidden until the summary by default; a setting shows them inline. Each chunk can be marked looks good / flagged / question, with notes. |
| 5 | GitHub writes | The summary page submits a review (approve, comment or request changes) through `gh api`, as the user's gh login, on the head commit that was reviewed. The comment is optional for approve and required otherwise, as GitHub requires. Past reviews and closed or merged PRs cannot be submitted. Notes and findings still have a "copy as GitHub comment" button; posting them as inline comments is a possible later addition. |
| 6 | Q&A | One ongoing Claude session per PR. The SDK session ID is stored and resumed. Each question is tied to its file, line range, chunk, and head SHA. Answers stream in. |
| 7 | Click to definition | Shiki tokens are clickable. ripgrep searches for definition patterns: one match opens it, several show a list, none offers "Ask Claude". File names open a file viewer with changed lines highlighted and a before/after toggle. LSP for TypeScript is a possible later addition. |
| 8 | Local code | The tool manages its own copies: a bare clone per repo in `~/.four-eyes/repos/` and a `git worktree` per PR at the head SHA. Your own clones are never touched. Uses existing `gh` logins (github.com and any GitHub Enterprise host). |
| 9 | Refresh | Check the head SHA every ~2 minutes while open. On refresh, match hunks by fingerprint (file path + changed lines, ignoring line numbers). Matched hunks keep your progress. New hunks become a "Round N" set of chunks. Missing hunks are marked "no longer in PR". The review re-runs, and findings are marked new / still present / resolved. Works across rebases and force-pushes. No OS notifications in v1. |
| 10 | Review list | Active and Past tabs. Rows show progress, a new-commits badge, the PR's GitHub state, and last activity. A review moves to Past when you finish it, or automatically when the PR is merged or closed. Past reviews are read-only, and their worktrees are deleted (rebuilt on demand). Adding the same PR again reopens the existing review. |
| 11 | Diff view | Like GitHub: unified by default with a side-by-side toggle, word-level highlights, 3 lines of context with expand buttons, a file header per hunk, a hide-whitespace toggle. A custom renderer (Shiki + `diff`), not a library. |
| 12 | Models | Chunking: Sonnet 5.5. Review: Opus 5.5. Q&A: Sonnet 5.5 with an "ask Opus" toggle. Set in a settings file. Live progress while working. Retry once on invalid output, then fall back to one chunk per file. Token use and cost are saved per run. |
| 13 | Summary | Claude's verdict → findings grouped by Bug / Risk / Improvement / Nit (each with go-to-chunk, copy button, agree / disagree / unsure) → your flags and notes → questions asked → coverage → "Copy full review" markdown. Findings must reference real hunk IDs or they are dropped. |
| 14 | Stack | Single TypeScript package (strict, no `any`): `server/`, `web/`, `shared/`. Node 24, Hono, server-sent events, `better-sqlite3` + Drizzle, React + Vite, TanStack Query, Shiki (loaded lazily), CSS modules, pnpm, Vitest, Playwright. |
| 15 | Look | Terminal style: monospace, dark, bordered panels with titles in the border, a bottom status bar with key hints, a `:` command bar. Borders drawn with CSS (not box-drawing characters), contrast-checked colors, `+`/`-` markers alongside color, visible focus. Light theme later. |

---

## How it works

```
paste PR URL
  → gh pr view --json (title, author, state, headRefOid, baseRefOid, files)
  → git fetch into bare clone, git worktree add at head SHA
  → git diff base...head → parse into hunks → split big hunks → fingerprint each
  → save PR + hunks to SQLite
  → start in parallel:
      chunking run (Sonnet)  → validate → save chunks → user starts stepping
      review run (Opus)      → validate → save findings (hidden until summary)
```

Claude tools for every run: `Read`, `Grep`, `Glob`, and `Bash` limited to `git log`, `git blame`, and `git show`. No write tools. The working directory is the PR's worktree.

### Claude outputs (validated with zod)

```ts
type ChunkPlan = {
  readonly chunks: readonly {
    readonly title: string;
    readonly explanation: string;
    readonly kind: "core" | "skim";
    readonly hunkIds: readonly string[];
  }[];
};

type ReviewResult = {
  readonly verdict: { readonly summary: string; readonly suggestion: "approve" | "approve_with_nits" | "request_changes" };
  readonly findings: readonly {
    readonly severity: "bug" | "risk" | "improvement" | "nit";
    readonly title: string;
    readonly explanation: string;
    readonly hunkIds: readonly string[];
    readonly suggestedFix?: string;
  }[];
};
```

---

## Data model (SQLite)

- **reviews**: id, host, owner, repo, pr_number, title, author, url, base_sha, head_sha, gh_state, status (`active` | `past`), worktree_path, qa_session_id, created_at, last_activity_at, finished_at
- **rounds**: id, review_id, number, head_sha, created_at
- **hunks**: id, review_id, round_id, fingerprint, file_path, old_start, old_lines, new_start, new_lines, patch_text, present (bool)
- **chunks**: id, review_id, round_id, position, title, explanation, kind
- **chunk_hunks**: chunk_id, hunk_id, position
- **chunk_progress**: chunk_id, status (`unseen` | `good` | `flagged` | `question`), note, updated_at
- **findings**: id, review_id, round_id, severity, title, explanation, suggested_fix, lifecycle (`new` | `still_present` | `resolved`), user_verdict (`agree` | `disagree` | `unsure` | null)
- **finding_hunks**: finding_id, hunk_id
- **verdicts**: review_id, round_id, summary, suggestion
- **questions**: id, review_id, chunk_id, file_path, start_line, end_line, selected_text, head_sha, question, answer, model, created_at
- **claude_runs**: id, review_id, kind (`chunking` | `review` | `qa`), model, status, input_tokens, output_tokens, cost_usd, error, started_at, finished_at
- **settings**: key, value

Data lives in `~/.four-eyes/four-eyes.db`.

---

## Milestones

Each milestone ends with something usable.

1. **SDK spike.** A script calls the Agent SDK with the user's `claude` binary and user settings loaded, and gets valid structured JSON back.
2. **Core loop.** Project scaffold, terminal-style shell (panels, status bar, key bindings), paste URL → fetch → worktree → hunk parsing → chunking → validation → SQLite → step through chunks with the diff view and good / flag / note. *Minimum useful tool.*
3. **Background review + summary screen**, with copy buttons and "Copy full review".
4. **Highlight-and-ask Q&A**: streaming, session resume, Q&A shown on its chunk.
5. **File viewer + click to definition.**
6. **Review list + refresh**: Active/Past, head SHA checks, fingerprint matching, rounds, finding lifecycle, auto-archive on merge/close.
7. **Polish**: `:` command bar, light theme, worktree cleanup, cost display, the inline-findings setting.

---

## Testing

- **Vitest unit tests** for the logic that has to be right: diff parsing, hunk splitting, fingerprinting, chunk and finding validation (missing, duplicate, and unknown hunk IDs), the fallback chunker, and building GitHub comment text.
- **Refresh matching tests** using real git repos built in a temp folder: normal push, rebase onto a moved base, force-push that rewrites one hunk, revert of a hunk, file rename.
- **Playwright end-to-end tests** with a recorded PR and a fake Claude layer (canned SDK responses), so they spend no tokens: add PR → step through → summary → copy; refresh flow; keyboard-only run; automated accessibility check with axe.

---

## Open items for later

- Posting notes and findings as inline review comments on GitHub.
- LSP-based go-to-definition for TypeScript.
- Pre-chunking file exclusion step for very large PRs.
- macOS notifications for new commits.
- Compacting very long Q&A sessions.
