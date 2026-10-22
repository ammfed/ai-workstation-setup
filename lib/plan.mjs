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

/** The first screen's lines (without the Enter line, which only a terminal shows). */
export function planLines(modules, source = 'recommended', ctx = null) {
  const heading = {
    recommended: 'Hi! This sets up an AI assistant on your computer.',
    named: 'Hi! This sets up an AI assistant on your computer.',
    saved: 'Welcome back! Your earlier choices are kept.',
    changed: 'Your picks:',
  }[source];
  const lines = [`  ${heading}`, ''];
  if (source !== 'changed') lines.push('  You get:');
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

/** Enter (or "y") goes ahead with the plan; "c" chooses. Returns 'go' or 'change'. */
export async function confirmPlan(prompter) {
  for (;;) {
    const a = (await prompter.question(`  ${START_LINE} `)).trim().toLowerCase();
    if (['', 'y', 'yes'].includes(a)) return 'go';
    if (['c', 'change', 'choose'].includes(a)) return 'change';
    process.stdout.write(`  ${START_LINE}\n`);
  }
}

export function unsupportedReason(m, os) {
  if (m.platforms.includes(os)) return null;
  return m.unsupported[os] || `supports ${m.platforms.join(', ')} only`;
}

// The picks start from the command line, then a saved answer, then the recommended set (the
// modules marked default). The plan is shown first; at a terminal, Enter goes ahead with it and
// every question takes its recommended answer, while "c" opens the module picker and questions.
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
    ctx.acceptPlan = (await confirmPlan(ctx.prompter)) === 'go';
    if (!ctx.acceptPlan && !named) {
      const ticked = choice.picked.filter((m) => !unsupportedReason(m, os)).map((m) => m.name);
      names = await ctx.prompter.multi(
        'Which modules should be set up?',
        supported.map((m) => ({ value: m.name, label: `${m.name.padEnd(13)} ${m.description}` })),
        ticked,
      );
      choice = pick(names);
      show(choice, 'changed');
    }
  }
  ctx.values.MODULES = choice.picked.map((m) => m.name);
  return choice.picked;
}
