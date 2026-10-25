# Review pages

A review page is an HTML page an agent serves with
[lavish-axi](https://www.npmjs.com/package/lavish-axi) so you can look at a proposal and
answer it in the browser, instead of reading a long chat reply. The `preferences` module
installs a decision-card template for this (`decision-cards.html`) when you pick
`PREFS_DECISIONS=both` (the default) or `cards`; with `PREFS_PAGES_ALL_CARDS` every review
page starts from it, not only decisions. Next to it the module writes a hide tray script
(`hide-kit.js`), so you can mark parts of a page for removal. This page is the loop an agent
follows with them.

The review-page rules live in the `review-pages` skill that the module writes to
`~/.claude/skills/review-pages/SKILL.md`, so they load when a page or prototype is in play
rather than in every session. The core rules file keeps only the decision rules: how questions
reach you, and that a yes-or-no question stays in chat.
[Working preferences](working-preferences.md#where-the-rules-live) lists every rule and where
it lives.

## The loop

1. **Build the page.** Copy the template next to the work, replace `CARDS` (and `DECIDED`,
   what is already settled), and give every option a preview. Keep text to a title, one
   question and short option labels. A card's optional `based` field ends it with one short
   "Based on" line that names the types of sources behind it.
2. **Serve it without opening a tab.** Creating the page never opens a tab, and the agent never
   re-runs the open command just to refresh the page.

   ```sh
   LAVISH_AXI_NO_OPEN=1 lavish-axi review.html --no-open
   ```

   The `agent-clis` module can set `LAVISH_AXI_NO_OPEN=1` for your user (`LAVISH_NO_OPEN`).
3. **Check the page by screenshot, then hand it over.** With `workflow-playbook` installed, the
   agent first runs its principle checker on the page
   (`node ~/.claude/skills/workflow-playbook/principles/bin/principle-check.mjs review.html`); a
   fail line stops the hand-over until it is fixed. Then it opens the page in its own browser and
   confirms the content shows. A page can load and still be stuck or blank. Then the agent opens
   it once in your browser and gives the link in chat, because a page that is only linked is
   easily missed. While you are away it opens nothing, and the link waits for your return.
4. **Wait for answers.** `lavish-axi poll review.html` waits until you press send. Leave it
   running; if it is interrupted, run it again. Answers stay queued until they are collected.
5. **Check the real state before saying anything about it.** Running `lavish-axi` with no
   arguments lists every session with its status and the number of answers waiting to be
   collected. An agent looks there (or polls) before it ever tells you a page is still open
   or a question is unanswered.
6. **Record and link.** Each answer is recorded where your decisions live (see
   `PREFS_DECISIONS_LOG`), and the finished result is linked.
7. **Respect an ended page.** If you end the session from the browser, the agent does not
   reopen it unless you ask for another review. A page that reads "ended" does not mean the
   answers were lost: the agent reads the session status and pending answers, and still collects
   them, before saying a page is open, answered or unanswered.

## Card fields

| Field | Use |
| --- | --- |
| `id`, `title`, `question` | What the card asks |
| `options` | `[[value, label], ...]` |
| `rec` | The recommended option's value |
| `previews` | One visual per option; the canvas lets you flip between all of them |
| `headline` | Optional `{ num, cap }`: the one number that matters, shown first |
| `evidence` | Optional one sentence shown above "Why" |
| `why` | Short detail, closed by default |
| `label` | Optional small label above the question, such as `D-1`; "1 of N" is added to it |

A card with no `options` is a content card (a report, plan or explainer step) and gets a
Next button instead of options. `WAITING` lists things you only have to press (a merge, a
sign-in); they show in a strip under the intro, apart from the real decisions. Below 720px
the card and its picture stack, and a picture opens full size on tap.

The page is light by default and does not follow the browser's dark setting. A small "Dark"
button at the top right switches it to dark (and back to "Light"). The choice is remembered per
page in the browser's local storage and applied before the page first paints; if storage is
blocked, the page simply stays light.

The comment block at the top of the template lists the visual rules (bars on one scale,
"3 of 10" before percentages, never colour alone, and so on).

## Hiding parts of a page

The hide tray lets you show the agent what to clean up by hiding it, instead of describing it.
It works on prototypes, slides and docs as well as card pages.

1. **Hide a part.** Press **Pick** in the tray and click the part, or hover it and press **H**.
   Click the page once first so it has keyboard focus. A hidden part stays where it was, faint
   with a dashed outline, so you can still see what you took out. Press **Escape** to stop
   picking.
2. **Change your mind.** Press **H** on a faint part, or **Unhide** next to it in the tray.
   **Unhide all** clears the list.
3. **Send the list.** **Send to agent** queues one "remove these" message in Lavish's
   Conversation panel; send it from there as usual. The agent removes the parts from the
   page and says what it removed. Without Lavish, the button copies the list instead.

The list survives the agent's edits and a reload. On a card page the tray sits under the
canvas, works on the picture there, and keeps a separate list for each card and option.

**For agents.** The card template already carries the tray. Every other Lavish page carries it
too: paste `~/.config/ai-workstation-setup/hide-kit.js` into a script at the end of the page
body (Lavish serves only the page's own folder), then call `HideKit.attach(document.body)`.
`HideKit.attach(root, { mode: 'vanish' })` takes hidden parts out of the page instead of
leaving them faint. The tray cannot add a button to Lavish's own top bar, and an exported or
shared copy of the page does not keep what was hidden.
