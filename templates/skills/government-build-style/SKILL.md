---
name: government-build-style
description: An opt-in build style for digital services built for a government body or public institution. Load it ONLY when the person explicitly asks for it in the current session, for example "use the government build style". Never load it by default, never on your own judgment, and never because the work merely looks like government work. Once asked, it applies to the current project only.
---

# Government build style

A taste layer for building systems for a government body or a public institution. It sits on top of the workflow playbook and its `building.md`, which always apply. This file adds only what is specific to government work. Where it says nothing, follow the playbook.

## How it switches on

- It is off by default. It loads only when the person says so in a session, for example "use the government build style".
- It applies to the current project only. Do not carry it into other projects or later sessions on your own.
- To keep it on for this project in later sessions, offer once to add this line to `CLAUDE.local.md` at the project root (a personal file, not committed): `Use the government build style for this project.` Add it only on the person's yes.
- Say in one line that the style is on, and for which project.

## Look and language

1. **Official, but modern.** The product looks like a government service people can trust, and as clean as well-known modern software. Use the official logo in the top bar and on the sign-in page, never flipped, recoloured or cropped. Take official colour values as given, use the national or organisational accent sparingly (for the main action, selection and focus), and start with a light theme.

   Why: people judge a public service by whether it looks official, and they keep using it when it feels as easy as the apps they know.
2. **Both languages from the start.** When the service has two languages, such as Arabic and English, build both from the first screen:
   - Mirror the whole layout for right-to-left. An assistant's panel and its figure sit at the reading start.
   - Text aligns by its own language, wherever it appears. Numbers and symbols sit in the right place in mixed text.
   - Button icons follow the reading direction. Arrows that show a real direction keep their place.
   - Keep one digit system on a screen, as the guidelines set.
   - Open in the language most users read first, with the other one button away.
   - Keep entry text as the person wrote it, and mark the app's translation as translated.

   Why: a second language added late is a translation of a design, not a design.
3. **Use the national design system selectively.** Take ideas from the national or organisational design guidelines where they help, with a take, adapt and leave list. Never let them break the base design system. Paraphrase the principles; do not upload or publish the guideline files.

   Why: following every line of an outside guideline can fight the system the product is built on, and ignoring it loses what citizens already know.

## Method and process

4. **Mirror the organisation's real method.** Copy the organisation's own forms, sheets, steps and group names exactly. Offer the international standard (for example ISO) as a setting. The organisation's way is the default.

   Why: staff trust a tool that matches the method they are audited on, and a standard they do not use yet feels foreign.
5. **Fix an approved platform; do not refactor it.** Stay aligned with the organisation's official sheets and standards. Take outside reviewers' points only as minor refinements, and only the critical ones.

   Why: an approved platform is a promise to the people who approved it.
6. **Configurable, not hard-coded.** Scales, role names, method options and similar rules are set in an admin panel. Keep roles few and aligned with the standard. The higher role approves; there is no approval for every step.

   Why: each unit works a little differently, and rules change with each policy cycle.
7. **When another team's system covers part of the need, split the requirements.** Show one table: each requirement marked as ours, theirs or shared, with the reason. Keep all requirements covered. Keep internal strategy out of anything shared with that team.

   Why: two systems that do not know where their borders are either duplicate work or leave a requirement uncovered.

## AI in a public service

8. **People stay in charge of the AI.** Every AI action that can run alone offers three modes, Manual, Balanced and Autonomous, set by people. The AI drafts and the person decides. The AI's work is marked as a suggestion.

   Why: a public body must be able to say who decided, and staff adopt an assistant faster when they control how far it goes.
9. **Engaging, but serious.** Make the work feel supported and a little rewarding: progress bars, finished ticks, a short done moment and a clear next step. No points, rankings or streaks.

   Why: people return to a tool that shows their progress, and game mechanics look unserious in a government service.

## Data, access and approvals

10. **Invented data until real data is signed off.** Early stages use invented data shaped like the real sheets. No file content from the organisation goes into a seed or a model. Private material stays on approved machines and never goes to an outside model or service.

    Why: real government data in a prototype is a breach, even when nobody sees it.
11. **No central IT dependency in the first stage.** The first stage runs with a stub sign-in and role grants until the organisation's identity system plugs in. Security, IT and cloud approvals are held items from the start (playbook rule 1.6).

    Why: central approvals take months, and a first stage that waits for them shows nothing.
12. **Internal codes stay internal.** Process numbers and internal IDs stay out of anything the organisation's staff will read.

    Why: codes mean nothing to the reader and make the document look like it was not written for them.

## Stakeholders

13. **Describe the scope as agreed.** In outward material, use the scope words that were agreed, never bigger words.

    Why: a bigger claim than the mandate draws scrutiny the work did not ask for.
14. **Stakeholder decks lead with the problem.** Open with the problem, the requirements, the current system and its limits (with real screenshots), then the proposal and its advantages, the parked ideas and the full vision. Show a short journey of the work: the research, the rounds, the restarts and why things changed.

    Why: leaders approve a change when they see the problem they own first and the effort behind the answer.
15. **Design, prototype, then show.** Design the idea and prototype it before showing it. Partner teams join after the prototype, to approve the research behind it. Ask departments to judge only a complete experience, never half-built screens.

    Why: officials judge what they can click, and a half-built screen gets judged as the final product.

## Growing this skill

When the owner approves a new government-specific principle:

1. Add it as a numbered rule under its group, with a "Why" line and the date it was approved, for example "(approved 2026-12-01)".
2. When a newer approval replaces a rule, strike the old text through with `~~` and keep it, then add the new rule right below it with "replaces the rule above" and its date. The newest dated rule wins.
3. A principle that holds for any client goes in the playbook's `building.md` instead.
4. Show each change on a review page before it ships, and land it in both the shared template and the local install.
