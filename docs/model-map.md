# Model map

Which model and effort level to use for each kind of work. The installer's defaults follow
this map; every one of them is a question you can answer differently, and the map is a
starting point to adjust to your own work and limits.

| Work | Model | Effort | Why |
|---|---|---|---|
| Small, clear task (bug with a clear repro, docs or copy edit, typo, version bump, config value) | Sonnet 5.5 | medium | Enough for a well-specified change; re-run it on Opus 5.5 at medium after a failed check. |
| Building a feature, normal everyday work | Opus 5.5 | medium | The best quality for the cost; raise effort before you change the model. |
| Prototype frontend and visual design: a new look, not yet settled | Opus 5.5 | high | The look is the product. Run it again at xhigh only as a second re-run after a weak result. |
| Polish of a prototype frontend whose look is settled (spacing, copy, states, small layout fixes, fixes from a usability check) | Opus 5.5 | medium | The look is decided; this is clear-scope work. |
| A code bug hunt whose cause is unknown | Opus 5.5 | high | Run it again at xhigh only as the second re-run when the cause stays hidden; fix it at medium once the cause is proven. |
| Scouts, audits and reports that mostly read and compare | Opus 5.5 | medium | Run it again at high when the result is weak. Start security audits at high. |
| Planning and architecture | Opus 5.5 | medium | Run it again at high when the plan is weak. Start plans that are hard to undo (data migration, public interface, security) at high. |
| Slides and documents | Opus 5.5 | medium | For knowledge work, medium matched high in Anthropic's runs. |
| Code review (no-mistakes) | Opus 5.5 | medium | Catches more bugs with fewer false alarms. |
| Reading, lookup and summaries inside a session | Haiku 5.5 | medium (low for a one-fact lookup) | Bulk reading does not need a large model; the `reader` subagent does it at medium. |
| Research | Opus 5.5 | medium | It plans and checks, and hands the bulk work to helpers (the next two rows). Run it again at high when the result is weak. |
| Research: bulk fetching and web reading | agy with Gemini 3.8 Flash medium; Claude Sonnet 4.6 on a Gemini quota error | (set by the model) | Keeps bulk fetching off your Claude limits; judge the result with Claude. |
| Research: drafting from a clear outline | Sonnet 5.5 | medium | A clear outline does not need the larger model. |
| Long, hard work Opus 5.5 at xhigh did not finish | Fable 5.1 | high | Only when you ask for it by name: it is slower and can cost more. |

## Rules of thumb

1. Pick the model and effort when a task starts. Switching inside a running session breaks
   the prompt cache.
2. Change effort before you change the model.
3. Escalate one step at a time. A small task on Sonnet 5.5 medium re-runs on Opus 5.5 medium
   after a failed check. Work on Opus 5.5 medium re-runs once at high when the result is weak.
   A bug hunt or a new look on Opus 5.5 high re-runs at xhigh only as the second re-run. After
   that, Fable 5.1 high if you ask for it.
4. Drop back to Opus 5.5 medium once the hard part (a plan, a proven cause) is done.
5. Never set xhigh or max by rule. Use them only as a second re-run after high failed, or when
   you name them.

## Where the installer sets each one

| Setting | Module | Answer key | Default |
|---|---|---|---|
| Default model in `~/.claude/settings.json` (`model`) | claude-code | `CLAUDE_MODEL` | `opus` (Opus 5.5) |
| Default effort in `~/.claude/settings.json` (`effortLevel`; it reaches Opus 5, Fable 5.1 and older models only) | claude-code | `CLAUDE_EFFORT` | `medium` |
| Opus 5.5 effort in `~/.claude/settings.json` (`modelSettings`) | claude-code | `CLAUDE_MODEL_EFFORTS` | `claude-opus-5-5=medium` |
| `reader` subagent in `~/.claude/agents/reader.md` (`model: haiku`, `effort: medium`, read-only tools) | claude-code | `CLAUDE_READER_AGENT` | yes; a reader you wrote is kept |
| no-mistakes review model (`agent_config.claude` in `~/.no-mistakes/config.yaml`, or `$NM_HOME`) | agent-clis | `NO_MISTAKES_REVIEW_MODEL` | `claude-opus-5-5 medium` |
| Example worker dispatch profiles (`config/crew-dispatch.json`) | firstmate | `FIRSTMATE_DISPATCH` | `capable` |
| Second mates (`config/secondmate-harness`) | firstmate | `FIRSTMATE_SECONDMATE_HARNESS` | `claude claude-opus-5-5 medium` with the `capable` profiles on Claude, otherwise `default` |
| backpass, which turns past sessions into rule suggestions | backpass | `BACKPASS_MODEL` | `claude-opus-5-5` (`gpt-5.5` on Codex); a dotted Claude id such as `claude-opus-5.5` is read as `claude-opus-5-5` |
| Research model for the bulk-reading CLI | preferences | `PREFS_DELEGATE_MODEL` | `gemini-3.8-flash-medium` for agy |
| Model for the same work after a Gemini quota error | preferences | `PREFS_DELEGATE_FALLBACK_MODEL` | `claude-sonnet-4-6` for agy |

Claude Code's own `effortLevel` no longer reaches Opus 5.5 and newer models; they take
their level from `modelSettings`, which is what `CLAUDE_MODEL_EFFORTS` writes. Set both, so
every model starts at medium. A saved answer wins over these defaults, so a `keep` saved
from an earlier install stays `keep` until you change it.

no-mistakes takes one model per harness for all repositories, and re-reads its config at each
run, so a change applies to the next run without restarting its daemon. An `agent_config`
entry for `claude` that you already have is kept.

The `capable` dispatch profiles run Opus 5.5 at medium by default and for research, scout
reports, audits, plans, specs, architecture, polish of a settled look, and slides and documents.
They run Opus 5.5 at high for a new frontend look that is not yet settled and for a code bug
hunt whose cause is unknown, and Sonnet 5.5 at medium for small, clear tasks. They name no
Fable rule: ask for Fable 5.1 by name when you want it.
