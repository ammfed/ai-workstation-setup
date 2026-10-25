Read the file at `{{FILE}}` and write what it contains into this vault at `{{VAULT}}`.

Read `AGENTS.md` first. It is the contract, and everything below assumes it.

Mode for this run: **{{MODE}}** (`new` = this file has not been read before, `revision` = a
file already ingested has changed and its existing source note must be updated in place).

## Never

- Do not modify, move, rename or delete `{{FILE}}`, or anything else outside this vault.
- Do not copy the file's contents into the vault verbatim. Write notes about it.
- Do not put any credential, token, API key or password into a note, whatever the file holds.
- Do not use em dashes in anything you write.

## Write, in this order

1. **A source note** at `sources/{{FILENAME}}.md`, from `templates/source.md`, carrying
   `source: {{FILENAME}}`, `sha256: {{SHA256}}`, `ingested: {{DATE}}`, and the right
   `filetype`. Its body is a short summary of what the file is, plus links to the notes below.
   In `revision` mode, update the existing source note instead: bump `updated` and `sha256`,
   add a `## Revision {{DATE}}` section, and re-derive the facts under the contradiction rule.

2. **The notes the facts belong in.** A fact about a person goes in that person's note under
   `people/`, a fact about an initiative under `projects/`, a decision under `decisions/`, a
   meeting under `meetings/`, and anything else in a topic note in the life-area folder it
   belongs to. Create a note from the matching template in `templates/` when it does not exist
   yet, and add to it when it does.

3. **Nothing else.** No summary of the run, no index file, no task list.

## How every fact is written

One claim per line, each ending in where it came from:
`<the fact> (from [[{{FILENAME}}]], {{DATE}})`.

If a new fact contradicts a line that is already there, do not overwrite it. Strike the old
line with both dates and add the new one below it:

```markdown
~~<old fact> (stated <its date>)~~ superseded {{DATE}} by the line below.
<new fact> (from [[{{FILENAME}}]], {{DATE}})
```

Link generously with `[[wikilinks]]`, and only to notes that exist or that you create in this
same run: `bin/check.mjs` fails on a link that resolves to nothing.

## Before you finish

Run `node bin/check.mjs` and fix anything it reports. A run that leaves the vault failing its
own contract is a failed run.

## How this job runs

`bin/ingest.mjs` runs you once per new file, then records the file in `.ingest/ledger.tsv`:

- A file whose sha256 is already in the ledger under another name is a duplicate. It is
  ledgered `duplicate-of:<original>` without a second agent run.
- A file whose path was ledgered before but now hashes differently is a revision: you update
  the existing `sources/` note in place (mode `revision`), and the row is ledgered `updated`.
- A file you do not finish within `--timeout` is ledgered `failed` and the run goes on;
  `--retry-failed` takes it again.
- With `--deadline` (or `$INGEST_DEADLINE`, which the daily sync sets) no file starts after that
  time, and a file cut off by it is left for the next run.
