# The second brain scheme

What the `second-brain` module installs, and why it is shaped this way. The vault it
creates carries its own `AGENTS.md`, which is the contract agents actually read. This
page is the reasoning behind that contract.

## Two kinds of folder, no numbering

**Life-area folders** hold topic notes, one folder per area of life. The installer asks
for the list and defaults to one example set. They are folders you are meant to rename:
the names are not the idea.

**Entity folders** hold one fixed note type each, and ship empty:

| Folder | Holds |
| --- | --- |
| `people/` | one note per person |
| `projects/` | one note per initiative, carrying `stage: idea|active|on-hold|done` |
| `decisions/` | one note per decision made |
| `meetings/` | one note per meeting, filename starting `YYYY-MM-DD` |
| `journal/` | one note per day |
| `reviews/` | periodic reviews |
| `sources/` | one note per raw file ingested |
| `preferences/` | optional: one preference note per project (`type: preference`) |

The portable idea is not the folder list. It is that a note's **kind** is fixed by the
folder it sits in, while its **life area** rides on the note as a `pillar:` list. A note
can belong to two areas at once, and no folder owns it. That is why there is no numbering
scheme: numbers encode a hierarchy that stops being true about a year in.

## The note contract

Every note opens with `title`, `type`, `status`, `pillar` (a list), `lang`, `created` and
`updated`. Projects add `stage`. Source notes add `source`, `ingested`, `sha256` and
`filetype`. The full vocabulary is in the vault's own `AGENTS.md`.

A contract that is only documented is a contract that drifts, so `bin/check.mjs` enforces
it: required fields, allowed values, the fixed type of each entity folder, dated filenames
where the folder expects them, and that every `[[wikilink]]` resolves to a note that
exists. It prints one line per problem and exits non-zero. A note with broken frontmatter
is invisible to every filtered read of the vault, which is the silent failure this catches.

## Raw files live outside the vault

This is the part worth copying.

Source documents stay in `$RAW_DIR`, outside the vault. They are never copied in and never
modified. A `sources/` note records the exact filename and the sha256, and the facts drawn
from the file are written into the topic and entity notes they belong to. The vault is a
layer of notes over an archive it does not own.

Two useful properties fall out of that. Delete the vault and the archive is untouched. Lose
the archive and the notes still say what was in it and when.

`bin/ingest.mjs` drives it: hash each file in `$RAW_DIR`, skip anything already in
`.ingest/ledger.tsv`, and hand the rest to an agent one at a time with the prompt in
`prompts/ingest.md`. The ledger row is `sha256`, filename, date, status, path. A file whose
hash is already ledgered under another name is a duplicate and costs no agent run. A file
whose path was ledgered but now hashes differently is a revision: its existing source note
is updated in place. An agent that has not finished one file after `--timeout` minutes (30 by
default) is stopped, that file is ledgered as failed with one `agent failed on:` line, and the
run goes on. `--deadline` (Unix seconds, or `$INGEST_DEADLINE`) stops the run in time: no file
starts after it, and a file it cuts off is not ledgered, so the next run takes it again. The
ledger is created by the first run. It ships absent, because it is
operational state rather than structure.

The agent is whatever `$AGENT_CLI` names, with `$AGENT_CLI_ARGS` for its flags. The vault
does not depend on a particular CLI, and nothing in it runs a local model for understanding,
summarizing or writing. Plain extraction that recovers text from a file without interpreting
it is fine as a step before the agent run.

## Provenance, and never overwriting

Every fact carries its origin inline: `(from [[<source note>]], <date>)`, or
`(captured by <who>, <date>)` when it came from a conversation.

A fact that contradicts an existing line never overwrites it. The old line is struck through
with both the date it was stated and the date it was superseded, and the new fact is added
below with its own provenance. Naming both dates, rather than just writing "superseded",
keeps a note's history unambiguous when it is read out of order. A vault that silently
overwrites cannot be audited, and a knowledge base you cannot audit is one you end up not
trusting.

The vault also states a small writing rule: no em dashes in new prose. Conventions like that
belong in the contract file where both people and agents will see them.

## What is open

`decisions/`, `journal/` and `reviews/` are the durable "what is open" surface. An
unresolved question belongs in one of them, where the next reader meets it. `decisions/`
holds what was settled and why. The newest `journal/` note holds today's carried-over state
and is transient by design. `reviews/` is where the sweep happens on a schedule and where a
project's `stage:` changes on purpose rather than by drift.

## Navigable without an index

There is no search index and no embeddings. Two files make the vault readable anyway:
`START-HERE.md`, written for a person arriving cold, and `MAP.md`, generated by
`bin/index.mjs` from every note's frontmatter plus its first line of prose. One line per
note, grouped by folder. `MAP.md` answers "what exists", `rg` answers "where is it".

`bin/housekeeping.mjs` is the unattended pass: run the checker and print one line. It is
check-only and never writes `MAP.md` or any other file, so it never leaves the vault dirty for
a job that needs it clean; `bin/index.mjs` stays the one writer of the map. A project with no
stage yet is a warning; any other contract problem makes it exit non-zero. Point a systemd user
timer, launchd agent, Task Scheduler entry or cron job at it every few hours. It makes no network
calls and needs no credentials, which is what makes it safe to leave running. It deliberately
does not ingest: reading new raw material costs money and deserves a person nearby.

A search index, a knowledge graph or embeddings would all be plausible additions. None of
them exist here, and nothing in the vault depends on one.

## Optional tools

Picked with `VAULT_TOOLS` (all off by default), each a single Node script in `bin/`:

- `search`: ranked full-text search (BM25, title words weighted up), run as `bin/search terms`
  (`node bin/search terms` on Windows). The extensionless `bin/search` runs `bin/search.mjs`,
  which holds the code. It reads the notes on every run and keeps nothing, so there is still no
  index. `bin/search` is the one search tool name the vault rule, the worker brief and the vault
  `AGENTS.md` use. A vault that already has its own `bin/search` keeps it: the installer never
  replaces a file a vault already has.
- `capture.mjs`: one provenance-tagged line into today's journal, a named note (`--to`), or a
  new note (`--type`, `--title`, `--area`). The note must pass `bin/check.mjs` or the capture is
  undone; in a git vault only that note and `MAP.md` are committed.
- `bookmarks.mjs`: a browser bookmark export (the HTML every browser writes) as markdown, one
  heading per folder, ready to drop in `$RAW_DIR` for ingestion.
- `garden.mjs` with `prompts/garden.md`: one small tidy-up of a few notes, round-robin over the
  vault, by the agent CLI you name in `$AGENT_CLI` (no default provider, no keys of its own).
  It needs a git vault, skips a slice you have uncommitted edits in, puts back anything the
  agent changed outside the slice (stray new files go to a removed-files folder outside the
  vault, never deleted), discards the pass if the notes fail the checker, and commits a good
  pass on its own.

`VAULT_TIMERS` can also schedule `housekeeping` (every 3 hours) and `garden` (every 6 hours,
with the agent command from `VAULT_AGENT_CMD`) as systemd user timers on Linux and WSL (a
crontab line when no systemd user session runs) or launchd agents on macOS; on Windows it leaves a to-do for Task Scheduler. The
housekeeping timer runs a copy of the script (with `check.mjs` and `lib-vault.mjs`) kept in
`~/.config/ai-workstation-setup/second-brain/`, outside the vault, so a reinstall updates what it
runs without writing into the vault. The agent CLI must
already be signed in on its own: the timer passes only the command and its flags.

## An existing vault

When the vault folder is already a git repository with at least one commit, the module
leaves out the starter files: the folder readmes, the note templates, the vault scripts and
the optional tools. They would show up as untracked files in a vault that has its own
tooling, and a job that needs a clean vault (the daily sync's ingest) would then skip its
run. The skipped steps say so in the install output. Everything else still runs: the
contract files that are missing, the git step, the timers, the agent access and the Claude
Code rules file.

To add the missing starter files anyway, answer `VAULT_REFRESH=yes`. Files that already
exist are still never replaced.

## Telling Claude Code about the vault

With `VAULT_AGENT_ACCESS` (on by default), the module also writes
`~/.claude/rules/second-brain.md`, a Claude Code user rules file loaded in every session, with
your vault path filled in. It is about eight short lines: the vault exists and is private, look
there first for past decisions and history, find a note by its folder and file name, `rg` or
`bin/search`, trust the newest dated line and follow `status: superseded`, check open items
against the live tracker, do not edit notes by hand (with the `bin/capture.mjs` line when that
tool is installed), and what may leave the machine (see below). It names only the scripts and
tools you installed.

Earlier versions also installed a `second-brain` skill with the same read routes. Sessions
never called it, so the rules file now carries its lines and the skill is retired. On a rerun,
`~/.claude/skills/second-brain/SKILL.md` is removed when it is a copy this setup shipped (a
backup, `SKILL.md.bak-<time>`, stays next to it). A copy you edited is left in place, and the
install summary lists a to-do to delete it by hand.

By default the rule says vault content never goes to an outside model or service. Answer
`VAULT_OUTSIDE_MODELS=yes` (default `no`) if you have removed sensitive content from your notes
and raw files and want agents to send them to an outside model through an agent CLI you chose.
The rule then says so. It also says that files agent workspaces write and export (reports,
progress notes, memory archives, your answers) count as raw files and may go too, and that
private chats themselves never go to an outside model or service. The question is only asked when
`VAULT_AGENT_ACCESS` is on.

On a rerun, a copy of the rules file that an earlier version of this setup shipped is replaced
with the new wording, and the old one is backed up. Like every other file the installer writes,
a copy you have edited is left alone.

The preferences module's worker brief (Firstmate's `brief-include.md`) carries one matching
vault line with the same search tool. The session rules file `working-preferences.md` no longer
repeats it, since this rules file is loaded in the same sessions.
