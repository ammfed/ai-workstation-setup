# Ledger: one running record and a live Now page

The `ledger` module (opt-in; Linux, macOS, WSL) keeps one append-only record of what you say
and decide and of the status of the work under way, captured the moment it happens, and a
`now.md` page rebuilt from it within about a second. No fact depends on an agent remembering
to copy it somewhere, and every reader (you, your coordinating agent, a voice assistant)
reads the same version of now.

It is one plain Node script with no dependencies, `ledger.mjs`, and one `config.json`, both
in `~/.config/ai-workstation-setup/ledger/`, run as a small always-on user service
(`workstation-ledger.service` under systemd, a launchd agent on macOS). Windows is skipped:
the records it reads come from Firstmate, which runs on Linux, macOS or WSL.

## What it captures

| Source | Read from | Entry |
| --- | --- | --- |
| Status lines | every configured Firstmate home's `state/<task>.status` | one per line: `task`, `state` (`done`, `needs-decision`, `paused`, ...), `key`, and `project` from `state/<task>.meta`; kind `status`, or `decision` for a `resolved` line |
| Inbox notes | each home's `state/inbox/` and `state/inbox/handled/` (`fm-inbox.sh note`) | one per note, with `via` (text or voice); kind `message` |
| Your messages | the Claude Code transcripts of each home's sessions (`~/.claude/projects/<folder>/*.jsonl`) | what you typed, exactly; source `owner`, kind `message` |
| Agent replies | the same transcripts | the agent's final reply of each turn (capped at `replyChars`); source `agent`. In a second mate's home only replies to your own words are kept |
| Anything else | `ledger add` | whatever another tool appends |

Homes are the main home you name, the second mates listed in its `data/secondmates.md`
(each one's `state/<name>.meta` names its home), and any extra homes. No Claude Code
setting changes: the transcripts are only read.

Transcripts carry a lot that is not you. Dropped: Firstmate's own injected turns (lines
starting with `FIRSTMATE_OP` or U+2063), "Firstmate instruction waiting" doorbells, Stop hook
feedback, task notifications, `<system-reminder>` blocks, tool calls and results, local
command output, interruptions, skill bodies and compaction summaries. A slash command keeps
its arguments (`/name args`); a bare one is dropped.

## The ledger

`ledger.jsonl` in the data folder (default `~/.local/share/ai-workstation-setup/ledger/`,
folder mode 700, files 600). One JSON object per line:

```json
{"id":"3f9c2a7d1b4e6a08","time":"2026-01-05T09:00:00.000Z","source":"status","home":"main",
 "project":"demo-app","task":"blue-task","kind":"status","state":"working",
 "text":"building the blue header","ref":"/path/to/state/blue-task.status:12","replaces":null}
```

- `kind` is one of `message`, `status`, `decision`, `task`, `fact`, set mechanically from
  the source. `replaces` is always null for now: a later pass that classifies what you said
  fills it in, with no change to the format.
- `text` is the exact text with credentials redacted (common token shapes, `password=...`
  and friends, plus your own patterns in `config.json` `redact`).
- `ref` points back to the source: a status file and line, a transcript and message id, a
  note file.
- `approx: true` marks a time that is only the file's modification time (a status line read
  during a backfill or after the service was down; status lines carry no time of their own).

Each source keeps a cursor in `cursors.json` (byte offset per file, seen ids per inbox), and
every captured entry has an id derived from its place in its source, so a restart never
skips or duplicates, even after a crash between writing entries and saving cursors. A line
without its newline yet waits for the next read. Appends take a short lock and go in one
write, so `ledger add` from other tools and the service never interleave.

## The Now page

`now.md` next to the ledger, rebuilt within about a second of any change to a status line,
a task record (`state/*.meta`), a backlog, an inbox note, a transcript or the ledger itself
(a watch on each folder it reads, plus a rescan every `rescanSeconds` for events the kernel drops). It is
rewritten only when its content changed, so its modification time means something.

- **Waiting on you**: open backlog items held for you (`(hold-kind: captain)` in each home's
  `data/backlog.md`) with their question, and `needs-decision` lines no `resolved` line has
  closed yet. Parked holds (see the board below for the rule) are listed on one line with why.
- **In flight**: every task with a live record, its project, the worker's working copy
  (`worktree=`), and what it is doing from its last status line; second mates below.
- **Latest from you and rulings**: your messages, inbox notes and `resolved` lines, newest
  first.
- **Latest status per task**, newest first.

## The live board (optional)

The same picture as a web page, live: turn it on with `LEDGER_BOARD=yes` (or `"board":
{"enabled": true}` in `config.json`) and the ledger service serves it at
`http://127.0.0.1:4391/`, on this machine only. It is read only: it never answers, steers or
writes anything.

- **Top strip**: *Needs you now* (captain holds you can answer now), *Working now* (tasks whose
  agent is working this second) and *Landed today* (backlog items done, merged or reported
  today).
- **Parked**: holds that wait on other work, on a date, or that nobody raised again for
  `holdAgeDays` (14) days, each with why.
- **One lane per mate**, the main home first, then each second mate with its own dot and last
  status. A card per task: its name from the backlog (never a terminal title), project, a dot
  (working, idle, stopped: no agent runs for it), the last status line and how long ago.
  Stopped cards fold under one line. Clicking a card, or a second mate's name, opens its
  timeline from the ledger.

*Needs you now* and *Parked* use Firstmate's own rule for `/bearings` (`hold_bucket` in
`bin/fm-fleet-snapshot.sh`), from structured fields only: a captain hold is parked when any
`blocked-by` item is not done, else while its `hold-until` date is after today, else when an
undated hold was set `holdAgeDays` or more ago; otherwise it needs you now. So the two agree on
the same backlog. The Now page's "Waiting on you" uses the same rule and also lists questions a
worker raised that are not yet a hold.

Voice mode's lookout reads the same `/api/board` while a conversation runs, to say when
something new needs you or a worker stopped or failed ([voice mode](voice-mode.md#the-lookout-speaking-up-on-its-own)).

The page polls `/api/board` every `pollSeconds` (2.5): `generated_at`, `counts`, `lanes`,
`rows` (the cards), `needs`, `parked`, `landed`. `/api/timeline?home=H&task=T` gives one
task's entries. The live dots come from `herdr agent list` (`board.agents` sets another
command, `false` turns it off; without it every dot shows unknown). The server answers GET only
and only for the host names 127.0.0.1 and localhost.

Your own look: `board.theme` names a CSS file served after the default styles, so it can
override any of the `--` variables at the top of `board.html` (colours, fonts, radius) or add
rules; files next to it (fonts, images) are served under `theme/`. Keep it outside this clone.

```json
"board": { "enabled": true, "port": 4391, "theme": "~/.config/my-look/board.css", "pollSeconds": 2.5 }
```

## Commands

```sh
ledger check                      # exit 0 only when the service runs and the Now page is fresh
ledger now                        # print now.md (--rebuild rebuilds it from the records first)
ledger tail -n 20                 # the last entries (--json, --kind decision)
ledger add --source voice --kind fact "The demo moved to Friday"   # "-" reads stdin
ledger scan --dry-run             # what a capture pass would record, writing nothing
ledger board                      # the board on its own when no service serves it (--json: one snapshot)
```

`ledger` is a small wrapper in `~/.local/bin`; without it run
`node ~/.config/ai-workstation-setup/ledger/ledger.mjs <command>`.

## The task sync

An optional piece of the module (`LEDGER_SYNC=yes`) keeps one record of each linked work item
the same across your trackers, so they stop drifting apart: the home records (each home's
`data/backlog.md`, the truth), TickTick, ClickUp and your notes vault. A change on any side
flows to the others. It is `sync.mjs` next to `ledger.mjs` (it shares the ledger's backlog
reader), run as its own service, `workstation-sync.service` (a launchd agent on macOS), with a
`task-sync` command. The ledger itself stays read-only.

Only linked items sync, each linked on purpose:

| Place | How an item is linked | Fields | Read and written with |
| --- | --- | --- | --- |
| Home | the truth; a row's id is the link key (`<home>/<task id>`), so a title change keeps it | title, status, due date, notes | its backlog file to read; `tasks-axi` to write |
| TickTick | pair a home with a list in `config.json`: a new open item on either side gets its twin (an open row and an open task with the same title are linked, not duplicated) | title, status, due date, notes | the official TickTick CLI, `ticktick-cli` |
| ClickUp | `task-sync link <home>/<task id> clickup <task id>`; a new home row never creates a ClickUp task | status, due date | the ClickUp v2 API with your token |
| Vault | the note says so: `task: <home>/<task id>` in the frontmatter of a `type: project` note under `projects/` | `task-status: open\|active\|done` | the note's frontmatter, under the vault's run lock |

**Status** is a bucket: open (Queued), active (In flight), done. TickTick has only open and
done; a ClickUp status maps by its list's table (its done and closed types are done). Only
done moves a home row by itself (`tasks-axi done`, or `reopen` when it comes back): a move to
active elsewhere starts no work, it becomes a note in that home's inbox and its firstmate decides.

**Notes** sync two-way between a home row and TickTick. The sync owns only one part of a row's
body, its `## Notes` section; every other line is copied unchanged, and each write archives the
old body (`tasks-axi update --body-file --archive-body`), so an overwrite can be undone. The due
date is a line of its own inside that section:

```markdown
## Notes
Call before ten.
due: 2026-03-10
```

**A clash.** The sync keeps, per place, the last value it synced for each field. One place
changed a field: that place wins, whenever it happened. Several changed it to different values:
the newest dated edit wins when the edits are more than `skewSeconds` (120) apart. Within that
window, or when one side has only a day and not a time, the clash is a card for you. A done
signal for a row held for you (a captain hold) is always a card: only your own answer closes one.

| Place | Its edit time |
| --- | --- |
| Home | when the sync first saw the change (the backlog file's time) |
| TickTick | `modifiedTime`; for done, `completedTime` |
| ClickUp | `date_updated`; for done, `date_done`, then `date_closed` |
| Vault | the note's last commit |

Remote times are corrected by the server clock (ClickUp's `Date` header, TickTick's own
`modifiedTime` on a write).

**Cards** go once into the home's inbox (`fm-inbox.sh note`) and stay listed in `task-sync cards`
until they close: make both sides agree, or answer with `task-sync pick <card> <place>`, `task-sync
map <list> "<status>" open|active|done` (a new ClickUp status, remembered from then on), or
`task-sync unlink`. Things that are always a card: a clash inside the window, a linked item
deleted or archived in one place while its home row is open, an abandoned TickTick task, and a
ClickUp status nobody mapped yet.

**When it runs.** The service starts a pass within `debounceMs` (2 s) of a backlog change (a
watch, plus a rescan every `rescanSeconds`) and every `pollSeconds` (120) for the other places,
which have no push. The daily sync's `sync` check runs a full pass and reports one line:

```
sync 07:30: 4 fixed (3 TickTick→home, 1 home→ClickUp), 1 for you, 0 failed
```

A place that cannot be read (signed out, offline) changes nothing and counts as failed; an item
it could not read is never taken as deleted.

### Its config

`~/.config/ai-workstation-setup/sync/config.json` (written once, then yours), with `links.json`,
`state.json` (cards and your status answers) and `journal.jsonl` next to it. Every id below is a
placeholder; yours stay in this file only.

```json
{
  "timeZone": "",
  "skewSeconds": 120,
  "pollSeconds": 120,
  "tasksAxi": "tasks-axi",
  "inbox": "~/firstmate/bin/fm-inbox.sh",
  "homes": [
    { "name": "main", "path": "~/firstmate", "ticktick": "<TickTick list id>" },
    { "name": "<home>", "path": "~/<home folder>", "ticktick": "" }
  ],
  "ticktick": { "command": "ticktick-cli" },
  "clickup": {
    "tokenFile": "~/<file holding your ClickUp token>",
    "notifyHome": "~/<the home that drafts ClickUp updates>",
    "lists": [
      { "id": "<ClickUp list id>", "statuses": { "<status>": "active" }, "write": { "done": "<status>" } }
    ]
  },
  "vault": { "path": "~/<vault>", "folder": "projects", "write": true, "lockHelper": "bin/lib-lock.sh", "lint": "bin/lint" }
}
```

- `timeZone` (empty: this machine's) turns a due day into a time for TickTick and ClickUp.
- TickTick list ids: `ticktick-cli project list --json`. Sign in once with `ticktick-cli auth
  login` (`ticktick-cli auth token <token>` without a browser).
- ClickUp: the token comes from `CLICKUP_TOKEN`, else `tokenFile`. List only the lists whose
  tasks are work items; leave out lists whose statuses are rulings (such as findings). Names
  and descriptions never sync. After each status or due-date change the sync leaves a note in
  `notifyHome`'s inbox, so the stakeholder update can be drafted for your OK. `statuses` maps
  a list's custom statuses to buckets; `write` names the status to set per bucket (by default:
  the list's first done-type status, its open status, its first active one).
- Vault: only `task-status` changes, in notes with `type: project` and `task:`; a board card
  note (with `board_list`) keeps its `board_state` and is only read. Each write takes the
  vault's run lock (`lockHelper`'s `acquire_run_lock`), runs `lint` on the note, and commits
  only that file; a note with uncommitted changes is left alone. `"write": false` reads it only.

```sh
task-sync run --dry-run           # what a pass would change, writing nothing (start here)
task-sync run                     # one pass
task-sync check                   # a full pass, then the one line (--verbose: each change)
task-sync cards                   # what waits on you
task-sync pick main/<id>:status ticktick
task-sync link main/<id> clickup <task id>
```

The TickTick CLI is installed by the module through npm. Both it and the unofficial
`ticktick-cli` npm package install a command named `ticktick`; when that one is there, the
official CLI goes into its own folder and only `ticktick-cli` is linked into `~/.local/bin`,
so nothing that calls `ticktick` changes.

## Privacy

The ledger holds your own words, so it lives only in your data folder, readable by you
alone, never in a repo. The ledger service only reads homes, transcripts and backlogs; it never
writes into a Firstmate home, a project or a vault. The task sync, when you turn it on, writes
only what is described above, and keeps its links and journal in its own config folder.
