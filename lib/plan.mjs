// The first screen: what a first run sets up, in a few plain lines a friend can read, and the one
// confirm. At a terminal, Enter goes ahead with it (every question takes its recommended answer)
// and "c" opens the usual pickers and questions to choose for yourself.

import { c } from './context.mjs';

// Each module names its group and a short plain phrase (`group`, `summary` in module.mjs).
export const GROUPS = {
  assistant: 'Your AI assistant',
  tools: 'Tools it works with',
  agents: 'Running several agents',
  notes: 'Your notes and tasks',
};

// What you get, one line per part of the recommended set, in the first screen's words. A module
// not named here shows its own summary. `o` says what the run would set up for the extras.
const YOU_GET = [
  { modules: ['claude-code'], line: (o) => `Claude, an AI assistant you talk to in plain words${o.desktop ? ', with its app' : ''}` },
  { modules: ['core', 'agent-clis', 'mcp-servers'], line: () => 'The tools it needs to do real work for you' },
  { modules: ['skills'], line: () => 'Skills that help it plan with you and check its own work' },
  { modules: ['preferences'], line: () => 'Good habits: plain words, and it checks with you before big steps' },
  { modules: ['second-brain'], line: (o) => `A notes folder it can read and keep tidy${o.obsidian ? ', with the Obsidian app' : ''}` },
  { modules: ['firstmate'], line: () => 'A helper that runs several AI workers for you' },
];

const questionsOf = (m, ctx) => (typeof m.questions === 'function' ? m.questions(ctx) : m.questions) || [];

// What a yes-or-no question would come to before it is asked: the saved answer, else its default.
function wouldBe(ctx, modules, key) {
  for (const m of modules) {
    const q = questionsOf(m, ctx).find((x) => x.key === key);
    if (!q) continue;
    if (q.when && !q.when(ctx)) return false;
    const v = ctx.answers.get(key) ?? (typeof q.default === 'function' ? q.default(ctx) : q.default);
    return /^(y|yes|true|1)$/i.test(String(v));
  }
  return false;
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The "You get" lines for the picked modules, the recommended parts first, then any others. */
export function youGetLines(modules, ctx) {
  const o = {
    desktop: ctx?.platform.os === 'windows' && wouldBe(ctx, modules, 'CLAUDE_DESKTOP'),
    obsidian: Boolean(ctx) && wouldBe(ctx, modules, 'VAULT_APP'),
  };
  const names = new Set(modules.map((m) => m.name));
  const lines = YOU_GET.filter((p) => p.modules.some((n) => names.has(n))).map((p) => p.line(o));
  const covered = new Set(YOU_GET.flatMap((p) => p.modules));
  for (const m of modules) if (!covered.has(m.name)) lines.push(capital(m.summary));
  return lines;
}

/**
 * How many settings a run would settle with their recommended answer because no saved answer
 * covers them: each question in turn takes its saved answer or its default, so a follow-up counts
 * only when the answer it follows would bring it up. Keys are not settings; they wait for the end.
 */
export function newSettings(ctx, modules) {
  const kept = ctx.values;
  ctx.values = {};
  let count = 0;
  try {
    for (const m of modules) {
      for (const q of questionsOf(m, ctx)) {
        if (q.type === 'secret' || (q.when && !q.when(ctx))) continue;
        let v = ctx.answers.get(q.key);
        if (v === undefined) {
          count += 1;
          v = typeof q.default === 'function' ? q.default(ctx) : q.default;
        }
        if (q.type === 'confirm') v = typeof v === 'boolean' ? v : /^(y|yes|true|1)$/i.test(String(v));
        else if (q.type === 'multi') v = Array.isArray(v) ? v : String(v ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== 'none');
        ctx.values[q.key] = v;
      }
    }
  } finally {
    ctx.values = kept;
  }
  return count;
}

const newLine = (n) => (n === 1 ? '1 new setting takes its recommended answer.' : `${n} new settings take their recommended answers.`);

/**
 * The first screen's lines (without the Enter line, which only a terminal shows). Running it
 * again with saved choices, a terminal shows only the welcome back and the count of new settings.
 */
export function planLines(modules, source = 'recommended', ctx = null) {
  if (source === 'saved' && ctx) {
    const n = newSettings(ctx, modules);
    const lines = ['  Welcome back! Your earlier choices are kept.'];
    if (n) lines.push(`  ${newLine(n)}`);
    if (ctx.interactive) return lines;
    lines.push('', '  You get:', ...youGetLines(modules, ctx).map((line) => `    ✓ ${line}`));
    return lines;
  }
  const heading = {
    recommended: 'Hi! This sets up an AI assistant on your computer.',
    named: 'Hi! This sets up an AI assistant on your computer.',
    saved: 'Welcome back! Your earlier choices are kept.',
  }[source];
  const lines = [`  ${heading}`, ''];
  lines.push('  You get:');
  const got = youGetLines(modules, ctx);
  for (const line of got) lines.push(`    ✓ ${line}`);
  if (!got.length) lines.push('    nothing');
  lines.push('');
  if (ctx?.platform.os === 'windows') {
    lines.push('  Windows may ask you to allow changes. Click Yes.', '  You sign in at the end. After that you can leave it running.');
  } else {
    lines.push('  Your computer asks for your password once. You sign in at the end.', '  After that you can leave it running.');
  }
  return lines;
}

export const START_LINE = 'Press Enter to start, or type c to choose for yourself.';
export const UPDATE_LINE = 'Press Enter to update, or type c to change your choices.';

/** Enter (or "y") goes ahead with the plan; "c" chooses. Returns 'go' or 'change'. */
export async function confirmPlan(prompter, line = START_LINE) {
  for (;;) {
    const a = (await prompter.question(`  ${line} `)).trim().toLowerCase();
    if (['', 'y', 'yes'].includes(a)) return 'go';
    if (['c', 'change', 'choose'].includes(a)) return 'change';
    process.stdout.write(`  ${line}\n`);
  }
}

// The customise picker: the plan's parts in a friend's words, the recommended ones first. A
// module no part names (Linux inside Windows, a new one) shows its own summary.
const PARTS = [
  { value: 'claude', label: 'Claude and its settings', modules: ['claude-code'] },
  { value: 'tools', label: 'The tools it works with', modules: ['core', 'agent-clis', 'mcp-servers'] },
  { value: 'skills', label: 'Skills', modules: ['skills'] },
  { value: 'habits', label: 'Good habits', modules: ['preferences'] },
  { value: 'notes', label: 'A notes folder', modules: ['second-brain'] },
  { value: 'helper', label: 'The helper for several workers', modules: ['firstmate'] },
  { value: 'voice', label: 'Talk to it by voice', modules: ['voice-mode'] },
  { value: 'clickup', label: 'ClickUp tasks', modules: ['clickup'] },
  { value: 'daily', label: 'A daily check of your work', modules: ['daily-sync'] },
  { value: 'ledger', label: 'A running record with a live page', modules: ['ledger'] },
  { value: 'news', label: 'A news digest every few hours', modules: ['news-digest'] },
  { value: 'terminal', label: 'The WezTerm terminal', modules: ['terminal'] },
  { value: 'extras', label: 'Extra desktop tools', modules: ['extras'] },
  { value: 'backpass', label: 'Learning from past sessions', modules: ['backpass'] },
  { value: 'openrouter', label: 'One OpenRouter key for the tools that use it', modules: ['openrouter'] },
  // The connections themselves: none is recommended, so ticking this asks which ones.
  { value: 'connections', label: 'Outside connections for Claude', modules: ['mcp-servers'], ask: ['MCP_SERVERS'], only: true },
];

export const PICKER_LINE = 'Choose what to set up. Space ticks or unticks. Enter goes on.';
export const KEEP_LINES = ['Keep the recommended settings for what you picked?', 'Press Enter to keep them, or type d to go through each one.'];

/** The picker's parts for this system, each with the modules it brings and when it starts ticked. */
export function pickerParts(supported, os) {
  const names = new Set(supported.map((m) => m.name));
  const parts = [];
  for (const p of PARTS) {
    const modules = p.modules.filter((n) => names.has(n));
    if (!modules.length) continue;
    // A part is ticked when its first module is picked; the connections part also needs a saved pick.
    const ticked = p.only
      ? (has, ctx) => has.has(modules[0]) && String(ctx.answers.get('MCP_SERVERS') ?? '').split(',').some((x) => x.trim() && x.trim() !== 'none')
      : (has) => has.has(modules[0]);
    parts.push({ ...p, modules, ticked, recommended: !p.only && supported.some((m) => m.default && modules.includes(m.name)) });
  }
  const covered = new Set(PARTS.flatMap((p) => p.modules));
  for (const m of supported) {
    if (!covered.has(m.name)) parts.push({ value: m.name, label: capital(m.summary), modules: [m.name], ticked: (has) => has.has(m.name), recommended: Boolean(m.default) });
  }
  // Recommended first, then the rest, each with its heading on the first of them.
  const sorted = [...parts.filter((p) => p.recommended), ...parts.filter((p) => !p.recommended)];
  sorted.forEach((p, i) => {
    if (i === 0 || p.recommended !== sorted[i - 1].recommended) p.heading = p.recommended ? 'Recommended' : 'More you can add';
  });
  return sorted;
}

/** The second gate under customise: Enter keeps the recommended settings, "d" asks each one. */
export async function confirmKeep(prompter) {
  console.log(`  ${KEEP_LINES[0]}`);
  for (;;) {
    const a = (await prompter.question(`  ${KEEP_LINES[1]} `)).trim().toLowerCase();
    if (['', 'y', 'yes', 'k', 'keep'].includes(a)) return 'keep';
    if (['d', 'details', 'detail'].includes(a)) return 'each';
  }
}

export function unsupportedReason(m, os) {
  if (m.platforms.includes(os)) return null;
  return m.unsupported[os] || `supports ${m.platforms.join(', ')} only`;
}

// The picks start from the command line, then a saved answer, then the recommended set (the
// modules marked default). The plan is shown first; at a terminal, Enter goes ahead with it and
// every question takes its recommended answer, while "c" opens the picker of parts and then the
// second gate: Enter keeps the recommended settings for what was picked, "d" asks each question.
export async function selectModules(ctx, modules, { named = false } = {}) {
  const { os } = ctx.platform;
  const byName = Object.fromEntries(modules.map((m) => [m.name, m]));
  const supported = modules.filter((m) => !unsupportedReason(m, os));
  const defaults = supported.filter((m) => m.default).map((m) => m.name);

  const pick = (names) => {
    const unknown = names.filter((n) => !byName[n]);
    if (unknown.length) throw new Error(`unknown module(s): ${unknown.join(', ')} (see --list)`);
    const wanted = new Set(names);
    const added = [];
    const addRequired = (name) => {
      for (const dep of byName[name].requires) {
        if (wanted.has(dep)) continue;
        wanted.add(dep);
        added.push(`  ${c.dim('•')} adding ${dep} (required by ${name})`);
        addRequired(dep);
      }
    };
    for (const n of [...wanted]) addRequired(n);
    return { picked: modules.filter((m) => wanted.has(m.name)), added };
  };
  const show = ({ picked, added }, source) => {
    console.log(`\n${planLines(picked.filter((m) => !unsupportedReason(m, os)), source, ctx).join('\n')}`);
    for (const line of added) console.log(line);
  };

  const saved = ctx.answers.get('MODULES');
  const source = saved === undefined || saved === 'default' ? 'recommended' : named ? 'named' : 'saved';
  let names = saved;
  if (names === undefined || names === 'default') names = defaults;
  else if (names === 'all') names = supported.map((m) => m.name);
  else names = names.split(',').map((s) => s.trim()).filter(Boolean);
  let choice = pick(names);
  show(choice, source);

  // The parts this system cannot run: for an assistant reading the output, not the first screen.
  const unsupported = ctx.interactive ? [] : modules.filter((m) => unsupportedReason(m, os));
  if (unsupported.length) {
    console.log(`\nNot available on ${os}:`);
    for (const m of unsupported) console.log(`  ${c.yellow('–')} ${m.name}: ${unsupportedReason(m, os)}`);
  }

  if (ctx.interactive) {
    console.log('');
    ctx.acceptPlan = (await confirmPlan(ctx.prompter, source === 'saved' ? UPDATE_LINE : START_LINE)) === 'go';
    if (!ctx.acceptPlan) {
      if (!named) {
        const parts = pickerParts(supported, os);
        const has = new Set(choice.picked.map((m) => m.name));
        const ticked = parts.filter((p) => p.ticked(has, ctx)).map((p) => p.value);
        const chosen = await ctx.prompter.multi(PICKER_LINE, parts, ticked, { friend: true });
        const fromParts = parts.filter((p) => chosen.includes(p.value));
        // Outside connections ticked: which ones is asked even when the recommended settings are kept.
        for (const p of fromParts) for (const key of p.ask || []) ctx.askAnyway.add(key);
        choice = pick([...new Set(fromParts.flatMap((p) => p.modules))]);
        for (const line of choice.added) console.log(line);
      }
      console.log('');
      ctx.acceptPlan = (await confirmKeep(ctx.prompter)) === 'keep';
    }
  }
  ctx.values.MODULES = choice.picked.map((m) => m.name);
  return choice.picked;
}
