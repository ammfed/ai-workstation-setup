# Start here

This is a plain-markdown, Obsidian-openable second brain. No numbering scheme, no database,
no search index: every note is a file you can read, and two files tell you what is here.

- **`MAP.md`** lists every note in the vault, one line each, grouped by folder. It is generated
  by `bin/index.mjs`, so it is never edited by hand. Read it to find a note, then `rg` for what
  is inside it.
- **`AGENTS.md`** is the contract: the frontmatter every note carries, how provenance is
  recorded, and the rules this vault is kept under. Read it before writing anything here.

## Folders

Life-area folders hold topic notes, one folder per area of life:

{{PILLAR_BULLETS}}

**Those names are an example, not a prescription.** They are one way to split a life. Rename
them, add one, drop one, so they match yours, then say so in `AGENTS.md`. What matters is not
the list: it is that each note carries its own `pillar:` tag, so a note can sit in two areas at
once without being duplicated or owned by a folder.

Entity folders hold one kind of note each, and start out empty:

- `people/` - one note per person.
- `projects/` - one note per initiative, carrying `stage: idea|active|on-hold|done`.
- `decisions/` - one note per decision made, with what was decided and why.
- `meetings/` - one note per meeting, filename starting `YYYY-MM-DD`.
- `journal/` - one note per day. Transient: capture here, then sweep into real notes.
- `reviews/` - weekly or monthly reviews, filename starting `YYYY-MM-DD`.
- `sources/` - one note per raw file ingested, the bridge to the original documents.

## What is open

`decisions/`, `journal/` and `reviews/` are where unresolved things live so they stay visible.
An open question in one of those folders gets met by the next person or agent who opens the
vault. The same question in your head does not. Start a working session by reading `decisions/`
and the newest note in `journal/`.

## Where the raw material lives

Outside the vault, in `$RAW_DIR` (this setup: `{{RAW_DIR}}`). Documents, exports and downloads
are never copied in and never modified. A `sources/` note records a file's exact filename and
sha256, and the facts drawn from it are written into the topic and entity notes they belong to,
each tagged with where it came from. Delete the whole vault and the archive is untouched. Lose
the archive and the notes still say what was in it, and when.

## Daily use

1. Drop new material into `$RAW_DIR`.
2. `node bin/ingest.mjs --dry-run`, then `node bin/ingest.mjs`, to have your agent CLI read each
   new file once and write it into the vault.
3. `node bin/check.mjs` to validate frontmatter and links, then `node bin/index.mjs` to
   regenerate `MAP.md`. `node bin/housekeeping.mjs` does both, and is the thing to put on a timer.
4. Capture anything that did not arrive as a file straight into `journal/YYYY-MM-DD.md`, and
   sweep it into a real note at your next review.

## Writing a note by hand

Copy the matching file out of `templates/`, fill in the frontmatter, and write facts one per
line, each ending in where it came from: `(from [[<source note>]], YYYY-MM-DD)` or
`(captured by <who>, YYYY-MM-DD)`. When a new fact contradicts an old one, strike the old line
with both dates instead of deleting it. No em dashes. `AGENTS.md` has the full conventions.

## Searching

```sh
rg -i "some topic" .                   # anything, anywhere
rg -l "source: report.pdf" sources/    # which note covers a given raw file
rg -l "type: project" projects/        # every project
```
