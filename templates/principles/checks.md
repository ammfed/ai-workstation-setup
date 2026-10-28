# Principle checks

The design and writing principles every screen, page and text should meet, written as checks that run on their own. They apply by default to everything built, for the owner and for other people alike. There is no separate accessibility pass at the end: a screen designed for people with attention or reading difficulties is better for everyone.

The workflow playbook runs these checks before any page reaches the owner (rule 4.7). Workers run the script part before they report done on anything with a screen.

## Who runs each check, and what a failure blocks

| Runs as | Who | When (playbook phases) | What a failure blocks |
| --- | --- | --- | --- |
| Script | `principle-check` in this folder (`bin/principle-check.mjs`), run on the page's files by the worker that built it | 5 and 7, and before every review page in any phase | The worker may not report done, and the page may not go to the owner |
| Reviewer | A fresh agent that did not build the work, briefed as in "Reviewer brief" below | 5 and 8, and before every review page in any phase | The page waits until each finding is fixed or becomes a card for the owner |
| Words | The script for the mechanical rows, then the second-model read (playbook rule 6.1) for the rest | Every phase that writes something a person will read | The text is rewritten before it is sent |
| Owner | The owner, on a card with a recommendation | 5 and 8 | Nothing ships until the owner answers |

The reviewer rows that can be judged from the code alone (W4, L3, L9, N1 and I1 to I5) also run inside no-mistakes when this setup adds them to its review rules: every review on the machine whose change touches an interface file checks them, and a finding parks the run for a fix. The rows that need the screen itself stay with the fresh reviewer.

Rows marked "Reviewer (script later)" can become script rows once the checker drives a browser. Until then a reviewer checks them.

The rows about a 390 px phone width run for anything built for other people. For the owner's own review pages and prototypes, follow the owner's screen-size rule; the checker adds those rows with `--phone`.

Charts and numbers rows apply only where a chart or figure appears. AI rows apply only where the product has an AI part. A reviewer says "not applicable" for a group that does not apply, rather than skipping it silently.

## Attention and flow

| ID | Check | Runs as | Source |
| --- | --- | --- | --- |
| A1 | No card, screen or message asks for more than one decision | Reviewer | W3C COGA (standards body) |
| A2 | A step-by-step flow shows where you are: "2 of 5", a step list or a history | Reviewer (script later) | W3C COGA (standards body); NN/g heuristic 1, visibility of system status (UX research org) |
| A3 | No more than about five options, fields or main actions on one card or screen | Reviewer (script later) | W3C COGA (standards body); Cowan 2001 (peer-reviewed) |
| A4 | Related items sit in groups of about four, separated by space or a border | Reviewer | Cowan 2001 (peer-reviewed) |
| A5 | Nothing interrupts the current task. A non-urgent notice can be put off or dismissed. No modal for anything that is not urgent | Reviewer | WCAG 2.2.4 Interruptions (standards body) |
| A6 | Nothing moves on an idle screen. No autoplay. Motion only marks a real change and respects the reduced-motion setting | Script | WCAG 2.2.2 Pause, Stop, Hide and 2.3.3 Animation from Interactions (standards body) |
| A7 | The fewest steps: a choice that fits on the current page is made there | Reviewer | House rule |
| A8 | The same frame on every view: tabs change what is inside the boxes, never where they are, and navigation is the same everywhere | Reviewer | WCAG 3.2.3 Consistent Navigation (standards body) |

## Time, status and progress

| ID | Check | Runs as | Source |
| --- | --- | --- | --- |
| T1 | Every pending item names a concrete next action, never only "review this" | Reviewer | Research on planning difficulty in adult ADHD (peer-reviewed) |
| T2 | Time shows as elapsed or "as of" ("updated 3 days ago"). Every data view has an as-of time. No prominent countdowns | Reviewer | Research on time perception in ADHD (peer-reviewed meta-analyses) |
| T3 | Background work shows that it is running and when it finished | Reviewer | NN/g heuristic 1, visibility of system status (UX research org) |
| T4 | Progress is a count of real outcomes ("12 of 52 decided") with a fill that closes toward done | Reviewer (script later) | NN/g heuristic 1 (UX research org) |
| T5 | No points, streaks, badges or leaderboards. Progress compares a person only with their own past | Reviewer | Deci, Koestner and Ryan 1999; Lepper, Greene and Nisbett 1973 (peer-reviewed) |
| T6 | A date that has passed is flagged, never changed by an agent. Dates belong to the owner | Reviewer | House rule |

## Words

| ID | Check | Runs as | Source |
| --- | --- | --- | --- |
| W1 | Readable at 13: short sentences, everyday words, one idea per sentence | Words (a readability score can flag, not decide) | W3C COGA (standards body); GOV.UK content design guidance (government design system) |
| W2 | No invented words or internal codes. An acronym or specialist term is explained where it first appears | Words | WCAG 3.1.4 Abbreviations (standards body); GOV.UK style guide (government design system) |
| W3 | One term per thing, and the same status words on every screen | Words | WCAG 3.2.4 Consistent Identification (standards body) |
| W4 | A button says its exact effect ("Send report"), not "Submit" or "OK" | Reviewer | Apple Human Interface Guidelines (official vendor guideline); GOV.UK Design System, buttons (government design system) |
| W5 | No em dashes, sentence case, and no slash-joined alternatives in labels | Script | House writing rule |
| W6 | An assistant inside the product never says "I"; the action is the subject | Script flags, reviewer decides | House rule |
| W7 | One language per sentence, unit words included, and one numeral system per screen | Reviewer | House rule |

## Layout and controls

| ID | Check | Runs as | Source |
| --- | --- | --- | --- |
| L1 | The decision or answer comes first; the reasoning sits one tap away in a closed "why" | Reviewer | NN/g, inverted pyramid and progressive disclosure (UX research org) |
| L2 | Minimalism removed only decoration: every rare control and the "why" are still reachable | Reviewer | Burmistrov, Zlokazova, Izmalkova and Leonova 2015, flat design and task time (peer-reviewed) |
| L3 | Labels stay visible (a placeholder is never the label). Likely answers are offered as choices. Defaults are filled in and editable | Script (placeholder without a label), reviewer for the rest | WCAG 3.3.2 Labels or Instructions (standards body); NN/g, placeholders in form fields (UX research org) |
| L4 | Familiar standard components, one icon family, simple icons | Reviewer | NN/g, Jakob's law (UX research org); Alvarez and Cavanagh 2004 (peer-reviewed) |
| L5 | Every icon button has a name, and a visible text label rather than a hover-only tooltip | Script (no accessible name), reviewer for the visible label | WCAG 4.1.2 Name, Role, Value (standards body) |
| L6 | The control itself prevents errors where it can. Input is checked on submit, not while typing | Reviewer | GOV.UK Design System, validation (government design system) |
| L7 | Reads well at 390 px: no sideways scroll, body text at least 14 px, card and picture stack, a wide diagram gets a phone version | Script for the viewport tag and text size, reviewer (script later) for the rest | WCAG 1.4.10 Reflow (standards body); house rule for 14 px |
| L8 | Space follows content: nothing cut off or cramped, and a card no bigger than what it holds | Reviewer (script later) | WCAG 1.4.12 Text Spacing, no loss of content (standards body) |
| L9 | An empty state says what is missing and gives one next action | Reviewer | NN/g, empty states (UX research org) |
| L10 | Text is never justified. Body line height is at least 1.5, more for scripts that need it | Script | WCAG 1.4.8 Visual Presentation (standards body) |

## Colour and visuals

| ID | Check | Runs as | Source |
| --- | --- | --- | --- |
| C1 | No meaning rests on colour alone; a word, number or label carries it too | Reviewer (script later) | WCAG 1.4.1 Use of Color (standards body) |
| C2 | Text meets WCAG 2.2 AA contrast, and chart marks reach 3 to 1 | Reviewer (script later) | WCAG 1.4.3 and 1.4.11 (standards body) |
| C3 | Red and green are never the only good and bad signal | Reviewer | WCAG 1.4.1 Use of Color (standards body) |

The look itself is the owner's call: whether a visual earns its place, the accent colour, the themes and the overall style. A reviewer never grades taste; it suggests a card for the owner instead. Taste rules of your own belong in your private layer, not in this list.

## Charts and numbers

| ID | Check | Runs as | Source |
| --- | --- | --- | --- |
| N1 | Values to compare are bars or dots on one shared scale. No pie, donut, radar, gauge, 3D or bubble chart | Script (chart type in the code), reviewer | Cleveland and McGill 1984 (peer-reviewed) |
| N2 | One headline number or answer is the largest thing on the card and is read first | Reviewer | House rule |
| N3 | A chart title states its finding; units and period sit in a subtitle | Reviewer | Knaflic 2015, Storytelling with Data (book) |
| N4 | A rate reads as a natural frequency first ("3 of 10"), and a percentage second if at all | Script flags a bare percentage, reviewer decides | Gigerenzer and Hoffrage 1995 (peer-reviewed) |
| N5 | An uncertain figure carries a range or "not yet known", and a shaded band gets a sentence | Reviewer | Spiegelhalter, Pearson and Short 2011 (peer-reviewed) |
| N6 | Every number shows its scale, denominator and what it measures ("8 of 10, high") | Reviewer | Huff 1954, How to Lie with Statistics (book) |
| N7 | Bars start at zero or the cut axis is labelled. No dual axis without a stated link | Reviewer | Huff 1954 (book) |
| N8 | No more decimals than the data supports | Script flags, reviewer decides | Huff 1954 (book) |
| N9 | A change is compared with normal noise and a named baseline before it is called a trend | Reviewer | Huff 1954 (book) |
| N10 | Ordinal ratings (low to critical) are never averaged | Reviewer | Stevens 1946, levels of measurement (peer-reviewed) |
| N11 | Many groups use small multiples on one scale; stacked bars only when the total is the point | Reviewer | Tufte 1983, The Visual Display of Quantitative Information (book) |

## AI in the product

| ID | Check | Runs as | Source |
| --- | --- | --- | --- |
| I1 | An AI flag names its specific concern ("source may be stale"), not only a confidence number | Reviewer | Google People + AI Guidebook (official vendor guideline) |
| I2 | AI-proposed items look different from accepted ones, and anything below the threshold goes to a person | Reviewer | Microsoft Guidelines for Human-AI Interaction, Amershi et al. 2019 (peer-reviewed) |
| I3 | A finding that only confirms what the reader expected carries a "second look" note | Reviewer | Skitka, Mosier and Burdick 1999, automation bias (peer-reviewed) |
| I4 | Any personalisation is a visible setting the user chooses, never an inferred trait or personality type | Reviewer | W3C COGA (standards body) |
| I5 | A chat surface shows what it can do with a few strong suggestions, not a blank box | Reviewer | NN/g, AI chatbot usability (UX research org) |

## What the checker covers today

`principle-check` checks A6, W5, W6, L3, L5, L7 (viewport tag and text size), L10, N1, N4 and N8 on `.html`, `.md` and `.txt` files. It prints one line per finding with the file, the line, the check ID and what to fix, and exits with 1 when any check fails. W6, N4 and N8 print as "check" lines: a likely slip that a reviewer decides on, which does not fail the run. L7 runs only with `--phone`. It reads the files as they are, so a stylesheet in a separate file is not checked. The rows marked "script later" need a running browser and stay with the reviewer until the checker can drive one.

Run it from the playbook folder: `node principles/bin/principle-check.mjs [--phone] <files or folder>`. Exit 0 means nothing failed, 1 means at least one check failed, 2 means a usage error or a path it cannot read.

## Reviewer brief

Give this to a fresh agent that did not build the work. It reviews; it does not edit.

- **What it gets:** the requirement the work answers, screenshots at the owner's laptop size (and at 390 px for anything built for other people), the page or app link, and this file.
- **What it does:** goes through every Reviewer and Words row that applies, group by group, and the "script later" rows. It says "not applicable" for a group that does not apply. It opens the page itself where a screenshot cannot show the answer (a closed "why", a hover, an empty state).
- **What it never does:** grade taste, or fix anything. A taste question becomes a suggested card for the owner, with a recommendation.
- **How it reports:** one line per finding, in the form `ID, where, what is wrong, the fix`, most serious first. Then one line per group: checked, or not applicable. "No findings" is a valid report.

The builder fixes each finding or turns it into a card for the owner. The page goes to the owner only when no finding is left open.

## Growing the list

The list grows from what slips through, in the improve step (playbook section 9). A mechanical slip that happens twice becomes a script row. A judgement call missed twice becomes a reviewer row. Each new row is shown to the owner first and names its public source, or says house rule.
