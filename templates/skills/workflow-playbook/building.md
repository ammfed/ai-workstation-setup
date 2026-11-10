# Building anything with a screen

A companion to the workflow playbook. Read it whenever the work has a screen, a page, a deck or a document layout, in any phase from research to ship. It adds the design and interface method that the playbook's general rules do not cover. The playbook's phases, gates, review pages and wording rules still apply, and the principle checks in `principles/checks.md` still run before anything reaches the owner.

Each rule names the phase it belongs to. Rules the playbook or the checks already hold are not repeated here; the last section points to them.

## Research

1. **The vision comes from people and moments, not from more references.**
   - Use other products for two jobs only: the must-haves each requirement needs, and the gaps nobody fills. Count both and show the evidence.
   - Frame the concepts around a few key moments of named users, for example "someone records an item, a reviewer checks it, leadership sees the whole picture". For each moment, compare how others do it with what the new product does.
   - Take good practice from the standards of the field, not from screens.

   Why: reference screens show the average. A product copied from them has no vision, and more research cannot fix a gap that is really a choice.
2. **Study outside products from every source you can reach.** Use their documentation, demos, videos, product pages and any access the owner provides. Keep screenshots and copies private and never publish them.

   Why: the more of a product you see, the better you learn how it meets each requirement, but material that is not yours stays private.
3. **Judge your own earlier work the way you judge a vendor's.** For each earlier concept or screen, say what works, what fails, and whether to keep, drop or improve it.

   Why: favouring your own past work carries its mistakes forward, and discarding it loses what already worked.
4. **Earlier work is input, never locked in.** Every stage reuses earlier work and decisions as input. Fresh research, findings and requirements may change them. Research is deep and broad, never a short study.

   Why: a decision that cannot be revisited when new evidence arrives turns into a rule nobody can explain.
5. **An AI-written proposal is a starting point, never a source.** Rank evidence by tier, and cite the source behind a claim, not the model that repeated it.

   Why: a model's summary looks settled even when nothing stands behind it.

## Concept

6. **Argument before layout.** For a deck, a document or a page for other people:
   - Settle the one-sentence point with the owner first, from a few candidate sentences.
   - Write the argument as spoken paragraphs in the owner's words, one per slide or section, and get the owner's edits.
   - Choose one visual per paragraph, only where it is the evidence: a real screenshot, a worked example, one number.
   - Build one slide or section to taste before the rest. Serve one spine, never two.

   Why: layout specifications alone produce generic output, and a piece that argues two points makes neither.
7. **One product, one purpose.** Keep separate kinds of documents or jobs separate. Do not stitch every idea from the research into one platform. A new idea enters only when it fixes one of the core jobs the requirements name.

   Why: a platform stitched from scattered concepts drifts from its main purpose and feels foreign to its users.

## Wireframe

8. **Wireframes are shapes, not paragraphs.** Each screen shows the prepared work as pictures and short labels, with nothing that does not help a person decide or act.

   Why: a text-heavy wireframe makes the reader read instead of see, and hides whether the flow works.
9. **Wireframes settle the flows and functions, not the final look.** The front end is built from the ground up in the chosen design system, with that system's own screen shapes and interaction design. Do not copy the wireframe layouts as they are.

   Why: a design system laid over wireframe boxes keeps their generic look and loses what the design system is for.
10. **Say why each control is this control.** For every control, say why it is a row, a dropdown or checkboxes, how many actions it offers, how add, remove, save and undo work, and whether it is an icon or a word. Keep the fewest steps between screens, each one still plain.

    Why: a control picked by habit adds friction that nobody chose.
11. **What a person enters once is known later.** Fill it in again for them and never ask twice. Fields that can be derived from context are derived, and the person checks them once.

    Why: asking again for known facts costs time and trust.
12. **Screens are done when every journey is walked.** Every role's every journey is walked end to end (in every language the product supports), every open fix is at zero, and the owner signs off. A signed screen is frozen. A later change fixes that one screen only.

    Why: a screen that looks finished alone can still break the handover to the next role.
13. **A rebuild carries forward the good pieces.** Earlier wireframes are a checklist for the rebuild, not its base. Check the rebuild against every earlier approved rule before it reaches the owner.

    Why: rebuilds kept dropping hard-won interface work, and the owner had to say it all again.

## Visual design and design systems

14. **Base the look on one mature design system.** Adopt its flows, patterns and components fully. Where it has a proper rule, use it. Where it has none, fill the gap with your own approved patterns. Simplify as far as the work allows.

    Why: a mature system has already solved most interface questions, and half-adopted patterns give an inconsistent product.
15. **A new design system starts from the approved principles.** Earlier design systems and old looks are not inputs unless the owner names them. Every prompt to a design tool names the design system it uses and attaches its references.

    Why: a patch on an old look carries its problems forward, and a design tool without references invents its own.
16. **Research colours and fonts for the audience and the place.**
    - Start from the official guidelines that apply: a national or organisational design system, brand values, and the scripts the product must render.
    - Use outside guidelines selectively. Keep a take, adapt and leave list, and never let them break the base design system.
    - Show colour and font options side by side with a contrast table before applying any. Check contrast on text, controls and surfaces.

    Why: colours and fonts carry trust and fit. A choice made by eye in one language often fails in another script or for the people who must read it.
17. **A design system changes the screens, not only the colours.** It changes the shell, the components, the type and the spacing. Show two or three sample screens in the new system beside today's for the owner's yes before applying it everywhere.

    Why: a reskin of colours only does not show the design system, and a full pass without a sample risks a result worse than before.
18. **If the full pass is worse, stop and go back.** Return to the last approved state exactly, and keep the new design work aside on its own branch.

    Why: forcing a worse result forward costs more than redoing the pass.
19. **Freeze in order, on the owner's word.** Freeze colours, layout and components first and fonts last. After the freeze, change the system only on the owner's word.

    Why: a design system that keeps moving makes every screen built on it move too.
20. **Visuals only where they are the evidence.** Name the one thing the reader must see before drawing anything. If a plain sentence or a small table shows it better, use that. Prefer real screenshots and worked examples. Tell design tools: no decorative visuals, only the visuals listed.

    Why: decorative visuals add noise and hide the recommendation.
21. **Pages for other people are visual first.** Infographics, few words, varied layouts, no jargon and no speech.

    Why: other people skim. A visual they can read at a glance carries the point, and a wall of words does not.

## Interface rules

22. **Every element has a reason.** Each element helps someone decide or act. Small text appears only where it carries a fact: a date, an owner, a count, a status or a source. Every title names what the user sees. Nothing is shown twice on one screen without a purpose.

    Why: anything without a reason makes people read instead of see.
23. **A box ends where its content ends.** Boxes in a row share their top edge. Spare space goes outside the boxes, never inside. Use the same edges and one gap everywhere, and let space follow the job.

    Why: boxes of random size and empty space inside them look unfinished and slow the eye.
24. **Nothing moves when a person switches or opens something.** Tabs change what is inside the boxes, never where they are. A count keeps its place at zero. The page scrolls as one, with no scroll box inside another. The same kind of table or list keeps the same columns every time it comes back.

    Why: a frame that shifts makes people search for what they already found.
25. **Layout rules are numbers, checked at real screen sizes.** Write the frame, controls and reading widths as numbers. Check them at the screen sizes the owner and the users really have, never by eye at one size.

    Why: proportions judged by eye on one screen break on the next one.
26. **New elements replace the lowest-value element on that screen,** placed for the role that needs them. A screen does not just grow.

    Why: screens that only gain elements become cluttered, one reasonable addition at a time.
27. **Motion follows the need.** Set the speed and amount of motion for each moment from the research and its purpose. Motion turns off when the device asks for less.

    Why: the right motion depends on the job. Motion with no purpose distracts and tires, and some people cannot use a screen that moves.

## Build

28. **Follow instructions exactly for what the owner sees, and say when one looks wrong.** What the owner sees and approved (screens, words, flows, behaviour) changes as asked, no more and no less. A signed screen or document stays exactly as signed, with only the agreed fixes. Under it, in code the worker owns, merging repeated code and adding tests are the worker's call, as long as what the owner approved stays the same and the tests show it. When an instruction looks wrong or does not make sense, say so with the reason before you act on it.

    Why: an unasked improvement breaks something the owner already approved, and a silent doubt lets a mistake through.
29. **One live version, always running.** Keep one live demo of the latest main line, rebuilt after every change, so the owner never waits for a merge to see the work. Run a separate preview only when the owner asks for one, and close it once merged.

    Why: several copies each showing a different mix of changes cost the owner's trust in what they see.
30. **Spot-check in a browser before saying done.** Open every changed screen in a real browser before you call it done or ask for a merge. Ask for a merge only after the owner has seen the result live.

    Why: the owner judges by what runs. A merge ask on unseen work feels like a broken process.
31. **Slices with a visible result, the most visible first.** Cut the build into slices. Each slice is one pull request with a result the owner can see. Put cheap, critical pieces that people will notice first. Never save the result for a big build at the end.

    Why: people outside the build judge progress by what they can see, and a big final build hides problems until it is too late.
32. **Prove the stack in small pieces first.** Test each part of the planned stack in a small experiment before adopting it, and make the first working slice a thin slice of that stack, so nothing is thrown away later.

    Why: a stack adopted whole fails late and expensively.
33. **Everything shown as working must work.** A demo shows only what is technically feasible, with no fake figures.

    Why: a demo that promises the impossible sets a target the build cannot meet.
34. **Fix forward, with a test of the real path.** Each problem the owner finds becomes a test that walks the owner's real path, in a small pull request.

    Why: a fix without a test comes back, and a test of an invented path misses the owner's case.
35. **New feedback pauses that screen.** When the owner gives feedback on a screen, pause the work on it. Rebuild it from all of the owner's feedback so far, once the owner agrees how to start.

    Why: patching only the newest comment drops the earlier ones.
36. **Each feedback round is its own version.** Freeze the current version before applying anyone's feedback. Build each round as a separate version branched from an earlier one, and keep an index of each version's parent, whose feedback it took and what changed. Never overwrite an earlier version.

    Why: the owner wants to compare versions and go back, and feedback from different people must not tangle.
37. **The owner sees progress as it happens.** During a long build, keep one live view: what is being worked on now, how much is covered, and which requirements are met.

    Why: an owner who cannot see progress has to ask, and asking costs both sides time.

## Ship

38. **Shipped means real use.** A product ships when it runs in the approved environment, with real sign-in, real data signed off, and the first real users' work done in it. A demo does not count.

    Why: calling a demo shipped hides the hardest part of the work.
39. **An AI's actions leave a record.** Before any real data, record every action the AI takes or proposes: who allowed it, what was done and when.

    Why: a person cannot answer for a decision nobody can trace.

## Talking with the owner during the work

40. **Style feedback is about the thing being built.** A comment on look, light or dark mode, or style is about the product, slide or screen, never about the review page. Keep the review page's own style.

    Why: restyling the review page from product feedback changes the one tool the owner already likes.
41. **Never rewrite a review page while it is open.** Changes wait for the owner's OK to reload, and every page keeps the owner's typed answers and notes across a reload.

    Why: a reload that loses typed answers loses the owner's work.

## Already in the playbook or the checks

These hold for screen work too. Follow them where they live; they are not repeated above.

- Stage gates, comments are not agreement, each stage names its inputs: playbook section 1.
- Requirements are the backbone, every research counts, show the evidence: playbook section 3.
- Every decision and every change to look or experience goes on a review page first: playbook rule 4.1.
- Ask one question at a time with a recommendation, and only about taste, intent, risk, money or people: playbook section 5.
- Plain words, readable at 13, specialist terms explained where they appear: playbook section 6 and checks W1 and W2.
- Plans show order, never dates or estimates, unless the owner asks for estimates; then give ranges: playbook rule 1.6.
- Fewest steps, one frame on every view, no points or streaks, AI work marked as a suggestion, counts never averages: `principles/checks.md`.

## Growing this file

When the owner approves a new principle for building screens:

1. Add it as a numbered rule under its phase, with a "Why" line and the date it was approved, for example "(approved 2026-12-01)".
2. When a newer approval replaces a rule, strike the old text through with `~~` and keep it, then add the new rule right below it with "replaces the rule above" and its date. The newest dated rule wins.
3. Taste that belongs to one kind of client or sector goes in its own opt-in style skill, such as `government-build-style`, not here.
4. Show each change on a review page before it ships (playbook rule 9.1), and land it in both the shared template and the local install.
