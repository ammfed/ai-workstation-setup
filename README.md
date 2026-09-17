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

Re-running is safe: installed tools are detected and skipped, config edits only
happen when something differs, and a changed file you own is never replaced
without asking (a timestamped `.bak-*` copy is kept when it is).

## Modules

| Module | What it sets up | Linux | macOS | WSL | Windows |
| --- | --- | :-: | :-: | :-: | :-: |
| `core` | git, Node.js check, GitHub CLI (and sign-in), jq | ✓ | ✓ | ✓ | ✓ |
| `claude-code` | Claude Code; model, effort, theme, thinking summaries; ccstatusline status line; diagram-design plugin | ✓ | ✓ | ✓ | ✓ |
| `agent-clis` | gh-axi, chrome-devtools-axi, lavish-axi, tasks-axi, quota-axi, ctx7, no-mistakes, treehouse; optional notion-axi, gws-axi, herdr, Codex, Antigravity, Composio (not native Windows); session hooks; `research-browser` launcher (not native Windows) | ✓ | ✓ | ✓ | ✓ |
| `mcp-servers` | Optional context7, chrome-devtools and TickTick MCP servers for Claude Code | ✓ | ✓ | ✓ | ✓ |
| `skills` | Claude Code skills: kun, grill-me, grilling, teach, to-questionnaire, find-docs | ✓ | ✓ | ✓ | ✓ |
| `firstmate` | Upstream Firstmate clone plus its local config: backend, harnesses, permission mode, backlog, dispatch profiles, tool update watch | ✓ | ✓ | ✓ | – (use WSL) |
| `preferences` | How your agents work, as a rules file: language and tone, reporting, decisions, review pages, ideas, model use, research, safety; [guide](docs/working-preferences.md) | ✓ | ✓ | ✓ | ✓ |
| `second-brain` | Markdown vault: life-area and fixed-type entity folders, note contract, provenance rules, eight note templates, map/checker/ingest/housekeeping scripts, obsidian-axi wiring; [design notes](docs/second-brain.md) | ✓ | ✓ | ✓ | ✓ |
| `clickup` | clickup-axi (checksum-verified release binary), skill, session hook, default list; [structure guide](docs/clickup-structure.md) | ✓ | ✓ | ✓ | ✓ |
| `terminal` | Optional WezTerm and a translucent theme in `~/.wezterm.lua` | ✓ | ✓ | config only | ✓ |

`./install.sh --list` prints the same from the modules themselves. A module that
does not support your system is skipped with the reason printed, never silently.

## Unattended runs

```sh
cp answers.example.env answers.env        # gitignored; edit it
./install.sh --yes --answers answers.env  # no prompts
```

`--save-answers FILE` records an interactive run's answers for reuse. Secrets are
never read from or written to answers files: export `CLICKUP_TOKEN` or
`CONTEXT7_API_KEY`, or sign in afterwards. See `./install.sh --help`.

## Privacy

Tokens you enter go only to the tool's own local config (for example
`claude mcp add` or `clickup-axi auth login`), never into this repository.
`scripts/privacy-scan.sh` checks the tree and history for secrets and for terms in
a local, gitignored denylist; CI runs it and gitleaks on every pull request.

## Contributing

See [AGENTS.md](AGENTS.md) for the module contract and how to add a module.

## License

[MIT](LICENSE)
