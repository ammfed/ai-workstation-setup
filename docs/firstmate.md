# Firstmate

[Firstmate](https://github.com/kunchenguid/firstmate) supervises a fleet of coding agents:
it writes briefs, launches workers in their own worktrees, watches their status lines and
brings you only the decisions that are yours. The `firstmate` module installs it as an
upstream clone (never a copy) and writes its local, gitignored configuration. Firstmate's own
`docs/configuration.md` is the reference for every file named here.

## Code and home

Firstmate keeps its code in the clone (`FIRSTMATE_DIR`, default `~/firstmate`) and its
private files (`config/`, `state/`, `data/`, `projects/`) in an operational home. By default
the home is the clone itself. Set `FIRSTMATE_HOME` (for example `~/.firstmate`) to keep them
apart: the clone then stays a clean checkout that updates with a fast-forward, and the module
exports `FM_HOME` for new shells and writes the config there.

With `FIRSTMATE_PIN_HOME=yes` the module also writes `env.FM_HOME` into the home's
`.claude/settings.local.json` (gitignored). A Claude Code session does not always inherit
`FM_HOME`, and scripts such as `fm-send.sh` refuse to guess a home, so a session without it
fails its first steer to a worker (upstream issue
[#5713](https://github.com/kunchenguid/firstmate/issues/5713)).

## Choices the module writes

| Answer | File | Notes |
| --- | --- | --- |
| `FIRSTMATE_BACKEND` | `config/backend` | Where workers run: tmux (upstream default), herdr, zellij, cmux, orca. |
| `FIRSTMATE_CREW_HARNESS` | `config/crew-harness` | The agent CLI workers use. |
| `FIRSTMATE_SECONDMATE_HARNESS` | `config/secondmate-harness` | `<harness> [model] [effort]` for second mates. Defaults to `claude claude-opus-5-5 medium` with the `capable` dispatch profiles on Claude, otherwise `default` (no file, so they follow the harness's own default). |
| `FIRSTMATE_PERMISSION_MODE` | `config/claude-permission-mode` | `bypass` (upstream default) or `auto`, Claude Code's classifier-reviewed mode. |
| `FIRSTMATE_BACKLOG` | `config/backlog-backend` | Only written for `manual`; tasks-axi is the default. |
| `FIRSTMATE_DISPATCH` | `config/crew-dispatch.json` | A starting example to change. `capable` (default, after [model-map.md](model-map.md)): Opus 5.5 at medium effort for most work, Opus 5.5 at xhigh for a new user-facing frontend look that is not yet settled, Opus 5.5 at high for polish of a settled look (spacing, copy, states, small layout fixes), Opus 5.5 at high for investigations, diagnosis and plans (re-run at xhigh when the result is weak or the cause is hard to find), Opus 5.5 at high for research (it plans and checks, and hands bulk fetching to agy, reading and summaries to the reader subagent, and drafting to Sonnet 5.5 at high), and Sonnet 5.5 at high for small, clear tasks (a bug with a clear repro, a docs edit, a version bump, a config tweak), re-run on Opus 5.5 at medium after a failed check. It has no Fable rule: name Fable in a task when you want it. `starter`: the strongest model for builds, more effort for planning, a light default. |
| `FIRSTMATE_HERDR_SPACES` | `config/herdr-presentation-spaces` | With herdr: `off` keeps every task in the flat layout instead of its own disposable workspace. |
| `FIRSTMATE_MEMORY_BUDGET` | `config/startup-memory-budget` | Estimated tokens allowed for preferences and learnings loaded at session start (upstream default 7500). |
| `FIRSTMATE_WATCH_UPDATES` | `config/watched-tools.json` | Firstmate announces new releases of itself, quota-axi and lavish-axi. |
| `FIRSTMATE_STOW_REMINDER` | `.claude/settings.local.json` in the clone and in each second-mate home | On by default. Once the session's context passes `FIRSTMATE_STOW_REMINDER_TOKENS`, its next prompt carries one reminder to run `/stow` (save its state) before anything else; it fires again only after the context drops back below 90% of that. The default `auto` reminds at seven eighths of that home's auto-compact window (175000 for a 200000 window, 350000 for 400000), so a home that compacts earlier is reminded earlier. Workers start in their own worktrees and get the claude-code module's general reminder instead. It reuses that module's context-reminder hook script. |

The preferences module adds two more with the `firstmate` target. `config/brief-include.md`,
which Firstmate appends to every worker brief (its docs/configuration.md, "Home brief
include"), carries the standing worker rules that apply: the plain-English house style with
`PREFS_WRITING_STYLE=ste`, the helper-model rule, the build rules, the principle checker to run
before reporting done (`PREFS_PRINCIPLE_CHECKS`), and the Everywhere and Workers lines of your
private rules file. `data/captain-shared.md` gets that file's Everywhere and Second mates lines,
only when there are any ([Your private rules](working-preferences.md#your-private-rules)).

Each file is written only when it differs, and a changed file is never replaced without asking.

## Second mates

A second mate is a Firstmate of its own, in its own home, that owns one domain (a product, a
client, a line of work) and supervises that domain's workers. The main Firstmate routes work to
it and hears back only through the second mate's parent channel, so nothing it reports depends
on anyone reading its chat. The working pattern:

- One persistent home per domain, created by Firstmate itself with `bin/fm-home-seed.sh` and
  listed in the main home's `data/secondmates.md`. Nothing in this repository creates homes.
- Idle by default: a second mate wakes when work is routed to it, finishes, reports up, and
  goes quiet again.
- Configuration flows down from the main home (`bin/fm-config-push.sh`); preferences you want
  everywhere go in the main home's `data/captain-shared.md`, which the preferences module writes
  from your private rules file.
- Each home gets its own `FM_HOME` pin. The module reads the registry on every run and pins
  every local second-mate home it finds, so re-run it after adding one:
  `./install.sh --modules firstmate`.

## Updating

Firstmate updates itself from its clone (its `updatefirstmate` skill, or `git pull` in the
clone while no fleet is running). This repository's `update.sh` updates only this template.
