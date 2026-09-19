import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { claudeDir } from '../../lib/claude.mjs';
import { renderPreferences } from './render.mjs';

// Writes how you want your agents to work (status format, tone, decisions, review
// pages, ideas, away mode, merges, research, quota) as a plain rules file your agents load.
// Every rule is a generic default you answer for; nothing here is anyone's record.
// docs/working-preferences.md describes each question and the rule it writes.

const yes = (key, message, extra = {}) => ({ key, type: 'confirm', message, default: true, ...extra });

const cardsOn = (ctx) => ctx.get('PREFS_DECISIONS') === 'cards';

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
  description: 'How your agents work: language and tone, reporting, decisions, review pages, ideas, model use, research, safety',
  // After firstmate, so its clone directory is known and exists.
  order: 65,
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

    // Language and tone
    yes('PREFS_PLAIN_LANGUAGE', 'Tone: plain, natural, friendly language with no jargon?'),
    yes('PREFS_NO_NARRATION', 'Tone: give the result, not a commentary on the agent\'s own steps?'),
    yes('PREFS_NO_EM_DASHES', 'Tone: avoid em dashes in everything written for you?'),
    yes('PREFS_OUTWARD_AS_USER', 'Tone: write content for other people as you, with no agent or tooling labels?'),
    yes('PREFS_NATURAL_TRANSLATION', 'Tone: write other languages the way native speakers do, never as a literal translation?'),
    yes('PREFS_WRITING_PRINCIPLES', 'Tone: writing for other people leads with the point, backs claims with evidence, and agrees the point before building a deck or document?'),
    yes('PREFS_ONE_DESIGN_SYSTEM', 'Tone: if you use several design systems, pick the one matching the artifact type and never mix them?', { default: false }),
    yes('PREFS_COPY_SECOND_OPINION', 'Tone: get a second AI model to refine copywriting and translations (only the text being polished is sent)?', { default: false }),
    {
      key: 'PREFS_CALM_WORD',
      type: 'text',
      message: 'Tone: a word you can say to ask for a calmer, quieter mode (empty for none)',
      default: 'calm',
    },

    // Reporting and status
    {
      key: 'PREFS_STATUS',
      type: 'choice',
      message: 'Reporting: how status replies open',
      default: 'board',
      choices: [
        { value: 'board', label: 'board - one table with TODO, DOING and DONE as three side-by-side columns, then brief action items' },
        { value: 'brief', label: 'brief - the answer in a sentence or two, then brief action items' },
        { value: 'none', label: 'none - no rule' },
      ],
    },
    yes('PREFS_HONEST_NUMBERS', 'Reporting: uncertain numbers as ranges or "not yet known", and charts as plain bars (never radar or gauges)?'),
    yes('PREFS_LINK_DELIVERABLES', 'Reporting: always link the finished deliverable (URL or file path)?'),
    yes('PREFS_DAILY_CHECK', 'Reporting: a daily nothing-forgotten check (uncollected answers, long waits, rules that never ran)?'),
    {
      key: 'PREFS_STALE_DAYS',
      type: 'text',
      message: 'Reporting: flag anything waiting on you for more than how many days',
      default: '2',
      when: (ctx) => ctx.get('PREFS_DAILY_CHECK'),
    },
    yes('PREFS_AWAY_MODE', 'Reporting: away mode, holding decisions while you are away and briefing you on return?'),

    // Decisions
    {
      key: 'PREFS_DECISIONS',
      type: 'choice',
      message: 'Decisions: how they are put to you',
      default: 'cards',
      choices: [
        { value: 'cards', label: 'cards - one at a time on a Lavish decision-card page, with a preview for every option (needs lavish-axi)' },
        { value: 'tool', label: "tool - the agent's question tool, one at a time, a preview on every option" },
        { value: 'chat', label: 'chat - in plain chat, one at a time, recommendation first' },
      ],
    },
    yes('PREFS_YES_NO_IN_CHAT', 'Decisions: ask simple yes-or-no questions in plain chat?', { when: (ctx) => ctx.get('PREFS_DECISIONS') !== 'chat' }),
    yes('PREFS_PREVIEW_BEFORE_BUILD', 'Decisions: show look-and-feel changes on a review page before they are built?'),
    yes('PREFS_CHECK_ANSWERS_FIRST', 'Decisions: check whether you already answered before calling a question open?'),
    yes('PREFS_ASK_BEFORE_CLOSING', 'Decisions: ask before closing finished agents, sessions and tabs?'),
    {
      key: 'PREFS_AUTONOMY',
      type: 'choice',
      message: 'Decisions: everyday judgment calls within a direction you already set',
      default: 'act',
      choices: [
        { value: 'act', label: 'act - the agent decides and reports the outcome; it still asks about credentials, anything destructive, and choices only you can make' },
        { value: 'ask', label: 'ask - the agent asks before each one' },
      ],
    },
    {
      key: 'PREFS_DECISIONS_LOG',
      type: 'text',
      path: true,
      message: 'Decisions: a file where the agent keeps your decisions, what you ruled out, and what waits for later (empty for none)',
      default: '',
    },
    yes('PREFS_GRILL_ON_GAPS', 'Decisions: question you hard about a plan only when it has a real gap, never as the default way to ask?'),

    // Review pages
    yes('PREFS_PAGE_SIDE_BY_SIDE', 'Review pages: decision card on one side and a canvas of the current decision on the other, never stacked?', { when: cardsOn }),
    yes('PREFS_PAGE_FLIP_PREVIEWS', "Review pages: let you flip between every option's preview, not only the recommended one?", { when: cardsOn }),
    yes('PREFS_PAGE_MINIMAL_TEXT', 'Review pages: minimal text, no fluff or helper text, visuals carry the meaning?'),
    yes('PREFS_PAGE_WIDE_HEADER', 'Review pages: a large title and intro spread across the full page width?'),
    yes('PREFS_PAGE_CHECK_BEFORE_SEND', 'Review pages: check the page by screenshot before its link is sent, and always send the link?'),
    yes('PREFS_PAGE_FIRST', 'Review pages: when a decision waits on a page, build and check the page first, send the link, then stand by until you answer?'),

    // Working with a fleet
    yes('PREFS_FLEET_WORKFLOW', 'Workflow: dispatch, supervise and land work the way a supervising agent should (briefs, status lines, pull requests, what gets a review page)?'),

    // Ideas and priorities
    yes('PREFS_CAPTURE_IDEAS', 'Ideas: capture every idea you share, fold it in or park it, and say in one line where it landed?'),
    yes('PREFS_RESEQUENCE', 'Ideas: let the agent reorder queued work by what blocks what, then tell you the new order?'),
    yes('PREFS_ORIENT', 'Ideas: when you seem lost, a two-line "where we are": the current phase, the next deliverable, where to find it?'),
    yes('PREFS_FINISH_FIRST', 'Ideas: once something works, stop instead of proposing the next improvement, and raise a risk once, not repeatedly?'),

    // AI and model use
    {
      key: 'PREFS_MODEL_ROUTING',
      type: 'choice',
      message: 'Models: effort and model routing',
      default: 'economical',
      choices: [
        { value: 'economical', label: 'economical - low effort by default, more for planning, design and hard reasoning, the strongest model for building' },
        { value: 'balanced', label: 'balanced - medium effort by default, high for planning, design, hard reasoning and building' },
        { value: 'none', label: 'none - no rule' },
      ],
    },
    yes('PREFS_QUOTA', 'Models: check subscription limits before heavy work and take the cheapest path?'),
    {
      key: 'PREFS_DELEGATE_RETRIEVAL',
      type: 'text',
      message: 'Models: a secondary agent CLI to hand bulk reading and fetching to, such as agy (empty for none)',
      default: (ctx) => ((ctx.values.AGENT_CLIS || []).includes('agy') ? 'agy' : ''),
    },

    // Research
    {
      key: 'PREFS_RESEARCH_BROWSER',
      type: 'choice',
      message: 'Research: where agents browse the web',
      default: 'separate',
      choices: [
        { value: 'separate', label: "separate - a visible browser of the agent's own, never your browser (agent-clis offers a launcher)" },
        { value: 'none', label: 'none - no rule' },
      ],
    },
    yes('PREFS_SOURCE_QUALITY', 'Research: name each source\'s type and skip low-quality sources?'),
    yes('PREFS_VERIFY_USER_CLAIMS', 'Research: check tools and facts you mention before relying on them, and compare options before large installs?'),
    yes('PREFS_FINDINGS_TO_CHANGE', 'Research: findings must end in a visible change or a decision, not just a report?'),

    // Safety
    {
      key: 'PREFS_MERGE',
      type: 'choice',
      message: 'Safety: who merges pull requests',
      default: 'explicit',
      choices: [
        { value: 'explicit', label: 'explicit - only when you say to merge that pull request' },
        { value: 'green', label: 'green - the agent may merge its own pull requests once every check passes' },
      ],
    },
    yes('PREFS_VERIFY_CAUSE', 'Safety: never guess the cause of a failure; say "cause unknown" unless it was checked?'),
    {
      key: 'PREFS_PAUSE_WORD',
      type: 'text',
      message: 'Safety: a word that pauses every running agent until you say resume (empty for none)',
      default: 'pause',
    },
    yes('PREFS_STOP_DIGGING', 'Safety: confirm a problem is real before hunting its cause, and stop after a couple of checks that find nothing?'),
  ],

  async install(ctx) {
    const targets = ctx.get('PREFS_TARGETS');
    if (!targets.length) throw new Skip('no targets selected');

    const cards = cardsOn(ctx) ? cardsPath(ctx) : null;
    if (cards) {
      await ctx.step('decision-card template', () => ctx.writeFile(cards, ctx.template('preferences/decision-cards.html'), { onConflict: 'ask' }));
    }

    const log = ctx.get('PREFS_DECISIONS_LOG');
    const text = renderPreferences((key) => ctx.get(key), { cardsPath: cards, decisionsPath: log ? ctx.path(log) : null });
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
