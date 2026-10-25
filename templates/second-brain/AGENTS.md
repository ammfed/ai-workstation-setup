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

- `templates/` - one frontmatter and body template per note `type`, for people and agents
- `bin/index.mjs` - regenerates `MAP.md` from every note's frontmatter. Plain extraction, no model
- `bin/check.mjs` - the frontmatter and link checker that makes the contract below real
- `bin/ingest.mjs` - the ingestion driver. Hands one raw file at a time to your agent CLI
- `bin/housekeeping.mjs` - the unattended pass: check, then reindex. Meant for a timer
- `prompts/ingest.md` - the prompt `bin/ingest.mjs` feeds that agent
- Optional tools, present only when they were picked at setup:
  - `bin/search.mjs` - ranked full-text search (BM25) that reads the notes on every run, no index
  - `bin/capture.mjs` - adds one provenance-tagged line to today's journal, a named note, or a
    new note, runs `bin/check.mjs` on it, and commits only that note and `MAP.md`
  - `bin/garden.mjs` and `prompts/garden.md` - one small tidy-up of a few notes by your agent CLI
  - `bin/bookmarks.mjs` - turns a browser bookmark export into markdown to drop in `$RAW_DIR`
- `START-HERE.md`, `MAP.md` - the two hand-readable entry points. `MAP.md` is generated: one
  line per note, grouped by folder, so anyone can see everything that exists without a search
  index. Like a folder's own `README.md`, neither carries note frontmatter, and `bin/check.mjs`
  skips all three
- `.ingest/ledger.tsv` - `sha256<TAB>filename<TAB>date<TAB>status<TAB>path`, what has been
  ingested. The first `bin/ingest.mjs` run creates it

Raw source files live **outside** this vault, under `$RAW_DIR` (this setup: `{{RAW_DIR}}`).
Notes in `sources/` reference them by exact filename only, so the vault stays a layer of notes
over an archive it does not own (see Rules).

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

`bin/check.mjs` enforces all of the above, and that every `[[wikilink]]` resolves to a note that
exists. Run it over the whole vault, or over named files:

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

A fact that contradicts an existing line is never overwritten (see Rules). Strike the old line,
stating both dates, and add the new fact as its own provenance-tagged line below:

```markdown
~~The deadline is 14 March (stated 2026-01-08)~~ superseded 2026-02-19 by the line below.
The deadline is 4 April (from [[budget-revision.eml]], 2026-02-19).
```

Naming both the date the old fact was stated and the date it was superseded, rather than just
the word "superseded", keeps a note's history unambiguous when it is read out of order. A
vault that silently overwrites is a vault that cannot be audited.

## What is open

`decisions/`, `journal/` and `reviews/` are the durable "what is open" surface. An unresolved
question belongs in one of them, where the next reader meets it, not in someone's head:

- `decisions/` holds what has been settled and why, so a closed question stays closed and a
  reopened one shows what changed.
- The most recent `journal/YYYY-MM-DD.md` holds today's carried-over state. It is transient by
  design: sweep it into real notes and let it go.
- `reviews/` is where the sweep happens on a schedule, per life area, and where a project's
  `stage:` gets changed on purpose rather than by drift.

Before changing notes, read the latest `journal/` note and the decisions `MAP.md` lists for the
topic at hand.

## Writing style

- **No em dashes in new prose.** Use a period, a comma, a colon, or a plain conjunction.
  Applies to what you and any agent write here going forward, not to quoted source material.
- Write the fact, not the story around it. One claim per line, each with its provenance.
- Prefer a link to a retelling: `[[note]]` instead of repeating what that note already says.

## How to search

There is no search index and no embeddings. `MAP.md` answers "what exists", `rg` answers
"where is it":

```sh
rg -i "some topic" .
rg -l "source: some-file.eml" sources/
rg -l "type: project" projects/
```

When `bin/search.mjs` is installed, `node bin/search.mjs some topic` ranks the notes that match
best, title matches first; it reads the notes on every run and keeps nothing. A search index, a
knowledge graph and embeddings are a plausible future extension, not part of it today (see Rules).

## How to ingest raw files

Drop a file in `$RAW_DIR`, then:

```sh
node bin/ingest.mjs --dry-run      # list what would be ingested
node bin/ingest.mjs --limit 1      # ingest one file, for a quick check
node bin/ingest.mjs                # ingest everything not yet in the ledger
node bin/ingest.mjs --file "/path/to/one/file"
node bin/ingest.mjs --timeout 30   # stop the agent on one file after 30 minutes (the default)
```

Each new file gets exactly one agent run from `prompts/ingest.md`, then a ledger row. That
prompt also says how a run treats duplicates, revisions, timeouts and the deadline. The agent is
the CLI `$AGENT_CLI` names, with `$AGENT_CLI_ARGS`; the vault needs no particular one and runs no
local model (see Rules).

## Housekeeping

`node bin/housekeeping.mjs` runs `bin/check.mjs` over the vault and regenerates `MAP.md`. It
prints one summary line, touches nothing else, makes no network calls and needs no credentials,
so a scheduler (a systemd user timer, a launchd agent, Task Scheduler, or cron) can run it every
few hours without supervision. Run it by hand after a batch of edits too.

## Garden

`node bin/garden.mjs` (when installed) has the agent CLI named by `$AGENT_CLI` make a few notes
clearer without changing any fact. `prompts/garden.md` is its prompt and says how a pass runs
and what it undoes.

## Rules

- **Raw files are never copied into the vault, and never modified.** `$RAW_DIR` is the archive,
  this vault is notes about it. The `sha256` in a `sources/` note is the only link that has to
  survive a rename.
- **No search or embedding index.** Agents read and grep the vault directly. A note that cannot
  be found with `rg` and `MAP.md` is a badly written note, not a missing index.
- **No local models** for understanding, summarizing or writing notes. Plain extraction tools
  that recover text from a file without interpreting it are fine as a step ahead of the agent
  run.
- **No credential ever enters the vault**: no secret, token, API key or password, in any folder.
  Use a real secret store.
- **Tasks never live in the vault.** The task tracker holds the queue. A project note names the
  next action and where it is tracked, and never mirrors the task list.
- **Nothing is silently deleted or overwritten.** A merged note becomes a one-line
  `status: superseded` redirect to the note that replaced it. A wrong fact gets struck, not
  removed.
