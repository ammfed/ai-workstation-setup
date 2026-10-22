// Screen 5 at a terminal: "All set!", or "Nearly all set." naming what did not work, how to
// start, the "Later" list and where the setup notes are. Everything else the summary under
// --yes prints (the part table, failures, to-dos, the Windows side, each part's recap) goes to
// setup-notes.md instead, written so Claude can read it and finish the leftovers with the person.

import os from 'node:os';
import path from 'node:path';
import { laterLines } from './signin.mjs';

export const ALL_SET = '  All set! Claude is ready.';
export const AGAIN = '  Run the setup again later. It skips what is already done.';
export const WHAT_WENT_WRONG = '  What went wrong is in setup-notes.md.';
export const START_WINDOWS = '  To start, open Claude from the Start menu and pick the Code tab.';
export const START = '  To start, type  claude  and press Enter.';

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** "the basics" / "the basics and Claude" / "the basics, Claude and skills". */
function listOf(things) {
  if (things.length < 2) return things.join('');
  return `${things.slice(0, -1).join(', ')} and ${things.at(-1)}`;
}

/** How to reach the helper's folder from the home folder, as typed after `cd`. */
function cdTarget(dir, home) {
  const rel = path.relative(home, dir);
  const shown = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : dir;
  return /\s/.test(shown) ? `"${shown}"` : shown;
}

/**
 * The lines of screen 5. `failed`: what did not work, in the screen's words (group lines, or
 * "signing in to Claude"). `helperDir`: the helper's folder when it was set up. `notesFile`:
 * shown as a path for a dry run, whose notes are in a temporary folder.
 */
export function allSetLines({ os: system, failed = [], helperDir = null, home = os.homedir(), signIns = [], notesFile = null } = {}) {
  const lines = [];
  if (failed.length) {
    const n = failed.length === 1 ? '1 thing' : `${failed.length} things`;
    lines.push(`  Nearly all set. ${n} did not work: ${listOf(failed.map(lower))}.`, AGAIN, WHAT_WENT_WRONG);
  } else lines.push(ALL_SET);
  lines.push('');
  if (system === 'windows') lines.push(START_WINDOWS);
  else {
    lines.push(START);
    if (helperDir) lines.push(`  For several workers at once, type  cd ${cdTarget(helperDir, home)}  then  claude`);
  }
  const later = laterLines(signIns);
  if (later.length) lines.push('', ...later.map((l) => `  ${l}`));
  lines.push('', notesFile ? `  Your setup notes are in ${notesFile}` : '  Your setup notes are in setup-notes.md in your home folder.');
  return lines;
}

/**
 * The rest of the summary, for setup-notes.md: what did not work, what is left to do (worded
 * for Claude to pick up), the Windows side, the part table and each part's recap. Markdown.
 */
export function notesSummary({ results, missed = [], windowsSide = [], extraTodos = [] }) {
  const out = ['', '## How it went', ''];
  for (const r of results) out.push(`- ${r.m.name}: ${r.status}${r.status === 'unsupported' ? ` (${r.rec.skips[0]})` : ''}`);
  const failures = results.flatMap((r) => r.rec.failures.map((f) => `${r.m.name}: ${f}`));
  if (failures.length) out.push('', '## What did not work', '', 'Running the setup again skips what is already done and tries these again.', '', ...failures.map((f) => `- ${f}`));
  const todos = [...results.flatMap((r) => r.rec.todos.map((t) => `${r.m.name}: ${t}`)), ...extraTodos];
  if (todos.length) {
    out.push(
      '',
      '## Left to do',
      '',
      'The setup could not do these by itself. Open Claude and say: "Read setup-notes.md in my home folder and help me finish what is left, one step at a time."',
      '',
      ...todos.map((t) => `- [ ] ${t}`),
    );
  }
  if (windowsSide.length) {
    out.push('', '## On the Windows side', '', 'Running `.\\install.ps1 --modules wsl` from Windows sets these up (see docs/windows-wsl.md in the setup folder).', '');
    for (const r of windowsSide) out.push(`- ${r.m.name}: ${r.note}`);
  }
  if (missed.length) out.push('', '## Not set up on this system', '', ...missed.map((m) => `- ${m.name}: ${m.reason}`));
  for (const r of results.filter((x) => x.rec.report.length)) out.push('', `## ${r.m.title}`, '', ...r.rec.report.map((l) => `- ${l.trim()}`));
  out.push('');
  return out.join('\n');
}
