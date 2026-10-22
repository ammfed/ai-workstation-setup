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
journey map and an aligned rules list. At capture it sets the review stakes once per
project: public repositories and anything stakeholders see get the full review run,
private notes and throwaway prototypes get a self-review. Its phase table splits these six steps into the
ten phases, with the early phases (requirements, whether it already exists, vision)
before anything is built, and says which phases each kind of work needs. Its
`principles/checks.md` lists the design and writing checks (attention, time, words,
layout, colour, charts, AI) that every screen and page meets, who runs each one and what
a failure blocks. `node principles/bin/principle-check.mjs <files or folder>` runs the
script rows on `.html`, `.md` and `.txt` files and exits 1 on a failure; add `--phone`
for anything built for other people. The rows a reviewer can judge from the code (button
wording, labels, empty states, chart types, AI flags) also run in the Ship step: the
agent-clis module adds them to no-mistakes' review rules (`NO_MISTAKES_PRINCIPLES`).

| Step | What happens | Skill |
| --- | --- | --- |
| 1. Plan | Write the idea down, judge whether it fits and when, and say so in one line. If the effort takes more than one session, the agent starts a map at once and shows the goal, the stages, where the work is and the next step. | wayfinder |
| 2. Decide | Ask the questions that settle the open decisions, one round at a time, each with a recommendation. Record the answers, the new terms and any hard-to-reverse decision. | grilling, with domain-modeling for `GLOSSARY.md` and `docs/adr/` |
| 3. Prototype | Write a short spec that names the seams the tests will hold. When the look or the flow needs judging, build a throwaway prototype. Nothing is built for real before the spec is approved. | to-spec, prototype (with wayfinder) |
| 4. Breakdown | Cut a spec too big for one change into tickets, each with what blocks it. Skip this when one change can hold the spec. | to-tickets |
| 5. Build | One builder takes the whole spec and builds it test-first at the seams the spec names. | tdd, codebase-design |
| 6. Ship | Validate the change, open a pull request, and merge it once you approve. | no-mistakes |

## Short paths

- **A small, clear change**: Plan, Build, Ship.
- **A bug**: Plan, find the cause, then Build with the reproduction as the regression test, then Ship.
- **A foggy effort over several sessions**: at Plan, the agent starts the map without being
  asked and shows it. Type /wayfinder to track the map as tickets. The map replaces Decide
  until the way forward is clear.

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
