# From a weak prototype to an aligned rules list

Section 10 of the workflow playbook (`SKILL.md` in this folder). The rules and reasons there apply to every step here.

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
