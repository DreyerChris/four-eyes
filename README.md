# four-eyes

A local pull request review tool that sits on top of Claude Code.

Paste a PR link. four-eyes splits the PR into small, ordered chunks that you step through one at a time, with a GitHub-style diff. You can highlight code and ask Claude about it, click a function to jump to its definition, and open any file. While you review, Claude writes its own review in the background. You see its findings next to your notes on a summary screen at the end, so you form your own opinion first.

Everything runs on your machine. Reviews are stored in a local SQLite database, and nothing is ever posted to GitHub.

## Requirements

- **Node.js 24+** and **pnpm**
- **[Claude Code](https://docs.claude.com/en/docs/claude-code)** installed and logged in. four-eyes runs your own `claude` binary with your user settings, so it uses the same login, gateway or proxy your `claude` command uses.
- **[GitHub CLI](https://cli.github.com/)** (`gh`) logged in to every host you review on (`gh auth login`, and `gh auth login --hostname <your-ghe-host>` for GitHub Enterprise)
- **git** and **[ripgrep](https://github.com/BurntSushi/ripgrep)** (`rg`)

## Getting started

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 and paste a PR link, for example `https://github.com/owner/repo/pull/123`.

For a production build served from a single port (8787 by default):

```sh
pnpm build
pnpm start
```

## Using it

| Key | Action |
|---|---|
| `j` / `k` | Next / previous chunk |
| `g` | Mark chunk as looks good |
| `f` | Flag chunk |
| `n` | Add a note |
| `Shift` + `↑` / `↓` | Select lines in the diff |
| `?` | Ask Claude about the selection |
| `r` | Refresh when the PR has new commits |
| `,` | Settings |
| `:` | Command bar: `:open <url>`, `:refresh`, `:summary`, `:goto <n>` |

Everything also works with the mouse.

Each row in the active list shows your own latest GitHub review of the PR, such as **you approved 2h ago**, whether you submitted it from four-eyes or on GitHub. It adds **new commits since** when the PR changed after your review, and shows **not reviewed by you yet** otherwise. This is read during the regular PR check.

### Suggested PRs

The **suggested** tab lists open PRs you might want to review: PRs in repos you reviewed in the last 30 days, and PRs by people whose PRs you reviewed before. four-eyes searches GitHub with your `gh` login when it starts and then every 15 minutes, and **Check now** searches straight away. Drafts and your own PRs are left out, and so are PRs already in four-eyes. By default, only PRs in repos you have reviewed before are shown; see Settings.

A suggestion never starts Claude on its own. Each row has:

- **Review this**, which adds the PR exactly like pasting its link.
- **Open on GitHub**.
- **Dismiss**, which hides the PR until it gets new activity.
- **Not interested**, which hides the PR for good. Adding the PR yourself later clears this.

Suggestions that GitHub stops returning, for example because the PR was merged or closed, are removed on the next check.

### Submitting your review

The summary page has a **submit to GitHub** panel. Pick Approve, Comment or Request changes, optionally write a comment, and submit. The comment is optional when you approve, and GitHub requires one for the other two. **Add full review to comment** appends the same markdown that **Copy full review** copies.

The review is posted with your `gh` login and attached to the commit you reviewed, even if the PR has newer commits since. This is the only thing four-eyes writes to GitHub.

## Settings

Open settings with `,`.

- **Models** used for chunking, the background review and Q&A. Defaults are Sonnet for chunking and Q&A and Opus for the review.
- **Claude executable.** Leave empty to use `claude` from your PATH. Set it if your Claude Code lives somewhere else or you start it through a wrapper. Accepts an absolute path, `~/...`, or a command name on your PATH. The panel shows which binary will be used and its version.
- **Claude's output length.** How much Claude writes in chunk explanations, findings, the verdict and Q&A answers: `brief`, `standard` (the default) or `detailed`. It applies to reviews and questions run after you change it, including follow-up questions in an existing Q&A session.
- **Suggestions.** Turn the suggested tab's GitHub searches on or off. Turning it on starts a search straight away.
- **Only suggest PRs in repos you have reviewed before** (on by default). Leaves out PRs by people you've reviewed when they are in a repo you have never reviewed.
- **Inline findings.** Show Claude's findings on each chunk while you step through, instead of only on the summary.

The Claude binary is chosen in this order: the settings value, then `FOUR_EYES_CLAUDE_PATH`, then `claude` on PATH.

## Environment variables

| Variable | Meaning |
|---|---|
| `FOUR_EYES_HOME` | Where data lives (default `~/.four-eyes`): the database, repo clones and worktrees |
| `FOUR_EYES_CLAUDE_PATH` | Claude Code binary, used when the setting is empty |
| `PORT` | Server port (default `8787`) |
| `FOUR_EYES_POLL_MS` | How often to check open PRs for new commits (default `120000`) |
| `FOUR_EYES_SUGGESTIONS_POLL_MS` | How often to search GitHub for suggested PRs (default `900000`, 15 minutes) |
| `FOUR_EYES_NO_OPEN=1` | Do not open a browser on start (macOS) |
| `FOUR_EYES_FAKE_CLAUDE=1` | Use canned Claude responses instead of real runs (tests, no tokens) |
| `FOUR_EYES_FAKE_GH=1` | Use a recorded fixture PR instead of GitHub (tests, no network) |

## Where your data goes

- **Claude:** requests go through your own `claude` binary, so they go wherever your Claude Code is configured to send them. Claude only gets read-only tools (read, search, `git log` / `blame` / `show`) inside a checkout of the PR, and MCP servers are disabled.
- **GitHub:** `gh` and `git` fetch PR details, code, your own reviews and suggested PRs using your existing logins. The only thing four-eyes writes is a review you submit yourself from the summary page. It never pushes.
- **Your disk:** reviews, notes and clones are stored in `FOUR_EYES_HOME`. Claude Code keeps its own session logs as it normally does.
- **The server** listens on `127.0.0.1` only, so other machines on your network cannot reach it. It also refuses requests addressed to any other host name, and changes coming from another website's page, so a site open in your browser cannot use it either.

## Development

| Command | What it does |
|---|---|
| `pnpm dev` | Server on :8787 and web app on :5173 with `/api` proxied |
| `pnpm typecheck` | TypeScript checks for server and web |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright) with fake Claude and fake GitHub |
| `pnpm db:generate` | Generate a database migration after a schema change |

The design decisions behind the tool are in [docs/design.md](docs/design.md).

## License

[MIT](LICENSE)
