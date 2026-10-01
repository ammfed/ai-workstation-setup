# ai-workstation-setup

One command that sets up an AI-assisted development workstation: Claude Code and
its settings, agent-ergonomic CLIs, MCP servers, skills, the
[Firstmate](https://github.com/kunchenguid/firstmate) agent-fleet workflow, an
Obsidian second brain, ClickUp, an optional terminal theme, and your working
preferences (how agents report, ask, merge and research) as a rules file.

It is a template: it installs tools and writes starter configuration, and asks you
for everything personal (paths, preferences, tokens). It contains no one's data.

## What's in this setup

Everything below is installed from its own official source by the module named in
brackets; nothing is vendored. Items marked optional are off until you pick them.

**Agents and their settings**
- [Claude Code](https://code.claude.com/docs) with model, effort per model, permission mode, theme, view, Remote Control and auto-compact settings (claude-code); the Claude desktop app on Windows.
- Status line: [ccstatusline](https://github.com/sirmalloc/ccstatusline) or a built-in gauges line with context, 5-hour and weekly bars (claude-code).
- Plugins: [diagram-design](https://github.com/cathrynlavery/diagram-design); optional [compact-adviser](https://github.com/kunchenguid/compact-adviser), which says when a session is at a safe point to compact (claude-code).
- Hooks: session-start briefings from the agent CLIs, and reminders to save notes before and after a compaction (claude-code, agent-clis).
- Skills: [kun](https://github.com/kunchenguid/kun), grilling and teach from [mattpocock/skills](https://github.com/mattpocock/skills), find-docs from [Context7](https://github.com/upstash/context7); optional grill-me, to-questionnaire, wayfinder (with its helpers domain-modeling, research and prototype), no-mistakes and composio-cli (skills).
- Optional other agents: [Codex](https://github.com/openai/codex), [Pi](https://github.com/earendil-works/pi), [Antigravity CLI](https://antigravity.google) (agent-clis).
- Working preferences written as a rules file every session loads: tone, status format, decisions, review pages, model use, research and safety (preferences; [guide](docs/working-preferences.md)).

**Agent fleet**
- [Firstmate](https://github.com/kunchenguid/firstmate), cloned from upstream, with its backend, harnesses, permission mode, dispatch profiles, a home kept apart from the code, and one persistent second mate per domain (firstmate; [notes](docs/firstmate.md)).
- [tasks-axi](https://github.com/kunchenguid/tasks-axi) backlog, [quota-axi](https://github.com/kunchenguid/quota-axi) plan limits, [no-mistakes](https://github.com/kunchenguid/no-mistakes) validation pipeline, [treehouse](https://github.com/kunchenguid/treehouse) worktree pool; optional [herdr](https://github.com/ogulcancelik/herdr) workspace backend or tmux (agent-clis, firstmate).
- Optional [gnhf](https://github.com/kunchenguid/gnhf) overnight loop and [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) live office view (agent-clis).
- Optional [backpass](https://github.com/kunchenguid/backpass) behind a privacy gate (backpass).

**Command-line tools for agents**
- [git](https://git-scm.com), [GitHub CLI](https://github.com/cli/cli), jq, and Node.js through nvm (core).
- [gh-axi](https://github.com/kunchenguid/gh-axi) for GitHub and [ctx7](https://github.com/upstash/context7) for current library docs (agent-clis).
- Optional [notion-axi](https://github.com/maximebrmd/notion-axi), Notion's own [ntn](https://developers.notion.com/cli/get-started/overview), [gws-axi](https://github.com/JarvusInnovations/gws-axi), [Composio](https://github.com/ComposioHQ/composio), [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii), [claude-swap](https://github.com/realiti4/claude-swap) for several Claude accounts, [notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli), the [CLI for Microsoft 365](https://github.com/pnp/cli-microsoft365) and the [Vercel CLI](https://github.com/vercel/vercel) (agent-clis).
- Optional MCP servers: Context7, [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp), and TickTick's official server (mcp-servers).

**Browser and review**
- [chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi) and `research-browser`, a visible Chrome with its own profile that belongs to your agents (agent-clis).
- [lavish-axi](https://github.com/kunchenguid/lavish-axi) review pages that never open tabs on their own, and a one-decision-at-a-time card page template (agent-clis, preferences; [review pages](docs/review-pages.md)).
- Optional [Lavish Library](https://github.com/ammfed/lavish-library), a local page to find and reopen every review page (extras).
- By hand, if you want it: the [Claude in Chrome](https://code.claude.com/docs/en/chrome) extension for your own browser, and claude.ai connectors (such as Claude Docs) turned on in your claude.ai settings.

**Notes and tasks**
- A Markdown second brain for [Obsidian](https://obsidian.md) with templates, map, checker and ingest scripts, and [obsidian-axi](https://github.com/AndersHoffmann/obsidian-axi) for agents (second-brain; [design](docs/second-brain.md)).
- [clickup-axi](https://github.com/JanSuthacheeva/clickup-axi) with its skill and session hook (clickup; [structure](docs/clickup-structure.md)).

**Always-on helpers (opt-in)**
- Daily sync: fast-forwards clean repos, runs the vault ingest, checks tool updates, reads ClickUp and TickTick for drift (daily-sync; [guide](docs/daily-sync.md)).
- Ledger: one record of what you say and decide and of every status line, a live Now page and a read-only board (ledger; [guide](docs/ledger.md)).
- Voice mode: talk with your assistant through OpenAI Realtime or Gemini Live, with desktop and browser actions chosen by a fast decision model (voice-mode; [guide](docs/voice-mode.md)).
- News digest: every few hours, new items from the feeds and pages you list, in one Markdown digest, summarised only by a model you name (news-digest; [guide](docs/news-digest.md)).
- One [OpenRouter](https://openrouter.ai) key and decision model ([Jev](https://openrouter.ai/typesafe/jev-1.13) by default), kept in a local env file and used where a tool documents it (openrouter; [notes](docs/openrouter.md)).

**Desktop extras (optional)**
- [docling](https://github.com/docling-project/docling) documents to Markdown, [OpenWhispr](https://github.com/OpenWhispr/openwhispr) dictation, [llama.cpp](https://github.com/ggml-org/llama.cpp) for local models (extras); [WezTerm](https://wezterm.org) with a translucent theme (terminal); WSL with Ubuntu on Windows (wsl).

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

**Windows (PowerShell)** (no Git yet? download the ZIP from GitHub and unpack it)

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

It asks one question. **Linux inside Windows** (recommended) installs WSL and Ubuntu
the way Microsoft documents it (`wsl --install`), carries on by itself after a restart if
Windows needs one, and then runs the whole setup inside Ubuntu, Firstmate included.
**Windows only** installs Claude Code (command line and desktop app) and every module that
runs on Windows. Either way, every dependency is installed without asking again; Windows
asks once to allow the WSL install, and Ubuntu asks for your new Linux password.

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
| `claude-code` | Claude Code (and the Claude desktop app on Windows); model (including the 1M-context Opus), effort (also per model), permission mode, theme, thinking summaries, Remote Control, view, auto-compact; ccstatusline or usage-gauges status line; diagram-design and optional compact-adviser plugins; context and after-compaction reminders | ✓ | ✓ | ✓ | ✓ |
| `agent-clis` | gh-axi, chrome-devtools-axi, lavish-axi, tasks-axi, quota-axi, ctx7, no-mistakes, treehouse; optional notion-axi, ntn, gws-axi, herdr, Codex, Pi, Antigravity, claude-swap, notebooklm-mcp-cli, CLI for Microsoft 365, Vercel CLI, Composio (not native Windows), mermaid-ascii, pixel-agents, gnhf; session hooks; `research-browser` launcher (not native Windows) | ✓ | ✓ | ✓ | ✓ |
| `mcp-servers` | Optional context7, chrome-devtools and TickTick MCP servers for Claude Code | ✓ | ✓ | ✓ | ✓ |
| `skills` | Claude Code skills: kun, grilling, teach, find-docs; optional grill-me, to-questionnaire, wayfinder, no-mistakes, composio-cli | ✓ | ✓ | ✓ | ✓ |
| `backpass` | Opt-in [backpass](https://github.com/kunchenguid/backpass) behind a privacy gate: project allowlist, denylist check before any model call, one pinned model, never auto-applies; optional schedule (cron) | ✓ | ✓ | ✓ | ✓ |
| `firstmate` | Upstream Firstmate clone plus its local config: an operational home apart from the code (FM_HOME, pinned per home and second mate), backend, harnesses, permission mode, backlog, dispatch profiles, Herdr presentation, startup memory budget, tool update watch; [notes](docs/firstmate.md) | ✓ | ✓ | ✓ | via `wsl` |
| `preferences` | How your agents work, as a rules file: language and tone, reporting, decisions, review pages, fleet workflow, ideas, model use, research, safety; [guide](docs/working-preferences.md), [review pages](docs/review-pages.md) | ✓ | ✓ | ✓ | ✓ |
| `second-brain` | Markdown vault: life-area and fixed-type entity folders, note contract, provenance rules, eight note templates, map/checker/ingest/housekeeping scripts, obsidian-axi wiring; [design notes](docs/second-brain.md) | ✓ | ✓ | ✓ | ✓ |
| `clickup` | clickup-axi (checksum-verified release binary), skill, session hook, default list; [structure guide](docs/clickup-structure.md) | ✓ | ✓ | ✓ | ✓ |
| `extras` | Optional docling (documents to markdown), OpenWhispr (voice dictation), llama.cpp (local models; Homebrew or winget) and Lavish Library (find and reopen review pages; Linux, macOS, WSL) | ✓ | ✓ | app on Windows side | ✓ |
| `daily-sync` | Opt-in daily job: fast-forwards clean repos, runs the vault ingest (failing loudly on a missing raw folder), checks tool updates, reads ClickUp and TickTick for drift; model calls only for new drift; one short report, FAILED when a run fails or is missed; [guide](docs/daily-sync.md) | ✓ | ✓ | ✓ | schedule by hand |
| `voice-mode` | Opt-in speech-to-speech with your assistant: OpenAI Realtime or Gemini Live (one config line), answers from your records read-only and a live briefing of your assistant's current conversation and work (redacted), hands deeper questions and real work to your assistant and speaks the answer when it comes back, controls the PC mid-sentence via a fast decision model choosing from a fixed list (open apps, sites, folders and records; switch and arrange windows; volume, media, brightness, screenshot, lock; notes, web search, typing; never deleting, sending or closing); optional browser control of a Chrome started for the assistant (click, type into a field, scroll, back, tabs, read the page; anything that sends, deletes, pays or signs in waits for a spoken yes, and password, payment and identity fields are never typed into); records looked up before anything is handed off, and a conversation that stays open until a handed-off answer is spoken; `voice-mode do` and `voice-mode say` let your assistant use the same desktop actions and voice; one conversation per hotkey press (on, then off), talk over a reply to cut in (echo cancellation), a floating orb that moves with the voices, measured latency; [guide](docs/voice-mode.md) | ✓ | ✓ | – | – |
| `ledger` | Opt-in always-on service: one append-only record of your messages, rulings and every Firstmate status line and inbox note, with secrets redacted, and a live Now page (waiting on you, in flight, latest words, latest status) rebuilt within seconds, plus an optional read-only live board on 127.0.0.1; [guide](docs/ledger.md) | ✓ | ✓ | ✓ | – (inside WSL) |
| `news-digest` | Opt-in scheduled collector: new items from the feeds and pages you list, written as one Markdown digest every few hours; a summary only from a model command you give; [guide](docs/news-digest.md) | ✓ | ✓ | ✓ | schedule by hand |
| `openrouter` | Opt-in OpenRouter key (environment or hidden prompt, stored in a local env file) and decision model, wired into voice mode; [notes](docs/openrouter.md) | ✓ | ✓ | ✓ | ✓ |
| `wsl` | Opt-in on Windows (the recommended first choice): WSL with Ubuntu via Microsoft's `wsl --install`, a Linux user, resuming after a restart, then this whole setup inside Ubuntu | – | – | – | ✓ |
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
never read from or written to answers files: export `CLICKUP_TOKEN`,
`CONTEXT7_API_KEY` or `OPENROUTER_API_KEY`, or sign in afterwards. See `./install.sh --help`.

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
