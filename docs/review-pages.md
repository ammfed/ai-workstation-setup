# Review pages

A review page is an HTML page an agent serves with
[lavish-axi](https://www.npmjs.com/package/lavish-axi) so you can look at a proposal and
answer it in the browser, instead of reading a long chat reply. The `preferences` module
installs a decision-card template for this (`decision-cards.html`) when you pick
`PREFS_DECISIONS=cards`. This page is the loop an agent follows with it.

## The loop

1. **Build the page.** Copy the template next to the work, replace `CARDS` (and `DECIDED`,
   what is already settled), and give every option a preview. Keep text to a title, one
   question and short option labels.
2. **Serve it without opening a tab.** The agent shares the link in chat; you open it when
   you are ready.

   ```sh
   LAVISH_AXI_NO_OPEN=1 lavish-axi review.html --no-open
   ```

   The `agent-clis` module can set `LAVISH_AXI_NO_OPEN=1` for your user (`LAVISH_NO_OPEN`).
3. **Wait for answers.** `lavish-axi poll review.html` waits until you press send. Leave it
   running; if it is interrupted, run it again. Answers stay queued until they are collected.
4. **Check the real state before saying anything about it.** Running `lavish-axi` with no
   arguments lists every session with its status and the number of answers waiting to be
   collected. An agent looks there (or polls) before it ever tells you a page is still open
   or a question is unanswered.
5. **Record and link.** Each answer is recorded where your decisions live (see
   `PREFS_DECISIONS_LOG`), and the finished result is linked.
6. **Respect an ended page.** If you end the session from the browser, the agent does not
   reopen it unless you ask for another review.

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

The comment block at the top of the template lists the visual rules (bars on one scale,
"3 of 10" before percentages, never colour alone, and so on).
