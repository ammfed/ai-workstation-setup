# AGENTS.md - second brain vault

Plain markdown, Obsidian-openable, no numbering scheme. People and agents both write here,
and this file is the contract that keeps it legible to both. Keep it current: when a
convention changes, change it here in the same edit.

## Layout

Two kinds of folder hold notes.

**Life-area folders** hold `type: topic` notes, one folder per area of life. This vault was
set up with:

{{PILLAR_BULLETS}}

That set is **an example, not a prescription**. It is one way to split a life; rename these
folders, add one, or drop one so they fit yours, and update the `pillar:` vocabulary below in
the same edit. The portable idea is not the names: it is that a note's life area rides on the
note as a `pillar:` tag, so a note can belong to two areas at once and no folder owns it.

**Entity folders** hold one fixed `type` each, so a note's kind is never ambiguous:

- `people/` - one note per person (`type: person`)
- `projects/` - one note per initiative (`type: project`, carries `stage: idea|active|on-hold|done`)
- `decisions/` - one note per decision made (`type: decision`)
- `meetings/` - one note per meeting, filename starts `YYYY-MM-DD ` (`type: meeting`)
- `journal/` - one note per day, filename `YYYY-MM-DD.md` (`type: daily`)
- `reviews/` - periodic review notes, filename starts `YYYY-MM-DD ` (`type: review`)
- `sources/` - one note per raw file ingested (`type: source`, plus the provenance keys below)

Everything else:

- `templates/` - one frontmatter and body template per note `type`, used by hand and by the
  ingesting agent
- `bin/index.mjs` - regenerates `MAP.md` from every note's frontmatter. Plain extraction, no model
- `bin/check.mjs` - the frontmatter and link checker. This is what makes the contract below real
  rather than merely documented
- `bin/ingest.mjs` - the ingestion driver. Hands one raw file at a time to your agent CLI
- `bin/housekeeping.mjs` - the unattended pass: check, then reindex. Meant for a timer
- `prompts/ingest.md` - the prompt `bin/ingest.mjs` feeds that agent
- `START-HERE.md`, `MAP.md` - the two hand-readable entry points. `MAP.md` is generated: one
  line per note, grouped by folder, so anyone can see everything that exists without a search
  index. Like a folder's own `README.md`, neither carries note frontmatter, and `bin/check.mjs`
  skips all three
- `.ingest/ledger.tsv` - `sha256<TAB>filename<TAB>date<TAB>status<TAB>path`, the record of what
  has been ingested. Created by the first `bin/ingest.mjs` run; it does not exist until then

Raw source files live **outside** this vault, under `$RAW_DIR` (this setup: `{{RAW_DIR}}`).
They are never copied in and never modified. Notes in `sources/` reference them by exact
filename only, so the vault stays a layer of notes over an archive it does not own.

## Note contract

Every note under a life-area folder or an entity folder, except a folder's own `README.md`,
MUST open with this frontmatter. See `templates/` for one file per type.

```yaml
title:    <string>
type:     source|topic|person|project|decision|meeting|daily|review
status:   draft|current|superseded|archived
pillar:   [{{PILLARS_INLINE}}]   # list, at least one value
lang:     {{LANGS}}
created:  YYYY-MM-DD
updated:  YYYY-MM-DD
```

A project note also carries `stage: idea|active|on-hold|done`. A `sources/` note also carries
`source` (the exact original filename), `ingested` (YYYY-MM-DD), `sha256`, and `filetype`
(`eml|md|xlsx|pdf|txt|html|other`, the *file* kind, distinct from the note `type` above).

A note's `type` must match the fixed type of its entity folder: everything under `people/` is
`type: person`, and so on. Update `updated:` on every edit.

`bin/check.mjs` enforces all of the above plus one more thing: that every `[[wikilink]]`
resolves to a note that exists. Run it over the whole vault, or over named files:

```sh
node bin/check.mjs             # whole vault
node bin/check.mjs people/*.md # just these, links still resolve vault-wide
```

It prints one line per problem and exits non-zero if there was one. A note with missing or
unparseable frontmatter is otherwise invisible to every filtered read of this vault, which is
exactly what this gate exists to catch.

## Provenance

Every fact added to a topic, person, project, decision or meeting note carries its origin
inline: `(from [[<source note>]], <date>)`, or `(captured by <who>, <date>)` when it came from
a conversation rather than a file.

A fact that contradicts an existing line **never overwrites it**. Strike the old line, stating
both dates, and add the new fact as its own provenance-tagged line below:

```markdown
~~The deadline is 14 March (stated 2026-01-08)~~ superseded 2026-02-19 by the line below.
The deadline is 4 April (from [[budget-revision.eml]], 2026-02-19).
```

Naming both the date the old fact was stated and the date it was superseded, rather than just
the word "superseded", keeps a note's history unambiguous when it is read out of order. A
vault that silently overwrites is a vault that cannot be audited.

## What is open

`decisions/`, `journal/` and `reviews/` are the durable "what is open" surface. An unresolved
question belongs in one of them, where the next reader will meet it, not in someone's head:

- `decisions/` holds what has been settled and why, so a closed question stays closed and a
  reopened one shows what changed.
- The most recent `journal/YYYY-MM-DD.md` holds today's carried-over state. It is transient by
  design: sweep it into real notes and let it go.
- `reviews/` is where the sweep happens on a schedule, per life area, and where a project's
  `stage:` gets changed on purpose rather than by drift.

Before starting work in this vault, read `decisions/` and the latest `journal/` note.

## Writing style

- **No em dashes in new prose.** Use a period, a comma, a colon, or a plain conjunction.
  Applies to what you and any agent write here going forward, not to quoted source material.
- Write the fact, not the story around it. One claim per line, each with its provenance.
- Prefer a link to a retelling: `[[note]]` instead of repeating what that note already says.

## How to search

There is no search index and no embeddings. Grep the vault directly:

```sh
rg -i "some topic" .
rg -l "source: some-file.eml" sources/
rg -l "type: project" projects/
```

`MAP.md` answers "what exists", `rg` answers "where is it". A search index, a knowledge graph
and embeddings are a plausible future extension of this vault, not part of it today. Nothing
here builds or depends on one.

## How to ingest raw files

Drop a file in `$RAW_DIR`, then:

```sh
node bin/ingest.mjs --dry-run      # list what would be ingested
node bin/ingest.mjs --limit 1      # ingest one file, for a quick check
node bin/ingest.mjs                # ingest everything not yet in the ledger
node bin/ingest.mjs --file "/path/to/one/file"
```

Each new file gets exactly one agent run, prompted from `prompts/ingest.md`, which writes a
`sources/` note and folds the facts into the topic and entity notes they belong to. Then the
file gets a ledger row. A file whose sha256 is already in the ledger under another name is a
duplicate and is ledgered `duplicate-of:<original>` without a second agent run. A file whose
path was ledgered before but now hashes differently is a revision: the agent updates the
existing `sources/` note in place and the row is ledgered `updated`.

The agent is whatever CLI `$AGENT_CLI` names, with `$AGENT_CLI_ARGS` for its flags. The vault
does not depend on any particular one. Nothing here runs a local model for understanding,
summarizing or writing: plain extraction tools that recover text from a file without
interpreting it are fine as a step ahead of the agent run.

## Housekeeping

`node bin/housekeeping.mjs` is the unattended pass: it runs `bin/check.mjs` over the vault and
regenerates `MAP.md`, printing one summary line and touching nothing else. It is safe to run
repeatedly and makes no network calls.

Point your scheduler at it (a systemd user timer, a launchd agent, Task Scheduler, or cron)
every few hours, or run it by hand after a batch of edits. Keeping it this boring is the point:
an unattended job that only validates and reindexes can be left running without supervision,
and needs no credentials of any kind.

## Rules

- **Raw files are never copied into the vault, and never modified.** `$RAW_DIR` is the archive,
  this vault is notes about it. The `sha256` in a `sources/` note is the only link that has to
  survive a rename.
- **No search or embedding index.** Agents read and grep the vault directly. A note that cannot
  be found with `rg` and `MAP.md` is a badly written note, not a missing index.
- **No local models** for understanding, summarizing or writing notes.
- **No credential ever enters the vault**: no secret, token, API key or password, in any folder.
  Use a real secret store.
- **Tasks never live in the vault.** The task tracker holds the queue. A project note names the
  next action and where it is tracked, and never mirrors the task list.
- **Nothing is silently deleted or overwritten.** A merged note becomes a one-line
  `status: superseded` redirect to the note that replaced it. A wrong fact gets struck, not
  removed.
