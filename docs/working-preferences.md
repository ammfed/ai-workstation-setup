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
| `PREFS_WRITING_PRINCIPLES` | yes | Writing for others leads with the point, backs claims with a reason or evidence and states uncertainty plainly; a deck or document starts from an agreed one-sentence point, then plain paragraphs, then visuals only where they are the evidence. |
| `PREFS_ONE_DESIGN_SYSTEM` | no | With several design systems, the one matching the artifact type is used, never two mixed. |
| `PREFS_COPY_SECOND_OPINION` | no | Copywriting and translations get a refinement pass from a second AI model; only the text being refined is sent. |
| `PREFS_CALM_WORD` | `calm` | Saying this word switches the agent to a calm mode: batched tool calls, no in-between updates, only the answer. Empty for none. |

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
| `PREFS_AUTONOMY` | `act` | Everyday judgment calls inside a direction you set are decided and reported; credentials, anything destructive and choices only you can make are always asked. `ask` asks about every one. |
| `PREFS_DECISIONS_LOG` | empty | A file where the agent records each ruling with its date (newest wins, not in the file means not decided), what you ruled out (never offered again), and each "not yet" with the condition that brings it back. |
| `PREFS_GRILL_ON_GAPS` | yes | Hard questioning of a plan only when it has a real gap, never as the default way to ask. |

### Review pages

The first two apply with `PREFS_DECISIONS=cards`; the starter page already follows all four.

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PAGE_SIDE_BY_SIDE` | yes | The decision card sits on one side and a canvas showing the current decision on the other, horizontally, never stacked. |
| `PREFS_PAGE_FLIP_PREVIEWS` | yes | Every option of a visual choice has a preview, and you can flip between all of them; never only the recommended one. |
| `PREFS_PAGE_MINIMAL_TEXT` | yes | A title, the question and short option labels: no fluff, no helper text, no explaining the obvious. Visuals carry the meaning. |
| `PREFS_PAGE_WIDE_HEADER` | yes | A large title and intro spread across the full page width. |

### Review page delivery and workflow

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_PAGE_CHECK_BEFORE_SEND` | yes | A page is opened in the agent's own browser and checked by screenshot before its link is sent, and the link is always sent. |
| `PREFS_PAGE_FIRST` | yes | When a decision waits on a page, the page is built and checked first, the link is sent, and the agent stands by until you answer. |
| `PREFS_FLEET_WORKFLOW` | yes | Supervising agents brief workers with a goal, branch and definition of done; workers report only at phase changes and land through a pull request with green checks; review pages are for real decisions and look-and-feel changes, never status or routine choices; permission prompts and command mechanics are never escalated. |

### Ideas and priorities

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_CAPTURE_IDEAS` | yes | Every idea you share is captured, folded into current work or parked with a trigger, and you get one line on where it landed. |
| `PREFS_RESEQUENCE` | yes | The agent reorders queued work by what blocks what without asking, then tells you the new order and why. |
| `PREFS_ORIENT` | yes | When work piles up or you seem unsure what is next, two lines: the current phase and the next deliverable, with where to find it. |
| `PREFS_FINISH_FIRST` | yes | Once something works, the agent stops instead of proposing the next improvement, suggests cutting scope at most once, and raises a risk once. |

### AI and model use

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_MODEL_ROUTING` | `economical` | Low effort by default, medium for planning, design and hard reasoning, the most capable model for building. `balanced` raises each step. |
| `PREFS_QUOTA` | yes | Check subscription limits with `quota-axi` before heavy work and take the cheapest path. |
| `PREFS_DELEGATE_RETRIEVAL` | `agy` if chosen in agent-clis | Bulk reading and fetching go to this secondary agent CLI; decisions and code changes stay with the main agent. Empty for none. |

### Research

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_RESEARCH_BROWSER` | `separate` | Web research happens in the agent's own visible browser, never yours; one tab per task, closed when done. |
| `PREFS_SOURCE_QUALITY` | yes | Each source is named by type (official docs, standards body, report, vendor page, forum); low-quality sources are skipped; existing software comes before general write-ups. |
| `PREFS_FINDINGS_TO_CHANGE` | yes | Research ends in a change you can see or a decision you can make, not only a report. |
| `PREFS_VERIFY_USER_CLAIMS` | yes | Tools and facts you mention in passing are checked before they are relied on, and options are compared before large installs. |

### Safety

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_MERGE` | `explicit` | Pull requests merge only on your explicit word. `green` lets the agent merge its own green pull requests. |
| `PREFS_VERIFY_CAUSE` | yes | No guessed causes: a failure's cause is named only when checked, otherwise "cause unknown". |
| `PREFS_PAUSE_WORD` | `pause` | Saying this word stops every running agent until you say resume. Empty for none. |
| `PREFS_STOP_DIGGING` | yes | A problem is confirmed from evidence before its cause is hunted; after about two checks that find nothing, the agent reports what is known. |

Always included: no secrets or personal data anywhere, only genuine decisions brought
to you, and saying plainly when something was reasoned about rather than tested.

## Tools the rules point to

- **Decision cards**: with `PREFS_DECISIONS=cards` the module installs a starter page at
  `~/.config/ai-workstation-setup/decision-cards.html`. It needs `lavish-axi` (agent-clis).
  Agents copy it, replace the example cards, and open it with `lavish-axi --no-open`. It shows
  the review-page rules: a full-width header, the card beside a canvas, and buttons to flip
  between every option's preview. [Review pages](review-pages.md) describes the loop and the
  card fields.
- **No surprise tabs**: agent-clis sets `LAVISH_AXI_NO_OPEN=1` (`LAVISH_NO_OPEN`), so review
  pages never open browser tabs on their own; links are shared in chat.
- **Research browser**: agent-clis installs `research-browser` (`RESEARCH_BROWSER`, Linux,
  macOS, WSL): a visible Chrome window with its own profile. Sign in to research sites
  there once; agents drive it with `research-browser axi <command>`.
- **Quota**: `quota-axi` (agent-clis) reads your subscription windows. It is held at 0.1.49:
  0.1.50 reads Claude's usage `utilization` as headroom, so it reports the share you have used
  as the share you have left, and the quota rule above would then act on the wrong number.
  Firstmate's tool update watch (`FIRSTMATE_WATCH_UPDATES`, `config/watched-tools.json`) still
  announces newer quota-axi releases; do not take that one until a release after 0.1.50 is
  confirmed fixed. Re-running the installer fails the `quota-axi` step while 0.1.50 is the
  installed version and prints the command that puts 0.1.49 back.
- **Context reminder**: the claude-code module can add a hook (`CLAUDE_CONTEXT_REMINDER`)
  that reminds the agent once, when the context passes `CLAUDE_CONTEXT_REMINDER_TOKENS`,
  to save its notes before the context is compacted, and (`CLAUDE_COMPACT_REMINDER`) once more
  right after a compaction, pointing at the full transcript so nothing is lost.
