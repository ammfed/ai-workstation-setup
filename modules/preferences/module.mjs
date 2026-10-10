import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { claudeDir } from '../../lib/claude.mjs';
import { renderBriefInclude, renderPreferences } from './render.mjs';

// Writes how you want your agents to work (status format, tone, decisions, review
// pages, building, ideas, away mode, merges, research, quota) as a plain rules file your agents load.
// Every rule is a generic default you answer for; nothing here is anyone's record.
// docs/working-preferences.md describes each question and the rule it writes.

const yes = (key, message, extra = {}) => ({ key, type: 'confirm', message, default: true, ...extra });

const cardsOn = (ctx) => ['cards', 'both'].includes(ctx.get('PREFS_DECISIONS'));

// PREFS_GRILL replaced the yes-or-no PREFS_GRILL_ON_GAPS; an earlier answer to that carries over.
function grillDefault(ctx) {
  const old = ctx.answers.get('PREFS_GRILL_ON_GAPS');
  if (old === undefined) return 'every';
  return /^(y|yes|true|1)$/i.test(String(old)) ? 'gaps' : 'off';
}

// Every question after the first two takes its recommended answer (its default, or a saved
// answer) unless the person chose to go through them one by one.
const GATE = ['PREFS_TARGETS', 'PREFS_REVIEW_EACH'];
function withRecommended(questions) {
  return questions.map((q) => (GATE.includes(q.key) ? q : { ...q, useDefault: (ctx) => !ctx.get('PREFS_REVIEW_EACH') }));
}

function cardsPath(ctx) {
  return path.join(ctx.home, '.config', 'ai-workstation-setup', 'decision-cards.html');
}

const TARGETS = {
  claude: {
    label: 'claude - a Claude Code user rules file (~/.claude/rules/working-preferences.md), loaded in every session',
    file: (ctx) => path.join(claudeDir(ctx), 'rules', 'working-preferences.md'),
  },
  firstmate: {
    label: "firstmate - seed firstmate's local preferences file (data/captain.md in your Firstmate home)",
    file: (ctx) => ctx.path(ctx.get('FIRSTMATE_HOME') || ctx.get('FIRSTMATE_DIR') || '~/firstmate', 'data/captain.md'),
    unsupported: { windows: 'firstmate runs in WSL; .\\install.ps1 --modules wsl sets it up there with this target' },
  },
};

export default {
  name: 'preferences',
  title: 'Working preferences',
  description: 'How your agents work: language and tone, reporting, decisions, review pages, building, ideas, model use, research, safety',
  // After firstmate, so its clone directory is known and exists.
  order: 65,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  default: true,
  questions: withRecommended([
    {
      key: 'PREFS_TARGETS',
      type: 'multi',
      message: 'Where to write your working preferences',
      default: (ctx) => ['claude', ...((ctx.values.MODULES || []).includes('firstmate') ? ['firstmate'] : [])],
      choices: Object.entries(TARGETS).map(([value, t]) => ({ value, label: t.label })),
    },
    {
      key: 'PREFS_REVIEW_EACH',
      type: 'confirm',
      message: 'Go through each working preference now (about 60 short questions)? No writes the recommended set, which you can edit any time',
      default: false,
    },

    // Language and tone
    yes('PREFS_PLAIN_LANGUAGE', 'Tone: plain, natural, friendly language with no jargon?'),
    yes('PREFS_NO_NARRATION', 'Tone: give the result, not a commentary on the agent\'s own steps?'),
    yes('PREFS_NO_EM_DASHES', 'Tone: avoid em dashes in everything written for you?'),
    yes('PREFS_OUTWARD_AS_USER', 'Tone: write content for other people as you, with no agent or tooling labels?'),
    yes('PREFS_NATURAL_TRANSLATION', 'Tone: write other languages the way native speakers do, never as a literal translation?'),
    yes('PREFS_WRITING_PRINCIPLES', 'Tone: writing for other people leads with the point, backs claims with evidence, and agrees the point before building a deck or document?'),
    {
      key: 'PREFS_WRITING_STYLE',
      type: 'choice',
      message: 'Tone: a house style for what agents write to you',
      default: 'plain',
      choices: [
        { value: 'plain', label: 'plain - no extra style rule beyond the tone answers here' },
        {
          value: 'ste',
          label:
            'ste - plain English based on Simplified Technical English (ASD-STE100): one instruction per sentence, active voice, short sentences, one word for one thing; ' +
            'not for documents written as you for other people',
        },
      ],
    },
    yes('PREFS_ONE_DESIGN_SYSTEM', 'Tone: if you use several design systems, pick the one matching the artifact type and never mix them?', { default: false }),
    yes('PREFS_COPY_SECOND_OPINION', 'Tone: get a second AI model to refine copywriting and translations (only the text being polished is sent)?', { default: false }),
    yes('PREFS_HABITS', 'Habits: replies end in actions, stay on your current topic, and treat claims as unproven until shown?'),
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
        { value: 'actions', label: 'actions - a very short list of action items, then where the full report is' },
        { value: 'board', label: 'board - one table with TODO, DOING and DONE as three side-by-side columns, then what is left grouped by who acts, your block labelled YOU' },
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
      default: 'both',
      choices: [
        { value: 'both', label: "both - quick questions through the agent's question tool with a preview on every option; larger or visual decisions on a Lavish decision-card page" },
        { value: 'cards', label: 'cards - one at a time on a Lavish decision-card page, with a preview for every option (needs lavish-axi)' },
        { value: 'tool', label: "tool - the agent's question tool, one at a time, a preview on every option" },
        { value: 'chat', label: 'chat - in plain chat, one at a time, recommendation first' },
      ],
    },
    yes('PREFS_YES_NO_IN_CHAT', 'Decisions: ask simple yes-or-no questions in plain chat?', { when: (ctx) => ctx.get('PREFS_DECISIONS') !== 'chat' }),
    yes('PREFS_PREVIEW_BEFORE_BUILD', 'Decisions: show look-and-feel changes on a review page before they are built?'),
    yes('PREFS_CHECK_ANSWERS_FIRST', 'Decisions: check whether you already answered before calling a question open?'),
    yes('PREFS_ASK_BEFORE_CLOSING', 'Decisions: ask before closing finished agents, sessions and review pages?'),
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
    {
      key: 'PREFS_GRILL',
      type: 'choice',
      message: 'Decisions: when questions to you run the grilling method',
      default: grillDefault,
      choices: [
        { value: 'every', label: 'every - every round of questions, kept balanced: no questions when the intent and the request are clear enough' },
        { value: 'gaps', label: 'gaps - only when a plan has a real gap, never as the default way to ask' },
        { value: 'off', label: 'off - no rule' },
      ],
    },

    // Review pages
    yes('PREFS_PAGES_ALL_CARDS', 'Review pages: use the card template for every page, not only decisions?', { when: cardsOn }),
    yes('PREFS_PAGE_SIDE_BY_SIDE', 'Review pages: decision card on one side and a canvas of the current decision on the other, never stacked?', { when: cardsOn }),
    yes('PREFS_PAGE_FLIP_PREVIEWS', "Review pages: let you flip between every option's preview, not only the recommended one?", { when: cardsOn }),
    yes('PREFS_PAGE_MINIMAL_TEXT', 'Review pages: minimal text, no fluff or helper text, visuals carry the meaning?'),
    yes('PREFS_PAGE_WIDE_HEADER', 'Review pages: a large title and intro spread across the full page width?'),
    yes('PREFS_PAGE_CHECK_BEFORE_SEND', 'Review pages: check the page by screenshot before its link is sent, and always send the link?'),
    yes('PREFS_PAGE_FIRST', 'Review pages: when a decision waits on a page, build and check the page first, send the link, then stand by until you answer?'),
    yes('PREFS_PAGES_TOGETHER', 'Review pages: hold page links until all open work is done, then send the checked set together?'),

    // Working with a fleet
    yes('PREFS_FLEET_WORKFLOW', 'Workflow: dispatch, supervise and land work the way a supervising agent should (briefs, status lines, pull requests, what gets a review page)?'),

    // Building
    yes('PREFS_BUILD_WHOLE_GOAL', 'Building: show research and user journeys first, then give one builder the whole goal?'),
    yes('PREFS_ROUTE', 'Building: take software projects through six steps (plan, decide, prototype, breakdown, build, ship), each with its skill (docs/route.md)?', { default: false }),
    yes('PREFS_TEST_FIRST', 'Building: build product code test-first at the seams the spec names (not prototypes, docs or config)?', { default: false }),
    yes('PREFS_GLOSSARY_ADR', 'Building: read GLOSSARY.md and docs/adr before building, and add new terms and decision records with the change?', { default: false }),
    yes('PREFS_PROTOTYPE_CHECK', 'Building: check every prototype at laptop and phone width and fix broken layout, unclear labels and dead ends before you see it?', { default: false }),
    yes('PREFS_MODEL_GUIDE', 'Models: when a model is named for a task, read its vendor\'s prompting guide first?'),

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
      default: 'capable',
      choices: [
        { value: 'capable', label: 'capable - the most capable model at medium effort, extra-high effort for frontend design, investigations and plans, a faster model for small tasks' },
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
    {
      key: 'PREFS_DELEGATE_MODEL',
      type: 'text',
      message: 'Models: the model that CLI uses for this work (empty: its own default)',
      default: (ctx) => (String(ctx.get('PREFS_DELEGATE_RETRIEVAL')).trim() === 'agy' ? 'gemini-3.8-flash-high' : ''),
      when: (ctx) => Boolean(String(ctx.get('PREFS_DELEGATE_RETRIEVAL') || '').trim()),
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
    yes('PREFS_BLOCKED_COMMANDS', 'Safety: when a permission check blocks an install, schedule, service or push, never work around it; give you the exact command to run?'),
    yes('PREFS_PRIVATE_STAYS_LOCAL', 'Safety: private chats and anything captured from your own sessions never go to an outside model?'),
    yes('PREFS_PUBLIC_REPOS', 'Safety: in public repositories, a no-reply commit identity, no email trailers, pull request text naming nothing private, and a privacy scan before each push?'),
  ]),

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
    // Firstmate's config/brief-include.md (its docs/configuration.md "Home brief include") is
    // appended to every worker brief, so workers write to firstmate in the same house style.
    const brief = renderBriefInclude((key) => ctx.get(key));
    if (brief && targets.includes('firstmate') && !ctx.forOs(TARGETS.firstmate.unsupported)) {
      const home = ctx.path(ctx.get('FIRSTMATE_HOME') || ctx.get('FIRSTMATE_DIR') || '~/firstmate');
      await ctx.step('firstmate worker briefs', () => ctx.writeFile(path.join(home, 'config', 'brief-include.md'), brief, { onConflict: 'ask' }));
    }
    ctx.info('edit the written file any time; re-running asks before replacing your edits (and keeps a backup)');
  },
};
