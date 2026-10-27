---
name: workflow-playbook
description: A working method for long projects run by one owner with AI agents. Use when a new goal takes more than one session, when capturing an idea and choosing which phases it needs, when planning or running multi-stage work (research, concepts, layout options, wireframes, build), when reworking a weak prototype into a liked direction, an approved journey map and an aligned rules list, when any stage needs research, when briefing a worker or helper, when building a review page for the owner or a page for stakeholders, or when deciding whether to ask the owner or act.
---

# Workflow playbook

These rules come from a long project that was restarted several times. Every restart had the same cause: work moved ahead of the owner's decisions, or research went into the product without a purpose. Each rule below fixes one of those failures, or a later one: the owner was left with a blank page and no clear next step.

- The owner is the person who decides. Agents and workers do the rest.
- Each rule has a "Why" line. Keep the reason in mind when a case does not fit the words.

## Phases, from an idea to shipped and improved

Every piece of work runs through some of these ten phases, in this order. Each phase has one owner, so two skills never do the same job. The route column is the step of the software route (`docs/route.md` in the setup repository) that the phase belongs to, so the two never disagree. A gate is an item only the owner closes (rule 2.5).

| Phase | Route step | Goal | Leads | Owner | Hands to | The next phase starts when |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Capture | Plan | Write the idea down, judge whether it fits and when, pick the phases from the table below and set the review stakes once (rule 2.8) | The coordinator | wayfinder | A map with every phase of the path queued as an item (rule 2.4) | The map is written. The first item has no blocker |
| 2. Requirements | Decide | Turn a vague goal into requirements the owner agrees with | A skill, in rounds with the owner | grilling, with domain-modeling in a repo | Requirements, and a glossary in a repo | The owner agrees to the last round (gate) |
| 3. Does it already exist | Decide | Find products, tools or people that already do this | A research worker, beside phase 2 | research | A report and one card: build, reuse or stop | The card is answered in the next requirements round |
| 4. Vision | Decide | Fix the destination and the test for which later ideas to accept | A skill, with the owner | vision | A vision file, once per project | The owner approves it. This closes the early phases gate |
| 5. Prototype | Prototype | Settle the look and the flow, then write the spec | Workers build, the owner judges | prototype with section 10, then to-spec | The approved prototype link and the spec | The owner approves the checkpoint page (gate) |
| 6. Breakdown | Breakdown | Cut the spec into items, one worker each | The coordinator | to-tickets | Items with blockers, including the fixed items (rule 1.6) | Each item starts as soon as its blockers clear |
| 7. Build | Build | Build each item, test-first where it pays | Workers | tdd, codebase-design | A pull request with a labelled preview | Green checks file the review item |
| 8. Review | Ship | The owner's review of what will ship, after the checks | The owner | a review page (section 4) | Keep, Change or Discard answers | The owner says to merge |
| 9. Ship and hand over | Ship | Merge, link the result, name who runs it | The coordinator, on the owner's word | no-mistakes | The merged result and the handover item | The merge files the improve item |
| 10. Improve | After Ship | Turn what slowed the work into rules and checks | The coordinator prepares, the owner approves | this playbook, section 9 | Proposal cards | A standing item, approved once |

Phases 2 to 4 are the early phases. They run before anything is built, and the early phases gate blocks phase 5 (rule 1.1).

**Kun supervises every phase.** The kun skill (`/kun`) supervises the whole life cycle.

- Run `/kun` once per session, at the start of real work. Name the kind of work and follow the route Kun's `ENTRY.md` gives for it (research, planning, reproduction, guardrails, implementation, validation).
- At the start of each phase and again before its gate, check the phase's row below against that load.
- Run `/kun` again only in a new session or after compaction.
- A check is a pass the agent runs, not a page and not a question to the owner.
- A finding that changes the plan goes on the phase's outcomes page.
- Where Kun and this playbook disagree, Kun wins, and the conflict goes on that page too.
- If `/kun` cannot load, say so in the status and go on with this playbook alone.

Why: one supervisor that checks every phase against the same method catches drift early, and a supervisor that stops the work when it is offline costs more than it saves.

| Phase | The /kun check |
| --- | --- |
| 1. Capture | Name the kind of work (an idea, a feature, a bug, a refactor or an explainer) and take Kun's route for it. Check Kun's tools list for a tool that already does the job |
| 2. Requirements | Each round rests on research in the real project. Its cards show the key directions, and only the owner's questions stay open |
| 3. Does it already exist | The study shows how others solved it, the proven playbooks and the common pitfalls |
| 4. Vision | The vision file meets what Kun's vision skill asks for: each principle cites real evidence from the project, and the file says what the work will not become |
| 5. Prototype | When a prototype shows the choice better than words, it sits on the checkpoint page. The page keeps only what is decided now |
| 6. Breakdown | A bug starts with a reproduction item in a clean setup, which becomes the regression test. A refactor starts with a guardrails item that adds the missing tests first |
| 7. Build | The change is the simplest one that meets the requirements. Anything the brief did not ask for is cut |
| 8. Review | The preview page shows what validation caught and fixed, next to the outcome |
| 9. Ship and hand over | No extra check: validation is the step Kun names. It runs through no-mistakes when the repository has it. Without it, offer to set it up, or use a fresh adversarial reviewer. The merge waits for the owner's word |
| 10. Improve | Check Kun's tools list for one that turns repeated corrections into checks, such as backpass. Bring each proposal as a card |

**Skills that own no phase.** This setup installs four more skills. Each one helps inside a phase when its moment comes. None of them starts a phase or takes over from its owner.

| Skill | Use it when |
| --- | --- |
| find-docs | A plan or code names a library, framework or service: fetch its current docs first, never work from memory (phases 3, 5 and 7) |
| to-questionnaire | A gap only someone else can fill, such as a colleague, a vendor or real users: turn it into a short questionnaire for that person, including the real-user try-out (rule 1.6) |
| teach | The owner asks to learn a new skill or concept |
| composio-cli | The work needs an outside app the owner has connected, such as email, a calendar or a tracker |

**Which phases a piece of work needs.** Pick by the kind of work, never by a guess of how long it takes.

| Kind of work | Phases it runs | Test |
| --- | --- | --- |
| A foggy goal, more than one session | All ten | The goal is bigger than one session |
| A product or feature with a look | All ten. Vision once per project | There is a look or a flow to choose |
| A change with no look or design choice | 1, 7, 9, and 8 if the owner will look at it | One worker, an existing item |
| A bug | 1, find the cause, 7 with the reproduction as the regression test, 9 | Something that worked is broken |
| A prototype the owner will show soon | 1 to 5 | Nothing is built for real before approval |
| A report or research only | 1, 3, 8 | No pull request |

## 1. Stage gates

1. **Work in gates, one at a time.**
   - Findings, then the owner's agreement. Concepts, then the owner's approval. Layout options, then the owner's pick. Wireframes, then the build.
   - Never start a stage whose input the owner has not approved.

   Why: a stage built on unapproved input is thrown away when that input changes.
2. **Comments are not agreement.**
   - When the owner comments, rework those points and show them again.
   - Move on only when the owner says they agree.

   Why: treating a comment as a yes builds the next stage on a guess.
3. **Each stage builds on the last.**
   - A stage output opens with what it takes from the stage before and what it hands to the next.
   - Replaced work stays on record, but it never feeds a new stage.

   Why: stages that do not name their inputs drift apart, and old work leaks back in.
4. **Pick the layout before the wireframes.**
   - After the owner approves the concepts, study the full interfaces the owner liked. Study whole screens, not single parts.
   - Then offer 3 layout options, using the same few key screens for every option.
   - Each option defines a page frame and page patterns. The page frame sets what stays the same across screens, including the header, navigation and main areas. Page patterns define the screen types that repeat, such as a list with details, a dashboard or a step-by-step form.
   - Start the wireframes only after the owner picks an option.
   - Draw all wireframes with the chosen page frame and page patterns.

   Why: wireframes drawn straight from concepts come out scattered, with each concept pushed into its own page.
5. **Build work for other audiences last.**
   - Build a deck, demo or report for others just before its date, from the latest approved stage.
   - Include a journey showcase: the hours spent, the rounds, and old screens beside the new ones.
   - Track time from the session logs. Count active time by adding the gaps between events that are under 5 minutes apart. Count calendar time from the first event to the last.
   - State which measure you use.

   Why: work built early may show a stage that has since changed. The showcase shows the effort behind the result. Calendar time includes nights and waiting periods, so it makes the work look longer than it was.
6. **Some items are always on the list.** Breakdown (phase 6) adds these items whenever they apply, before any other build item:
   - **System design first.** The first build item settles the contracts, the data model and the hard-to-reverse decisions. Front end and back end work start only after it.
   - **Outside approvals as held items.** Any approval someone else owns (security, IT, a client) becomes its own held item at once, so the wait shows early.
   - **An evaluation item for any AI part.** Test how well the AI part does its job on real examples before any pilot.
   - **A real-user try-out.** When real people will use the result, they try the prototype, guided by a short questionnaire. The results come back as a card.
   - **A handover item.** When real people will run or use it, an item names who runs it and how they learn it, blocked by the last build item.
   - Finished items stay on the list, marked done, never deleted.
   - Dates belong to the owner. Agents never set or move a date; they only flag one that has passed.

   Why: each of these is easy to forget until it blocks a launch, and a date moved by an agent hides the slip the owner needs to see.

## 2. Lead the way

1. **Start the map yourself.**
   - When a new goal takes more than one session, start a map at once. Do not wait for the owner to ask.
   - The map names the goal, the stages from here to the goal, where the work is now and the next step.
   - If the goal is vague, the first stage is to define the requirements.
   - Show the map to the owner, then lead the work one step at a time.
   - Update the map when a stage ends or the plan changes.

   Why: without a clear view of the whole project, the owner faces a blank page at every step and cannot see where the work is going.
2. **Never leave the next step empty, and wait at a review page.**
   - The next step is always named on the map and queued with what blocks it.
   - While a review page waits for the owner's answer, the agent stands by quietly for that answer: it does not prepare the next stage or ask the question anywhere else. Other items that nothing blocks keep moving.
   - Preparing the next stage while a page waits is the owner's preference, set once with their working preferences, and the recommended answer is no.
   - When the owner chose to have it prepared: gather its inputs, draft its plan and list its open questions, but never start it before approval.
   - If the owner changes an input, update the preparation first. That preparation is its own item, and no gate blocks it.

   Why: an empty next step stalls the work, preparation made before the answer is often redone when the answer changes it, and a stage started before approval may have to be done again.
3. **End every reply with where the work is.**
   - End each project reply with one plain line that says where the work is on the map, the next step, who takes it and when. For example: "Where we are: concepts are on the review page. Next: you answer the cards, then I offer the layout options."
   - Name the step in words, not as a count such as "step 3 of 6".
   - Say when as an event or a day, not a clock time.
   - When the owner takes the next step, say exactly what they need to do and link to it.

   Why: the owner always knows what comes next without asking, and a step count gives a number but does not say what to do.
4. **Queue the whole path at the start.**
   - When the map is drawn (phase 1), write every phase of the chosen path as an item in the work queue, each with what blocks it, not only the first one.
   - Add the research items of rule 3.6 and the fixed items of rule 1.6 as soon as they are known.

   Why: a queue that holds only the next item stops when that item ends, and the work waits for someone to remember the rest.
5. **A gate item ends every phase.**
   - The owner owns it, and the next phase is blocked by it.
   - When the owner's answer arrives, collect it, close the gate on the owner's words and start the next phase at once, without waiting to be asked.

   Why: one pattern gives both the stage gates and the momentum. The work stops exactly where the owner decides and nowhere else.
6. **No item without a blocker or a date.**
   - Every queued item names what it waits for or when it runs.
   - The only work that starts with neither is a standing item the owner approved once, such as a daily check or the improve item (phase 10).

   Why: an item with neither stalls without anyone noticing, and a habit the owner never approved is work they did not choose.
7. **Ask a few questions, then keep going.**
   - Ask the owner only the few questions that set the direction, each with a recommendation.
   - Inside a stage, when a choice can be undone, go ahead on the recommendation and fold in the answer when it comes.
   - When it cannot, hold only that branch and keep the rest moving.
   - Decisions only the owner can make (dates, money, people, taste, anything hard to undo) and every merge never start on their own.

   Why: waiting on every answer stalls the work, and acting on an answer that cannot be undone takes a decision away from the owner.
8. **Set the review stakes once per project, at capture.** The capture line says which of two review levels the project gets, and every later change in that project uses it without asking again:
   - **Full review run:** a public repository, or anything stakeholders or other people will see. Every change goes through the full validation and review run before it reaches them.
   - **Self-review:** private notes and throwaway prototypes. The worker checks its own change against the brief and the checks of section 4, and skips the full run.
   - When unsure, pick the full run.
   - When a project moves up (a prototype becomes the product, private notes are shared), say so in the status and switch it to the full run before the next change ships. A prototype that becomes the product gets the full run in phase 7.
   - The owner may change the stakes at any time; an agent never lowers them on its own.

   Why: the full run costs time and usage limits that throwaway work does not repay, and a level set once stops each change from being argued again. Choosing it change by change is a guess an automatic router cannot make well.

## 3. Evidence and research

1. **Requirements are the backbone.**
   - Organize all work by the requirements.
   - Research shows how others meet each requirement.
   - An idea that serves no requirement goes on a parked list with a reason.

   Why: research that goes straight into the product adds features nobody asked for.
2. **Grill for the requirements when the goal is vague.**
   - When work starts from a vague goal, project or problem, build the requirements first by grilling the stakeholders or clients. Do this before any research or building.
   - Beside the first round, a research worker checks whether it already exists: products and tools that already do it, and people in the organisation who already own or run something like it.
   - The answer goes into the next round as one card: build, reuse or stop.

   Why: research and building that start before the requirements are clear serve a guess, not a need, and the cheapest project is the one someone already runs.
3. **All research counts.**
   - Fold in every study, trial and lesson, and name the source of each item.
   - List what was not used and why.
   - When two sources disagree, show how they fit together in a conflicts table instead of dropping one.

   Why: research that is left out silently is research the owner paid for and lost.
4. **Show the evidence, not a summary.**
   - A findings page shows the real material (screens, documents) and says how deeply each source was read.
   - When there is a lot, give the owner a gallery to mark.

   Why: the owner judges coverage by what they can see.
5. **Start from what people already use.**
   - Begin with the tool and process the users know today.
   - Build the smallest thing that proves one idea.

   Why: a demo that tries to prove everything proves nothing, and an unfamiliar concept loses its audience.
6. **Research at every stage, without being asked.** Start research for each stage; do not wait for the owner to ask. These moments start a study:
   - A new goal: list the requirements, then research how established products meet each one (rules 3.1 and 3.2).
   - Findings: show an evidence gallery that states how much of each source was read (rule 3.4).
   - Before any visual work: study design references from a library of styles, screens and flows.
   - Feedback or a direction from the owner: check it online (rule 3.8). If the owner points to a product, study it (rule 3.9).
   - The end of a stage: include all research so far (rule 3.3).
   - A tool, product or service is named that the work does not use yet: check it live against each use the requirements name before anything is installed or bought (rule 3.10).
   - A card or open decision has no evidence behind it: before it goes to the owner, run one narrow study that answers that one question, and put the answer on the card's "Based on" line.
   - A stage gate is about to open: list the research that feeds the next stage, marked approved, replaced or missing. Each missing row becomes a research item for that stage.
   - A stakeholder date or an outside document arrives: check their stated needs against the current work before that date. Show which are met and the cheapest changes now.
   - The owner's feedback shows no effect: a fresh worker that did not build the work finds what was dropped, where and why. Each dropped item becomes a card: restore it, or confirm it is dropped.
   - A result is thin: before a findings page goes out, a fresh reviewer checks its depth (evidence for every requirement, real material, how much of each source was read). A thin result goes back for the same question, deeper, never for a wider one.
   - A new idea arrives partway through: if it serves a requirement of the current stage, a separate study starts beside the work without blocking it. Otherwise it is parked with the trigger that brings it back.

   How studies are queued and run:
   - Queue the start studies as items when the work is captured (rule 2.4): one per group of requirements, plus the check of rule 3.2. Every other moment above files its own item when it happens.
   - Name the research used in each stage output, and check this before passing it on (rule 4.7, the trace check).
   - Plan and judge each study on the strongest model, and hand fetching and reading to cheaper helpers (rule 7.1).
   - A study is done when it ends in a card the owner answers or a change they can see, never in a report alone.
   - A study names its requirement first, then each source and its type, and lists the research it did not use, with the reason.

   Six things stop research from widening the scope:
   - Requirements bound it. No study starts without a requirement or a card question. A new question found during a study is parked with a trigger, not added as a new track.
   - Reuse comes first. Every study starts from earlier research and names what it reuses.
   - One question per study for a card. The study ends when the question is answered.
   - The number of tracks is set at the start and said in the capture line. Another track is a new item the owner can see in the status.
   - Gates still hold. Research for a later stage starts after its gate, unless the owner chose to have the next stage prepared (rule 2.2). Even then its findings wait for the gate, and replaced work is never an input (rule 1.3).
   - Check the usage limits before a parallel fan-out starts, and pause near a limit.

   Why: research that waits to be requested comes too late, a stage that does not name its research rests on a guess, and research with no bound grows until it buries the decision it was for.
7. **Use trusted sources.**
   - Use usability research groups, design systems, standards bodies such as the W3C, and official documentation.
   - Name the type of each source.
   - Skip blogs and content farms.

   Why: a weak source makes a strong claim look settled.
8. **Check the owner's direction online.**
   - When the owner gives feedback or a direction, check it against trusted sources without being asked.
   - Show what the sources support and where they suggest a different path, with numbers.
   - When a source disagrees with the owner, show both options and recommend one (rule 5.1).
   - Name the types of sources in each card's "Based on" line (rule 4.2).

   Why: the owner decides faster and with more confidence when the evidence sits next to their own words.
9. **Study patterns the owner points to.**
   - Name the pattern. Find out how and why the product uses it, and where it does not.
   - Compare our own screens with the pattern and explain where they fall short.
   - Then adapt the pattern to the requirements. Do not copy the product.

   Why: a pattern copied without its reasons brings the other product's problems with it.
10. **Check tools before recommending them.**
    - Research a tool before installing it.
    - Before giving advice about a tool or purchase, check the vendor's pages again that day.
    - Give only current examples from a live ranking checked that day, and include the date.

    Why: tools, prices and rankings change every month, and memory goes out of date.

## 4. Review pages

1. **The owner decides from a page, never from a description.**
   - Put every decision, and every change to look or experience, on a review page before it is built.

   Why: people judge what they can see, and a question asked before the page exists is noise.
2. **One card at a time.**
   - Each card holds one decision or rule, a picture beside it where the picture makes the point clearer, little text, and clear choices (for example Agree, Change it, Reject).
   - End each card with a short "Based on" line that names the types of sources behind it, such as the owner's notes, a design system or a usability study.
   - Check the page before sharing it (rules 4.5 and 4.7).
   - At every stage end, send a short results page: what was found, what was decided and by whom, and what is still open.
   - Create the page without opening it, check it, then open it once for the owner and give the link. Do not only link it.
   - While the owner is away, open nothing: the link goes into the brief they get on return.

   Why: long pages overwhelm, a page that is only linked is often never seen, and a page that opens itself before it is checked can show the owner a broken page.
3. **Every element has a reason.**
   - Each element on a page or screen helps someone decide or act.
   - Remove filler text, captions and decoration.

   Why: anything without a reason makes the owner read instead of see.
4. **Present stakeholder pages live.**
   - When the owner needs to align other people, build a page they can present live in the meeting.
   - Give each item one card with Approve, Change or Discard and a note.
   - End with a summary the owner can copy.

   Why: answers given in the room are recorded at once, and the summary goes straight into the meeting notes.
5. **Check the page before sharing it.**
   - Open it at the owner's target screen size first (checkpoints.md, step 18), then at laptop width and phone width.
   - Check that font sizes and column positions stay the same on every card and tab.
   - Use plain names, never internal codes made of a letter and a number.
   - Then open the hosted page itself. Check that it loads, has no answers yet and includes every source it cites.
   - Only then tell the owner it is ready.

   Why: the owner notices changes in font size or column position before the content, codes force them to look things up, and a page marked ready that is broken or already answered wastes a round.
6. **Four review points.** The owner reviews at four points, each on a page built from the same card template:

   | Review point | Phase | What the page shows | The owner answers |
   | --- | --- | --- | --- |
   | Round page | 2, 3 | What is settled on top, then one question per card, each with a recommendation (rule 5.3) | Yes, a pick, or a note |
   | Checkpoint page | 5 | Options the owner can flip between, with real screenshots | Keep, Change or Discard. Comments are not agreement (rule 1.2) |
   | Preview page | 8 | The build running. The first line says which code it runs and which data: sample data, or real data the owner has already allowed | Keep, Change or Discard, then the word to merge |
   | Outcomes page | The end of each phase | What was found, what was decided and by whom, what it means, what is still open | Next, or a note |

   - What only the owner can judge (taste, look and feel) is never graded by an agent. It goes on a card with a recommendation.
   - When several pages are ready at once, hold them, check them against each other (each question asked once, no clashing recommendations, one set of names) and hand them over together in the order to take them.
   - A page for a gate goes alone.

   Why: a few fixed review points tell the owner when they are needed, and everything between them can run without waiting.
7. **Six checks before any page reaches the owner.** Run them in this order. A failure stops the page until it is fixed or becomes a card for the owner.
   1. The principle checker in this skill's `principles/` folder, run on the page and its words.
   2. A fresh reviewer who did not build the work, briefed with the reviewer list in `principles/checks.md`, looking at screenshots.
   3. The trace check: every item names its requirement and its research source, and research that was not used is listed with the reason (rule 3.3).
   4. The live-state check: every status line and every "done" is checked against the live state, and a few real items are opened and read (checkpoints.md, step 12).
   5. The words check: every text a person will read goes to a second model (rule 6.1).
   6. The screenshot check: the page really renders at the target sizes (rule 4.5).

   Why: each check catches a failure the owner would otherwise find first, and the owner's time goes to decisions, not to finding mistakes.

## 5. Asking and acting

1. **Check before you ask.**
   - Search the owner's earlier rulings and the stated goal first. If the answer is there, act and tell the owner in one line.
   - Ask only about taste, intent, risk, money or people, and always give a recommendation.
   - When asking in chat, use a structured question: one clear question at a time, a small sketch of each option, and the recommended option first.

   Why: most questions are already answered, and each extra question costs the owner attention.
2. **Keep work moving.**
   - Act on anything the owner is not blocking.
   - Keep a pass to what the owner named, and ask before widening it.
   - Merge follows the merge rule in working-preferences.md.
   - Product code, sign-in, real data and anything risky wait for the owner's word.

   Why: asking for approval on things the owner cannot judge wastes their time, and widening a pass changes things they did not choose.
3. **A round reaches the owner one question at a time.**
   - A round decides what is asked now: the open questions that can be answered now, with facts looked up instead of asked.
   - How it reaches the owner is separate: one question or one card at a time, each with a recommendation, worded so that "yes" takes the recommendation. Put what is already settled first.
   - In chat, use the question tool, never a numbered list of questions.
   - On a page, the round is one page from the card template, its cards shown one at a time, with one send at the end.
   - Ask the next round only after the answers.

   Why: a list of questions makes the owner hunt for the one to answer, and a round that asks what is not yet answerable wastes a turn.

## 6. Wording

1. **A second model checks every text a person will read.**
   - Before handover, send the wording to a strong model from another family through an agent CLI this setup installed, with full context: what the page is, who reads it, the tone, and what must not change.
   - Use its wording unless it breaks a fact, a name, a rule or wording the owner already approved.
   - Never send private material, only your own wording.

   Why: the agent that wrote the text cannot hear how it sounds, and a bare list of strings gets a shallow answer.
2. **Plain words.**
   - Short sentences, everyday words, one word for one thing.
   - Anything others will read is written as the owner, with no agent or crew wording, internal codes or citations.

   Why: jargon stalls decisions, and outsiders do not know or care about the agents.
3. **Check names from speech.** The owner often dictates, and speech to text can change names and terms.
   - Match each name or term to the correct spelling in the records, and use that spelling.
   - State your choice in one line so the owner can correct it.
   - Quote the owner's words as spoken.

   Why: a misheard name that reaches a page or a rule spreads to every later stage.

## 7. Models and briefs

1. **Match the model to the job.** Pick by the kind of job:

   | Job | Model and effort |
   | --- | --- |
   | Building, and anything not named below | The strongest model at medium effort |
   | Research, investigations, diagnosis and plans | The strongest model at high effort. Re-run at extra-high effort when the result is weak or the cause is hard to find, then build at medium once the cause is proven or the plan is settled |
   | A new look that is not settled yet (screens, layout, clickable journeys) | The strongest model at extra-high effort |
   | Polish of a look that is already settled (spacing, copy, states, small layout fixes) | The strongest model at high effort |
   | Small, clear tasks (a bug with a clear reproduction, a docs or copy edit, a version bump, a config tweak) | A faster model at high effort. After a failed check, re-run it on the strongest model at medium effort |
   | Bulk fetching, reading and summaries | Cheap helpers: a fetcher finds the information, a reader on the fastest model summarizes it, and a faster model at high effort drafts |

   - Give each helper one task, and check its work yourself.
   - Use a model above these only when the owner names it for a task.
   - A coordinator running at a lower effort than this table picks never writes the plan itself. It hands planning to a worker at the right effort and checks the effort that actually started.

   Why: quota is limited, and planning at the wrong effort quietly lowers the quality of everything built on it.
2. **One complete brief.**
   - Each worker gets one brief: the owner's exact words, the whole goal, every earlier report and version (not a chosen subset), the current rulings, the tools ruled out, and the finish line.
   - Never drip steps.

   Why: step-by-step prompts make a builder loop on details and miss the main idea, and a partial inventory hides earlier work.
3. **Standing lines in every build brief.**
   - Each build item (phase 7) names the approved prototype page it builds.
   - A spec with several items builds on one integration branch. An item starts when its blockers have merged into that branch.
   - Each worker merges the branch tip into its own work and re-runs the checks before it reports done.
   - The pull request body opens with the smallest visual that shows the change (a screenshot, a short clip or a before and after), then the evidence that it works, then the merge danger: whether it can be undone easily, and what else it touches if it goes wrong.

   Why: a worker that builds from a description instead of the approved page drifts from it, items merged one by one into the main branch clash late, and a reviewer who cannot see the change or its risk either waves it through or holds it too long.

## 8. Memory and status

1. **Save the owner's words when they say them.**
   - Keep one record of rulings with the owner's words, the date and the status. The newest ruling wins, and replaced rulings are marked.
   - Every brief carries the active rulings.
   - Save the session's lessons before the context is compacted, every time, and tell the owner when that is done.

   Why: a rebuild that forgets one ruling repeats the mistake that ruling fixed, and a compaction without a save loses what the owner taught.
2. **Status the owner can act on.**
   - Follow the status-and-away skill for status replies.

   Why: a status built from memory hides stalls, and a long status buries the owner's asks.

## 9. Improve

This section is phase 10. It keeps the way of working, and this playbook, current.

1. **Record each method lesson when it happens.**
   - When the owner corrects the way of working, write the lesson down in one line with what triggered it.
   - At each stage end, fold the lessons into this playbook.
   - Show every change to the playbook on a review page before it ships.

   Why: a method that is not written down has to be taught again on the next project.
2. **Improve as a standing item.**
   - The improve item is a dated, repeating item that the owner approves once. It also follows every merge (phase 9).
   - Each run looks back over the finished work or the last day: what slowed the work, which of the owner's corrections came more than once, and which check failed most.
   - Sort each finding: a mechanical slip becomes a script check, and a judgement call becomes a reviewer check or a written rule.
   - Each proposal goes to the owner as a card. Approved ones land as a check, a rule or a playbook change.
   - Edits to saved memory are proposed, never made on their own.

   Why: the coordinator never starts work in an empty queue, so a look back runs only if it is an approved item, and a lesson that does not become a check is made again.
3. **Save, then compact, at a phase boundary.**
   - When the context needs compacting, finish the phase step in hand.
   - Save the session's lessons and the owner's rulings (rule 8.1), then compact.

   Why: compacting in the middle of a step loses the half-done work, and compacting before a save loses what the owner taught.

## 10. From a weak prototype to an aligned rules list

- When a scattered prototype has to reach a direction the owner likes, an approved journey map and one agreed rules list, read `checkpoints.md` in this skill's folder and follow its steps.
- It holds 25 steps in three checkpoints, most with a reusable prompt. The steps named above (step 12, step 18) are its steps.
- Add the next checkpoint only when the owner says the next stage is good.

Why: writing down the steps and prompts makes a direction that took many rounds to find faster to reach next time.
