# Model map

Which model and effort level to use for each kind of work. The installer's defaults follow
this map; every one of them is a question you can answer differently, and the map is a
starting point to adjust to your own work and limits.

| Work | Model | Effort | Why |
|---|---|---|---|
| Tiny mechanical edit (typo, version bump, config value) | Sonnet 5.5 | medium | Fast and cheap; nothing to reason about. |
| Small, clear task (bug with a clear repro, docs or copy edit) | Sonnet 5.5 | medium | Enough for a narrow change; raise it to high after a failed check. |
| Building a feature, normal everyday work | Opus 5.5 | medium | The best quality for the cost; raise effort before you change the model. |
| Prototype frontend and visual design | Opus 5.5 | xhigh | The look is the product, and the extra effort shows. |
| Investigation and diagnosis | Opus 5.5 | xhigh | Finding a cause needs depth; fix it at medium once the cause is proven. |
| Planning and architecture | Opus 5.5 | xhigh | A good plan is cheap next to a wrong build; build it at medium. |
| Code review (no-mistakes) | Opus 5.5 | medium | Catches more bugs with fewer false alarms. |
| Reading, lookup and summaries inside a session | Haiku 5.5 | (subagent) | Bulk reading does not need a large model; the `reader` subagent does it. |
| Research and bulk web reading | agy with Gemini 3.8 Flash high | (set by the model) | Keeps bulk fetching off your Claude limits; judge the result with Claude. |
| Long, hard work Opus 5.5 at xhigh did not finish | Fable 5.1 | high | Only when you ask for it by name: it is slower and can cost more. |

## Rules of thumb

1. Pick the model and effort when a task starts. Switching inside a running session breaks
   the prompt cache.
2. Change effort before you change the model.
3. Escalate one step at a time, when a check fails twice: Sonnet 5.5, then Opus 5.5 medium,
   then Opus 5.5 xhigh, then Fable 5.1 high if you ask for it.
4. Drop back to Opus 5.5 medium once the hard part (a plan, a proven cause) is done.
5. Leave max effort for when you name it; it costs the most for the smallest gain.

## Where the installer sets each one

| Setting | Module | Answer key | Default |
|---|---|---|---|
| Opus 5.5 effort in `~/.claude/settings.json` (`modelSettings`) | claude-code | `CLAUDE_MODEL_EFFORTS` | `claude-opus-5-5=medium` |
| `reader` subagent in `~/.claude/agents/reader.md` (`model: haiku`, read-only tools) | claude-code | `CLAUDE_READER_AGENT` | yes; a reader you wrote is kept |
| no-mistakes review model (`agent_config.claude` in `~/.no-mistakes/config.yaml`, or `$NM_HOME`) | agent-clis | `NO_MISTAKES_REVIEW_MODEL` | `claude-opus-5-5 medium` |
| Example worker dispatch profiles (`config/crew-dispatch.json`) | firstmate | `FIRSTMATE_DISPATCH` | `capable` |
| Research model for the bulk-reading CLI | preferences | `PREFS_DELEGATE_MODEL` | `gemini-3.8-flash-high` for agy |

no-mistakes takes one model per harness for all repositories, and re-reads its config at each
run, so a change applies to the next run without restarting its daemon. An `agent_config`
entry for `claude` that you already have is kept.

The `capable` dispatch profiles run Opus 5.5 at medium by default, Opus 5.5 at xhigh for
frontend design and for investigations, diagnosis and plans, and Sonnet 5.5 at medium for
small, clear tasks. They name no Fable rule: ask for Fable 5.1 by name when you want it.
