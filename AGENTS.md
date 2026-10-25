# AGENTS.md - ai-workstation-setup

A public, cross-platform installer template. `install.sh` (Linux, macOS, WSL) and
`install.ps1` (Windows) only make sure Node.js 20+ is there, then hand off to
`lib/installer.mjs`, which uses Node built-ins only (no `npm install`).

## Running the installer as an agent

- Never run it interactively without a terminal. Use `--yes --answers <file>`, starting from `answers.example.env`. Unknown keys are reported.
- When you install for a person (not develop this repo), follow `docs/install-with-ai.md`.
- Always run `--dry-run` first.
- `--platform linux|macos|wsl|windows` simulates another OS, only with `--dry-run`. Use it to test every platform's plan on one machine.
- Secrets come only from environment variables (`CLICKUP_TOKEN`, `CONTEXT7_API_KEY`, `OPENROUTER_API_KEY`) or a hidden paste on the last screen at a terminal (`ctx.keyAtEnd`), never from answers files.
- Exit status: 0 ok, 1 a step failed (see the summary), 2 usage or config error.
- Without `--answers`, the installer reads `answers.env` (gitignored). A real run saves it back merged: earlier answers kept, new questions added, keys no question uses dropped.
- To update a person's clone, follow "For agents" in `docs/updating.md`. Never force, reset, stash, merge, rebase, delete or move their files or commits, and never edit or commit `answers.env`.

## Tracked and private

- Tracked files are the shared template. A person's own material is gitignored (`answers.env`, `local/`, secrets; see `.gitignore`).
- Everything the installer writes lives outside the clone. `ctx.normalize` refuses a `path` answer inside it.
- Never make a module write into the repo or read personal data from a tracked file.

## Module contract

- Each `modules/<name>/module.mjs` default-exports `{ name, title, description, order, group, summary, platforms, unsupported?, requires?, default?, questions?, install(ctx) }`. `loadModules` in `lib/installer.mjs` validates it.
- `group` and `summary` (a short plain phrase, no flags or jargon) make the plan printed before anything installs (`lib/plan.mjs`). `default: true` puts the module in the recommended picks.
- `platforms` lists the supported OSes. `unsupported[os]` is the reason printed when the module is skipped.
- Questions are asked up front. `type` is text, confirm, choice, multi or secret. `when(ctx)` sets a condition, and `useDefault(ctx)` takes the saved answer or the default without asking.
- When the person goes ahead with the plan, every question takes its default. Mark a question that has no recommended answer `alwaysAsk`.
- Never just delete a `multi` choice, because a saved answer naming it would exit 2. List it in the question's `retired: { old: 'replacement' }`.
- `install(ctx)` makes every side effect through `lib/context.mjs`, so dry run, idempotency and backups hold: `ctx.ensureTool`, `ctx.run`, `ctx.pkgInstall`, `ctx.npmGlobal`, `ctx.writeFile`, `ctx.updateJson`, `ctx.setUserEnv`, `ctx.addUserPath`. Claude Code settings, hooks and skills go through `lib/claude.mjs`.
- Wrap each unit in `ctx.step`, so one failure does not stop the module. Throw `Skip` for a reasoned skip. Use `ctx.todo` for anything the user must do by hand.
- Where a tool can prove it works offline without signing in, give its `ensureTool` spec a `check` (see `checkTool` in `lib/context.mjs`). It runs on every run, so a broken tool on PATH fails its step.
- To add a module, copy a small one (`modules/skills`). Take install commands from the tool's official docs; never vendor binaries or copy upstream source.
- A new module also adds its keys to `answers.example.env`, its row to `README.md`, and its WSL side to `WSL_SIDES` in `lib/wsl.mjs` and to `docs/windows-wsl.md`. Then run the checks below.
- Anything under `templates/` is content the installer writes onto the user's machine, not code this repo runs.
- `ctx.template` replaces the `{{UPPER_CASE}}` placeholders it has a value for and leaves every other one untouched. That is how a shipped file keeps placeholders of its own for run time (`templates/second-brain/prompts/ingest.md`).
- Template scripts (`templates/*/bin/*.mjs`) must still pass `node --check`. They run on the user's machine, so keep them free of dependencies and cross-platform.

## Checks

```sh
shellcheck install.sh update.sh scripts/*.sh templates/*/*.sh
for f in lib/*.mjs modules/*/*.mjs scripts/*.mjs templates/*/bin/*.mjs; do node --check "$f"; done
node --test test/update.test.mjs test/update-check.test.mjs test/answers.test.mjs test/tools.test.mjs test/privacy.test.mjs test/daily-sync.test.mjs test/voice-mode.test.mjs test/ledger.test.mjs test/sync.test.mjs test/windows.test.mjs test/news-digest.test.mjs test/refresh.test.mjs test/second-brain.test.mjs test/optional-pieces.test.mjs test/preferences.test.mjs test/models.test.mjs test/wsl.test.mjs test/apply-to-machine.test.mjs test/principles.test.mjs test/prompt.test.mjs test/plan.test.mjs test/signin.test.mjs test/password.test.mjs test/progress.test.mjs test/allset.test.mjs test/start-scripts.test.mjs
for os in linux macos wsl windows; do node lib/installer.mjs --dry-run --yes --modules all --answers answers.example.env --platform "$os"; done
scripts/privacy-scan.sh --denylist <local denylist>
```

- CI (`.github/workflows/`) runs these, plus real dry runs on Ubuntu, macOS and Windows and a real Linux install inside WSL on a Windows runner.

## Privacy (this repo is public)

- Commit no secrets, tokens, emails, personal data, project or client names, workspace or list ids, or anyone's notes or preferences. Use placeholders and prompts.
- Run `scripts/privacy-scan.sh` over the tree and history before every push. Any hit blocks the push.
- The denylist file is local and gitignored; never commit its terms. Deliberate public exceptions live in `scripts/privacy-allow.txt`.
- Commit with a GitHub noreply identity. The scan checks every commit's author and committer.

## Maintaining this file

- Keep only knowledge useful to almost every future agent session in this project.
- Do not repeat what the codebase already shows. Point to the authoritative file or command instead.
- Prefer rewriting or pruning existing entries over appending new ones, and keep entries concise.
