---
name: second-brain
description: Read routes into your private knowledge vault at {{VAULT_PATH}}. Use when a task needs past decisions, project history or stage, people, meetings, earlier findings, or what was agreed before, or when asked what the vault says about something.
---

The vault at `{{VAULT_PATH}}` is plain Markdown. {{OUTSIDE_NOTE}}

{{SCRIPTS_NOTE}}## Find a note

{{FIND_ROUTES}}

## Read it right

- Folders: `projects/` one note per initiative (with `stage`), `people/`, `decisions/`,
  `meetings/` (`YYYY-MM-DD ` names), `journal/` one note per day, `reviews/`, `sources/` one
  note per ingested raw file, and one folder per life area ({{PILLARS}}) for topics.
- Each fact names its source: `(from [[source note]], date)` or `(captured by who, date)`.
  Prefer the newest dated line. A struck-through line was superseded by the line below it, and
  a note with `status: superseded` points to the note that replaced it.
- The vault only knows what has been ingested or captured. For today's state of live work,
  check the live tracker too.

## Add to it

{{ADD_ROUTES}}
