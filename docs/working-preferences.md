# Working preferences

The `preferences` module turns a set of questions into a plain Markdown rules file your
agents load on every session. The defaults describe one proven way of working with an
agent fleet; every one is a question, so change what does not suit you.

Where it writes (`PREFS_TARGETS`):

| Target | File | Loaded by |
| --- | --- | --- |
| `claude` | `~/.claude/rules/working-preferences.md` | Claude Code, as user rules in every project |
| `firstmate` | `data/captain.md` in your Firstmate home (`FIRSTMATE_HOME`, else the clone; the file firstmate reads for preferences) | Firstmate, at session start |

The file is yours: edit it freely. Re-running the installer asks before replacing a
changed file and keeps a timestamped backup.

## Questions and the rules they write

### Language and tone

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PLAIN_LANGUAGE` | yes | Plain, natural, friendly words; explain a thing before naming it; short replies. |
| `PREFS_NO_NARRATION` | yes | Give the result, not a commentary on the agent's own steps. |
| `PREFS_NO_EM_DASHES` | yes | No em dashes: periods, commas or plain conjunctions instead. |
| `PREFS_OUTWARD_AS_USER` | yes | Content for other people is written as you, with no agent or tooling labels, internal ids or tags. |
| `PREFS_NATURAL_TRANSLATION` | yes | Other languages are written the way a native speaker in that field would write them, never translated literally. |
| `PREFS_WRITING_PRINCIPLES` | yes | Writing for others leads with the point, backs claims with a reason or evidence and states uncertainty plainly; a deck or document starts from an agreed one-sentence point, then plain paragraphs, then visuals only where they are the evidence. |
| `PREFS_WRITING_STYLE` | `plain` | `ste` adds a plain-English house style for everything written to you, based on Simplified Technical English (ASD-STE100): one instruction per sentence with the condition first, active voice, short sentences and paragraphs, simple tenses, one word for one thing, verbs instead of noun phrases, no semicolons or em dashes, and warnings that state the risk first. Greetings, the reason behind a recommendation and short acknowledgements may relax it. Writing done as you for other people follows the outward rules instead. `plain` writes no extra rule. |
| `PREFS_ONE_DESIGN_SYSTEM` | no | With several design systems, the one matching the artifact type is used, never two mixed. |
| `PREFS_COPY_SECOND_OPINION` | no | Copywriting and translations get a refinement pass from a second AI model; only the text being refined is sent. |
| `PREFS_HABITS` | yes | Eight everyday habits: replies end with the next actions, yours first; "I'm lost" or "too long" gets the shortest plain answer; an opinion is a real one with its reason; status and questions stay on your current topic; "check X" is a question, not a go-ahead to widen the work; no menu of what to run next; a claim is unproven until something shows it, including the case that can fail; a record you call outdated is checked against reality before it is defended. The lines land in Language and tone, Ideas and priorities, and Safety. |
| `PREFS_CALM_WORD` | `calm` | Saying this word switches the agent to a calm mode: batched tool calls, no in-between updates, only the answer. Empty for none. |

### Reporting and status

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_STATUS` | `board` | Every status reply opens with one table whose three columns, TODO, DOING and DONE, sit side by side, then groups what is left by who acts: your block labelled YOU, the agent's labelled with its own role name (never ME). Small text bars and boxes only where they carry meaning. `actions` gives a very short list of action items, yours first, then a pointer to the full report; `brief` opens with a one-line answer, then brief action items. |
| `PREFS_HONEST_NUMBERS` | yes | Uncertain numbers are ranges or "not yet known"; charts are plain bars or small multiples, never radar or gauges. |
| `PREFS_LINK_DELIVERABLES` | yes | Every finished item links to its output: a URL, or an absolute path for a local file. |
| `PREFS_DAILY_CHECK` | yes | Once a day, a nothing-forgotten check: uncollected review answers, anything waiting longer than `PREFS_STALE_DAYS` (default 2), and standing rules with no evidence they ran. Each item is verified before it is called dropped. |
| `PREFS_AWAY_MODE` | yes | When you say you are away, approved work continues, new decisions wait, and you get a short return brief. |

### Decisions

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_DECISIONS` | `both` | Quick questions go through the agent's question tool, one at a time, with a preview on every option and a recommendation; larger or visual decisions go on a Lavish decision-card page. `cards` puts every decision on a card page; `tool` uses only the question tool; `chat` asks in chat. |
| `PREFS_YES_NO_IN_CHAT` | yes | Simple yes-or-no questions stay in plain chat. |
| `PREFS_PREVIEW_BEFORE_BUILD` | yes | A change to how something looks or feels is shown on a review page before it is built. |
| `PREFS_CHECK_ANSWERS_FIRST` | yes | The agent checks for your answer before calling a page or question open. |
| `PREFS_ASK_BEFORE_CLOSING` | yes | The agent asks before closing finished agents, sessions and review pages. Research tabs follow the research rule. |
| `PREFS_AUTONOMY` | `act` | Everyday judgment calls inside a direction you set are decided and reported; credentials, anything destructive and choices only you can make are always asked. `ask` asks about every one. |
| `PREFS_DECISIONS_LOG` | empty | A file where the agent records each ruling with its date (newest wins, not in the file means not decided), what you ruled out (never offered again), and each "not yet" with the condition that brings it back. |
| `PREFS_GRILL` | `every` | Every round of questions runs the grilling method: map the open decisions, ask only those that can be answered now, each with a recommendation, look facts up instead of asking, and ask the next round only after the answers. Kept balanced: when the intent and the request are clear enough, the agent goes ahead without asking. A gap only someone else can fill becomes a short questionnaire for that person. `gaps` questions you hard only when a plan has a real gap; `off` writes no rule. An earlier `PREFS_GRILL_ON_GAPS` answer carries over (yes becomes `gaps`, no becomes `off`). |

### Review pages

The first three apply with `PREFS_DECISIONS=both` or `cards`; the starter page already follows the layout rules.

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PAGES_ALL_CARDS` | yes | Every Lavish page (decisions, reports, plans, explainers, lessons) starts from the card template: one card at a time, a visual beside it, minimal text, and a Next button on a card with nothing to choose. This overrides lavish-axi's own design default unless you name another look; diagrams use the diagram-design skill. |
| `PREFS_PAGE_SIDE_BY_SIDE` | yes | The decision card sits on one side and a canvas showing the current decision on the other, horizontally, never stacked. |
| `PREFS_PAGE_FLIP_PREVIEWS` | yes | Every option of a visual choice has a preview, and you can flip between all of them; never only the recommended one. |
| `PREFS_PAGE_MINIMAL_TEXT` | yes | A title, the question and short option labels: no fluff, no helper text, no explaining the obvious. Visuals carry the meaning. |
| `PREFS_PAGE_WIDE_HEADER` | yes | A large title and intro spread across the full page width. |

### Review page delivery and workflow

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PAGE_CHECK_BEFORE_SEND` | yes | A page is opened in the agent's own browser and checked by screenshot before its link is sent, and the link is always sent. |
| `PREFS_PAGE_FIRST` | yes | When a decision waits on a page, the page is built and checked first, the link is sent, and the agent stands by until you answer. |
| `PREFS_PAGES_TOGETHER` | yes | While several review pages are in progress, links are held until all open work is done; the pages are checked against each other (each question once, dependencies in order, no clashing recommendations, one set of names) and sent together in the order to take them, with brief status meanwhile. |
| `PREFS_FLEET_WORKFLOW` | yes | Supervising agents brief workers with a goal, branch and definition of done; workers report only at phase changes and land through a pull request with green checks; review pages are for real decisions and look-and-feel changes, never status or routine choices; permission prompts and command mechanics are never escalated. |

### Building

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_BUILD_WHOLE_GOAL` | yes | Before something new is built, the research and the user journeys are shown on one review page. Then one builder gets the whole goal in a single brief (your words, the constraints, what done means) and runs, never fed step by step; the full validation pipeline runs once the first complete pass exists. |
| `PREFS_ROUTE` | no | Software projects go through six steps, each with its skill: Plan, Decide, Prototype, Breakdown, Build, Ship, with short paths for a small change and a bug. [The route](route.md) describes each step. |
| `PREFS_TEST_FIRST` | no | Product code is built test-first at the seams the spec names (tdd, codebase-design). Prototypes, docs and config are not test-first. |
| `PREFS_GLOSSARY_ADR` | no | `GLOSSARY.md` and `docs/adr/` are read before building, and new terms and decision records land with the change that introduces them. The files start only when a term or a hard-to-reverse decision comes up. |
| `PREFS_PROTOTYPE_CHECK` | no | Before you see a prototype, the agent opens it at laptop width and at phone width (390 px) and fixes broken layout, unclear labels and dead ends. |
| `PREFS_MODEL_GUIDE` | yes | When a model is named for a task, the agent reads that vendor's official prompting guide first and briefs the model the way it says. |

### Ideas and priorities

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_CAPTURE_IDEAS` | yes | Every idea you share is captured, folded into current work or parked with a trigger, and you get one line on where it landed. |
| `PREFS_RESEQUENCE` | yes | The agent reorders queued work by what blocks what without asking, then tells you the new order and why. |
| `PREFS_ORIENT` | yes | When work piles up or you seem unsure what is next, two lines: the current phase and the next deliverable, with where to find it. |
| `PREFS_FINISH_FIRST` | yes | Once something works, the agent stops instead of proposing the next improvement, suggests cutting scope at most once, and raises a risk once. |

### AI and model use

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_MODEL_ROUTING` | `capable` | The most capable model at medium effort for most work, with user-facing frontend and visual design on the model strongest at design and small, clear tasks on a faster model at high effort. `economical`: low effort by default, medium for planning, design and hard reasoning, the most capable model for building. `balanced` raises each step. |
| `PREFS_QUOTA` | yes | Check subscription limits with `quota-axi` before heavy work and take the cheapest path. |
| `PREFS_DELEGATE_RETRIEVAL` | `agy` if chosen in agent-clis | Bulk reading and fetching go to this secondary agent CLI; decisions and code changes stay with the main agent. Empty for none. |

### Research

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_RESEARCH_BROWSER` | `separate` | Web research happens in the agent's own visible browser, never yours; one tab per task, closed when done, and never a tab the agent did not open. |
| `PREFS_SOURCE_QUALITY` | yes | Each source is named by type (official docs, standards body, report, vendor page, forum); low-quality sources are skipped; existing software comes before general write-ups. |
| `PREFS_FINDINGS_TO_CHANGE` | yes | Research ends in a change you can see or a decision you can make, not only a report. |
| `PREFS_VERIFY_USER_CLAIMS` | yes | Tools and facts you mention in passing are checked before they are relied on, and options are compared before large installs. |

### Safety

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_MERGE` | `explicit` | Pull requests merge only on your explicit word. `green` lets the agent merge its own green pull requests. |
| `PREFS_VERIFY_CAUSE` | yes | No guessed causes: a failure's cause is named only when checked, otherwise "cause unknown". |
| `PREFS_PAUSE_WORD` | `pause` | Saying this word stops every running agent until you say resume. Empty for none. |
| `PREFS_STOP_DIGGING` | yes | A problem is confirmed from evidence before its cause is hunted; after about two checks that find nothing, the agent reports what is known. |
| `PREFS_BLOCKED_COMMANDS` | yes | A permission check that blocks an install, schedule, service change, push or pull request is never worked around; the agent records the exact one-line command for you and carries on. |
| `PREFS_PRIVATE_STAYS_LOCAL` | yes | Private chats and anything captured from your own sessions never go to an outside model or service. |
| `PREFS_PUBLIC_REPOS` | yes | In public repositories: a no-reply commit identity, no email trailers, pull request text that names nothing private, and a privacy scan before every push. |

Always included: no secrets or personal data anywhere, only genuine decisions brought
to you, and saying plainly when something was reasoned about rather than tested.

## Tools the rules point to

- **Decision cards**: with `PREFS_DECISIONS=both` or `cards` the module installs a starter page at
  `~/.config/ai-workstation-setup/decision-cards.html`. It needs `lavish-axi` (agent-clis).
  Agents copy it, replace the example cards, and open it with `lavish-axi --no-open`. It shows
  the review-page rules: a full-width header, the card beside a canvas, and buttons to flip
  between every option's preview. [Review pages](review-pages.md) describes the loop and the
  card fields.
- **No surprise tabs**: agent-clis sets `LAVISH_AXI_NO_OPEN=1` (`LAVISH_NO_OPEN`), so review
  pages never open browser tabs on their own; links are shared in chat.
- **Research browser**: agent-clis installs `research-browser` (`RESEARCH_BROWSER`, Linux,
  macOS, WSL): a visible Chrome window with its own profile. Sign in to research sites
  there once; agents drive it with `research-browser axi <command>`.
- **Quota**: `quota-axi` (agent-clis) reads your subscription windows.
- **Context reminder**: the claude-code module can add a hook (`CLAUDE_CONTEXT_REMINDER`)
  that reminds the agent once, when the context passes `CLAUDE_CONTEXT_REMINDER_TOKENS`,
  to save its notes before the context is compacted, and (`CLAUDE_COMPACT_REMINDER`) once more
  right after a compaction, pointing at the full transcript so nothing is lost.
