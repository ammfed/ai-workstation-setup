---
name: workflow-playbook
description: A working method for long projects run by one owner with AI agents. Use when a new goal takes more than one session, when capturing an idea and choosing which phases it needs, when planning or running multi-stage work (research, concepts, layout options, wireframes, build), when reworking a weak prototype into a liked direction, an approved journey map and an aligned rules list, when any stage needs research, when briefing a worker or helper, when building a review page for the owner or a page for stakeholders, or when deciding whether to ask the owner or act.
---

# Workflow playbook

These rules come from a long project that was restarted several times. Every restart had the same cause: work moved ahead of the owner's decisions, or research went into the product without a purpose. Each rule below fixes one of those failures, or a later one: the owner was left with a blank page and no clear next step. The owner is the person who decides. Agents and workers do the rest.

## Phases, from an idea to shipped and improved

Every piece of work runs through some of these ten phases, in this order. Each phase has one owner, so two skills never do the same job. The route column is the step of the software route (`docs/route.md` in this setup) that the phase belongs to, so the two never disagree. A gate is an item only the owner closes (rule 2.5).

| Phase | Route step | Goal | Leads | Owner | Hands to | The next phase starts when |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Capture | Plan | Write the idea down, judge whether it fits and when, pick the phases from the table below | The coordinator | wayfinder | A map with every phase of the path queued as an item (rule 2.4) | The map is written. The first item has no blocker |
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

1. **Work in gates, one at a time.** Findings, then the owner's agreement. Concepts, then the owner's approval. Layout options, then the owner's pick. Wireframes, then the build. Never start a stage whose input the owner has not approved.
   Why: a stage built on unapproved input is thrown away when that input changes.
2. **Comments are not agreement.** When the owner comments, rework those points and show them again. Move on only when the owner says they agree.
   Why: treating a comment as a yes builds the next stage on a guess.
3. **Each stage builds on the last.** A stage output opens with what it takes from the stage before and what it hands to the next. Replaced work stays on record, but it never feeds a new stage.
   Why: stages that do not name their inputs drift apart, and old work leaks back in.
4. **Pick the layout before the wireframes.** After the owner approves the concepts, study the full interfaces the owner liked. Study whole screens, not single parts. Then offer 3 layout options using the same few key screens for every option. Each option defines a page frame and page patterns. The page frame sets what stays the same across screens, including the header, navigation and main areas. Page patterns define the screen types that repeat, such as a list with details, a dashboard or a step-by-step form. Start the wireframes only after the owner picks an option. Draw all wireframes using the chosen page frame and page patterns.
   Why: wireframes drawn straight from concepts come out scattered, with each concept pushed into its own page.
5. **Build work for other audiences last.** Build a deck, demo or report for others just before its date. Use the latest approved stage. Include a journey showcase with the hours spent, the rounds and old screens beside the new ones. Track time from the session logs. Count active time by adding the gaps between events that are under 5 minutes apart. Count calendar time from the first event to the last. State which measure you use.
   Why: work built early may show a stage that has since changed. The showcase shows the effort behind the result. Calendar time includes nights and waiting periods, so it makes the work look longer than it was.
6. **Some items are always on the list.** Breakdown (phase 6) adds these items whenever they apply, before any other build item:
   - **System design first.** The first build item settles the contracts, the data model and the hard-to-reverse decisions. Front end and back end work start only after it.
   - **Outside approvals as held items.** Any approval someone else owns (security, IT, a client) becomes its own held item at once, so the wait shows early.
   - **An evaluation item for any AI part.** Test how well the AI part does its job on real examples before any pilot.
   - **A real-user try-out.** When real people will use the result, they try the prototype, guided by a short questionnaire. The results come back as a card.
   - **A handover item.** When real people will run or use it, an item names who runs it and how they learn it, blocked by the last build item.

   Finished items stay on the list, marked done, never deleted. Dates belong to the owner: agents never set or move a date, they only flag one that has passed.
   Why: each of these is easy to forget until it blocks a launch, and a date moved by an agent hides the slip the owner needs to see.

## 2. Lead the way

1. **Start the map yourself.** When a new goal takes more than one session, start a map at once. Do not wait for the owner to ask. The map names the goal, the stages from here to the goal, where the work is now and the next step. If the goal is vague, the first stage is to define the requirements. Show the map to the owner, then lead the work one step at a time. Update the map when a stage ends or the plan changes.
   Why: without a clear view of the whole project, the owner faces a blank page at every step and cannot see where the work is going.
2. **Never leave the next step empty.** While the owner reviews a stage, prepare the next one. Gather its inputs, draft its plan and list its open questions. Keep the stage gates: prepare a stage that needs approval, but never start it before approval. If the owner changes an input, update the preparation first. The preparation is its own item and no gate blocks it.
   Why: an empty next step stalls the work, and a stage started before approval may have to be done again.
3. **End every reply with where the work is.** End each project reply with one plain line that says where the work is on the map, the next step, who takes it and when. For example: "Where we are: concepts are on the review page. Next: you answer the cards, then I offer the layout options." Name the step in words, not as a count such as "step 3 of 6". Say when as an event or a day, not a clock time. When the owner takes the next step, say exactly what they need to do and link to it.
   Why: the owner always knows what comes next without asking, and a step count gives a number but does not say what to do.
4. **Queue the whole path at the start.** When the map is drawn (phase 1), write every phase of the chosen path as an item in the work queue, each with what blocks it, not only the first one. Add the research items of rule 3.6 and the fixed items of rule 1.6 as soon as they are known.
   Why: a queue that holds only the next item stops when that item ends, and the work waits for someone to remember the rest.
5. **A gate item ends every phase.** The owner owns it, and the next phase is blocked by it. When the owner's answer arrives, collect it, close the gate on the owner's words and start the next phase at once, without waiting to be asked.
   Why: one pattern gives both the stage gates and the momentum. The work stops exactly where the owner decides and nowhere else.
6. **No item without a blocker or a date.** Every queued item names what it waits for or when it runs. The only work that starts with neither is a standing item the owner approved once, such as a daily check or the improve item (phase 10).
   Why: an item with neither stalls without anyone noticing, and a habit the owner never approved is work they did not choose.
7. **Ask a few questions, then keep going.** Ask the owner only the few questions that set the direction, each with a recommendation. When a choice can be undone, go ahead on the recommendation and fold in the answer when it comes. When it cannot, hold only that branch and keep the rest moving. Decisions only the owner can make (dates, money, people, taste, anything hard to undo) and every merge never start on their own.
   Why: waiting on every answer stalls the work, and acting on an answer that cannot be undone takes a decision away from the owner.

## 3. Evidence and research

1. **Requirements are the backbone.** Organize all work by the requirements. Research shows how others meet each requirement. An idea that serves no requirement goes on a parked list with a reason.
   Why: research that goes straight into the product adds features nobody asked for.
2. **Grill for the requirements when the goal is vague.** When work starts from a vague goal, project or problem, build the requirements first by grilling the stakeholders or clients. Do this before any research or building. Beside the first round, a research worker checks whether it already exists: products and tools that already do it, and people in the organisation who already own or run something like it. The answer goes into the next round as one card: build, reuse or stop.
   Why: research and building that start before the requirements are clear serve a guess, not a need, and the cheapest project is the one someone already runs.
3. **All research counts.** Fold in every study, trial and lesson. Name the source of each item. List what was not used and why. When two sources disagree, show how they fit together in a conflicts table instead of dropping one.
   Why: research that is left out silently is research the owner paid for and lost.
4. **Show the evidence, not a summary.** A findings page shows the real material (screens, documents) and says how deeply each source was read. When there is a lot, give the owner a gallery to mark.
   Why: the owner judges coverage by what they can see.
5. **Start from what people already use.** Begin with the tool and process the users know today. Build the smallest thing that proves one idea.
   Why: a demo that tries to prove everything proves nothing, and an unfamiliar concept loses its audience.
6. **Research at every stage, without being asked.** Start research for each stage. Do not wait for the owner to ask.
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

   Queue the start studies as items when the work is captured (rule 2.4): one per group of requirements, plus the check of rule 3.2. Every other moment above files its own item when it happens. Name the research used in each stage output. Check this before passing it on (rule 4.5). Plan and judge each study on the strongest model and hand fetching and reading to cheaper helpers (rule 7.1).

   A study is done when it ends in a card the owner answers or a change they can see, never in a report alone. It names its requirement first, then each source and its type, and lists the research it did not use, with the reason.

   Six things stop research from widening the scope:
   - Requirements bound it. No study starts without a requirement or a card question. A new question found during a study is parked with a trigger, not added as a new track.
   - Reuse comes first. Every study starts from earlier research and names what it reuses.
   - One question per study for a card. The study ends when the question is answered.
   - The number of tracks is set at the start and said in the capture line. Another track is a new item the owner can see in the status.
   - Gates still hold. Research for a later stage may be prepared, but its findings wait for the gate, and replaced work is never an input (rule 1.3).
   - Check the usage limits before a parallel fan-out starts, and pause near a limit.

   Why: research that waits to be requested comes too late, a stage that does not name its research rests on a guess, and research with no bound grows until it buries the decision it was for.
7. **Use trusted sources.** Use usability research groups, design systems, standards bodies such as the W3C, and official documentation. Name the type of each source. Skip blogs and content farms.
   Why: a weak source makes a strong claim look settled.
8. **Check the owner's direction online.** When the owner gives feedback or a direction, check it against trusted sources without being asked. Show what the sources support and where they suggest a different path, with numbers. When a source disagrees with the owner, show both options and recommend one (rule 5.1). Name the types of sources in each card's "Based on" line (rule 4.2).
   Why: the owner decides faster and with more confidence when the evidence sits next to their own words.
9. **Study patterns the owner points to.** Name the pattern. Find out how and why the product uses it, and where it does not. Compare our own screens with the pattern and explain where they fall short. Then adapt the pattern to the requirements. Do not copy the product.
   Why: a pattern copied without its reasons brings the other product's problems with it.
10. **Check tools before recommending them.** Research a tool before installing it. Before giving advice about a tool or purchase, check the vendor's pages again that day. Give only current examples from a live ranking checked that day, and include the date.
    Why: tools, prices and rankings change every month, and memory goes out of date.

## 4. Review pages

1. **The owner decides from a page, never from a description.** Put every decision, and every change to look or experience, on a review page before it is built.
   Why: people judge what they can see, and a question asked before the page exists is noise.
2. **One card at a time.** Each card holds one decision or rule, a picture beside it where the picture makes the point clearer, little text, and clear choices (for example Agree, Change it, Reject). End each card with a short "Based on" line that names the types of sources behind it, such as the owner's notes, a design system or a usability study. Check the page before sharing it (rule 4.5). At every stage end, send a short results page: what was found, what was decided and by whom, and what is still open. Open the page for the owner. Do not only link it.
   Why: long pages overwhelm, and a page that is only linked is often never seen.
3. **Every element has a reason.** Each element on a page or screen helps someone decide or act. Remove filler text, captions and decoration.
   Why: anything without a reason makes the owner read instead of see.
4. **Present stakeholder pages live.** When the owner needs to align other people, build a page they can present live in the meeting. Give each item one card with Approve, Change or Discard and a note. End with a summary the owner can copy.
   Why: answers given in the room are recorded at once, and the summary goes straight into the meeting notes.
5. **Check the page before sharing it.** Open it at the owner's target screen size first (step 18), then at laptop width and phone width. Check that font sizes and column positions stay the same on every card and tab. Use plain names, not internal codes such as Q1 or K1. Then open the hosted page itself. Check that it loads, has no answers yet and includes every source it cites. Only then tell the owner it is ready.
   Why: the owner notices changes in font size or column position before the content, codes force them to look things up, and a page marked ready that is broken or already answered wastes a round.

## 5. Asking and acting

1. **Check before you ask.** Search the owner's earlier rulings and the stated goal first. If the answer is there, act and tell the owner in one line. Ask only about taste, intent, risk, money or people, and always give a recommendation. When asking in chat, use a structured question. Ask one clear question at a time, show a small sketch of each option and put the recommended option first.
   Why: most questions are already answered, and each extra question costs the owner attention.
2. **Keep work moving.** Act on anything the owner is not blocking. Keep a pass to what the owner named, and ask before widening it. Merge low-risk paperwork (notes, records, prototypes) once checks pass, if the owner has granted that. Product code, sign-in, real data and anything risky wait for the owner's word.
   Why: asking for approval on things the owner cannot judge wastes their time, and widening a pass changes things they did not choose.

## 6. Wording

1. **A second model checks every text a person will read.** Before handover, send the wording to a strong second model (for example ChatGPT) with full context: what the page is, who reads it, the tone, and what must not change. Use its wording unless it breaks a fact, a name, a rule or wording the owner already approved. Never send private material, only your own wording.
   Why: the agent that wrote the text cannot hear how it sounds, and a bare list of strings gets a shallow answer.
2. **Plain words.** Short sentences, everyday words, one word for one thing. Anything others will read is written as the owner, with no agent or crew wording, internal codes or citations.
   Why: jargon stalls decisions, and outsiders do not know or care about the agents.
3. **Check names from speech.** The owner often dictates, and speech to text can change names and terms. Match each name or term to the correct spelling in the records and use that spelling. State your choice in one line so the owner can correct it. Quote the owner's words as spoken.
   Why: a misheard name that reaches a page or a rule spreads to every later stage.

## 7. Models and briefs

1. **Match the model to the job.** Use the strongest model at high effort for research, investigations and plans. Raise the effort to the highest setting only for a new visual design or when the result is weak. Use the strong model at medium effort for building. Use a smaller model for small, clear tasks, and cheap helpers for bulk work: use a fetcher to find information and a reader to summarize it. Give each helper one task, and check its work yourself. A coordinator running at low or medium effort never writes the plan itself. It hands planning to a worker at the right effort and checks the effort that actually started.
   Why: quota is limited, and planning at the wrong effort quietly lowers the quality of everything built on it.
2. **One complete brief.** Each worker gets one brief: the owner's exact words, the whole goal, every earlier report and version (not a chosen subset), the current rulings, the tools ruled out, and the finish line. Never drip steps.
   Why: step-by-step prompts make a builder loop on details and miss the main idea, and a partial inventory hides earlier work.

## 8. Memory and status

1. **Save the owner's words when they say them.** Keep one record of rulings with the owner's words, the date and the status, where the newest ruling wins and replaced rulings are marked. Every brief carries the active rulings. Save the session's lessons before the context is compacted, every time, and tell the owner when that is done.
   Why: a rebuild that forgets one ruling repeats the mistake that ruling fixed, and a compaction without a save loses what the owner taught.
2. **Status the owner can act on.** Lead with what needs the owner, then what is at risk, then a short table of to do, doing and done. Check live state before saying anything is in progress. Give a link for every finished item. No clock times and no narration of your own steps.
   Why: a status built from memory hides stalls, and a long status buries the owner's asks.

## 9. Keep the playbook current

1. **Record each method lesson when it happens.** When the owner corrects the way of working, write the lesson down in one line with what triggered it. At each stage end, fold the lessons into this playbook. Show every change to the playbook on a review page before it ships.
   Why: a method that is not written down has to be taught again on the next project.

## 10. From a weak prototype to an aligned rules list

These steps took a scattered prototype to a wireframe direction the owner liked (checkpoint 1), then to an understanding page and a journey map the owner approved (checkpoint 2), then to one rules list and an alignment page the owner liked (checkpoint 3). Add the next checkpoint only when the owner says the next stage is good. Most steps end with a reusable prompt. Fill in the words in brackets.
Why: writing down the steps and prompts makes a direction that took many rounds to find faster to reach next time.

### Checkpoint 1: a liked wireframe direction

1. **Walk it as the people who use it.** Give each role a name and walk through its full journey in the prototype. Click only what that person would click. Sort the findings by type (gap, distraction, inconsistency), count them, and save a screenshot of each.
   Prompt: "Walk through the prototype as each role, from start to end. List every finding by type, with counts and screenshots. Change nothing yet."
2. **Find the causes.** Group the findings into a few root causes and rank them by harm. Common causes include links that lose track of who the person is, tasks that stop at the decision with no after state, journeys with no first or last step, to-do lists that disagree, one thing in two places, and items that open the wrong record. Confirm each symptom in the prototype before naming its cause.
   Prompt: "From the walk, identify the root causes and rank them by harm. Confirm each symptom before naming its cause."
3. **Let the owner pick the approach.** Offer approaches and recommend one (rule 5.1). For example, start with the journey: create one flow per role, then make a clickable walk-through.
   Prompt: "Fix it [journey first]: one flow per role, then a clickable walk-through."
4. **Gather the references.** Put all references in one folder. Include competitor screens, screens the owner liked in the old tool, fresh captures of the current tool, and other screens the owner liked. Note what the owner liked about each one.
   Prompt: "My references are in [folder]. Use them for the polish pass."
5. **Make smooth measurable.** Turn smooth into five checks, each with a target of 0: dead ends, links to another person's page, main actions with no after state, journeys with no reachable first or last step, and to-do lists that disagree. Automatically re-walk every role in every mode at laptop and phone widths. Then test with real clicks. Repeat until every check is 0.
   Prompt: "Define smooth as checks you can count, with a target of 0. Re-walk every role in every mode, at laptop and phone widths, until all checks are 0."
6. **Give the builder room.** Hand over the full goal in one brief (rule 7.2). Inside the stage, drop the approval stops between rounds, but keep the measured bar. The owner can then make selective edits.
   Prompt: "Do the [journey-first] fix and iterate. Then we do the selective editing. I give you room to come back with the smoothest journey."
7. **Polish from the references.** Stay in the wireframe stage. Borrow layout, order, interaction and wording, but not colour or visual design. Log each idea with its source screen and the reason it makes a screen clearer, faster or more engaging (rule 3.3). Re-walk to keep every check at 0.
   Prompt: "Polish from my references. Log each idea with its source screen and its reason. Nothing goes in without a reason."
8. **Check the copy.** Send every line a person will read to a second model (rule 6.1). Then re-walk.
9. **Show one complete review page.** Put every open decision on one page (section 4). Do not ask for some of the decisions early while a follow-up pass is still running.
10. **Save the liked state.** Before any rework, save a read-only copy and an archive with a checksum. This lets you restore the liked state.
    Prompt: "Save this version as a checkpoint before you change anything."
11. **Start the next pass right.** After the owner's feedback, restate what you understood and ask about the gaps first. Sort the references to match the wireframe pages one to one. Create a numbered folder for each page, put that page's wireframe first, and include an index. Place each image using a vision check and an independent second check. The target is 0 misplaced images. When the owner is unsure, build options the owner can see and try, as in rule 1.4, instead of asking abstract questions.
    Prompt: "Tell me what you understood and ask about the gaps. When I am unsure, show me options I can click through."
12. **Spot-check real content.** Before calling anything done, open real items, such as screens, records or pages, and read their content. Do not rely on counts alone.
    Prompt: "Before you say it is done, open [a few] real [screens] and check what they say."

### Checkpoint 2: an approved understanding page and journey map

Start here when the owner likes the direction, has walked through it and has shared comments.

13. **Settle the comments before the next design round.** Do not change anything yet. Build one understanding page (section 4) in this order: the read-back, the journey and screen map, the open patterns, the gaps, the questions, the target screen and a Settled card. Start the next round only after the owner agrees to the Settled card (rule 1.2).
    Prompt: "Before you change anything, show me on one page what you understood from my comments."
14. **Read back every comment.** Restate each feedback point in your own words. Show the screens it affects side by side. The owner marks each point Right, Partly or Wrong. Then read back the owner's free notes in the order they wrote them.
    Prompt: "Read back each of my points with the screens side by side, so I can mark it Right, Partly or Wrong. Then read back my notes in order."
15. **Map the journeys and screens for each role.** Start with the roles and their journeys. Then list the sections, views and side views. For each role, name the first screen, what matters most, what stays out of sight and where work passes to another role.
    Prompt: "Map the roles and journeys first, then the sections, views and side views. For each role, show the first screen, what matters, what stays out of sight and the hand-offs."
16. **Research open patterns.** For each open pattern question, study how modern products solve it. Show the examples and pick one (rule 3.4).
    Prompt: "For [the open pattern], show me how modern products do it and pick one."
17. **List the gaps, then ask the few questions.** List the gaps the owner did not mention, each with a pick. Then ask only the questions that research cannot answer. Give a recommendation for each question (rule 5.1).
    Prompt: "List the gaps I did not mention, each with your pick. Ask me only what research cannot answer."
18. **Settle the target screen.** Ask for the owner's actual screen size and the usable browser area inside it. Design for that size first. Then check larger and smaller widths, including a phone, in every re-walk (step 5).
    Prompt: "My screen is [size] and the browser area is [size]. Design at that size, then check larger and smaller widths."
19. **Close with a Settled card.** End the page with one card that lists everything settled. Check the page against the real screens before sending it (step 12). Once the owner agrees, start the next design round from the Settled card only (rule 1.3).
    Prompt: "End the page with a Settled card. Build nothing until I agree to it."

### Checkpoint 3: align on one rules list

Start here when the owner has approved a walk-through but each new note changes the plan. Stop reworking and agree on the rules first.

20. **Bring all feedback into one rules list.** Pause the rework. Read every note from the owner, not just the latest one. Write one rules list. Link each rule to its source note by file and line. Add a conflicts table that lists each conflict, how it was settled, why, and which decisions need the owner's approval. Replace the old list with the new one. Use earlier lists only as input (rule 1.3).
    Prompt: "Pause. Bring all my feedback into one rules list. Show the source of each rule and list the conflicts in a table. Then agree on the rules with me before you start again."
21. **Study the pattern the owner points to.** Before changing the rules list, study the pattern as described in rule 3.9. Check our own screens at the target sizes (step 18).
    Prompt: "I like how [product] handles [pattern]. Find out what it is, how and why they use it, and whether it solves [problem] here. Adapt it, do not copy it."
22. **Check every direction online.** Check each direction in the rules list as described in rule 3.8. If a source disagrees with the owner, show both options on the alignment page.
    Prompt: "Check my direction online against design systems, usability research and W3C standards. If they disagree with me, show me both options."
23. **Draw sketches from one script and one words file.** Draw grey sketches that show shapes, not colours. Draw each screen at the target size, at a smaller size and at a larger size. If the product supports a right to left language, draw those layouts too. Keep all sketch text in one words file that one script reads. Then one wording change can update every sketch.
    Prompt: "Sketch each screen in grey at [three sizes] and in right to left layouts where needed. Keep all the words in one file, so one change updates every sketch."
24. **Check that you agree on everything.** Build one alignment page (section 4). Show what changed, then one card for each change with a sketch beside it, then the rules list with its open decisions, then the order for rebuilding. End with one card like the Settled card (step 19): "Are we 100 percent aligned?" with Go, Not yet and a note. Rebuild only after Go (rule 1.2).
    Prompt: "Show me the rules and sketches on one page. End with 'Are we 100 percent aligned?' Do not build anything until I say Go."
25. **Update the page until Go.** When the owner answers Not yet or adds notes, update the rules list (step 20) and send an updated page. Start with "What changed since your answers". Mark every rule New, Changed, Same or Dropped. End with the same Go card. Repeat until the owner says Go.
    Prompt: "Update the page with my answers. Start with what changed, mark every rule and end with the Go card again."
