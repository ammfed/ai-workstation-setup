# Model map

Which model and effort level to use for each kind of work. The installer's defaults follow
this map; every one of them is a question you can answer differently, and the map is a
starting point to adjust to your own work and limits.

| Work | Model | Effort | Why |
|---|---|---|---|
| Small, clear task (bug with a clear repro, docs or copy edit, typo, version bump, config value) | Sonnet 5.5 | medium | Enough for a well-specified change; re-run it on Opus 5.5 at medium after a failed check. |
| Building a feature, normal everyday work | Opus 5.5 | medium | The vendor's recommended start for most work; raise effort or move to Fable 5.2 only when a result is weak. |
| Prototype frontend and visual design: a new look, not yet settled | Fable 5.2 | low | Hard work. On the vendor's runs, Fable 5.2 at low already matches Opus 5.5 at its highest effort on hard reasoning, for under a tenth of its cost per task. Name the styles to avoid in the brief. |
| A code bug hunt whose cause is unknown | Fable 5.2 | low | Hard work, as above. Re-run once at medium, then at high, if the cause stays hidden; fix on Opus 5.5 at medium once the cause is proven. |
| Security audits and plans that are hard to undo (data migration, public interface, security) | Fable 5.2 | low | Hard work, as above. |
| Research that runs many steps to a decision or a finished write-up: the orchestrator | Fable 5.2 | low | The vendor names multistep research as Fable's job. One orchestrator plans, splits and checks the work, and hands the fetching to the helpers in the rows below. |
| Research: direct fetch-and-report tasks, run in parallel | Haiku 5.5 subagents (for example `reader`) | medium | Many cheap fetchers give wider coverage at low cost; each reports back to the orchestrator. A weak fetcher re-runs once on Sonnet 5.5 at medium. |
| Polish of a prototype frontend whose look is settled (spacing, copy, states, small layout fixes, fixes from a usability check) | Opus 5.5 | medium | The look is decided; this is clear-scope work. |
| Scouts, ordinary audits, plans, specs and reports that mostly read and compare | Opus 5.5 | medium | Re-run once on Fable 5.2 at low when the result is weak. |
| Slides and documents | Opus 5.5 | medium | The vendor reports its documents need less editing; Fable 5.2 is not clearly ahead on document benchmarks. |
| Code review (no-mistakes) | Opus 5.5 | medium | Catches more bugs with fewer false alarms. |
| Reading, lookup and summaries inside a session | Haiku 5.5 | medium (low for a one-fact lookup) | Bulk reading does not need a large model; the `reader` subagent does it at medium. |
| Research: bulk sweeps and broad web reading | agy with Gemini 3.8 Flash medium; Claude Sonnet 4.6 on a Gemini quota error | (set by the model) | Keeps bulk sweeps off your Claude limits; the orchestrator judges the result. |
| Research: drafting from a clear outline | Sonnet 5.5 | medium | A clear outline does not need the larger model. |

Fable on a subscription: Max-type plans and premium seats include Fable 5.2 for up to half of the
weekly limit, and it uses that limit faster than other models. Pro and standard seats bill Fable to
usage credits from the start. Fable 5.2 needs Claude Code 2.1.321 or later.

## Rules of thumb

1. Pick the model and effort when a task starts. Switching inside a running session breaks
   the prompt cache.
2. For the hard rows, the model change pays: Fable 5.2 at low matches Opus 5.5 at its highest
   effort on the vendor's runs. Elsewhere, change effort before you change the model.
3. Escalate one step at a time. A small task on Sonnet 5.5 medium re-runs on Opus 5.5 medium
   after a failed check. Work on Opus 5.5 medium re-runs once on Fable 5.2 low when the result
   is weak. Work on Fable 5.2 low re-runs once at medium, then once at high.
4. Drop back to Opus 5.5 medium once the hard part (a plan, a proven cause) is done.
5. Never set xhigh or max by rule. Use them only when you name them.
6. Brief the model the way its vendor's prompting guide says
   ([Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2),
   [Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)).
   Fable stops early more often at low effort, so its briefs must name the only stops wanted.
   The running-workers rules carry the main points: name the only stops you want, name the
   actions that need a go-ahead, say who owns the code, keep cautions few, and lower effort
   instead of asking for less thinking.

## Where the installer sets each one

| Setting | Module | Answer key | Default |
|---|---|---|---|
| Default model in `~/.claude/settings.json` (`model`) | claude-code | `CLAUDE_MODEL` | `opus` (Opus 5.5) |
| Default effort in `~/.claude/settings.json` (`effortLevel`; it reaches Opus 5, Fable 5.1 and older models only) | claude-code | `CLAUDE_EFFORT` | `medium` |
| Opus 5.5 and Fable 5.2 effort in `~/.claude/settings.json` (`modelSettings`) | claude-code | `CLAUDE_MODEL_EFFORTS` | `claude-opus-5-5=medium, claude-fable-5-2=low` |
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

The `capable` dispatch profiles run Opus 5.5 at medium by default and for scout reports,
ordinary audits, plans, specs, architecture, polish of a settled look, and slides and documents.
They run Fable 5.2 at low for a new frontend look that is not yet settled, a code bug hunt
whose cause is unknown, a security audit, a plan that is hard to undo, and research that runs
many steps (one orchestrator with Haiku 5.5 fetchers at medium), and Sonnet 5.5 at medium for
small, clear tasks.
