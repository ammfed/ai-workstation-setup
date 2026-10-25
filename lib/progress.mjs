// Screen 3 at a terminal: one line of progress per group, with a word for its state, while the
// step-by-step detail goes to setup-notes.md (see openNotes). Under --yes nothing here is used:
// the detail prints as it happens, for an assistant reading the output.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The groups a friend sees, in the screen's words. A module not named here shows its own summary.
const GROUPS = [
  { modules: ['core'], line: 'The basics' },
  { modules: ['claude-code'], line: 'Claude' },
  { modules: ['agent-clis', 'mcp-servers'], line: 'The tools it works with' },
  { modules: ['skills'], line: 'Skills' },
  { modules: ['preferences'], line: 'Good habits' },
  { modules: ['second-brain'], line: 'Your notes folder' },
  { modules: ['firstmate'], line: 'The helper for several workers' },
];

export const PROGRESS_HEAD = '  Setting things up. You can leave this running.';
export const NOTES_FILE = 'setup-notes.md';
const TOP = '# Setup notes';

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The groups for these modules, in the order they run; neighbours in one group share a line. */
export function progressGroups(modules) {
  const groups = [];
  for (const m of modules) {
    const g = GROUPS.find((x) => x.modules.includes(m.name));
    const line = g ? g.line : capital(m.summary);
    const last = groups.at(-1);
    if (last && g && last.line === line) last.modules.push(m.name);
    else groups.push({ line, modules: [m.name], state: '' });
  }
  return groups;
}

/**
 * The live screen. At a terminal it redraws its lines in place; when something else printed
 * below it (interrupt), it draws itself again underneath. Without a terminal it prints each
 * change as a line of its own.
 */
export class Progress {
  constructor(groups, { out = process.stdout } = {}) {
    this.groups = groups;
    this.out = out;
    this.tty = Boolean(out.isTTY);
    this.drawn = 0; // lines of the last drawing, still on screen right above the cursor
  }

  lines() {
    const width = this.groups.some((g) => g.state === 'did not work') ? 14 : 7;
    const now = this.groups.findIndex((g) => g.state === 'now');
    const count = now >= 0 ? now + 1 : this.groups.filter((g) => g.state).length;
    return [
      ...this.groups.map((g) => `    ${g.state.padEnd(width)}${g.line}`.trimEnd()),
      '',
      `  ${count} of ${this.groups.length}`,
    ];
  }

  draw() {
    const lines = this.lines();
    if (this.drawn) this.out.write(`\x1b[${this.drawn}F\x1b[J`);
    this.out.write(`${lines.join('\n')}\n`);
    this.drawn = lines.length;
  }

  /** The head line; the groups draw with the first set(). */
  start() {
    this.out.write(`\n${PROGRESS_HEAD}\n\n`);
  }

  /** Set the state of the group that holds this module: 'now', 'done' or 'did not work'. */
  set(name, state) {
    const g = this.groups.find((x) => x.modules.includes(name));
    if (!g || g.state === 'did not work') return;
    if (state === 'done' && g.modules.at(-1) !== name) state = 'now'; // the group goes on
    if (g.state === state) return;
    g.state = state;
    if (this.tty) this.draw();
    else if (state !== 'now') this.out.write(`    ${state.padEnd(7)}${state.length >= 7 ? '  ' : ''}${g.line}\n`);
  }

  /** Something else is about to print (a question, a sign-in): draw afresh below it next time. */
  interrupt() {
    this.drawn = 0;
  }

  /** After a question: draw the lines again below it, so the screen does not wait for the next change. */
  resume() {
    if (this.tty && this.groups.some((g) => g.state)) this.draw();
  }
}

/**
 * Where the step-by-step detail goes: setup-notes.md in the home folder, or for a dry run a file
 * in a temporary folder (a dry run changes nothing in the home folder). Returns { file, fd }.
 */
export function openNotes(ctx) {
  const dir = ctx.dryRun ? fs.mkdtempSync(path.join(os.tmpdir(), 'aiws-dry-run-')) : ctx.home;
  const file = path.join(dir, NOTES_FILE);
  // A file of the same name that this setup did not write is kept as a backup.
  if (!ctx.dryRun && fs.existsSync(file) && !fs.readFileSync(file, 'utf8').startsWith(TOP)) ctx.backup(file);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, `${TOP}\n\nWritten by the setup on ${stamp}${ctx.dryRun ? ' (a dry run: nothing was changed)' : ''}.\n\n## What the setup did, step by step\n`);
  return { file, fd };
}
