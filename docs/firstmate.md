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
| `FIRSTMATE_SECONDMATE_HARNESS` | `config/secondmate-harness` | `<harness> [model] [effort]` for second mates, for example `claude claude-opus-5-5 medium`. |
| `FIRSTMATE_PERMISSION_MODE` | `config/claude-permission-mode` | `bypass` (upstream default) or `auto`, Claude Code's classifier-reviewed mode. |
| `FIRSTMATE_BACKLOG` | `config/backlog-backend` | Only written for `manual`; tasks-axi is the default. |
| `FIRSTMATE_DISPATCH` | `config/crew-dispatch.json` | `starter`: the strongest model for builds, more effort for planning, a light default. `capable`: the most capable model at medium effort for most work, with user-facing frontend design on the model strongest at design and small, clear tasks (a bug with a clear repro, a docs edit, a version bump, a config tweak) on Sonnet at xhigh effort. |
| `FIRSTMATE_HERDR_SPACES` | `config/herdr-presentation-spaces` | With herdr: `off` keeps every task in the flat layout instead of its own disposable workspace. |
| `FIRSTMATE_MEMORY_BUDGET` | `config/startup-memory-budget` | Estimated tokens allowed for preferences and learnings loaded at session start (upstream default 7500). |
| `FIRSTMATE_WATCH_UPDATES` | `config/watched-tools.json` | Firstmate announces new releases of itself, quota-axi and lavish-axi. |
| `FIRSTMATE_STOW_REMINDER` | `.claude/settings.local.json` in the clone | On by default. Once the main session's context passes `FIRSTMATE_STOW_REMINDER_TOKENS` (default 350000), its next prompt carries one reminder to run `/stow` (save its state) before anything else; it fires again only after the context drops back below 90% of that. Workers and second mates start in their own folders, so they never see it. It reuses the claude-code module's context-reminder hook script. |

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
  everywhere go in the main home's `data/captain-shared.md`.
- Each home gets its own `FM_HOME` pin. The module reads the registry on every run and pins
  every local second-mate home it finds, so re-run it after adding one:
  `./install.sh --modules firstmate`.

## Updating

Firstmate updates itself from its clone (its `updatefirstmate` skill, or `git pull` in the
clone while no fleet is running). This repository's `update.sh` updates only this template.
