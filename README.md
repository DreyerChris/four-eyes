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

## Settings

Open settings with `,`.

- **Models** used for chunking, the background review and Q&A. Defaults are Sonnet for chunking and Q&A and Opus for the review.
- **Claude executable.** Leave empty to use `claude` from your PATH. Set it if your Claude Code lives somewhere else or you start it through a wrapper. Accepts an absolute path, `~/...`, or a command name on your PATH. The panel shows which binary will be used and its version.
- **Inline findings.** Show Claude's findings on each chunk while you step through, instead of only on the summary.

The Claude binary is chosen in this order: the settings value, then `FOUR_EYES_CLAUDE_PATH`, then `claude` on PATH.

## Environment variables

| Variable | Meaning |
|---|---|
| `FOUR_EYES_HOME` | Where data lives (default `~/.four-eyes`): the database, repo clones and worktrees |
| `FOUR_EYES_CLAUDE_PATH` | Claude Code binary, used when the setting is empty |
| `PORT` | Server port (default `8787`) |
| `FOUR_EYES_POLL_MS` | How often to check open PRs for new commits (default `120000`) |
| `FOUR_EYES_NO_OPEN=1` | Do not open a browser on start (macOS) |
| `FOUR_EYES_FAKE_CLAUDE=1` | Use canned Claude responses instead of real runs (tests, no tokens) |
| `FOUR_EYES_FAKE_GH=1` | Use a recorded fixture PR instead of GitHub (tests, no network) |

## Where your data goes

- **Claude:** requests go through your own `claude` binary, so they go wherever your Claude Code is configured to send them. Claude only gets read-only tools (read, search, `git log` / `blame` / `show`) inside a checkout of the PR, and MCP servers are disabled.
- **GitHub:** `gh` and `git` fetch PR details and code using your existing logins. four-eyes only reads; it never comments, reviews or pushes.
- **Your disk:** reviews, notes and clones are stored in `FOUR_EYES_HOME`. Claude Code keeps its own session logs as it normally does.
- **The browser** only talks to `localhost`.

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
