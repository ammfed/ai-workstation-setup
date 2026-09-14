# AGENTS.md - second brain vault

This is a plain-markdown Obsidian vault. People and agents both write here, and
this file is the contract that keeps it legible to both. Keep it current: when a
convention changes, change it here in the same edit.

## Reading and writing

- Use `obsidian-axi` (`obsidian-axi search <query>`, `obsidian-axi ls --recursive`,
  `obsidian-axi tags list`). It finds this vault through `OBSIDIAN_VAULT`.
- Link notes with `[[slug]]` wikilinks. A link to a note that does not exist yet is fine.

## Folders

Folders are note **types**, not life areas; the area lives in `pillar:`.

| Folder | Meaning |
| --- | --- |
| `00-inbox/` | Capture. Anything quick lands here and is triaged later. Exempt from the frontmatter contract. |
| `01-maps/` | Maps of content, hand-curated. |
| `02-templates/` | One template per `type:`, plus `capture.md` for the inbox. |
| `09-generated/` | Agent-written synthesis. Never hand-edited; safe to delete wholesale. |
| `10-pillars/` | One note per life area: {{PILLAR_FILES}}. The only numbered notes. |
| `11-people/` | People, one note per person, named by slug. |
| `12-orgs/` | Organizations, named by slug. |
| `20-notes/` | Atomic evergreen notes, densely linked. |
| `21-sources/` | Notes *about* external material (articles, books, talks). |
| `30-projects/` | Active, time-bound projects, named by slug. |
| `31-meetings/` | Meeting notes, named `YYYY-MM-DD-<slug>.md`. |
| `90-archive/` | Retired notes. |

## Naming

- Pillars carry their number in the filename (`10.01 <pillar>.md`) and a matching quoted `id:`.
- Everything else is named by slug: lowercase words joined by single hyphens.
- Dated streams (inbox, meetings) start with the date: `2026-01-31-kickoff.md`.

## Frontmatter contract

Required on every note outside `00-inbox/`:

```yaml
title:
type:            note | meeting | person | org | project | pillar | source | map
status:          inbox | processed | evergreen | archived
pillar:          []              # {{PILLARS}}
classification:  public | internal | confidential | restricted
lang:            {{LANGS}}
created:         YYYY-MM-DD
updated:         YYYY-MM-DD
tags:            []
```

Additions: pillars add `id:`; sources add `source:`; projects add `tracker:` (a
link to the task tracker); meetings add `date:`, `attendees: []`, `decisions: []`,
`actions: []` and keep the body sections **Summary / Decisions / Next steps / Details**.

`status:` separates a raw capture from a durable claim; update `updated:` on every edit.

## Rules

- **Tasks never live in the vault.** The task tracker holds the queue; a project
  note links to it through `tracker:` and never mirrors its task list.
- **`09-generated/` is agent-owned.** Anything an agent synthesizes goes there.
- **No credential ever enters the vault**: no secret, token, API key or password,
  in any folder. Use a real secret store.
- **Restricted material stays outside the vault.** `classification:` labels
  handling; `restricted/` folders are gitignored at any depth.
