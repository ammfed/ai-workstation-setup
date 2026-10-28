# Working preferences

The `preferences` module turns a set of questions into plain Markdown rules your agents follow.
The defaults describe one proven way of working with an agent fleet; every one is a question,
so change what does not suit you.

## Where the rules live

A rules file that loads in every session costs attention in every session, and agents follow
fewer rules well as the count grows. So the rules are split by how often a session needs them:

- **The core file** holds the rules almost every session needs: how to reply, decisions, focus
  and priorities, safety, and what to check before you start. With the recommended answers it
  is 38 short rules, about 70 lines. It ends with one line per skill below, saying when to load it.
- **Five skills** hold the rules that only one kind of work needs. Claude Code shows the agent
  each skill's name and description at startup, and the agent loads the whole skill when that
  work comes up:
  - `writing-for-others`: anything other people will read, other languages, questionnaires.
  - `status-and-away`: status replies, the daily check, live state, queue order, away mode.
  - `review-pages`: when to use a page, the card template, layout, checks, sending, answers.
  - `running-workers`: worker briefs, landing pull requests, building something new, public
    repositories, deadlines.
  - `models-and-research`: model and effort choice, helpers, quota, research and sources.
- **This page** explains each rule and why it exists. Agents do not load it.

Where it writes (`PREFS_TARGETS`):

| Target | Files | Loaded by |
| --- | --- | --- |
| `claude` | `~/.claude/rules/working-preferences.md` (the core file) and `~/.claude/skills/<name>/SKILL.md` (the five skills) | Claude Code: the core file in every project, each skill when its work comes up |
| `firstmate` | `data/captain.md` in your Firstmate home (`FIRSTMATE_HOME` from this run or your saved answers, else the clone; the file firstmate reads for preferences) | Firstmate, at session start |

`captain.md` holds the core rules and every skill's rules in one file, with each skill under its
own heading. A supervisor needs status, review-page and worker rules in almost every turn, and
its harness may not load Claude Code skills, so nothing in it waits to be loaded.

Every file is yours: edit it freely. Re-running the installer asks before replacing a changed
file and keeps a timestamped backup. A skill none of your answers fills is not written.

After the targets, one question decides how many follow: `PREFS_REVIEW_EACH` (default no)
writes the recommended set below without asking each one. Answer yes to go through them one
by one. `PREFS_PAGE_PREPARE_NEXT` (default no: a review page waits for your answer) is asked
only when you choose for yourself; going ahead with the first screen takes its default. An
answers file still sets any key it names either way.

With the `firstmate` target, the module also writes Firstmate's `config/brief-include.md`, which
Firstmate appends to every worker brief. It holds what applies: the house style with
`PREFS_WRITING_STYLE=ste` (for what workers write to Firstmate, never the deliverable), the
vault-first line (sessions get it from the second-brain rules file instead) when second-brain runs or its saved vault folder
exists and agents have access, naming only the routes it installs, the helper-model rule from
`PREFS_DELEGATE_RETRIEVAL`, the build rules from `PREFS_KUN`, `PREFS_TEST_FIRST` and
`PREFS_GLOSSARY_ADR`, the principle checker line from `PREFS_PRINCIPLE_CHECKS`, and your private
Everywhere and Workers lines. Nothing applies, nothing is written. The split does not change it.

Firstmate reads that file only in the home it belongs to, so the module also writes the same
lines into `config/brief-include.md` of every local second-mate home listed in the main home's
`data/secondmates.md` (a home without its `.fm-secondmate-home` marker is skipped). There the
lines go in a block between two `ai-workstation-setup` comment markers: lines the home wrote
itself stay around the block, a re-run replaces only the block, and a dry run lists each file.
Keep your own edits outside the block. A home added later gets the lines on the next run.

Your own rules that are not generic go in a private rules file outside the clone; see
[Your private rules](#your-private-rules).

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
| `PREFS_HABITS` | yes | Nine everyday habits: replies end with the next actions, yours first; "I'm lost" or "too long" gets the shortest plain answer; an opinion is a real one with its reason; status and questions stay on your current topic; "check X" is a question, not a go-ahead to widen the work; no menu of what to run next; a claim is unproven until something shows it, including the case that can fail; a record you call outdated is checked against reality before it is defended; a deadline never skips a check, a review or an approval, and work runs in dependency order. The lines land in Language and tone, Ideas and priorities, and Safety. |
| `PREFS_CALM_WORD` | `calm` | Saying this word switches the agent to a calm mode: batched tool calls, no in-between updates, only the answer. Empty for none. |

### Reporting and status

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_STATUS` | `needs-you` | Every status reply opens with one line of headline counts, then NEEDS YOU (only what you alone can do, ranked, each with a rough time cost and one link), AT RISK (what is stuck or slipping and what it costs you), always a table with To do, Doing and Done side by side (one row per project, Done only since the last status), and one Links line. Empty parts are left out, except the table. `board` opens with one table whose three columns, TODO, DOING and DONE, sit side by side, then groups what is left by who acts: your block labelled YOU, the agent's labelled with its own role name (never ME). Small text bars and boxes only where they carry meaning. `actions` gives a very short list of action items, yours first, then a pointer to the full report; `brief` opens with a one-line answer, then brief action items. |
| `PREFS_HONEST_NUMBERS` | yes | Uncertain numbers are ranges or "not yet known"; charts are plain bars or small multiples, never radar or gauges. |
| `PREFS_LINK_DELIVERABLES` | yes | Every finished item links to its output: a URL, or an absolute path for a local file. |
| `PREFS_DAILY_CHECK` | yes | Once a day, a nothing-forgotten check: uncollected review answers, anything waiting longer than `PREFS_STALE_DAYS` (default 2), and standing rules with no evidence they ran. Each item is verified before it is called dropped. |
| `PREFS_AWAY_MODE` | yes | When you say you are away, approved work continues, new decisions wait, and you get a short return brief. |

### Decisions

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_DECISIONS` | `both` | Quick questions go through the agent's question tool, one at a time, with a preview on every option and a recommendation; larger or visual decisions go on a Lavish decision-card page. `cards` puts every decision on a card page; `tool` uses only the question tool; `chat` asks in chat. With `both` or `cards`, a page is created without opening a tab (`--no-open`), checked, then opened once in your browser when it is handed over, with its link; while you are away nothing opens and the link waits for your return brief. |
| `PREFS_YES_NO_IN_CHAT` | yes | Simple yes-or-no questions stay in plain chat. |
| `PREFS_PREVIEW_BEFORE_BUILD` | yes | A change to how something looks or feels is shown on a review page before it is built. |
| `PREFS_CHECK_ANSWERS_FIRST` | yes | The agent checks for your answer before calling a page or question open. |
| `PREFS_ASK_BEFORE_CLOSING` | yes | The agent asks before closing finished agents, sessions and review pages. Research tabs follow the research rule. |
| `PREFS_AUTONOMY` | `act` | Everyday judgment calls inside a direction you set are decided and reported; credentials, anything destructive and choices only you can make are always asked. A process or tooling question you cannot answer is settled from the primary source (official docs or the upstream repository), with one line on what was chosen and why. `ask` asks about every one. |
| `PREFS_DECISIONS_LOG` | empty | A file where the agent records each ruling with its date (newest wins, not in the file means not decided), what you ruled out (never offered again), and each "not yet" with the condition that brings it back. |
| `PREFS_GRILL` | `every` | Every round of questions runs the grilling method: map the open decisions, ask only those that can be answered now, each with a recommendation, look facts up instead of asking, and ask the next round only after the answers. Kept balanced: when the intent and the request are clear enough, the agent goes ahead without asking. A gap only someone else can fill becomes a short questionnaire for that person. `gaps` questions you hard only when a plan has a real gap; `off` writes no rule. An earlier `PREFS_GRILL_ON_GAPS` answer carries over (yes becomes `gaps`, no becomes `off`). |

### Review pages

The first three apply with `PREFS_DECISIONS=both` or `cards`; the starter page already follows the layout rules.

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PAGES_ALL_CARDS` | yes | Every Lavish page (decisions, reports, plans, explainers, lessons) starts from the card template: one card at a time, a visual beside it, minimal text, and a Next button on a card with nothing to choose. This overrides lavish-axi's own design default, and the look of boards a skill brings with it, unless you name another look; diagrams use the diagram-design skill. |
| `PREFS_PAGE_SIDE_BY_SIDE` | yes | The decision card sits on one side and a canvas showing the current decision on the other, horizontally, never stacked. |
| `PREFS_PAGE_FLIP_PREVIEWS` | yes | Every option of a visual choice has a preview, and you can flip between all of them; never only the recommended one. |
| `PREFS_PAGE_MINIMAL_TEXT` | yes | A title, the question and short option labels: no fluff, no helper text, no explaining the obvious. Visuals carry the meaning. |
| `PREFS_PAGE_PHONE` | yes | Every review page also reads well on a phone (390 px wide): the card and its picture stack, body text is at least 14 px, and a wide diagram gets a phone version instead of tiny labels. A 390 by 844 screenshot is checked before the link is sent. The same answer decides whether `PREFS_PROTOTYPE_CHECK` also checks phone width, so one answer pauses or restores every phone check. |
| `PREFS_PAGE_WIDE_HEADER` | yes | A large title and intro spread across the full page width. |

### Review page delivery and workflow

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PAGE_CHECK_BEFORE_SEND` | yes | A page is opened in the agent's own browser and checked by screenshot before its link is sent, and the link is always sent. |
| `PREFS_PAGE_FIRST` | yes | When a decision waits on a page, the page is built and checked first, the link is sent, and the agent stands by until you answer. |
| `PREFS_PAGE_PREPARE_NEXT` | no | Asked only when you choose for yourself. With `PREFS_PAGE_FIRST`: while a review page waits for your decision, the agent prepares the next stage but does not start it until you approve. |
| `PREFS_PAGES_TOGETHER` | yes | While several review pages are in progress, links are held until all open work is done; the pages are checked against each other (each question once, dependencies in order, no clashing recommendations, one set of names) and sent together in the order to take them, with brief status meanwhile. |
| `PREFS_FLEET_WORKFLOW` | yes | Supervising agents brief workers with a goal, branch and definition of done; workers report only at phase changes and land through a pull request with green checks; review pages are for real decisions and look-and-feel changes, never status or routine choices; permission prompts and command mechanics are never escalated. Live state is checked before work is called in progress or finished, the next step of a plan starts as soon as one lands, and a wait over 30 minutes is raised within the hour. When you must type in an agent's window, it is named by the labels you see on screen, never internal ids. |

### Building

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_BUILD_WHOLE_GOAL` | yes | Before something new is built, the research and the user journeys are shown on one review page. Then one builder gets the whole goal in a single brief (your words, the constraints, what done means) and runs, never fed step by step; the full validation pipeline runs once the first complete pass exists. |
| `PREFS_ROUTE` | no | Software projects go through six steps, each with its skill: Plan, Decide, Prototype, Breakdown, Build, Ship, with short paths for a small change and a bug. [The route](route.md) describes each step. |
| `PREFS_KUN` | yes | At the start of real work (a feature, a bug, a refactor, a plan, research or an explainer), the agent runs `/kun` once and follows the route its `ENTRY.md` gives for that kind of work. Later checks in the session reuse that load. Small clear tasks, status replies and helper subagents skip it. |
| `PREFS_TEST_FIRST` | no | Product code is built test-first at the seams the spec names (tdd, codebase-design). Prototypes, docs and config are not test-first. |
| `PREFS_GLOSSARY_ADR` | no | `GLOSSARY.md` and `docs/adr/` are read before building, and new terms and decision records land with the change that introduces them. The files start only when a term or a hard-to-reverse decision comes up. |
| `PREFS_PROTOTYPE_CHECK` | no | Before you see a prototype, the agent opens it at your target screen size first, then at laptop width and, when `PREFS_PAGE_PHONE` is yes, at phone width (390 px), checks that font sizes and column positions stay the same on every tab, and fixes broken layout, unclear labels and dead ends. |
| `PREFS_PRINCIPLE_CHECKS` | yes | With the `firstmate` target: every worker brief tells the worker to run the principle checker that `workflow-playbook` installs (`principles/bin/principle-check.mjs`, with `--phone` for work built for other people) before it reports done on anything with a screen, fix every `fail` line and list each `check` line for the reviewer. Written only when the playbook is chosen or already installed. |
| `PREFS_MODEL_GUIDE` | yes | When a model is named for a task, the agent reads that vendor's official prompting guide first and briefs the model the way it says. |

### Ideas and priorities

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_CAPTURE_IDEAS` | yes | Every idea you share is captured, folded into current work or parked with a trigger, and you get one line on where it landed. |
| `PREFS_RESEQUENCE` | yes | The agent reorders queued work by what blocks what without asking, then tells you the new order and why. |
| `PREFS_ORIENT` | yes | Every project reply ends with one line that says where the work is on the map, the next step, who takes it and when. When the next step is yours, the line says exactly what you need to do and links to it. No step counters. |
| `PREFS_FINISH_FIRST` | yes | Once something works, the agent stops instead of proposing the next improvement, suggests cutting scope at most once, and raises a risk once. |

### AI and model use

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_MODEL_ROUTING` | `capable` | The most capable model at medium effort for most work, extra-high effort for a new frontend look that is not yet settled, high effort for polish of a settled look, high effort for investigations, diagnosis and plans (re-run at extra-high effort when the result is weak or the cause is hard to find), research at high effort (it plans and checks, and hands bulk fetching to the bulk research CLI, reading and summaries to the reader subagent, and drafting to a faster model), small, clear tasks on a faster model at high effort (re-run on the most capable model at medium effort after a failed check), and reading, lookup and summaries on the fastest model ([model-map.md](model-map.md)). Before planning, investigation or design starts, the agent checks the effort it actually runs at; one on a lower effort than these rules pick hands that work to a worker at that effort and only reviews it. `economical`: low effort by default, medium for planning, design and hard reasoning, the most capable model for building. `balanced` raises each step. |
| `PREFS_QUOTA` | yes | Check subscription limits with `quota-axi` before heavy work and take the cheapest path. |
| `PREFS_DELEGATE_RETRIEVAL` | `agy` if chosen in agent-clis | Bulk reading and fetching go to this secondary agent CLI; decisions and code changes stay with the main agent. Empty for none. |
| `PREFS_DELEGATE_MODEL` | `gemini-3.8-flash-high` for agy | The model that CLI is told to use for it (`--model`). Empty leaves the CLI's own default. |
| `PREFS_DELEGATE_FALLBACK_MODEL` | `claude-sonnet-4-6` for agy | The model the rule names for the same work after a Gemini quota error. Empty for none. Asked only when `PREFS_DELEGATE_MODEL` is set. |

### Research

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_RESEARCH_BROWSER` | `separate` | Web research happens in the agent's own visible browser, never yours; one tab per task, closed when done, and never a tab the agent did not open. |
| `PREFS_SOURCE_QUALITY` | yes | Each source is named by type (official docs, standards body, report, vendor page, forum); low-quality sources are skipped; existing software comes before general write-ups. |
| `PREFS_LIVE_FACTS` | yes | Examples of the current leading models, tools or products come from a live source checked that day, with its date. Before advice on what to buy or which tool to pick, each product's own pricing page and docs are fetched that day, and every claim is marked as checked on the vendor's page, from a third party only, or not checked. |
| `PREFS_FINDINGS_TO_CHANGE` | yes | Research ends in a change you can see or a decision you can make, not only a report. |
| `PREFS_VERIFY_USER_CLAIMS` | yes | Tools and facts you mention in passing are checked before they are relied on, and options are compared before large installs. |

### Safety

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_MERGE` | `explicit` | Pull requests merge only on your explicit word. `green` lets the agent merge its own green pull requests. |
| `PREFS_VERIFY_CAUSE` | yes | No guessed causes: a failure's cause is named only when checked, otherwise "cause unknown". |
| `PREFS_PAUSE_WORD` | `pause` | Saying this word stops every running agent until you say resume. Empty for none. |
| `PREFS_STOP_DIGGING` | yes | A problem is confirmed from evidence before its cause is hunted; after about two checks that find nothing, the agent reports what is known. A command or check that fails the same way twice is not run a third time: the agent tries one other way, then reports. |
| `PREFS_BLOCKED_COMMANDS` | yes | A permission check that blocks an install, schedule, service change, push or pull request is never worked around; the agent records the exact one-line command for you and carries on. |
| `PREFS_PRIVATE_STAYS_LOCAL` | yes | Private chats and anything captured from your own sessions never go to an outside model or service. |
| `PREFS_PUBLIC_REPOS` | yes | In public repositories: a no-reply commit identity, no email trailers, pull request text that names nothing private, and a privacy scan before every push. |

Always included, in the core file: no secrets or personal data anywhere, only genuine
decisions brought to you, and saying plainly when something was reasoned about rather than
tested.

## Why each preference exists, and where it lives

"Core" is the always-loaded core file. A skill name means the rule loads with that skill.
Firstmate's `captain.md` holds every rule, wherever it lives here.

| Key | Why it exists | Lives in |
| --- | --- | --- |
| `PREFS_PLAIN_LANGUAGE` | Jargon and long replies slow every decision. | Core |
| `PREFS_NO_NARRATION` | A running commentary hides the result you asked for. | Core |
| `PREFS_NO_EM_DASHES` | Many readers take em dashes as a sign of machine-written text. | Core |
| `PREFS_OUTWARD_AS_USER` | Readers outside your team do not know or care about the agents. | writing-for-others |
| `PREFS_NATURAL_TRANSLATION` | A literal translation reads as foreign to a native reader. | writing-for-others |
| `PREFS_WRITING_PRINCIPLES` | A document that does not lead with its point loses its reader, and a deck built before its point is agreed is rebuilt. | writing-for-others |
| `PREFS_WRITING_STYLE` | One fixed style makes instructions and warnings unambiguous. | Core (House style) |
| `PREFS_ONE_DESIGN_SYSTEM` | Two design systems in one artifact look broken. | writing-for-others |
| `PREFS_COPY_SECOND_OPINION` | The agent that wrote a text cannot hear how it sounds. | writing-for-others |
| `PREFS_HABITS` | Small habits keep replies actionable and claims honest. | Core, except the deadline rule (running-workers) |
| `PREFS_CALM_WORD` | One word quiets a busy session without new instructions. | Core |
| `PREFS_STATUS` | A status that leads with your asks is one you can act on. | status-and-away |
| `PREFS_HONEST_NUMBERS` | A made-up figure looks like a fact. | Core |
| `PREFS_LINK_DELIVERABLES` | A finished item you cannot open is not finished for you. | Core |
| `PREFS_DAILY_CHECK`, `PREFS_STALE_DAYS` | Uncollected answers and long waits are easy to forget. | status-and-away |
| `PREFS_AWAY_MODE` | Decisions made while you are away are decisions you did not make. | status-and-away |
| `PREFS_DECISIONS` | Questions asked one at a time, with previews, get faster and better answers. | Core; the page mechanics in review-pages |
| `PREFS_YES_NO_IN_CHAT` | A page for a yes-or-no question wastes a round. | Core |
| `PREFS_PREVIEW_BEFORE_BUILD` | People judge what they can see. | review-pages |
| `PREFS_CHECK_ANSWERS_FIRST` | Asking again what you already answered costs your attention. | Core (chat and tool); review-pages (card pages) |
| `PREFS_ASK_BEFORE_CLOSING` | Closing a session unasked can lose work you still wanted. | Core |
| `PREFS_AUTONOMY` | Asking about every small choice stalls the work; acting on the big ones takes them from you. | Core |
| `PREFS_DECISIONS_LOG` | A ruling that is not written down gets asked again or undone. | Core |
| `PREFS_GRILL` | Rounds of focused questions settle a plan before work starts. | Core; the questionnaire rule in writing-for-others |
| `PREFS_PAGES_ALL_CARDS`, `PREFS_PAGE_SIDE_BY_SIDE`, `PREFS_PAGE_FLIP_PREVIEWS`, `PREFS_PAGE_MINIMAL_TEXT`, `PREFS_PAGE_PHONE`, `PREFS_PAGE_WIDE_HEADER` | One familiar page shape lets you decide without learning a new layout each time. | review-pages |
| `PREFS_PAGE_CHECK_BEFORE_SEND` | A page can load and still be blank or broken. | review-pages |
| `PREFS_PAGE_FIRST`, `PREFS_PAGE_PREPARE_NEXT` | A question asked before its page exists is noise, and work started before approval may be redone. | review-pages |
| `PREFS_PAGES_TOGETHER` | Pages checked against each other do not ask the same thing twice. | review-pages |
| `PREFS_FLEET_WORKFLOW` | Clear briefs, live status and pull requests keep a fleet visible and safe. | running-workers; the status and live-state rules in status-and-away; when a page is used in review-pages |
| `PREFS_BUILD_WHOLE_GOAL` | A builder fed step by step loops on details and misses the main idea. | running-workers |
| `PREFS_ROUTE`, `PREFS_TEST_FIRST`, `PREFS_GLOSSARY_ADR` | One route and its checks keep software work in order. | running-workers |
| `PREFS_KUN` | One method loaded at the start keeps every kind of work on its route. | Core (and worker briefs) |
| `PREFS_PROTOTYPE_CHECK` | You notice a broken layout before the content. | review-pages |
| `PREFS_PRINCIPLE_CHECKS` | A script catches mechanical slips before a reviewer has to. | Worker briefs only |
| `PREFS_MODEL_GUIDE` | Each model follows the briefing style its vendor documents. | running-workers |
| `PREFS_CAPTURE_IDEAS` | An idea that is not written down is lost, and one started at once derails the current work. | Core |
| `PREFS_RESEQUENCE` | Work ordered by what blocks what finishes sooner. | status-and-away |
| `PREFS_ORIENT` | You always know what comes next without asking. | Core |
| `PREFS_FINISH_FIRST` | Finished work beats a growing list of improvements. | Core |
| `PREFS_MODEL_ROUTING`, `PREFS_QUOTA`, `PREFS_DELEGATE_*` | Quota is limited, and the wrong effort quietly lowers quality. | models-and-research (the helper rule also in worker briefs) |
| `PREFS_RESEARCH_BROWSER` | Your own browser holds your accounts and tabs. | models-and-research |
| `PREFS_SOURCE_QUALITY`, `PREFS_VERIFY_USER_CLAIMS`, `PREFS_LIVE_FACTS`, `PREFS_FINDINGS_TO_CHANGE` | Weak or stale sources make a strong claim look settled, and research that changes nothing was wasted. | models-and-research |
| `PREFS_MERGE` | A merge is hard to undo, and approving work is not the same as shipping it. | Core |
| `PREFS_VERIFY_CAUSE`, `PREFS_STOP_DIGGING` | A guessed cause sends the fix the wrong way, and a failure repeated unchanged only spends tokens. | Core |
| `PREFS_PAUSE_WORD` | One word stops every agent at once. | Core |
| `PREFS_BLOCKED_COMMANDS` | A permission check exists for a reason; going around it is not your choice made. | Core |
| `PREFS_PRIVATE_STAYS_LOCAL` | Private material must not leave your machine. | Core |
| `PREFS_PUBLIC_REPOS` | A public repository keeps everything it is given, forever. | running-workers |
| `PREFS_TASTE_PRESET` | An optional starting point for screen taste and review habits. | Core (and worker briefs) |
| `PREFS_PRIVATE_RULES` | Your own rules never go in this public repository. | Core, worker briefs and second mates, by heading |

## The taste preset

`PREFS_TASTE_PRESET` (default no) adds an optional taste preset: the screen taste and review
habits the template's author works by, cleaned to generic rules in
`templates/preferences/taste-preset.md`. It holds only rules no question above writes, such as
purposeful minimalism, one word per label, one fixed layout frame, and treating a comment on a
review page as something to rework rather than agreement. Its `Everywhere` lines land in a
"Taste preset" section of the core file and of every Firstmate worker brief; its `Sessions`
lines go to the core file only. Turn it off and re-run the installer to remove them. The
recommended set leaves it off, so it is asked only when you go through each preference.

## Your private rules

Some of your rules are yours alone: a screen size, a house style detail, the name of a tool or
a home. They never go in this repository. Keep them in a private rules file outside the clone,
at `PREFS_PRIVATE_RULES` (default `~/.config/ai-workstation-setup/private-rules.md`, beside the
card template). The module reads it when it exists; a path inside the clone is refused.

It is plain Markdown. Each `##` heading says where its lines go:

| Heading | Goes to |
| --- | --- |
| `Everywhere` | All three files below |
| `Sessions` | The core file (`working-preferences.md`) and Firstmate's `data/captain.md` |
| `Workers` | Firstmate's `config/brief-include.md` (and each local second-mate home's), appended to every worker brief |
| `Second mates` | Firstmate's `data/captain-shared.md` in the main home, which every second mate reads; written only when there are lines for it |
| `Reviewer` | The no-mistakes design review rules (agent-clis, `NO_MISTAKES_PRINCIPLES`), added after the generic ones to every review whose change touches an interface file |

Each `-` or numbered item, or each paragraph, is one rule; a line that follows without a blank
line continues it. A `#` title, text before the first heading and HTML comments are not used.
An unknown heading is reported and its lines are left out. The lines land in a "Private rules"
section at the end of each file (never in a skill), so edit them in your private file, not in the written copies.

```markdown
## Everywhere
- Check every page at my laptop size before you send it.

## Workers
- Use the research browser for anything that needs a sign-in.
```

## Tools the rules point to

- **Decision cards**: with `PREFS_DECISIONS=both` or `cards` the module installs a starter page at
  `~/.config/ai-workstation-setup/decision-cards.html`. It needs `lavish-axi` (agent-clis).
  Agents copy it, replace the example cards, and open it with `lavish-axi --no-open`. It shows
  the review-page rules: a full-width header, the card beside a canvas, and buttons to flip
  between every option's preview. It is light by default, with a small switch to go dark.
  [Review pages](review-pages.md) describes the loop and the card fields.
- **Hide tray**: next to the card template the module writes
  `~/.config/ai-workstation-setup/hide-kit.js`. The card template already carries it, and the
  rules tell agents to paste it into every prototype, slide or doc page they open in Lavish. You
  pick parts of the page, they stay faint, and Send to agent asks the agent to remove them.
  [Review pages](review-pages.md#hiding-parts-of-a-page) says how to use it.
- **No surprise tabs**: agent-clis sets `LAVISH_AXI_NO_OPEN=1` (`LAVISH_NO_OPEN`), so review
  pages never open browser tabs on their own. The agent opens a checked page once, on
  purpose, when it hands it over, and shares the link in chat.
- **Research browser**: agent-clis installs `research-browser` (`RESEARCH_BROWSER`, Linux,
  macOS, WSL): a visible Chrome window with its own profile. Sign in to research sites
  there once; agents drive it with `research-browser axi <command>`.
- **Quota**: `quota-axi` (agent-clis) reads your subscription windows.
- **Context reminder**: the claude-code module adds a hook (`CLAUDE_CONTEXT_REMINDER`, on by
  default) that reminds the agent once, when the context passes `CLAUDE_CONTEXT_REMINDER_TOKENS`,
  to save its notes before the context is compacted, and (`CLAUDE_COMPACT_REMINDER`) once more
  right after a compaction, pointing at the full transcript so nothing is lost. The default
  `auto` puts the save point at seven eighths of the auto-compact window that applies to the
  session (`autoCompactWindow` in the project's `.claude` settings, else yours): 350000 for a
  400000 window, 175000 for 200000, and 150000 when no window is set. So a folder with a
  smaller window of its own gets an earlier reminder without another hook.
  `CLAUDE_CONTEXT_REMINDER_TEXT` changes what it asks for, such as running a save skill. The
  user-level hook is registered with a `--user` marker. In a project that registers its own
  reminder (Firstmate's stow reminder), it stays quiet whatever its text, so a session gets one
  reminder, not two.
  The hook runs on each prompt and after each tool call (`PostToolUse`), so a long run of tool
  calls that passes the save point is reminded before it reaches compaction. It still reminds
  once per crossing, whichever event sees it first. If your Claude settings file is protected
  from agent edits, run `scripts/apply-to-machine.sh` yourself: it copies the current hook into
  `~/.claude/hooks`, registers it on every event above with your threshold and text, keeps a
  backup set of each file it changes, and leaves the rest of `~/.claude/settings.json` alone.
  `--dry-run` shows what it would change and `--undo` restores the latest backup set.
