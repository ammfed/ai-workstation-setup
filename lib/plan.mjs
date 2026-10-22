// The short plan shown before anything is installed: what will be set up and what it gives
// you, one plain line per group. At a terminal, Enter goes ahead with it (every question takes
// its recommended answer) and "c" opens the usual pickers and questions to change the picks.

import { c } from './context.mjs';

// Each module names its group and a short plain phrase (`group`, `summary` in module.mjs).
export const GROUPS = {
  assistant: 'Your AI assistant',
  tools: 'Tools it works with',
  agents: 'Running several agents',
  notes: 'Your notes and tasks',
};

const joinPlain = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** The plan's lines, groups in GROUPS order, modules in install order within each group. */
export function planLines(modules, source = 'recommended') {
  const heading = {
    recommended: 'What will be set up (the recommended picks):',
    saved: 'What will be set up (your saved picks):',
    named: 'What will be set up (the modules you named):',
    changed: 'What will be set up (your picks):',
  }[source];
  const lines = [heading];
  for (const [key, title] of Object.entries(GROUPS)) {
    const phrases = modules.filter((m) => m.group === key).map((m) => m.summary);
    if (phrases.length) lines.push(`  ${title}: ${joinPlain(phrases)}`);
  }
  if (!modules.length) lines.push('  nothing');
  return lines;
}

/** Enter (or "y") goes ahead with the plan; "c" changes the picks. Returns 'go' or 'change'. */
export async function confirmPlan(prompter) {
  for (;;) {
    const a = (await prompter.question('? Press Enter to go ahead, or type c to change the picks: ')).toLowerCase();
    if (['', 'y', 'yes'].includes(a)) return 'go';
    if (['c', 'change'].includes(a)) return 'change';
    process.stdout.write('  Press Enter to go ahead, or type c to change the picks.\n');
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
    console.log(`\n${planLines(picked.filter((m) => !unsupportedReason(m, os)), source).join('\n')}`);
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

  const unsupported = modules.filter((m) => unsupportedReason(m, os));
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
