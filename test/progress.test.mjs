// Tests for screen 3: one line of progress per group with a word for its state, and the
// step-by-step detail in setup-notes.md instead of on screen.
// Run: node --test test/progress.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aiws-progress-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.NO_COLOR = '1';

const { Context, detectPlatform } = await import('../lib/context.mjs');
const { NOTES_FILE, PROGRESS_HEAD, Progress, openNotes, progressGroups } = await import('../lib/progress.mjs');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ORDER = ['core', 'claude-code', 'agent-clis', 'mcp-servers', 'skills', 'firstmate', 'preferences', 'second-brain'];
const mods = (names) => names.map((name) => ({ name, summary: `the ${name} part` }));

function sink(tty) {
  const out = { isTTY: tty, text: '', write: (s) => (out.text += s) };
  return out;
}
const plain = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

test('the recommended parts make the seven groups, in the order they run', () => {
  const groups = progressGroups(mods(RUN_ORDER));
  assert.deepEqual(groups.map((g) => g.line), [
    'The basics',
    'Claude',
    'The tools it works with',
    'Skills',
    'The helper for several workers',
    'Good habits',
    'Your notes folder',
  ]);
  assert.deepEqual(groups[2].modules, ['agent-clis', 'mcp-servers']);
  // A part picked under customise shows its own summary.
  assert.deepEqual(progressGroups(mods(['core', 'clickup'])).map((g) => g.line), ['The basics', 'The clickup part']);
});

test('at a terminal the screen shows a word for every state and the count', () => {
  const out = sink(true);
  const p = new Progress(progressGroups(mods(RUN_ORDER)), { out });
  p.start();
  p.set('core', 'now');
  p.set('core', 'done');
  p.set('claude-code', 'now');
  p.set('claude-code', 'done');
  p.set('agent-clis', 'now');
  p.set('agent-clis', 'done'); // mcp-servers is in the same group: it stays "now"
  assert.ok(out.text.startsWith(`\n${PROGRESS_HEAD}\n\n`));
  assert.deepEqual(p.lines(), [
    '    done   The basics',
    '    done   Claude',
    '    now    The tools it works with',
    '           Skills',
    '           The helper for several workers',
    '           Good habits',
    '           Your notes folder',
    '',
    '  3 of 7',
  ]);
  // Redrawn in place: the last drawing on screen is the current one.
  assert.ok(plain(out.text).endsWith(`${p.lines().join('\n')}\n`));
  assert.ok(out.text.includes('\x1b[9F'), 'moves back up over its own nine lines');
  p.set('mcp-servers', 'did not work');
  assert.equal(p.lines()[2], '    did not work  The tools it works with');
  assert.equal(p.lines()[0], '    done          The basics');
  for (const line of p.lines()) assert.ok(line.length <= 72, line);
});

test('after something else printed, the screen draws afresh below it', () => {
  const out = sink(true);
  const p = new Progress(progressGroups(mods(['core', 'skills'])), { out });
  p.start();
  p.set('core', 'now');
  p.interrupt();
  out.text = '';
  p.set('core', 'done');
  assert.ok(!out.text.includes('\x1b['), 'no move up over what printed in between');
});

test('after a question the screen draws again below it at once; without a terminal it prints nothing', () => {
  const out = sink(true);
  const p = new Progress(progressGroups(mods(['core', 'skills'])), { out });
  p.start();
  p.set('core', 'now');
  p.interrupt();
  out.text = '';
  p.resume();
  assert.ok(!out.text.includes('['), 'no move up over the question');
  assert.match(out.text, /now    The basics/);
  const plain = sink(false);
  const q = new Progress(progressGroups(mods(['core'])), { out: plain });
  q.set('core', 'now');
  plain.text = '';
  q.resume();
  assert.equal(plain.text, '');
});

test('without a terminal each finished group prints one line', () => {
  const out = sink(false);
  const p = new Progress(progressGroups(mods(['core', 'claude-code'])), { out });
  p.start();
  for (const n of ['core', 'claude-code']) {
    p.set(n, 'now');
    p.set(n, n === 'core' ? 'done' : 'did not work');
  }
  assert.equal(out.text, `\n${PROGRESS_HEAD}\n\n    done   The basics\n    did not work  Claude\n`);
});

function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => (console.log = log))
    .then(() => lines.join('\n'));
}

test('while the screen is up the detail and command output go to the notes file, and a question steps the screen aside', async () => {
  const asked = [];
  const prompter = { confirm: async (t) => (asked.push(t), true), release() {} };
  const ctx = new Context({ platform: detectPlatform(), dryRun: false, interactive: true, answers: new Map(), prompter, repoRoot });
  const notes = openNotes(ctx);
  assert.equal(notes.file, path.join(home, NOTES_FILE));
  ctx.sink = notes.fd;
  const shown = [];
  ctx.progress = { interrupt: () => shown.push('interrupt'), resume: () => shown.push('resume') };
  const screen = await capture(async () => {
    ctx.beginModule('demo');
    ctx.info('a detail line');
    ctx.run('echo from-the-command');
    assert.equal(await ctx.confirm('Replace it?', false), true);
    ctx.run('echo the-person-sees-this', { show: true });
  });
  fs.closeSync(notes.fd);
  const text = fs.readFileSync(notes.file, 'utf8');
  assert.match(text, /^# Setup notes\n/);
  assert.match(text, /• a detail line/);
  assert.match(text, /\$ echo from-the-command\nfrom-the-command/);
  assert.ok(!text.includes('the-person-sees-this'), text);
  assert.ok(!screen.includes('a detail line') && !screen.includes('from-the-command'), screen);
  assert.match(screen, /\$ echo the-person-sees-this/);
  assert.deepEqual(asked, ['Replace it?']);
  assert.deepEqual(shown, ['interrupt', 'resume', 'interrupt']);
});

test('a setup-notes.md the setup did not write is backed up; a dry run writes only to a temporary folder', () => {
  const own = path.join(home, NOTES_FILE);
  fs.writeFileSync(own, 'my own notes\n');
  const ctx = new Context({ platform: detectPlatform(), dryRun: false, interactive: true, answers: new Map(), prompter: null, repoRoot });
  fs.closeSync(openNotes(ctx).fd);
  const backups = fs.readdirSync(home).filter((f) => f.startsWith(`${NOTES_FILE}.bak-`));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(home, backups[0]), 'utf8'), 'my own notes\n');

  const before = fs.readFileSync(own, 'utf8');
  const dry = new Context({ platform: detectPlatform(), dryRun: true, interactive: true, answers: new Map(), prompter: null, repoRoot });
  const notes = openNotes(dry);
  fs.closeSync(notes.fd);
  assert.notEqual(path.dirname(notes.file), home);
  assert.match(fs.readFileSync(notes.file, 'utf8'), /a dry run: nothing was changed/);
  assert.equal(fs.readFileSync(own, 'utf8'), before);
});
