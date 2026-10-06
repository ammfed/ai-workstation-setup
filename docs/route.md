# A route for software projects

Six steps take a software idea from a first mention to a merged change. Each step has a
skill that does most of the work. The skills come from the `skills` module; the ones
marked optional are choices you add to `SKILLS`.

The route is for building or changing an app, a tool or a codebase. Documents, review
pages, research and one-off tasks do not need it.

| Step | What happens | Skill |
| --- | --- | --- |
| 1. Plan | Write the idea down, judge whether it fits and when, and say so in one line. For an effort too big for one session, map the open decisions instead. | wayfinder (optional) |
| 2. Decide | Ask the questions that settle the open decisions, one round at a time, each with a recommendation. Record the answers, the new terms and any hard-to-reverse decision. | grilling, or grill-with-docs (optional) to write `GLOSSARY.md` and `docs/adr/` as you go |
| 3. Prototype | Write a short spec that names the seams the tests will hold. When the look or the flow needs judging, build a throwaway prototype. Nothing is built for real before the spec is approved. | to-spec (optional), prototype (with wayfinder) |
| 4. Breakdown | Cut a spec too big for one change into tickets, each with what blocks it. Skip this when one change can hold the spec. | to-tickets (optional) |
| 5. Build | One builder takes the whole spec and builds it test-first at the seams the spec names. | tdd, codebase-design |
| 6. Ship | Validate the change, open a pull request, and merge it once you approve. | no-mistakes (optional) |

## Short paths

- **A small, clear change**: Plan, Build, Ship.
- **A bug**: Plan, find the cause, then Build with the reproduction as the regression test, then Ship.
- **A foggy effort over several sessions**: start wayfinder at Plan. Its map replaces Decide
  until the way is clear.

## Build rules that go with it

The `preferences` module offers these as optional rules (see
[working preferences](working-preferences.md#building)):

- `PREFS_ROUTE`: follow this route for software projects, each step with its skill.
- `PREFS_TEST_FIRST`: build product code test-first at the seams the spec names.
  Prototypes, docs and config are not test-first.
- `PREFS_GLOSSARY_ADR`: read `GLOSSARY.md` and `docs/adr/` before building, and add new
  terms and decision records with the change that introduces them. Start the files only
  when a term or a hard-to-reverse decision comes up.
- `PREFS_PROTOTYPE_CHECK`: before you see a prototype, the agent opens it at laptop width
  and at phone width (390 px) and fixes broken layout, unclear labels and dead ends.
