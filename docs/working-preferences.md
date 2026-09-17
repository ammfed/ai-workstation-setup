# Working preferences

The `preferences` module turns a set of questions into a plain Markdown rules file your
agents load on every session. The defaults describe one proven way of working with an
agent fleet; every one is a question, so change what does not suit you.

Where it writes (`PREFS_TARGETS`):

| Target | File | Loaded by |
| --- | --- | --- |
| `claude` | `~/.claude/rules/working-preferences.md` | Claude Code, as user rules in every project |
| `firstmate` | `data/captain.md` in your firstmate clone (the file firstmate reads for preferences) | Firstmate, at session start |

The file is yours: edit it freely. Re-running the installer asks before replacing a
changed file and keeps a timestamped backup.

## Questions and the rules they write

### Language and tone

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PLAIN_LANGUAGE` | yes | Plain, natural, friendly words; explain a thing before naming it; short replies. |
| `PREFS_NO_NARRATION` | yes | Give the result, not a commentary on the agent's own steps. |
| `PREFS_NO_EM_DASHES` | yes | No em dashes: periods, commas or plain conjunctions instead. |
| `PREFS_OUTWARD_AS_USER` | yes | Content for other people is written as you, with no agent or tooling labels, internal ids or tags. |
| `PREFS_NATURAL_TRANSLATION` | yes | Other languages are written the way a native speaker in that field would write them, never translated literally. |

### Reporting and status

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_STATUS` | `board` | Status replies open with one table whose three columns, TODO, DOING and DONE, sit side by side (never three stacked lists or rows), then brief action items grouped by who acts. `brief` opens with a one-line answer instead. |
| `PREFS_HONEST_NUMBERS` | yes | Uncertain numbers are ranges or "not yet known"; charts are plain bars or small multiples, never radar or gauges. |
| `PREFS_LINK_DELIVERABLES` | yes | Every finished item links to its output: a URL, or an absolute path for a local file. |
| `PREFS_DAILY_CHECK` | yes | Once a day, a nothing-forgotten check: uncollected review answers, anything waiting longer than `PREFS_STALE_DAYS` (default 2), and standing rules with no evidence they ran. Each item is verified before it is called dropped. |
| `PREFS_AWAY_MODE` | yes | When you say you are away, approved work continues, new decisions wait, and you get a short return brief. |

### Decisions

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_DECISIONS` | `cards` | Decisions go one at a time on a Lavish decision-card page with a preview for every option. `tool` uses the agent's question tool; `chat` asks in chat. |
| `PREFS_YES_NO_IN_CHAT` | yes | Simple yes-or-no questions stay in plain chat. |
| `PREFS_PREVIEW_BEFORE_BUILD` | yes | A change to how something looks or feels is shown on a review page before it is built. |
| `PREFS_CHECK_ANSWERS_FIRST` | yes | The agent checks for your answer before calling a page or question open. |
| `PREFS_ASK_BEFORE_CLOSING` | yes | The agent asks before closing finished agents, sessions and tabs. |

### Review pages

The first two apply with `PREFS_DECISIONS=cards`; the starter page already follows all four.

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PAGE_SIDE_BY_SIDE` | yes | The decision card sits on one side and a canvas showing the current decision on the other, horizontally, never stacked. |
| `PREFS_PAGE_FLIP_PREVIEWS` | yes | Every option of a visual choice has a preview, and you can flip between all of them; never only the recommended one. |
| `PREFS_PAGE_MINIMAL_TEXT` | yes | A title, the question and short option labels: no fluff, no helper text, no explaining the obvious. Visuals carry the meaning. |
| `PREFS_PAGE_WIDE_HEADER` | yes | A large title and intro spread across the full page width. |

### Ideas and priorities

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_CAPTURE_IDEAS` | yes | Every idea you share is captured, folded into current work or parked with a trigger, and you get one line on where it landed. |
| `PREFS_RESEQUENCE` | yes | The agent reorders queued work by what blocks what without asking, then tells you the new order and why. |

### AI and model use

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_MODEL_ROUTING` | `economical` | Low effort by default, medium for planning, design and hard reasoning, the most capable model for building. `balanced` raises each step. |
| `PREFS_QUOTA` | yes | Check subscription limits with `quota-axi` before heavy work and take the cheapest path. |

### Research

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_RESEARCH_BROWSER` | `separate` | Web research happens in the agent's own visible browser, never yours; one tab per task, closed when done. |
| `PREFS_SOURCE_QUALITY` | yes | Each source is named by type (official docs, standards body, report, vendor page, forum); low-quality sources are skipped; existing software comes before general write-ups. |
| `PREFS_FINDINGS_TO_CHANGE` | yes | Research ends in a change you can see or a decision you can make, not only a report. |

### Safety

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_MERGE` | `explicit` | Pull requests merge only on your explicit word. `green` lets the agent merge its own green pull requests. |
| `PREFS_VERIFY_CAUSE` | yes | No guessed causes: a failure's cause is named only when checked, otherwise "cause unknown". |

Always included: no secrets or personal data anywhere, only genuine decisions brought
to you, and saying plainly when something was reasoned about rather than tested.

## Tools the rules point to

- **Decision cards**: with `PREFS_DECISIONS=cards` the module installs a starter page at
  `~/.config/ai-workstation-setup/decision-cards.html`. It needs `lavish-axi` (agent-clis).
  Agents copy it, replace the example cards, and open it with `lavish-axi --no-open`. It shows
  the review-page rules: a full-width header, the card beside a canvas, and buttons to flip
  between every option's preview.
- **No surprise tabs**: agent-clis sets `LAVISH_AXI_NO_OPEN=1` (`LAVISH_NO_OPEN`), so review
  pages never open browser tabs on their own; links are shared in chat.
- **Research browser**: agent-clis installs `research-browser` (`RESEARCH_BROWSER`, Linux,
  macOS, WSL): a visible Chrome window with its own profile. Sign in to research sites
  there once; agents drive it with `research-browser axi <command>`.
- **Quota**: `quota-axi` (agent-clis) reads your subscription windows.
- **Context reminder**: the claude-code module can add a hook (`CLAUDE_CONTEXT_REMINDER`)
  that reminds the agent once, when the context passes `CLAUDE_CONTEXT_REMINDER_TOKENS`,
  to save its notes before the context is compacted.
