# Daily sync: one daily alignment pass

The `daily-sync` module (opt-in) schedules one job a day that keeps what you depend on
current and tells you only what changed or needs you. It is one plain Node script with no
dependencies, `daily-sync.mjs`, and one `config.json`, both in
`~/.config/ai-workstation-setup/daily-sync/`. There is no service or daemon: the system's own
scheduler starts it once a day.

## What a run does

Every step is plain scripting, in this order:

| Step | What it does | Never |
| --- | --- | --- |
| `pull` | Fetches each repo and fast-forwards it when it is on its default branch, clean and strictly behind. Dirty, diverged or off-branch repos are reported; a diverged one also says which files both sides change and whether `git merge-tree` finds a conflict, and names the merge command when it does not. | force, stash, reset, merge commit, rebase |
| `watch` | Repos another tool updates (for example a Firstmate clone): reported when their remote has moved on, with read-only probes. | fetch, pull or any other change |
| `vault` | Checks the raw folder exists and holds files, runs the vault's ingest in dry-run mode, and when there are new raw files runs the vault's command (the ingest, or its daily script) on at most `limit` of them a day (50 by default). A missing or empty raw folder is a failure, not "nothing new". | ingest into a vault with uncommitted changes (`requireClean`) |
| `commands` | Runs each command (such as Firstmate's tool-update check) and reports what it prints. The `sync` choice adds the ledger's task sync check (`sync.mjs check`), which fixes settled drift between linked items and prints one line ([task sync](ledger.md#the-task-sync)). | install anything |
| `versions` | Compares the version you have on record (a note, a lock file) with the folder or command that holds the thing itself. | change either side |
| `clickup` | Reads a space's active lists with `clickup-axi` and compares them with the lists you expect. | write to ClickUp |
| `ticktick` | Runs your read-only command that prints your TickTick lists as JSON (by default the official CLI: `ticktick-cli project list --json`) and compares them with the lists you expect. | write to TickTick |

A model is called only for a **new** drift item a step could not settle itself (a diverged
repo, an unexpected or missing list, a version mismatch): one short call per item, at most
`model.maxCalls` per run, and its answer is folded into the report. Drift already reported
is not asked about again, so a quiet day makes no model call. The vault ingest runs your
vault's own agent, one run per new raw file; those runs are counted too. Every report and
the log say how many model calls were made.

## Reports and failures

Each run writes `reports/<date>-<time>.md` and `reports/latest.md` (the last 30 are kept) and
appends to `daily-sync.log` (rotated at 512 KB). A quiet run's report is one line:

```text
daily-sync 2026-01-05 07:30: all quiet (6 check(s), no model calls)
```

With a `vault` step, the report ends with one line that counts the agent sessions of the last 7
days that made a tool call naming the vault, such as
`vault use: 18 of 451 agent sessions in the last 7 days`. It reads the local Claude session logs
(`~/.claude/projects`, or `vault.sessionLogs`), keeps only the two counts and copies nothing
from a session. With no logs it says so instead of printing zero.

When something changed, something new needs you, or anything failed, the same report is
piped to your `notify` command (for example Firstmate's inbox: `fm-inbox.sh note -`). Drift
that was already reported is listed as `(still)` and sent again only every `remindDays`.

A report starts with `FAILED` when a step failed or when the previous run never finished. The
run then exits non-zero. When no run succeeded for `staleHours` (26 by default, so a machine
that was off or a timer that stopped is noticed at the next run), the report lists that under
"Needs you" once. If this run's own steps pass, it still counts as a success. The optional
Claude Code session-start check, `daily-sync.mjs --status`, prints one `FAILED` line after a
failed run and when no run has happened for a day at all, and nothing otherwise. The first run that
passes after a FAILED one sends a short `recovered` note, so the failure does not look ongoing.

## Scheduling

| System | How | A missed run |
| --- | --- | --- |
| Linux, WSL with systemd | `~/.config/systemd/user/daily-sync.timer`, `Persistent=true`, plus `daily-sync-catchup.timer` at 09:30 | runs at the next login (or boot, with `loginctl enable-linger`) |
| Linux or WSL without systemd | crontab lines marked `# ai-workstation-setup daily-sync`, the second one at 09:30 (in WSL, cron itself must be started: [docs/windows-wsl.md](windows-wsl.md#systemd-and-the-cron-fallback)) | the 09:30 run covers it; else reported as FAILED by the next run |
| macOS | `~/Library/LaunchAgents/local.ai-workstation-setup.daily-sync.plist` | runs on wake; after power-off, reported by the next run |
| Windows | the installer prints the `schtasks` command to add it | reported by the next run |

The 09:30 catch-up (systemd and cron, when the daily time is earlier than 09:30) runs
`daily-sync.mjs --catch-up`: it does nothing when a run already succeeded that day, so it only
starts when the morning run failed or never happened. A run waits first, for at most
`networkWaitSec` (300 by default; `0` turns it off), until the host of each repo it pulls or
pushes resolves, because a run at boot can start before DNS works. After the wait it goes on and
the steps that need the network report their own failure.

## Pausing and removing it

- Pause: create an empty file named `off` next to `config.json`; delete it to resume.
- systemd: `systemctl --user disable --now daily-sync.timer daily-sync-catchup.timer`
- cron: remove the marked line with `crontab -e`
- macOS: `launchctl bootout gui/$(id -u)/local.ai-workstation-setup.daily-sync`
- The session-start check is the `daily-sync.mjs --status` entry under `hooks.SessionStart` in
  `~/.claude/settings.json`.

## config.json

The installer writes a starter from your answers and never replaces one you changed.
Paths may start with `~`.

```json
{
  "staleHours": 26,
  "keepReports": 30,
  "remindDays": 7,
  "notify": "~/firstmate/bin/fm-inbox.sh note -",
  "model": { "command": "claude -p --model haiku ...", "maxCalls": 3, "timeoutSec": 180 },
  "pull": ["~/dotfiles", { "path": "~/notes", "ignoreDirty": [".obsidian/"] }],
  "watch": ["~/firstmate"],
  "vault": {
    "path": "~/second-brain",
    "rawDir": "~/raw-sources",
    "dryRun": "node bin/ingest.mjs --dry-run",
    "run": "node bin/ingest.mjs --limit {limit}",
    "limit": 50,
    "requireClean": true,
    "ignoreDirty": [".obsidian/"],
    "timeoutMin": 120
  },
  "commands": [{ "name": "tool updates", "run": "bin/fm-tool-update-check.sh check", "cwd": "~/firstmate", "env": {}, "timeoutSec": 180 }],
  "versions": [
    {
      "name": "design system",
      "recorded": { "file": ["~/notes/Design system - web.md", "~/notes/Design system.md"], "pattern": "Design System v(\\d+(?:\\.\\d+)*)" },
      "actual": { "dir": "~/design-systems", "pattern": "^v(\\d+(?:\\.\\d+)*)" },
      "evidence": "~/design-systems/CHANGELOG.md"
    }
  ],
  "clickup": { "workspace": "<workspace id>", "space": "<space name or id>", "lists": ["<list id>", "<list id>"] },
  "ticktick": { "command": "ticktick-cli project list --json", "authCommand": "ticktick-cli auth status", "lists": ["Work", "Personal"] }
}
```

- A version source's `file` is one path, or a list of paths. With a list, the first path that
  exists is read and the report names that file, so a note that was split into smaller notes
  can be listed first with the old note as the fallback. When none exists, the check fails
  with a line that names every path tried.
- `vault.dryRun` must print one line starting `would ingest`, `would update` or `would retry`
  per pending file; the ingest the second-brain module installs does. The vault gets
  `RAW_DIR` from `rawDir`, so the schedule never depends on your shell profile.
- `vault.run` is the command run in the vault when files are pending, with `{limit}` replaced
  by `vault.limit`. The installer asks for it (`DAILY_SYNC_VAULT_RUN`) and defaults to the
  second-brain module's `node bin/ingest.mjs --limit {limit}`, which every vault made by this
  template has. A vault that ships its own daily script can use it instead, for example
  `bin/daily --limit {limit}`; only answer that when the vault has the script. Keep `{limit}`
  in the command, or the limit does not apply. The report counts the lines the command prints
  that start `ingesting:` or `ingest (` (for the model-call count), `<name> failed on:` or
  `ingest: FAILED <file>: <reason>` (for failed files, on stdout or stderr), so
  a daily script should pass the ingest's own output through.
- Each run also checks the vault read-only: a failing `bin/status` (a stuck run) or `bin/lint`
  (lint problems) puts one line in "Needs you". A vault without either script skips that check.
- When every ingest attempt of a run fails (no success, at least one attempt), the run is
  `FAILED` with one line, exits non-zero and does not count as a success. When only some fail,
  the line reads `ingested 3 of 5` and each failed file is listed under "Needs you".
- When the newest `.eml` file or the newest `bookmarks*.html` export in `vault.rawDir` is more
  than `vault.staleSourceDays` (14) days old, "Needs you" gets one line naming the source, its
  age and the action: export a fresh copy into that folder.
- `vault.limit` is the most raw files a run processes (`DAILY_SYNC_INGEST_LIMIT`, 50 by
  default). Each file is an agent run; the rest wait for the next day. The whole run is
  stopped after `vault.timeoutMin` minutes (120 by default), and the report then says how many
  files it got through and that the command's later steps (such as a commit or push) did not
  run. The command gets `INGEST_DEADLINE`, a Unix time a tenth of that limit (at most 10
  minutes) before it: the template's `bin/ingest.mjs` starts no file after it and leaves a file
  it cuts off for the next run, and the report then counts the files still waiting. A daily
  script that runs its own ingest should pass it on (`--deadline "$INGEST_DEADLINE"`).
- A version source is `{ "file" | "dir" | "command", "pattern" }`; the highest version the
  pattern's first group matches on each side is compared.
- `clickup.lists` can also point at a JSON file you already keep:
  `{ "file": "~/notes/board.json", "key": "lists" }` (an object or list of `{ "id", "name" }`).
- `clickup.workspace` is passed to clickup-axi as `CLICKUP_AXI_WORKSPACE`; set it when your
  token sees more than one workspace, since a scheduled run does not read your shell profile.
- `ticktick.authCommand`, when set, is run first. A non-zero exit, or output that says "not
  signed in", is reported as signed out. Output such as `expires 86400 seconds` is warned about
  two weeks ahead. The official CLI's `ticktick-cli auth status` prints `Not signed in` and exits
  0 when no token is stored; it prints no expiry.
- Network reads (git fetch and ls-remote, ClickUp, TickTick) get a second try
  `retryWaitSec` (20) seconds later before they count as failed.
- `notify` and `model.command` are shell commands that read the report or prompt on stdin.
  An empty `model.command` means no model is ever called.
