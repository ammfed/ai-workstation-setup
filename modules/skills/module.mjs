import { Skip } from '../../lib/context.mjs';
import { installSkill, skillInstalled } from '../../lib/claude.mjs';

// Installed user-wide for Claude Code with the skills CLI (github.com/vercel-labs/skills).
const SKILLS = [
  { value: 'kun', repo: 'kunchenguid/kun', label: 'kun - how Kun thinks, builds and solves problems' },
  { value: 'grill-me', repo: 'mattpocock/skills', label: 'grill-me - a relentless interview to sharpen a plan' },
  { value: 'grilling', repo: 'mattpocock/skills', label: 'grilling - stress-test a plan, decision or idea' },
  { value: 'teach', repo: 'mattpocock/skills', label: 'teach - learn a new skill or concept in your workspace' },
  { value: 'tdd', repo: 'mattpocock/skills', label: 'tdd - build features and fix bugs test-first, red-green-refactor' },
  { value: 'codebase-design', repo: 'mattpocock/skills', label: 'codebase-design - shared vocabulary for deep modules, seams and testable interfaces' },
  { value: 'grill-with-docs', repo: 'mattpocock/skills', label: 'grill-with-docs - grilling that also writes GLOSSARY.md and docs/adr as it goes' },
  { value: 'to-spec', repo: 'mattpocock/skills', label: 'to-spec - turn the current conversation into a spec in your issue tracker' },
  { value: 'to-tickets', repo: 'mattpocock/skills', label: 'to-tickets - break a plan or spec into tickets with their blocking edges' },
  { value: 'to-questionnaire', repo: 'mattpocock/skills', label: 'to-questionnaire - turn an open decision into a questionnaire' },
  {
    value: 'wayfinder',
    repo: 'mattpocock/skills',
    label:
      'wayfinder - plans work too big for one session as a map of open decisions; starts only when you type /wayfinder; ' +
      'its tracker is local Markdown by default, with no setup skill to install. ' +
      'Also installs its helpers domain-modeling, research and prototype, which can start on their own in any session: ' +
      'research and prototype answer general research and UI-exploration requests, ' +
      'domain-modeling writes GLOSSARY.md and docs/adr into the repo it runs in',
    helpers: ['domain-modeling', 'research', 'prototype'],
  },
  { value: 'find-docs', repo: 'upstash/context7', label: 'find-docs - fetch current library docs with ctx7' },
  { value: 'no-mistakes', repo: 'kunchenguid/no-mistakes', label: 'no-mistakes - run the no-mistakes validation pipeline from chat (agent-clis installs the tool)' },
  {
    value: 'composio-cli',
    label: "composio-cli - Composio's own Claude Code plugin and skill, added by `composio setup` (agent-clis installs the tool)",
    install: (ctx) => {
      if (!ctx.dryRun && !ctx.has('composio')) throw new Skip('`composio` is not installed; pick it in agent-clis first');
      ctx.run('composio setup --target claude --yes');
    },
  },
];
// The default set is the one in daily use; the rest stay available as options.
// docs/route.md shows where each skill fits in a software project.
const DEFAULTS = ['kun', 'grilling', 'teach', 'tdd', 'codebase-design', 'find-docs'];

// Every skill a choice installs, helpers included.
const skillNames = (s) => (s.repo ? [s.value, ...(s.helpers ?? [])] : []);
const chosenSkills = (ctx) => SKILLS.filter((s) => ctx.get('SKILLS').includes(s.value));

export default {
  name: 'skills',
  title: 'Agent skills',
  description: 'Claude Code skills: kun, grilling, teach, tdd, codebase-design, find-docs; grill-me, grill-with-docs, to-spec, to-tickets, to-questionnaire, wayfinder, no-mistakes, composio-cli',
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
    for (const s of chosen) {
      await ctx.step(s.value, () => (s.install ? s.install(ctx) : installSkill(ctx, s.repo, s.value, opts)));
      for (const h of s.helpers ?? []) await ctx.step(`${h} (for ${s.value})`, () => installSkill(ctx, s.repo, h, opts));
    }
    ctx.info('the clickup module installs its own skill');
  },
};
