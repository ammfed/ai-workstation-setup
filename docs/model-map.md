# Model map

Which model and effort level to use for each kind of work. The installer's defaults follow
this map; every one of them is a question you can answer differently, and the map is a
starting point to adjust to your own work and limits.

| Work | Model | Effort | Why |
|---|---|---|---|
| Tiny mechanical edit (typo, version bump, config value) | Sonnet 5.5 | medium | Fast and cheap; nothing to reason about. |
| Small, clear task (bug with a clear repro, docs or copy edit) | Sonnet 5.5 | high | Enough for a narrow change; re-run it on Opus 5.5 at medium after a failed check. |
| Building a feature, normal everyday work | Opus 5.5 | medium | The best quality for the cost; raise effort before you change the model. |
| Prototype frontend and visual design: a new look, not yet settled | Opus 5.5 | xhigh | The look is the product, and the extra effort shows. |
| Polish of a prototype frontend whose look is settled (spacing, copy, states, small layout fixes, fixes from a usability check) | Opus 5.5 | high | The look is decided; the remaining work needs care, not invention. |
| Investigation and diagnosis | Opus 5.5 | high | Run it again at xhigh when the result is weak or the cause is hard to find; fix it at medium once the cause is proven. |
| Planning and architecture | Opus 5.5 | high | Run it again at xhigh when the plan is weak; build it at medium once the plan is settled. |
| Code review (no-mistakes) | Opus 5.5 | medium | Catches more bugs with fewer false alarms. |
| Reading, lookup and summaries inside a session | Haiku 5.5 | (subagent) | Bulk reading does not need a large model; the `reader` subagent does it. |
| Research | Opus 5.5 | high | It plans and checks, and hands the bulk work to helpers (the next three rows). |
| Research: bulk fetching and web reading | agy with Gemini 3.8 Flash high; Claude Sonnet 4.6 on a Gemini quota error | (set by the model) | Keeps bulk fetching off your Claude limits; judge the result with Claude. |
| Research: drafting from a clear outline | Sonnet 5.5 | high | A clear outline does not need the larger model. |
| Long, hard work Opus 5.5 at xhigh did not finish | Fable 5.1 | high | Only when you ask for it by name: it is slower and can cost more. |

## Rules of thumb

1. Pick the model and effort when a task starts. Switching inside a running session breaks
   the prompt cache.
2. Change effort before you change the model.
3. Escalate one step at a time. A small task on Sonnet 5.5 high re-runs on Opus 5.5 medium
   after a failed check. An investigation or plan on Opus 5.5 high re-runs at xhigh when the
   result is weak or the cause is hard to find. After that, when a check fails twice: Opus 5.5
   xhigh, then Fable 5.1 high if you ask for it.
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
| Model for the same work after a Gemini quota error | preferences | `PREFS_DELEGATE_FALLBACK_MODEL` | `claude-sonnet-4-6` for agy |

no-mistakes takes one model per harness for all repositories, and re-reads its config at each
run, so a change applies to the next run without restarting its daemon. An `agent_config`
entry for `claude` that you already have is kept.

The `capable` dispatch profiles run Opus 5.5 at medium by default, Opus 5.5 at xhigh for a
new frontend look that is not yet settled, Opus 5.5 at high for polish of a settled look, for
investigations, diagnosis and plans (re-run at xhigh when the result is weak) and for research,
and Sonnet 5.5 at high for small, clear tasks. They name no Fable rule: ask for Fable 5.1 by
name when you want it.
