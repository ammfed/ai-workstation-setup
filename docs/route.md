# A route for software projects

Six steps take a software idea from a first mention to a merged change. Each step has a
skill that does most of the work. The skills come from the `skills` module, which
installs all of them by default.

The route is for building or changing an app, a tool or a codebase. Documents, review
pages, research and one-off tasks do not need it.

For a long project of any kind (research, concepts, review pages and a build, over many
sessions), the workflow-playbook skill provides the working method. It covers ten
phases from an idea to shipped and improved, stage gates, a map that always shows the
next step, evidence and research at every stage, four review points with checks that run
before any page reaches you, when to ask or act, an improve step after every merge, and
the steps for taking a weak prototype to a liked wireframe direction, an approved
journey map and an aligned rules list. The kun skill supervises every phase: `/kun` loads once
per session at the start of real work, each phase start and gate is checked against it,
and the skills module installs kun whenever it installs the playbook. At capture it sets the review stakes once per
project: public repositories and anything stakeholders see get the full review run,
private notes and throwaway prototypes get a self-review. While a review page waits for
your answer, the agent stands by quietly and does not prepare the next stage, unless you
chose that with `PREFS_PAGE_PREPARE_NEXT`. Its phase table splits these six steps into ten
phases: capture, requirements, whether it already exists, vision, prototype, breakdown,
build, review, ship and hand over, and improve. The early phases (requirements, whether
it already exists, vision) run before anything is built, and the table says which phases
each kind of work needs. Its
`principles/checks.md` lists the design and writing checks (attention, time, words,
layout, colour, charts, AI) that every screen and page meets, who runs each one and what
a failure blocks. `node principles/bin/principle-check.mjs <files or folder>` runs the
script rows on `.html`, `.md` and `.txt` files and exits 1 on a failure; add `--phone`
for anything built for other people. The rows a reviewer can judge from the code (button
wording, labels, empty states, chart types, AI flags) also run in the Ship step: the
agent-clis module adds them to no-mistakes' review rules (`NO_MISTAKES_PRINCIPLES`).

The playbook's phase table (in `templates/skills/workflow-playbook/SKILL.md`) says what happens
at each step and which phases each kind of work needs. The skill for each step:

1. **Plan**: wayfinder (you start it).
2. **Decide**: grilling, with domain-modeling for `GLOSSARY.md` and `docs/adr/`.
3. **Prototype**: to-spec (you start it), prototype, wayfinder (you start it).
4. **Breakdown**: to-tickets (you start it).
5. **Build**: tdd, codebase-design.
6. **Ship**: no-mistakes.

wayfinder, to-spec and to-tickets start only when you type `/wayfinder`, `/to-spec` or
`/to-tickets`. Until then the agent does that step itself with the same output (the map,
the spec, tickets with blockers) and offers the command in one line.

## Short paths

- **A small, clear change**: Plan, Build, Ship.
- **A bug**: Plan, find the cause with diagnosing-bugs, then Build with the reproduction as the
  regression test, then Ship.
- **A foggy effort over several sessions**: at Plan, the agent starts the map without being
  asked and shows it. Type /wayfinder to track the map as tickets. The map replaces Decide
  until the way forward is clear.

## The engineering skill pack

Most route skills come from [mattpocock/skills](https://github.com/mattpocock/skills).
Install them with the `skills` module, one skill at a time, not with the pack's Claude Code
plugin: the plugin adds every skill at once, so the same skill loads twice and the extra
skills start on their own. Never turn a plugin on inside another tool's own clone, because
that changes a file the tool tracks.

The pack's handoff skill is not needed beside stow (see the next section).

Pack skills this setup leaves out, and what would bring each one back:

| Skill | Comes back when |
| --- | --- |
| code-review | A repository has no validation pipeline (no-mistakes reviews every change) |
| implement, implement-spec | A spec is built outside a fleet tool that starts workers |
| triage | Other people start filing issues |
| ask-matt | Never: the playbook and kun say which skill to use |
| improve-codebase-architecture | A refactor starts that needs a survey of the code |
| wizard | A setup step needs you to enter credentials by hand more than once |
| setup-ts-deep-modules | A TypeScript repository with several packages |
| software-factory (unfinished) | You design an agent factory beyond your fleet tool |

The pack's setup skill (`setup-matt-pocock-skills`) writes an issue tracker file and a
domain file into a repository. Run it only in a repository that has a tracker in use,
agents working in it, and code the engineering skills apply to.

## Stow, retro and backpass

Three tools improve how agents work, each at a different point.

- **stow** saves what the current conversation learned (preferences, facts, decisions, next
  steps) into the files where it belongs. Run `/stow` before a compaction or a long break.
- **retro** looks back at a coding session you name and suggests changes to the agent's
  environment: signposts to files, automated checks, coding standards, the size of `AGENTS.md`,
  expensive tool use, instructions that change nothing, and missing information. Only you can
  start it, by typing `/retro`. It reads writing-for-agents first, which the skills module
  installs with it. Run it after a session that went badly or slowly.
- **backpass** is the optional, privacy-gated tool in the `backpass` module. It reads past
  sessions of the projects on your allowlist and proposes evidence-backed edits to `AGENTS.md`,
  `CLAUDE.md` and project skills. It never applies them. Use it for a pattern across many sessions.

They hand off in this order. stow saves the lessons while the session is fresh. retro turns one
session's trouble into changes to the environment, which you approve. backpass finds what repeats
across many sessions and leaves its proposals for you to review with `backpass apply`.

## Build rules that go with it

The `preferences` module offers these as optional rules (see
[working preferences](working-preferences.md#building)):

- `PREFS_ROUTE`: follow this route for software projects, each step with its skill.
- `PREFS_TEST_FIRST`: build product code test-first at the seams the spec names.
  Prototypes, docs and config are not test-first.
- `PREFS_GLOSSARY_ADR`: read `GLOSSARY.md` and `docs/adr/` before building, and add new
  terms and decision records with the change that introduces them. Start the files only
  when a term or a hard-to-reverse decision comes up.
- `PREFS_PROTOTYPE_CHECK`: before you see a prototype, the agent opens it at your target
  screen size first, then at laptop width, and at phone width (390 px) when `PREFS_PAGE_PHONE`
  is yes. It checks that font sizes and column positions stay the same on every tab, and fixes
  broken layout, unclear labels and dead ends.
