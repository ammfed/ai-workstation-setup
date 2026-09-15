# Working preferences

The `preferences` module turns a few questions into a plain Markdown rules file your
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

| Key | Default | Rule |
| --- | --- | --- |
| `PREFS_STATUS` | `board` | Status replies open with a TODO / DOING / DONE table, then brief action items grouped by who acts. `brief` opens with a one-line answer instead. |
| `PREFS_PLAIN_LANGUAGE` | yes | Plain, friendly, everyday words; explain a thing before naming it; short replies. |
| `PREFS_NO_EM_DASHES` | yes | No em dashes: periods, commas or plain conjunctions instead. |
| `PREFS_CALM` | yes | No narration between steps; batch tool calls and report the result. |
| `PREFS_DECISIONS` | `cards` | Decisions go one at a time on a Lavish decision-card page with a preview for every option. `tool` uses the agent's question tool; `chat` asks in chat. |
| `PREFS_YES_NO_IN_CHAT` | yes | Simple yes-or-no questions stay in plain chat. |
| `PREFS_AWAY_MODE` | yes | When you say you are away, approved work continues, new decisions wait, and you get a short return brief. |
| `PREFS_ASK_BEFORE_CLOSING` | yes | The agent asks before closing finished agents, sessions and tabs. |
| `PREFS_MERGE` | `explicit` | Pull requests merge only on your explicit word. `green` lets the agent merge its own green pull requests. |
| `PREFS_OUTWARD_AS_USER` | yes | Content for other people is written as you, with no agent or tooling labels, internal ids or tags. |
| `PREFS_MODEL_ROUTING` | `economical` | Low effort by default, medium for planning and design, the most capable model for building. `balanced` raises each step. |
| `PREFS_RESEARCH_BROWSER` | `separate` | Web research happens in the agent's own visible browser, never yours; one tab per task, closed when done. |
| `PREFS_QUOTA` | yes | Check subscription limits with `quota-axi` before heavy work and take the cheapest path. |

Always included: no secrets or personal data anywhere, a link on every finished
deliverable, and saying plainly when something was reasoned about rather than tested.

## Tools the rules point to

- **Decision cards**: with `PREFS_DECISIONS=cards` the module installs a starter page at
  `~/.config/ai-workstation-setup/decision-cards.html`. It needs `lavish-axi` (agent-clis).
  Agents copy it, replace the example cards, and open it with `lavish-axi --no-open`.
- **No surprise tabs**: agent-clis sets `LAVISH_AXI_NO_OPEN=1` (`LAVISH_NO_OPEN`), so review
  pages never open browser tabs on their own; links are shared in chat.
- **Research browser**: agent-clis installs `research-browser` (`RESEARCH_BROWSER`, Linux,
  macOS, WSL): a visible Chrome window with its own profile. Sign in to research sites
  there once; agents drive it with `research-browser axi <command>`.
- **Quota**: `quota-axi` (agent-clis) reads your subscription windows.
