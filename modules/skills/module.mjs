import { Skip } from '../../lib/context.mjs';
import { installSkill } from '../../lib/claude.mjs';

// Installed user-wide for Claude Code with the skills CLI (github.com/vercel-labs/skills).
const SKILLS = [
  { value: 'kun', repo: 'kunchenguid/kun', label: 'kun - how Kun thinks, builds and solves problems' },
  { value: 'grill-me', repo: 'mattpocock/skills', label: 'grill-me - a relentless interview to sharpen a plan' },
  { value: 'grilling', repo: 'mattpocock/skills', label: 'grilling - stress-test a plan, decision or idea' },
  { value: 'teach', repo: 'mattpocock/skills', label: 'teach - learn a new skill or concept in your workspace' },
  { value: 'to-questionnaire', repo: 'mattpocock/skills', label: 'to-questionnaire - turn an open decision into a questionnaire' },
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
const DEFAULTS = ['kun', 'grill-me', 'grilling', 'teach', 'to-questionnaire', 'find-docs'];

export default {
  name: 'skills',
  title: 'Agent skills',
  description: 'Claude Code skills: kun, grill-me, grilling, teach, to-questionnaire, find-docs, no-mistakes, composio-cli',
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
  ],

  async install(ctx) {
    const chosen = SKILLS.filter((s) => ctx.get('SKILLS').includes(s.value));
    if (!chosen.length) ctx.ok('no skills selected');
    for (const s of chosen) await ctx.step(s.value, () => (s.install ? s.install(ctx) : installSkill(ctx, s.repo, s.value)));
    ctx.info('the clickup module installs its own skill');
  },
};
