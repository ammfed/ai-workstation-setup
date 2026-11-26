# Model map

Which model and effort level to use for each kind of work. The installer's defaults follow
this map; every one of them is a question you can answer differently, and the map is a
starting point to adjust to your own work and limits.

| Work | Model | Effort | Why |
|---|---|---|---|
| Small, clear task (bug with a clear repro, docs or copy edit, typo, version bump, config value) | Sonnet 5.5 | medium | Enough for a well-specified change; re-run it on Opus 5.5 at medium after a failed check. |
| Routine work: supervision, building or fixing to a settled spec, normal everyday work | Opus 5.5 | medium | The vendor's recommended start for most work; a weak result re-runs once at high. |
| Slides and decks | Opus 5.5 | high | At medium effort, slide work came out weaker and dropped earlier instructions. |
| Games, and any look or front-end design work, settled or not (screens, look, layout, clickable journeys) | Opus 5.5 | high | Design calls need the extra effort. Name the styles to avoid in the brief. |
| Plans, specs and architecture | Opus 5.5 | high | A plan made at too low an effort lowers the quality of everything built on it. |
| Judging the quality of other work, and security audits | Opus 5.5 | high | A judge that misses a weakness passes it on. |
| A code bug hunt whose cause is unknown | Opus 5.5 | high | Fix on Opus 5.5 at medium once the cause is proven. |
| Research that runs many steps to a decision or a finished write-up: the orchestrator | Opus 5.5 | high | One orchestrator plans, splits and judges the work, and hands the fetching to the helpers in the rows below. |
| Research: direct fetch-and-report tasks, run in parallel | Haiku 5.5 subagents (for example `reader`) | medium | Many cheap fetchers give wider coverage at low cost; each reports back to the orchestrator. A weak fetcher re-runs once on Sonnet 5.5 at medium. |
| Polish of a frontend whose look is settled (spacing, copy, states, small layout fixes, fixes from a usability check) | Opus 5.5 | medium | The look is decided; this is clear-scope work. |
| Scouts, ordinary audits, documents and pages | Opus 5.5 | medium | Re-run once at high when the result is weak. |
| Code review (no-mistakes) | Opus 5.5 | medium | Catches more bugs with fewer false alarms. |
| Reading, lookup and summaries inside a session | Haiku 5.5 | medium (low for a one-fact lookup) | Bulk reading does not need a large model; the `reader` subagent does it at medium. |
| Research: bulk sweeps and broad web reading | agy with Gemini 3.8 Flash medium; Claude Sonnet 4.6 on a Gemini quota error | (set by the model) | Keeps bulk sweeps off your Claude limits; the orchestrator judges the result. |
| Research: drafting from a clear outline | Sonnet 5.5 | medium | A clear outline does not need the larger model. |
| Any task you name Fable for | Fable 5.2 | the effort you name | No row above uses Fable. It runs only when you name it for a task. |

When you name Fable 5.2 for a task on a subscription: Max-type plans and premium seats include
it for up to half of the weekly limit, and it uses that limit faster than other models. Pro and
standard seats bill Fable to usage credits from the start. Fable 5.2 needs Claude Code 2.1.321
or later.

## Rules of thumb

1. Pick the model and effort for each task when it starts. Do not pin one model and effort
   for all work. Switching inside a running session breaks the prompt cache.
2. Change effort before you change the model.
3. Escalate one step at a time. A small task on Sonnet 5.5 medium re-runs on Opus 5.5 medium
   after a failed check. Work on Opus 5.5 medium re-runs once at high when the result is weak.
4. Drop back to Opus 5.5 medium once the hard part (a plan, a proven cause) is done.
5. Never set xhigh or max, or Fable, by rule. Use them only when you name them for a task.
6. When a rule in this map changes, change every copy of it in the same pass: your preference
   files, any dispatch or routing config, the installed skills and your copy of this template.
   A copy left behind keeps giving the old rule.
7. Brief the model the way its vendor's prompting guide says
   ([Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5),
   [Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2)).
   The running-workers rules carry the main points: name the only stops you want, name the
   actions that need a go-ahead, say who owns the code, keep cautions few, and lower effort
   instead of asking for less thinking.

## Where the installer sets each one

| Setting | Module | Answer key | Default |
|---|---|---|---|
| Default model in `~/.claude/settings.json` (`model`) | claude-code | `CLAUDE_MODEL` | `opus` (Opus 5.5) |
| Default effort in `~/.claude/settings.json` (`effortLevel`; it reaches Opus 5, Fable 5.1 and older models only) | claude-code | `CLAUDE_EFFORT` | `medium` |
| Opus 5.5 effort a session starts at, in `~/.claude/settings.json` (`modelSettings`) | claude-code | `CLAUDE_MODEL_EFFORTS` | `claude-opus-5-5=medium` |
| Model of a helper started without one (`CLAUDE_CODE_SUBAGENT_MODEL` in `env` of `~/.claude/settings.json`; a backstop, because the rules name a model for every helper; a value you set stays) | claude-code | none | `claude-sonnet-5-5` |
| `reader` subagent in `~/.claude/agents/reader.md` (`model: haiku`, `effort: medium`, read-only tools) | claude-code | `CLAUDE_READER_AGENT` | yes; a reader you wrote is kept |
| no-mistakes review model (`agent_config.claude` in `~/.no-mistakes/config.yaml`, or `$NM_HOME`) | agent-clis | `NO_MISTAKES_REVIEW_MODEL` | `claude-opus-5-5 medium` |
| Example worker dispatch profiles (`config/crew-dispatch.json`) | firstmate | `FIRSTMATE_DISPATCH` | `capable` |
| Second mates (`config/secondmate-harness`) | firstmate | `FIRSTMATE_SECONDMATE_HARNESS` | `claude claude-opus-5-5 medium` with the `capable` profiles on Claude, otherwise `default` |
| backpass, which turns past sessions into rule suggestions | backpass | `BACKPASS_MODEL` | `claude-opus-5-5` (`gpt-5.5` on Codex); a dotted Claude id such as `claude-opus-5.5` is read as `claude-opus-5-5` |
| Research model for the bulk-reading CLI | preferences | `PREFS_DELEGATE_MODEL` | `gemini-3.8-flash-medium` for agy |
| Model for the same work after a Gemini quota error | preferences | `PREFS_DELEGATE_FALLBACK_MODEL` | `claude-sonnet-4-6` for agy |

Claude Code's own `effortLevel` no longer reaches Opus 5.5 and newer models; they take
their level from `modelSettings`, which is what `CLAUDE_MODEL_EFFORTS` writes. Set both, so
every session starts at medium. That is only the starting level: each task still picks its
own effort from the table above, and a worker for high-effort work is started at high. No
Fable level is written, because Fable runs only when you name it. A saved answer wins over
these defaults, so a `keep` saved from an earlier install stays `keep` until you change it,
and a Fable level an earlier install wrote stays in your settings until you remove it.

no-mistakes takes one model per harness for all repositories, and re-reads its config at each
run, so a change applies to the next run without restarting its daemon. An `agent_config`
entry for `claude` that you already have is kept.

The `capable` dispatch profiles run Opus 5.5 at medium by default and for routine work:
supervision, building or fixing to a settled spec, scout reports, ordinary audits, documents,
pages and polish of a settled look. They run Opus 5.5 at high for slides or a deck, a game,
any look or front-end design work, a plan, a spec, an architecture decision, judging the
quality of other work, a security audit, a code bug hunt whose cause is unknown, and research
that runs many steps (one orchestrator with Haiku 5.5 fetchers at medium), and Sonnet 5.5 at
medium for small, clear tasks. No profile uses Fable.
