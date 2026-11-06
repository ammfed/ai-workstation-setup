# Slides workflow

A working method for making any presentation with AI agents for one owner: a short internal update, a deck that asks stakeholders for a decision, a training deck, or a launch or keynote deck for a stage. AI helps at most stages: drafting an outline and words, suggesting layouts, making background pictures, checking words and access, and coaching a rehearsal. It is never required.

These rules come from a first deck made this way, widened to every kind of presentation. The deck reached a final version the owner approved, but a full first draft, three look rounds and two exports were thrown away along the way. Each rule below fixes one cause of that waste, or one risk that AI adds.

This file extends the workflow playbook. The playbook's phases, gates, review pages, research and wording rules still apply. This file says what is different for slides.

- The owner is the person who decides. Agents and workers do the rest.
- The content owner is the person whose message and figures the deck carries. The presenter is the person who speaks. Either can be the owner.
- Reviewers are the other people whose word counts: a client, an event lead, a colleague, a subject-matter expert.
- Tools named in this file are examples. Check any tool live on the day before relying on it (playbook rule 3.10).
- Each rule has a "Why" line. Keep the reason in mind when a case does not fit the words.
- Plans for the owner show the order of the stages, never days, hours or estimates. This holds on every project, not only for slides.

## The stages

The stages follow the established parts of presentation work: plan the message, design and draft the slides, refine them, then rehearse and deliver.

| Part | Stage | What it makes | Playbook phase | The owner's review point | Where AI helps |
| --- | --- | --- | --- | --- | --- |
| Plan | 1. Brief and show facts | One brief: the audience, the one message, how it plays, the master file, the rules | 1 Capture, 2 Requirements | None. Missing facts go on the calls page | No |
| | 2. Brand kit and sources | The official kit checked, the content map, one figure table | 2 Requirements, 3 Does it already exist | None. Gaps go on the calls page | Yes: summaries and figure lists from the source files, under the data rule |
| | 3. Research, calls and the technical test | Findings, one card per open call with a real sample, a one-slide round trip through the show app | 3 Does it already exist, 5 Prototype | **Gate 1: the calls page** | Yes: candidate opening lines, sample backgrounds |
| Design and draft | 4. Look round | Many distinct looks on a live grid, tested for the back row | 5 Prototype | **Gate 2: the look round** | Yes: generated backgrounds and textures, layout suggestions |
| | 5. Storyline and slide plan | The storyline, one line per slide, a visual form for each slide | 5 Prototype, 6 Breakdown | None. It is reviewed inside the full draft | Yes: a language model drafts the outline from the brief and sources |
| | 6. Full first draft | The whole deck in the master file: words, visuals, notes and motion | 7 Build | **Gate 3: the full draft review** (storyline and words included) | Yes: drafted words, layout suggestions, generated pictures |
| Refine | 7. Feedback rounds | One frozen version per round | 8 Review | Sees each version on the live link | Yes: a rewrite of one slide for a named fault |
| | 8. Finishing passes | Checked words and figures, the access pass, the alignment pass, the look locked | 8 Review | Gets the sign-offs from the content and figure owners | Yes: the words check by a second model, the app's access checker, draft alt text |
| Deliver | 9. Show file and final approval | The show file working in the real app, compared with the approved version, a backup | 8 Review, 9 Ship and hand over | **Gate 4: final approval** | No |
| | 10. Rehearsal | A run on the real screen with the presenter and the person who clicks, a run sheet | 9 Ship and hand over | None, unless rehearsal finds a fault | Yes: a rehearsal coach in the presentation app, if the presenter chooses it |
| | 11. Delivery and hand-off | The deck shown or sent, the share copy, the figures for sibling pieces, the close-out | 9 Ship and hand over, 10 Improve | Says "delivered" | No |

The four gates match the playbook's review points (rule 4.6). The calls page is a round page. The look round and the full draft review are checkpoint pages. Final approval is a preview page.

The full first draft comes before any separate review of the storyline or the words. The owner judges the storyline and the words inside the slides, at gate 3.

Under a short deadline, the four gates stay. The look round may end with one default look and the other looks as themes the owner can switch in the draft, so the look is picked inside the draft. A fault found in rehearsal opens one round (stage 7) for that fault only.

## Which stages a deck needs

Pick by the kind of work, never by a guess of how long it takes. A deck that mixes kinds runs the union of their stages.

| Kind of deck | Stages it runs | Where AI usually helps | Test |
| --- | --- | --- | --- |
| A short internal update | 1, 2, 6, 8, 9, 11. 7 only when the owner asks for changes | A drafted outline and words, layout suggestions | A few slides for people who already know the context, on the house template |
| A stakeholder decision deck | 1 to 3, 5 to 9, 11. 4 only when no house template fits. 10 when it is presented live | A drafted outline, a summary of the source documents, charts drafted from the figure table | It asks the audience to decide one thing |
| A training deck | All eleven. 10 is a dry run with a test learner | A drafted outline from the course goals, alt text, the access checker | People learn a skill from it, often without the author present |
| A launch or keynote deck | All eleven. 4, 6 and 10 carry most of the work | Generated backgrounds, layout suggestions, a rehearsal coach | It is shown on a stage to a large audience |
| A small change to a finished deck (a figure, a slide, a word) | 1, 7, 8, 9, 11 | A rewrite of one slide for a named fault | The deck is already approved |

## 1. Brief and show facts

1. **Ask what the deck must do before anything is made.**
   - Ask who the audience is, what they know, and the one thing they should think, feel or do after it.
   - Ask whether it is presented live, sent to be read, or both. A deck that is read alone needs more words on the slide than a deck someone speaks over.
   - Write the one message as one sentence in the brief.

   Why: a deck without one stated message grows into a list of everything, and the owner then cuts it late.
2. **Settle the show facts.**
   - Find out: the file the deck plays from, which app and machine, the screen shape and size, who presents, who clicks, the length, and the language rule.
   - Look in the brief and earlier rulings first. Put only the missing facts on the calls page, each with a recommended answer.
   - When nobody knows a fact, take a sensible default, write it down as an assumption, and design so the deck survives if it is wrong.

   Why: a deck built for the wrong app or screen is rebuilt at the end, when there is no time.
3. **Decide the master file for this project.**
   - The master file holds the source of truth. Every other file is an export made from it.
   - Choose it from the show facts. When the owner or the presenter will edit the deck in a presentation app, the app file is the master. When motion or a web share matters most and only agents edit, a page built from one data file can be the master.
   - When the show facts cannot settle it, recommend the presentation app file.
   - Write the choice into the brief. Make lasting changes only in the master, and never hand-edit an export.
   - When the owner starts editing another file, that file becomes the master. Record the change and bring every later change into it.

   Why: two files that are both edited drift apart, and an export that was never opened in the real app breaks on the last day.
4. **Name the kind of deck and the stages it runs.**
   - Pick the kind from the table above and write the stages it runs into the map (playbook rule 2.4).

   Why: an internal update and a keynote need different stages, and a stage nobody needs costs a round.
5. **Set the data rule and the AI stance once.**
   - Say what may leave the machine. Usually that is generic prompts for pictures and slide wording with every figure replaced by a placeholder.
   - Source documents, figures and recordings stay local, unless the owner grants a named, written exception.
   - Ask whether generated pictures are welcome, and ask for a spend limit for paid generation. Money is the owner's call.
   - Load any key from its environment variable inside the command that uses it. Never print, log or copy it.

   Why: a data question asked mid-build stalls the build, and a file or a key that leaves once cannot be called back.
6. **Fix the tool set, including the owner's own apps.**
   - Name the tools for the master file, the look, the pictures and the show file, each checked live that day.
   - The owner may ask the agent to work inside a presentation or design app through a connector, such as a desktop or web presentation app or an online design tool. Use it at the stage the owner names, most often the show file and the finishing passes.
   - Before relying on a connector, check that it is connected, what it can and cannot do, and whether it works offline. Say plainly what it could not do.
   - Work through the connector in the master file, or bring the result back into the master at once (1.3). The data rule (1.5) holds for anything a connector sends to an online service.
   - A tool the owner has not bought or approved stays a card, never a step in the plan.

   Why: the owner often finishes in their own app, and work done there by hand or through a tool nobody checked is lost or breaks on the day.
7. **Name the reviewers, their channels and who signs off.**
   - List every reviewer, what they can decide, and where their words arrive.
   - Name who signs off the content, the figures, and the wording.
   - Start one acceptance list now (see "Fixed items").

   Why: a reviewer whose words were never read comes back late with a change that undoes a round.

## 2. Brand kit and sources

1. **Get the official brand kit before any visual work.**
   - Ask for the guideline, the house template if there is one, the logo files in vector, the single-colour logo versions, the fonts, and the logo rule for this event or channel.
   - Check each font's licence and price. A paid font is the owner's call. Name a free stand-in.
   - Until the kit is in hand, work only on the content map and the research.

   Why: visual work done before the kit arrives is redone when it arrives.
2. **Take the style from the official guideline.**
   - The guideline sets the palette, the type and the logo use.
   - Past decks for the same audience give practical facts only: how much text fits, where logos sit, the screen shape.

   Why: a look copied from old decks or recordings breaks the brand the audience expects.
3. **List what the content owner asked for, with the source of each item.**
   - Treat the content owner's own documents as primary content.
   - Keep a list of each item they asked for and the slide where it appears. An item left out is a choice the owner sees and approves.

   Why: a deck that skips what the content owner listed reads as if they were ignored.
4. **Keep one figure table.**
   - Every figure gets one line: its words on the slide, the source file, the page, the date and its status.
   - Mark every figure "to be confirmed" until the figure owner confirms it. Where sources disagree, show both and never show a disputed figure as final.
   - File the figure owner's check as a held item at once (playbook rule 1.6).

   Why: a wrong figure on a stage screen is the worst mistake a deck can make, and a check filed late is never done.
5. **Keep each piece's sources apart.**
   - When two pieces share an event, such as a deck and a film, name which sources belong to which piece.
   - Never move content between them without the owner's word.

   Why: content from a sibling piece looks plausible and slips in unnoticed.

## 3. Research, calls and the technical test

1. **Research before the calls page.**
   - Study how strong decks for the same kind of audience carry one message, the visual patterns that fit the content, and the tools.
   - Check tool prices and features on the vendor's page that day.

   Why: the calls need evidence beside them, and tool facts go out of date fast.
2. **Show each taste call as a real sample.**
   - How bold the motion is: a short live sample of each level.
   - An opening line: each option set in the real type on the real palette.
   - Put the missing show facts and the master file choice on the same page, each with a recommendation.

   Why: the owner judges motion and type by seeing them, not by reading about them.
3. **Run a technical test as a round trip.**
   - Build one slide in the master file, in the real fonts, with one motion, in the main language.
   - Export it to the show file format, open it in the real show app on the real machine if possible, and check the fonts, the text direction, the motion and the screen shape.
   - Say plainly what could not be tested.

   Why: an export that is never opened in the real app breaks on the last day.

## 4. Look round

1. **Show many distinct looks.**
   - Make each look clearly different, not a near-copy. Say why each one earns its place.
   - When the owner shares a reference image or an earlier deck, add a look taken from it, mapped to the brand palette. Take the concept, not the picture.
   - Show every look in a dark and a light version.
   - Ask for the owner's mood words, then show designed effects, not literal ones.

   Why: the owner finds the look by comparing, and a narrow set sends the round back.
2. **Make the round page a live, view-only grid.**
   - Show every slide type at once, small enough to see the whole set on one screen.
   - Put the filters (look, dark or light, font, effects) beside the grid. The grid changes in place.
   - Update the page as each look lands, so the owner can watch it move.
   - Add decision cards only when the round is finished and checked.

   Why: the owner steers best while watching, and cards shown too early ask for a pick before the options exist.
3. **Test readability for the back row.**
   - Check the contrast of every text over every background, logos included.
   - Keep body text solid. Use effects such as glass or gradients on large display type only, and prove it with the check.
   - Use generated pictures for backgrounds and illustrations only. All words stay live text.

   Why: what reads on a laptop can vanish on a big screen from the last seat, and words inside a generated picture come out misspelled.
4. **Never restyle the review page.**
   - When feedback could mean the review page or the deck, it means the deck.
   - If it is still unclear, ask in one line.

   Why: restyling the page instead of the deck loses a whole round.

## 5. Storyline and slide plan

1. **Write the storyline before the slides.**
   - Write the one message, the few sections that carry it, and one line per slide that says what the slide must prove.
   - Use the order the brief asks for. Put the ask or the decision where the audience can act on it.
   - A language model may draft the outline from the brief and the sources. The agent checks every claim against the figure table.

   Why: slides built before the storyline are re-cut when the storyline changes.
2. **Study visual patterns before the first draft.**
   - Pick one visual form per slide from its message: a path for a roadmap, a single large number for a headline figure, layers for alignment, a comparison for a choice.
   - No two slides in a row share a layout. Cards in a grid are the exception, not the default.
   - Write which pattern each slide uses and why.

   Why: a first draft of repeated card grids is thrown away as boring.

## 6. Full first draft

1. **Build the whole deck in the master file.**
   - Every slide has its words, its visual, its speaker notes and its motion.
   - The storyline and the words are reviewed here, inside the slides, not on a separate page.
   - Keep one live link that always shows the latest version.

   Why: the owner judges words best in place, and a file path is not a preview.
2. **Write for the audience and the presenter.**
   - Write in the main language natively, never as a translation. Use a second language only for terms that would be wrong to translate.
   - Keep each slide digestible: not empty, not crowded. One idea per slide.
   - Speaker notes are a few short lines the presenter can glance at, on every kind of deck.

   Why: the presenter speaks over the slides, and a slide that needs a script loses the room.
3. **Annotate what a number means.**
   - Each figure gets a short line that says why it matters, not only its label.
   - Use plain bar or line charts on a shared scale. Never use radar or gauge charts.

   Why: the audience remembers the meaning, not the number.
4. **Give the owner a draft they can touch.**
   - When the master is a page, give an editor: edit text in place, switch themes and screen shapes, control motion speed, play.
   - When the master is an app file, give the file and the live link with pictures of each slide.

   Why: the owner wants to see and change the deck, and changes made in a tool they know come back sooner.

## 7. Feedback rounds

1. **Freeze, then branch.**
   - Before any change, freeze the current version read-only.
   - Each round gets a new version, branched from the version it changes. Never overwrite an earlier one.
   - Keep one index that shows which version came from which, whose feedback, and what changed. Say which version goes out.

   Why: feedback from several people arrives at once, and a lost version cannot be shown again.
2. **Bring in the owner's own edits first.**
   - Before any other change, bring in every edit the owner made in the editor or the app. Never revert them.
   - Check that saved browser state does not show the owner an older version.

   Why: the owner's edits are the newest decisions, and stale saved state makes a fixed deck look broken.
3. **Report each round point by point.**
   - List each point from the acceptance list that the round covered, what changed, and a before and after picture of the slide.
   - Before the report goes out, a fresh check compares the round's points with the result and names any point that was dropped.

   Why: the owner checks a round in minutes, and a dropped point is found before the owner finds it.
4. **Change only what the round asked for.**
   - Keep what the owner said they like. Name it in the round's brief as fixed.

   Why: a round that reworks a liked part loses the version the owner chose.

## 8. Finishing passes

1. **Check the words.**
   - The person named in the brief checks the language.
   - A second model checks every line a person will read (playbook rule 6.1). It gets the wording with figures as placeholders.

   Why: a wrong word on a big screen is the fault people remember.
2. **Trace every figure to a file.**
   - Check every figure on every slide against the figure table.
   - Never show a worked-out figure as final. Ask, or leave it out.
   - The figure owner signs off. Remove a "to be confirmed" mark only on their word.

   Why: one wrong figure undoes the deck.
3. **Run the access pass on every deck.**
   - Run the presentation app's own access checker and fix what it finds.
   - Give every picture and chart alt text, and every slide a unique title. Check the reading order.
   - Check the contrast of all text. Caption any video in the deck.

   Why: a deck that is shared as a file is read by people who use screen readers, and low contrast fails in a bright room.
4. **Finish with one alignment pass, then lock the look.**
   - Align margins, grids and spacing. Keep clear zones around logos.
   - One tap per slide: the motion plays by itself in a short, calm sequence after the tap.
   - Use calm motion on a formal stage: settle and fade, no bursts.
   - Then lock the theme and the style. Leave only the content editable.

   Why: a presenter cannot press many times in time with the talk, and a look changed after approval is a new look nobody approved.

## 9. Show file and final approval

1. **Make the show file work in the real app.**
   - When the owner asked for work through a connector to the show app, build or repair the show file there, and check the result in the app itself.
   - Embed the fonts, or ship them with an install list and a licence note.
   - Use the app's own standard animation presets. Drop a motion only when it cannot work.
   - Match each file's slide size to its name. Check the text direction and the direction of every wipe.
   - Render the show file to pictures and compare them side by side with the approved version.
   - Say plainly what was not tested in the real app.

   Why: an export that looks different from the approved deck is a new deck nobody approved.
2. **Ask for final approval on the show file itself.**
   - Show the owner the show file as it plays, not the editor and not an export from it.
   - Make one backup file, such as a pictures-only copy. Make other formats only when the owner asks.
   - Name each delivered file with the date and the hour. Never overwrite a delivered file.

   Why: the owner approves what the audience sees, and a stale copy confuses everyone.

## 10. Rehearsal

1. **Rehearse on the real screen when the deck is presented live.**
   - Run the whole deck with the presenter and the person who clicks, on the real screen or one of the same shape.
   - Check that the back row can read every slide, that every motion plays in one tap, and that the presenter's notes fit a glance.
   - A rehearsal coach in the presentation app can give feedback on pace and filler words. Offer it. The presenter decides, because such a coach can send the speech to the vendor's service.

   Why: a deck that works on a laptop can fail on the real screen, and the presenter finds the hard slides only by speaking them.
2. **Write a short run sheet.**
   - Name the file, the machine, the backup, and what to do if the show file fails.
   - Make the main route the simplest one the operator already knows, such as a slide and a clicker.

   Why: an untested device fails in the room.

## 11. Delivery and hand-off

1. **Ship the share copy.**
   - When the deck is sent or shared, ship the editable file, a pictures-only copy and, if asked, a page that works on a phone.
   - Use vector logos everywhere, including posters and QR pages. Decode every QR code to check it.

   Why: a pixelated logo is the first thing people see, and a QR code that points to the wrong place cannot be fixed once printed.
2. **Hand the figures to sibling pieces.**
   - Give any film, poster or report that shares the event a plain list of the final figures, with each label and slide number.

   Why: the pieces must show the same numbers.
3. **The owner may finish the deck.**
   - When the owner edits the show file in the app, repair only what broke. Keep their words and numbers exactly.

   Why: the owner's edits are approval in action.
4. **Close out.**
   - When the owner says delivered, record it, stop the workers and the live link, and keep the final version with the versions and sources it was built from.
   - Write down the method lessons of this deck for the next one (playbook section 9).

   Why: a finished deck with workers and links still running costs quota and confuses the next round.

## Fixed items for every deck

These run through every stage. Add them to the map at the brief.

| Item | What it is | Why |
| --- | --- | --- |
| One acceptance list | Every ask from the owner and every reviewer, in their words, with its source and date. The newest ask wins. Replaced asks are marked, not deleted. Each line says applied, or why not | Remarks from several people contradict each other unless one list settles them |
| The show facts card | The audience, the one message, how it plays, the show app, the screen, who presents and clicks, the master file | A deck built for the wrong app or screen is rebuilt at the end |
| The brand kit and font licences | The official kit, the logo rule, each font with its licence and stand-in | Visual work done before the kit is redone |
| The figure table and its sign-off | Every figure with its source and status. The figure owner's check is a held item from the start | A wrong figure on a screen undoes the deck |
| The version index | Every frozen version, where it came from, and what changed | The owner can go back to the version they liked |
| A real-app run of the show file | The show file opened and played in the real app before final approval | An export nobody opened breaks on the day |
| The spend record | Paid generation so far against the owner's limit, when the deck uses any | Money is the owner's call, and a limit nobody tracks is passed silently |

## Traps

| Trap | What it cost | The rule that prevents it |
| --- | --- | --- |
| A plan page with days, hours and estimates | A plan page rebuilt without them | The intro of this file |
| Visual work before the brand kit arrived | A restart of every page and sample | 2.1 |
| A look built from old recordings instead of the guideline | A look round thrown away | 2.2 |
| The review page restyled when the feedback was about the deck | A look round thrown away | 4.4 |
| Decision cards shown while a look round was still running | A page rebuilt as a live grid | 4.2 |
| Three near-copy looks | Another look round | 4.1 |
| A first full draft made of card grids | The whole draft thrown away | 5.2 |
| Separate storyline and copy gates under a short deadline | Gates the owner skipped | 6.1, the deadline note under "The stages" |
| Edits made in one folder with no versions | Feedback from three people tangled | 7.1 |
| The owner's own edits left in browser storage | A false "missed asks" round and re-added slides | 7.2 |
| Content from a sibling piece slipped into the deck | Slides removed after the owner caught it | 2.5 |
| An export never opened in the real app | Fonts, motion and screen shape broken twice | 3.3, 9.1 |
| Plain fades in place of the app's animation presets | A version thrown away | 9.1 |
| A page kept as the master while the owner finished the deck in the app | Two export repairs replaced by the owner's own file | 1.3 |
| A raster logo upscaled on a poster | A pixelated logo, made again | 11.1 |
| Small text sized on a laptop | A round to enlarge text and fix a roadmap | 4.3 |
