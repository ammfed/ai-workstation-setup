import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { claudeDir } from '../../lib/claude.mjs';
import { renderPreferences } from './render.mjs';

// Writes how you want your agents to work (status format, tone, decisions,
// away mode, merges, research, quota) as a plain rules file your agents load.
// Every rule is a generic default you answer for; nothing here is anyone's record.
// docs/working-preferences.md describes each question and the rule it writes.

const yes = (key, message, extra = {}) => ({ key, type: 'confirm', message, default: true, ...extra });

function cardsPath(ctx) {
  return path.join(ctx.home, '.config', 'ai-workstation-setup', 'decision-cards.html');
}

const TARGETS = {
  claude: {
    label: 'claude - a Claude Code user rules file (~/.claude/rules/working-preferences.md), loaded in every session',
    file: (ctx) => path.join(claudeDir(ctx), 'rules', 'working-preferences.md'),
  },
  firstmate: {
    label: "firstmate - seed firstmate's local preferences file (data/captain.md in your firstmate clone)",
    file: (ctx) => ctx.path(ctx.get('FIRSTMATE_DIR') || '~/firstmate', 'data/captain.md'),
    unsupported: { windows: 'firstmate runs in WSL; run ./install.sh inside WSL for this target' },
  },
};

export default {
  name: 'preferences',
  title: 'Working preferences',
  description: 'How your agents work: status format, tone, decisions, away mode, merges, research, quota',
  // After firstmate, so its clone directory is known and exists.
  order: 70,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  default: true,
  questions: [
    {
      key: 'PREFS_TARGETS',
      type: 'multi',
      message: 'Where to write your working preferences',
      default: (ctx) => ['claude', ...((ctx.values.MODULES || []).includes('firstmate') ? ['firstmate'] : [])],
      choices: Object.entries(TARGETS).map(([value, t]) => ({ value, label: t.label })),
    },
    {
      key: 'PREFS_STATUS',
      type: 'choice',
      message: 'How status replies look',
      default: 'board',
      choices: [
        { value: 'board', label: 'board - open with a TODO / DOING / DONE table, then brief action items' },
        { value: 'brief', label: 'brief - the answer in a sentence or two, then brief action items' },
        { value: 'none', label: 'none - no rule' },
      ],
    },
    yes('PREFS_PLAIN_LANGUAGE', 'Plain, friendly, jargon-free language?'),
    yes('PREFS_NO_EM_DASHES', 'Avoid em dashes in everything written for you?'),
    yes('PREFS_CALM', 'Calm replies: no narration between steps, just the result?'),
    {
      key: 'PREFS_DECISIONS',
      type: 'choice',
      message: 'How decisions are put to you',
      default: 'cards',
      choices: [
        { value: 'cards', label: 'cards - one at a time on a Lavish decision-card page, with a preview for every option (needs lavish-axi)' },
        { value: 'tool', label: "tool - the agent's question tool, one at a time, a preview on every option" },
        { value: 'chat', label: 'chat - in plain chat, one at a time, recommendation first' },
      ],
    },
    yes('PREFS_YES_NO_IN_CHAT', 'Ask simple yes-or-no questions in plain chat?', { when: (ctx) => ctx.get('PREFS_DECISIONS') !== 'chat' }),
    yes('PREFS_AWAY_MODE', 'Away mode: when you say you are away, hold decisions and give a short brief when you return?'),
    yes('PREFS_ASK_BEFORE_CLOSING', 'Ask before closing finished agents, sessions and tabs?'),
    {
      key: 'PREFS_MERGE',
      type: 'choice',
      message: 'Who merges pull requests',
      default: 'explicit',
      choices: [
        { value: 'explicit', label: 'explicit - only when you say to merge that pull request' },
        { value: 'green', label: 'green - the agent may merge its own pull requests once every check passes' },
      ],
    },
    yes('PREFS_OUTWARD_AS_USER', 'Write content for other people as you, with no agent or tooling labels?'),
    {
      key: 'PREFS_MODEL_ROUTING',
      type: 'choice',
      message: 'Model and effort routing',
      default: 'economical',
      choices: [
        { value: 'economical', label: 'economical - low effort by default, more for planning and design, the strongest model for building' },
        { value: 'balanced', label: 'balanced - medium effort by default, high for planning, design and building' },
        { value: 'none', label: 'none - no rule' },
      ],
    },
    {
      key: 'PREFS_RESEARCH_BROWSER',
      type: 'choice',
      message: 'Where agents do web research',
      default: 'separate',
      choices: [
        { value: 'separate', label: "separate - a visible browser of the agent's own, never your browser (agent-clis offers a launcher)" },
        { value: 'none', label: 'none - no rule' },
      ],
    },
    yes('PREFS_QUOTA', 'Quota awareness: check subscription limits before heavy work and take the cheapest path?'),
  ],

  async install(ctx) {
    const targets = ctx.get('PREFS_TARGETS');
    if (!targets.length) throw new Skip('no targets selected');

    const cards = ctx.get('PREFS_DECISIONS') === 'cards' ? cardsPath(ctx) : null;
    if (cards) {
      await ctx.step('decision-card template', () => ctx.writeFile(cards, ctx.template('preferences/decision-cards.html'), { onConflict: 'ask' }));
    }

    const text = renderPreferences((key) => ctx.get(key), { cardsPath: cards });
    for (const name of targets) {
      const target = TARGETS[name];
      await ctx.step(name, () => {
        const reason = ctx.forOs(target.unsupported);
        if (reason) throw new Skip(reason);
        return ctx.writeFile(target.file(ctx), text, { onConflict: 'ask' });
      });
    }
    ctx.info('edit the written file any time; re-running asks before replacing your edits (and keeps a backup)');
  },
};
