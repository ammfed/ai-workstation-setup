import { installSkill } from '../../lib/claude.mjs';

// Installed user-wide for Claude Code with the skills CLI (github.com/vercel-labs/skills).
const SKILLS = [
  { value: 'kun', repo: 'kunchenguid/kun', label: 'kun - how Kun thinks, builds and solves problems' },
  { value: 'grill-me', repo: 'mattpocock/skills', label: 'grill-me - a relentless interview to sharpen a plan' },
  { value: 'grilling', repo: 'mattpocock/skills', label: 'grilling - stress-test a plan, decision or idea' },
  { value: 'teach', repo: 'mattpocock/skills', label: 'teach - learn a new skill or concept in your workspace' },
  { value: 'to-questionnaire', repo: 'mattpocock/skills', label: 'to-questionnaire - turn an open decision into a questionnaire' },
  { value: 'find-docs', repo: 'upstash/context7', label: 'find-docs - fetch current library docs with ctx7' },
];

export default {
  name: 'skills',
  title: 'Agent skills',
  description: 'Claude Code skills: kun, grill-me, grilling, teach, to-questionnaire, find-docs',
  order: 50,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: true,
  questions: [
    {
      key: 'SKILLS',
      type: 'multi',
      message: 'Skills to install for Claude Code',
      default: SKILLS.map((s) => s.value),
      choices: SKILLS,
    },
  ],

  async install(ctx) {
    const chosen = SKILLS.filter((s) => ctx.get('SKILLS').includes(s.value));
    if (!chosen.length) ctx.ok('no skills selected');
    for (const s of chosen) await ctx.step(s.value, () => installSkill(ctx, s.repo, s.value));
    ctx.info('more skills ship with tools: no-mistakes (`no-mistakes init`), composio (`composio setup`), clickup module');
  },
};
