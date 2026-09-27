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
  closed yet. Holds you parked are listed on one line.
- **In flight**: every task with a live record, its project, the worker's working copy
  (`worktree=`), and what it is doing from its last status line; second mates below.
- **Latest from you and rulings**: your messages, inbox notes and `resolved` lines, newest
  first.
- **Latest status per task**, newest first.

## Commands

```sh
ledger check                      # exit 0 only when the service runs and the Now page is fresh
ledger now                        # print now.md (--rebuild rebuilds it from the records first)
ledger tail -n 20                 # the last entries (--json, --kind decision)
ledger add --source voice --kind fact "The demo moved to Friday"   # "-" reads stdin
ledger scan --dry-run             # what a capture pass would record, writing nothing
```

`ledger` is a small wrapper in `~/.local/bin`; without it run
`node ~/.config/ai-workstation-setup/ledger/ledger.mjs <command>`.

## Privacy

The ledger holds your own words, so it lives only in your data folder, readable by you
alone, never in a repo. The service only reads homes, transcripts and backlogs; it never
writes into a Firstmate home, a project or a vault.
