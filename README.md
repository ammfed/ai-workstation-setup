# ai-workstation-setup

One command that sets up an AI-assisted development workstation: Claude Code and
its settings, agent-ergonomic CLIs, MCP servers, skills, the
[Firstmate](https://github.com/kunchenguid/firstmate) agent-fleet workflow, an
Obsidian second brain, ClickUp, an optional terminal theme, and your working
preferences (how agents report, ask, merge and research) as a rules file.

It is a template: it installs tools and writes starter configuration, and asks you
for everything personal (paths, preferences, tokens). It contains no one's data.

## Quick start

```sh
git clone https://github.com/ammfed/ai-workstation-setup
cd ai-workstation-setup
```

**Linux, macOS, WSL**

```sh
./install.sh --dry-run   # see the plan, change nothing
./install.sh             # pick modules, answer questions, install
```

**Windows (PowerShell)**

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 --dry-run
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The only prerequisite is Node.js 20+; the entry script offers to install it
(per-user with nvm on Linux/macOS, with winget on Windows). You pick modules, every
question is asked up front, then the install runs and ends with a summary of what
was done, skipped, failed, and what is left for you (such as signing in).

Re-running is safe: installed tools are detected and skipped (tools that can prove
they work without a sign-in are also given a quick real check), config edits only
happen when something differs, and a changed file you own is never replaced
without asking (a timestamped `.bak-*` copy is kept when it is). Your answers are
saved to `answers.env` (gitignored), so a re-run asks only questions you have not
answered yet.

## Getting updates

```sh
./update.sh     # Windows: .\update.ps1
./install.sh    # re-run: only new questions are asked
```

`update` fast-forwards your clone (or fork) to the template's latest version and never
touches your answers or other gitignored files. If your clone has local changes or has
diverged, it stops, explains, and changes nothing. See
[how to get updates without losing your setup](docs/updating.md).

## Modules

| Module | What it sets up | Linux | macOS | WSL | Windows |
| --- | --- | :-: | :-: | :-: | :-: |
| `core` | git, Node.js check, GitHub CLI (and sign-in), jq | ✓ | ✓ | ✓ | ✓ |
| `claude-code` | Claude Code; model, effort (also per model), theme, thinking summaries, Remote Control, view, auto-compact; ccstatusline or usage-gauges status line; diagram-design plugin; context and after-compaction reminders | ✓ | ✓ | ✓ | ✓ |
| `agent-clis` | gh-axi, chrome-devtools-axi, lavish-axi, tasks-axi, quota-axi, ctx7, no-mistakes, treehouse; optional notion-axi, gws-axi, herdr, Codex, Antigravity, Composio (not native Windows), mermaid-ascii, pixel-agents; session hooks; `research-browser` launcher (not native Windows) | ✓ | ✓ | ✓ | ✓ |
| `mcp-servers` | Optional context7, chrome-devtools and TickTick MCP servers for Claude Code | ✓ | ✓ | ✓ | ✓ |
| `skills` | Claude Code skills: kun, grill-me, grilling, teach, to-questionnaire, find-docs; optional no-mistakes, composio-cli | ✓ | ✓ | ✓ | ✓ |
| `backpass` | Opt-in [backpass](https://github.com/kunchenguid/backpass) behind a privacy gate: project allowlist, denylist check before any model call, one pinned model, never auto-applies; optional schedule (cron) | ✓ | ✓ | ✓ | ✓ |
| `firstmate` | Upstream Firstmate clone plus its local config: backend, harnesses, permission mode, backlog, dispatch profiles, tool update watch | ✓ | ✓ | ✓ | – (use WSL) |
| `preferences` | How your agents work, as a rules file: language and tone, reporting, decisions, review pages, fleet workflow, ideas, model use, research, safety; [guide](docs/working-preferences.md), [review pages](docs/review-pages.md) | ✓ | ✓ | ✓ | ✓ |
| `second-brain` | Markdown vault: life-area and fixed-type entity folders, note contract, provenance rules, eight note templates, map/checker/ingest/housekeeping scripts, obsidian-axi wiring; [design notes](docs/second-brain.md) | ✓ | ✓ | ✓ | ✓ |
| `clickup` | clickup-axi (checksum-verified release binary), skill, session hook, default list; [structure guide](docs/clickup-structure.md) | ✓ | ✓ | ✓ | ✓ |
| `extras` | Optional docling (documents to markdown) and OpenWhispr (voice dictation) | ✓ | ✓ | app on Windows side | ✓ |
| `daily-sync` | Opt-in daily job: fast-forwards clean repos, runs the vault ingest (failing loudly on a missing raw folder), checks tool updates, reads ClickUp and TickTick for drift; model calls only for new drift; one short report, FAILED when a run fails or is missed; [guide](docs/daily-sync.md) | ✓ | ✓ | ✓ | schedule by hand |
| `ledger` | Opt-in always-on service: one append-only record of your messages, rulings and every Firstmate status line and inbox note, with secrets redacted, and a live Now page (waiting on you, in flight, latest words, latest status) rebuilt within seconds; [guide](docs/ledger.md) | ✓ | ✓ | ✓ | – (use WSL) |
| `terminal` | Optional WezTerm and a translucent theme in `~/.wezterm.lua` | ✓ | ✓ | config only | ✓ |

`./install.sh --list` prints the same from the modules themselves. A module that
does not support your system is skipped with the reason printed, never silently.

## Unattended runs

```sh
cp answers.example.env answers.env        # gitignored; edit it
./install.sh --yes --answers answers.env  # no prompts
```

Without `--answers`, a run reads and saves `answers.env` itself; `--save-answers FILE`
also records a run's answers elsewhere. Secrets are
never read from or written to answers files: export `CLICKUP_TOKEN` or
`CONTEXT7_API_KEY`, or sign in afterwards. See `./install.sh --help`.

## Privacy

Tokens you enter go only to the tool's own local config (for example
`claude mcp add` or `clickup-axi auth login`), never into this repository.
`scripts/privacy-scan.sh` checks the tree and history (commit authors and committers
included) for secrets, email addresses other than GitHub noreply ones, and terms in
a local, gitignored denylist; CI runs it and gitleaks on every pull request.

## Contributing

See [AGENTS.md](AGENTS.md) for the module contract and how to add a module.

## License

[MIT](LICENSE)
