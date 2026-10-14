---
name: workflow-playbook
description: A working method for long projects run by one owner with AI agents. Use when a new goal takes more than one session, when planning or running multi-stage work (research, concepts, wireframes, build), when briefing a worker or helper, when building a review page for the owner, or when deciding whether to ask the owner or act.
---

# Workflow playbook

These rules come from a long project that was restarted several times. Every restart had the same cause: work moved ahead of the owner's decisions, or research went into the product without a purpose. Each rule below fixes one of those failures, or a later one: the owner was left with a blank page and no clear next step. The owner is the person who decides. Agents and workers do the rest.

## 1. Stage gates

1. **Work in gates, one at a time.** Findings, then the owner's agreement. Concepts, then the owner's approval. Wireframes, then the build. Never start a stage whose input the owner has not approved.
   Why: a stage built on unapproved input is thrown away when that input changes.
2. **Comments are not agreement.** When the owner comments, rework those points and show them again. Move on only when the owner says they agree.
   Why: treating a comment as a yes builds the next stage on a guess.
3. **Each stage builds on the last.** A stage output opens with what it takes from the stage before and what it hands to the next. Replaced work stays on record, but it never feeds a new stage.
   Why: stages that do not name their inputs drift apart, and old work leaks back in.

## 2. Lead the way

1. **Start the map yourself.** When a new goal takes more than one session, start a map at once. Do not wait for the owner to ask. The map names the goal, the stages from here to the goal, where the work is now and the next step. If the goal is vague, the first stage is to define the requirements. Show the map to the owner, then lead the work one step at a time. Update the map when a stage ends or the plan changes.
   Why: without a clear view of the whole project, the owner faces a blank page at every step and cannot see where the work is going.
2. **Never leave the next step empty.** While the owner reviews a stage, prepare the next one. Gather its inputs, draft its plan and list its open questions. Keep the stage gates: prepare a stage that needs approval, but never start it before approval. If the owner changes an input, update the preparation first.
   Why: an empty next step stalls the work, and a stage started before approval may have to be done again.
3. **End every reply with where the work is.** End each project reply with one plain line that says where the work is on the map, the next step, who takes it and when. For example: "Concepts are on the review page. Next: you answer the cards, then I draft the wireframe plan." Name the step in words, not as a count such as "step 3 of 6". Say when as an event or a day, not a clock time.
   Why: the owner always knows what comes next without asking, and a step count gives a number but does not say what to do.

## 3. Evidence first

1. **Requirements are the backbone.** Organize all work by the requirements. Research shows how others meet each requirement. An idea that serves no requirement goes on a parked list with a reason.
   Why: research that goes straight into the product adds features nobody asked for.
2. **Grill for the requirements when the goal is vague.** When work starts from a vague goal, project or problem, build the requirements first by grilling the stakeholders or clients. Do this before any research or building.
   Why: research and building that start before the requirements are clear serve a guess, not a need.
3. **All research counts.** Fold in every study, trial and lesson. Name the source of each item. List what was not used and why. When two sources disagree, show how they fit together instead of dropping one.
   Why: research that is left out silently is research the owner paid for and lost.
4. **Show the evidence, not a summary.** A findings page shows the real material (screens, documents) and says how deeply each source was read. When there is a lot, give the owner a gallery to mark.
   Why: the owner judges coverage by what they can see.
5. **Start from what people already use.** Begin with the tool and process the users know today. Build the smallest thing that proves one idea.
   Why: a demo that tries to prove everything proves nothing, and an unfamiliar concept loses its audience.

## 4. Review pages

1. **The owner decides from a page, never from a description.** Put every decision, and every change to look or experience, on a review page before it is built.
   Why: people judge what they can see, and a question asked before the page exists is noise.
2. **One card at a time.** Each card holds one decision or rule, a picture beside it where the picture makes the point clearer, little text, and clear choices (for example Agree, Change it, Reject). Check it on a laptop and on a phone. At every stage end, send a short results page: what was found, what was decided and by whom, and what is still open. Open the page for the owner. Do not only link it.
   Why: long pages overwhelm, and a page that is only linked is often never seen.
3. **Every element has a reason.** Each element on a page or screen helps someone decide or act. Remove filler text, captions and decoration.
   Why: anything without a reason makes the owner read instead of see.

## 5. Asking and acting

1. **Check before you ask.** Search the owner's earlier rulings and the stated goal first. If the answer is there, act and tell the owner in one line. Ask only about taste, intent, risk, money or people, and always give a recommendation.
   Why: most questions are already answered, and each extra question costs the owner attention.
2. **Keep work moving.** Act on anything the owner is not blocking. Keep a pass to what the owner named, and ask before widening it. Merge low-risk paperwork (notes, records, prototypes) once checks pass, if the owner has granted that. Product code, sign-in, real data and anything risky wait for the owner's word.
   Why: asking for approval on things the owner cannot judge wastes their time, and widening a pass changes things they did not choose.

## 6. Wording

1. **A second model checks every text a person will read.** Before handover, send the wording to a strong second model (for example ChatGPT) with full context: what the page is, who reads it, the tone, and what must not change. Use its wording unless it breaks a fact, a name, a rule or wording the owner already approved. Never send private material, only your own wording.
   Why: the agent that wrote the text cannot hear how it sounds, and a bare list of strings gets a shallow answer.
2. **Plain words.** Short sentences, everyday words, one word for one thing. Anything others will read is written as the owner, with no agent or crew wording, internal codes or citations.
   Why: jargon stalls decisions, and outsiders do not know or care about the agents.

## 7. Models and briefs

1. **Match the model to the job.** Use the strongest model at high effort for research, investigations and plans. Raise the effort to the highest setting only for a new visual design or when the result is weak. Use the strong model at medium effort for building. Use a smaller model for small, clear tasks, and cheap helpers for bulk reading, one closed task each, checked by the caller. A coordinator running at low or medium effort never writes the plan itself. It hands planning to a worker at the right effort and checks the effort that actually started.
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
