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
| `pull` | Fetches each repo and fast-forwards it when it is on its default branch, clean and strictly behind. Dirty, diverged or off-branch repos are reported. | force, stash, reset, merge commit, rebase |
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

When something changed, something new needs you, or anything failed, the same report is
piped to your `notify` command (for example Firstmate's inbox: `fm-inbox.sh note -`). Drift
that was already reported is listed as `(still)` and sent again only every `remindDays`.

A report starts with `FAILED` when a step failed, when the previous run never finished, or
when no run succeeded for `staleHours` (26 by default, so a machine that was off or a timer
that stopped is noticed at the next run). The run then exits non-zero. The optional Claude
Code session-start check, `daily-sync.mjs --status`, prints one `FAILED` line in that case
and when no run has happened for a day at all, and nothing otherwise. The first run that
passes after a FAILED one sends a short `recovered` note, so the failure does not look ongoing.

## Scheduling

| System | How | A missed run |
| --- | --- | --- |
| Linux, WSL with systemd | `~/.config/systemd/user/daily-sync.timer`, `Persistent=true` | runs at the next login (or boot, with `loginctl enable-linger`) |
| Linux or WSL without systemd | a crontab line marked `# ai-workstation-setup daily-sync` (in WSL, cron itself must be started: [docs/windows-wsl.md](windows-wsl.md#systemd-and-the-cron-fallback)) | reported as FAILED by the next run |
| macOS | `~/Library/LaunchAgents/local.ai-workstation-setup.daily-sync.plist` | runs on wake; after power-off, reported by the next run |
| Windows | the installer prints the `schtasks` command to add it | reported by the next run |

## Pausing and removing it

- Pause: create an empty file named `off` next to `config.json`; delete it to resume.
- systemd: `systemctl --user disable --now daily-sync.timer`
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
      "recorded": { "file": "~/second-brain/topics/Design system.md", "pattern": "Design System v(\\d+(?:\\.\\d+)*)" },
      "actual": { "dir": "~/design-systems", "pattern": "^v(\\d+(?:\\.\\d+)*)" },
      "evidence": "~/design-systems/CHANGELOG.md"
    }
  ],
  "clickup": { "workspace": "<workspace id>", "space": "<space name or id>", "lists": ["<list id>", "<list id>"] },
  "ticktick": { "command": "ticktick-cli project list --json", "authCommand": "ticktick-cli auth status", "lists": ["Work", "Personal"] }
}
```

- `vault.dryRun` must print one line starting `would ingest`, `would update` or `would retry`
  per pending file; the ingest the second-brain module installs does. The vault gets
  `RAW_DIR` from `rawDir`, so the schedule never depends on your shell profile.
- `vault.run` is the command run in the vault when files are pending, with `{limit}` replaced
  by `vault.limit`. The installer asks for it (`DAILY_SYNC_VAULT_RUN`) and defaults to the
  second-brain module's `node bin/ingest.mjs --limit {limit}`, which every vault made by this
  template has. A vault that ships its own daily script can use it instead, for example
  `bin/daily --limit {limit}`; only answer that when the vault has the script. Keep `{limit}`
  in the command, or the limit does not apply. The report counts the lines the command prints
  that start `ingesting:` or `ingest (` (for the model-call count) or `<name> failed on:` (for failed files), so
  a daily script should pass the ingest's own output through.
- `vault.limit` is the most raw files a run processes (`DAILY_SYNC_INGEST_LIMIT`, 50 by
  default). Each file is an agent run; the rest wait for the next day. The whole run is
  stopped after `vault.timeoutMin` minutes (120 by default).
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
