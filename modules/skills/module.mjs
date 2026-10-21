import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { claudeDir, installSkill, skillInstalled } from '../../lib/claude.mjs';

/**
 * Write a skill this repo ships in templates/skills/<name> to ~/.claude/skills/<name>.
 * A copy this setup shipped earlier is refreshed; a local edit is left alone.
 */
export function writeBundledSkill(ctx, name) {
  return ctx.writeFile(path.join(claudeDir(ctx), 'skills', name, 'SKILL.md'), ctx.template(`skills/${name}/SKILL.md`), { onConflict: 'ask' });
}

// Installed user-wide for Claude Code with the skills CLI (github.com/vercel-labs/skills).
const SKILLS = [
  { value: 'kun', repo: 'kunchenguid/kun', label: 'kun - how Kun thinks, builds and solves problems' },
  { value: 'vision', repo: 'kunchenguid/vision', label: 'vision - draft and stress-test a VISION.md for a repository, then refine it with you on a review board' },
  { value: 'grilling', repo: 'mattpocock/skills', label: 'grilling - stress-test a plan, decision or idea' },
  { value: 'teach', repo: 'mattpocock/skills', label: 'teach - learn a new skill or concept in your workspace' },
  { value: 'tdd', repo: 'mattpocock/skills', label: 'tdd - build features and fix bugs test-first, red-green-refactor' },
  { value: 'codebase-design', repo: 'mattpocock/skills', label: 'codebase-design - shared vocabulary for deep modules, seams and testable interfaces' },
  { value: 'to-spec', repo: 'mattpocock/skills', label: 'to-spec - turn the current conversation into a spec in your issue tracker' },
  { value: 'to-tickets', repo: 'mattpocock/skills', label: 'to-tickets - break a plan or spec into tickets with their blocking edges' },
  { value: 'to-questionnaire', repo: 'mattpocock/skills', label: 'to-questionnaire - turn an open decision into a questionnaire' },
  {
    value: 'wayfinder',
    repo: 'mattpocock/skills',
    label:
      'wayfinder - tracks open decisions for work that takes more than one session as tickets on a map. Only you can start it, by typing /wayfinder. ' +
      'With workflow-playbook, the agent first draws a simple map on its own. ' +
      'Its tracker is local Markdown by default, with no setup skill to install. ' +
      'Also installs its helpers domain-modeling, research and prototype, which can start on their own in any session: ' +
      'research and prototype answer general research and UI-exploration requests, ' +
      'domain-modeling writes GLOSSARY.md and docs/adr into the repo it runs in',
    helpers: ['domain-modeling', 'research', 'prototype'],
  },
  { value: 'find-docs', repo: 'upstash/context7', label: 'find-docs - fetch current library docs with ctx7' },
  {
    value: 'no-mistakes',
    repo: 'kunchenguid/no-mistakes',
    label: 'no-mistakes - run the no-mistakes validation pipeline from chat (agent-clis installs the tool; skipped without it)',
    needs: { bin: 'no-mistakes', what: 'the no-mistakes CLI' },
  },
  {
    value: 'workflow-playbook',
    label:
      'workflow-playbook - a working method for long projects run with AI agents. Covers stage gates, ' +
      'a map that always shows the next step, evidence and research at every stage, review pages, when to ask or act, wording, briefs, ' +
      'memory and status, and the steps from a weak prototype to a liked direction, an approved journey map and an aligned rules list. Included with this setup.',
    install: (ctx) => writeBundledSkill(ctx, 'workflow-playbook'),
  },
  {
    value: 'composio-cli',
    label: "composio-cli - Composio's own Claude Code plugin and skill, added by `composio setup` (agent-clis installs the tool; skipped without it)",
    needs: { bin: 'composio', what: 'the composio CLI' },
    install: (ctx) => ctx.run('composio setup --target claude --yes'),
  },
];
// The default is the full set, so a fresh clone works like the setup it came from; untick
// what you do not want. docs/route.md shows where each skill fits in a software project.
const DEFAULTS = SKILLS.map((s) => s.value);
// Choices no longer offered, and the choice that covers each, so a saved answer naming one still runs.
// grill-me and grill-with-docs only called grilling (and domain-modeling, which wayfinder installs).
const RETIRED = { 'grill-me': 'grilling', 'grill-with-docs': 'grilling' };

// Every skill a choice installs, helpers included.
const skillNames = (s) => (s.repo ? [s.value, ...(s.helpers ?? [])] : []);
const chosenSkills = (ctx) => SKILLS.filter((s) => ctx.get('SKILLS').includes(s.value));

/**
 * A saved SKILLS answer plus the default skills that were not on offer when it was given
 * (SKILLS_OFFERED), so a rerun pulls new skills but never turns back on one you unticked.
 * An answer older than SKILLS_OFFERED gets the whole default set, unless it was "none".
 */
function withNewSkills(ctx, saved) {
  const before = ctx.answers.get('SKILLS_OFFERED');
  if (before === undefined && !saved.length) return saved;
  const offered = String(before ?? '').split(',').map((v) => v.trim());
  const added = DEFAULTS.filter((v) => !saved.includes(v) && !offered.includes(v));
  if (added.length) ctx.info(`new skills added to your selection: ${added.join(', ')} (to leave one out, remove it from SKILLS in answers.env)`);
  return [...saved, ...added];
}

/**
 * Why a skill cannot be installed yet, or null. Its tool must be on PATH; agent-clis runs
 * first, so a dry run also counts a tool that this run's agent-clis would install.
 */
function missingTool(ctx, s) {
  if (!s.needs || ctx.has(s.needs.bin)) return null;
  if (ctx.dryRun && (ctx.get('AGENT_CLIS') ?? []).includes(s.needs.bin)) return null;
  return `${s.needs.what} is not installed (install it, then rerun with --modules skills)`;
}

/** Run one skill's step and note how it ended, for the recap at the end of the install. */
async function tallied(ctx, tally, label, fn) {
  const { skips, failures } = ctx.record;
  const before = [skips.length, failures.length];
  await ctx.step(label, fn);
  if (failures.length > before[1]) tally.failed.push(failures.at(-1));
  else if (skips.length > before[0]) tally.skipped.push(skips.at(-1));
  else tally.installed.push(label);
}

export default {
  name: 'skills',
  title: 'Agent skills',
  description: 'Claude Code skills, downloaded from their upstreams: kun, vision, grilling, teach, tdd, codebase-design, to-spec, to-tickets, to-questionnaire, wayfinder, find-docs, no-mistakes, workflow-playbook, composio-cli',
  order: 50,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: true,
  questions: [
    {
      key: 'SKILLS',
      type: 'multi',
      message: 'Skills to install for Claude Code',
      default: DEFAULTS,
      choices: SKILLS,
      retired: RETIRED,
      refresh: withNewSkills,
    },
    {
      key: 'SKILLS_OFFERED',
      type: 'text',
      message: 'Skills on offer when SKILLS was answered (kept by the installer, so a rerun knows which skills are new)',
      default: SKILLS.map((s) => s.value).join(','),
      useDefault: () => true,
      refresh: () => SKILLS.map((s) => s.value).join(','),
    },
    {
      key: 'SKILLS_UPDATE',
      type: 'confirm',
      message: 'Update the chosen skills you already have to their latest upstream version (replaces local edits to them)?',
      default: true,
      when: (ctx) => chosenSkills(ctx).some((s) => skillNames(s).some((n) => skillInstalled(ctx, n))),
    },
  ],

  async install(ctx) {
    const chosen = chosenSkills(ctx);
    if (!chosen.length) ctx.ok('no skills selected');
    const opts = { update: Boolean(ctx.get('SKILLS_UPDATE')) };
    const tally = { installed: [], skipped: [], failed: [] };
    for (const s of chosen) {
      const missing = missingTool(ctx, s);
      await tallied(ctx, tally, s.value, () => {
        if (missing) throw new Skip(missing);
        return s.install ? s.install(ctx) : installSkill(ctx, s.repo, s.value, opts);
      });
      if (missing) continue;
      for (const h of s.helpers ?? []) await tallied(ctx, tally, `${h} (for ${s.value})`, () => installSkill(ctx, s.repo, h, opts));
    }
    ctx.info('the clickup module installs its own skill');
    if (!chosen.length) return;
    if (tally.installed.length) ctx.report(`${ctx.dryRun ? 'would install' : 'installed'}: ${tally.installed.join(', ')}`);
    for (const line of tally.skipped) ctx.report(`skipped: ${line}`);
    for (const line of tally.failed) ctx.report(`failed: ${line}`);
    ctx.report('Restart Claude Code so the new skills load.');
  },
};
