// The sign-ins, all in one place at the end of a run at a terminal (the last stop before
// "all set"). Modules record them with ctx.signIn during the install; nothing stops halfway.
// Claude comes first. A sign-in the person does not need on day one (GitHub, Context7) goes
// on the "Later" list unless they asked for it under customise; a re-run offers it again.

import { c } from './context.mjs';

export const KEYS_HEAD = ['  These need a key. Paste it, or press Enter to add it later.', '  Nothing shows while you paste.', ''];

/**
 * The keys, on the same last screen below the sign-ins. A pasted key is used at once; one left
 * empty runs the part's `none` and goes on the to-do list. Failures land in the part's record.
 */
export async function runKeys(ctx, { first = true } = {}) {
  if (!ctx.keys.length) return;
  console.log(`\n${first ? '  Almost done.\n' : ''}${KEYS_HEAD.join('\n')}`);
  const prev = ctx.record;
  for (const k of ctx.keys) {
    const v = (await ctx.prompter.secret(`    ${k.label}: `, { plain: true })).trim();
    ctx.record = k.rec;
    if (v) await ctx.step(`${k.name} key`, () => k.apply(v));
    else {
      if (k.none) await ctx.step(k.name, () => k.none());
      if (k.todo) k.rec?.todos.push(k.todo);
    }
  }
  ctx.record = prev;
}

const BROWSER = '  Your browser opens. Sign in there, then come back here.';

/** The words for one sign-in. `only`: Claude's sign-in is the one stop at the end. */
export function signInLines(s, { only = false } = {}) {
  if (s.name === 'Claude') {
    return [
      `  ${only ? 'Almost done. Last step: sign in to Claude.' : 'Almost done. First, sign in to Claude.'}`,
      '',
      BROWSER,
      '  No account yet? You can make one on the same page.',
      '',
    ];
  }
  return [`  Sign in to ${s.later || s.name}.`, '', BROWSER, ''];
}

export const ENTER_CLAUDE = '  Press Enter to open your browser. ';
export const ENTER_OTHER = '  Press Enter to open your browser, or type s to skip. ';

/** The "Later" list for the last screen: sign-ins left for when the person wants them. */
export function laterLines(signIns) {
  const later = signIns.filter((s) => !s.wanted);
  if (!later.length) return [];
  return [
    'Later, when you want them:',
    ...later.map((s) => `  • ${s.later || s.name}`),
    'Run the setup again any time to sign in to these. It asks nothing else.',
  ];
}

/** Show each wanted sign-in, Claude first, and run it after Enter. Returns the ones that did not finish. */
export async function runSignIns(ctx) {
  const wanted = ctx.signIns.filter((s) => s.wanted).sort((a, b) => (b.name === 'Claude') - (a.name === 'Claude'));
  const missed = [];
  for (const s of wanted) {
    console.log(`\n${signInLines(s, { only: wanted.length === 1 }).join('\n')}`);
    const claude = s.name === 'Claude';
    const a = (await ctx.prompter.question(claude ? ENTER_CLAUDE : ENTER_OTHER)).toLowerCase();
    if (!claude && a.startsWith('s')) {
      s.wanted = false; // back on the "Later" list
      continue;
    }
    try {
      ctx.run(s.cmd);
    } catch (err) {
      console.log(`  ${c.yellow('!')} ${s.name}: the sign-in did not finish (${err.message})`);
      s.rec?.todos.push(s.todo);
      missed.push(s);
    }
  }
  return missed;
}
