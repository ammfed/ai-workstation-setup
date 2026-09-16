# AGENTS.md - ai-workstation-setup

A public, cross-platform installer template. `install.sh` (Linux, macOS, WSL) and
`install.ps1` (Windows) only ensure Node.js 20+ and hand off to
`lib/installer.mjs`, which uses Node built-ins only (no `npm install`).

## Running it as an agent

- Never run it interactively without a terminal: use `--yes --answers <file>`
  (start from `answers.example.env`). Unknown keys are reported.
- Always `--dry-run` first. `--platform linux|macos|wsl|windows` simulates another
  OS, only with `--dry-run`; that is how every platform's plan is tested on one machine.
- Secrets come only from environment variables (`CLICKUP_TOKEN`, `CONTEXT7_API_KEY`)
  or hidden prompts, never answers files.
- Exit status: 0 ok, 1 a step failed (see the summary), 2 usage or config error.

## Module contract

Each `modules/<name>/module.mjs` default-exports `{ name, title, description, order,
platforms, unsupported?, requires?, default?, questions?, install(ctx) }`;
`lib/installer.mjs` `loadModules` validates it. `platforms` lists supported OSes;
`unsupported[os]` is the reason printed when skipped. Questions are asked up front
(`type`: text, confirm, choice, multi, secret; `when(ctx)` for conditions).

`install(ctx)` must go through `lib/context.mjs` for every side effect, so dry-run,
idempotency and backups hold: `ctx.ensureTool`, `ctx.run`, `ctx.pkgInstall`,
`ctx.npmGlobal`, `ctx.writeFile`, `ctx.updateJson`, `ctx.setUserEnv`, and
`lib/claude.mjs` for Claude Code settings, hooks and skills. Wrap each unit in
`ctx.step` so one failure does not stop the module; throw `Skip` for a reasoned skip;
use `ctx.todo` for anything the user must do by hand.

To add a module: copy a small one (`modules/skills`), take install commands from the
tool's official docs (never vendor binaries or copy upstream source), add its keys to
`answers.example.env`, its row to `README.md`, then run the checks below.

Anything under `templates/` is content the installer writes onto the user's machine, not
code this repo runs. `ctx.template` replaces `{{UPPER_CASE}}` placeholders it has a value
for and leaves every other one untouched, which is how a shipped file can keep placeholders
of its own that are filled in later at run time (`templates/second-brain/prompts/ingest.md`).
Template-shipped scripts (`templates/*/bin/*.mjs`) still have to pass `node --check`. They
run on the user's machine, not here, so keep them free of dependencies and cross-platform.

## Checks

```sh
shellcheck install.sh scripts/*.sh
for f in lib/*.mjs modules/*/*.mjs templates/*/bin/*.mjs; do node --check "$f"; done
for os in linux macos wsl windows; do node lib/installer.mjs --dry-run --yes --modules all --answers answers.example.env --platform "$os"; done
scripts/privacy-scan.sh --denylist <local denylist>
```

CI (`.github/workflows/`) runs these plus real dry runs on Ubuntu, macOS and Windows.

## Privacy rules (this repo is public)

- Commit no secrets, tokens, emails, personal data, project or client names,
  workspace or list ids, or anyone's notes or preferences. Use placeholders and prompts.
- Run `scripts/privacy-scan.sh` over the tree and history before every push; any hit
  blocks the push. The denylist file is local and gitignored; never commit its terms.
  Deliberate public exceptions live in `scripts/privacy-allow.txt`.
- Commit with a GitHub noreply identity.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
