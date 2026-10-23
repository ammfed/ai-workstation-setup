// Tests for screen 5 at a terminal: "All set!" or "Nearly all set." with what did not work, how
// to start, the "Later" list and where the setup notes are, and the summary and to-do list
// written into setup-notes.md instead of onto the screen.
// Run: node --test test/allset.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_SET, AGAIN, START, START_WINDOWS, WHAT_WENT_WRONG, allSetLines, notesSummary } from '../lib/allset.mjs';

const home = '/tmp/aiws-home';
const later = [
  { name: 'GitHub', wanted: false, later: 'GitHub, to save your work online' },
  { name: 'Context7', wanted: false, later: 'Context7, for fresh answers about code tools' },
  { name: 'Claude', wanted: true },
];
const LATER = [
  '  Later, when you want them:',
  '    • GitHub, to save your work online',
  '    • Context7, for fresh answers about code tools',
  '  Run the setup again any time to sign in to these. It asks nothing else.',
];
const NOTES = '  Your setup notes are in setup-notes.md in your home folder.';

test('Linux and Mac: the design\'s exact words, with the helper and the Later list', () => {
  for (const system of ['linux', 'macos', 'wsl']) {
    const lines = allSetLines({ os: system, helperDir: `${home}/firstmate`, home, signIns: later });
    assert.deepEqual(lines, [
      ALL_SET,
      '',
      START,
      '  For several workers at once, type  cd firstmate  then  claude',
      '',
      ...LATER,
      '',
      NOTES,
    ]);
    for (const l of lines) assert.ok(l.length <= 80, `fits an 80-column terminal: ${l}`);
  }
  assert.equal(ALL_SET, '  All set! Claude is ready.');
  assert.equal(START, '  To start, type  claude  and press Enter.');
});

test('Windows: open Claude from the Start menu, no cd line', () => {
  const lines = allSetLines({ os: 'windows', helperDir: `${home}/firstmate`, home, signIns: later });
  assert.deepEqual(lines, [ALL_SET, '', START_WINDOWS, '', ...LATER, '', NOTES]);
  assert.equal(START_WINDOWS, '  To start, open Claude from the Start menu and pick the Code tab.');
});

test('no helper and nothing left for later: just the start line and the notes', () => {
  assert.deepEqual(allSetLines({ os: 'linux', home, signIns: [{ name: 'Claude', wanted: true }] }), [ALL_SET, '', START, '', NOTES]);
});

test('the helper\'s folder as typed after cd: under home relative, elsewhere whole, spaces quoted', () => {
  const cd = (dir) => allSetLines({ os: 'linux', helperDir: dir, home })[3];
  assert.equal(cd(`${home}/work/firstmate`), '  For several workers at once, type  cd work/firstmate  then  claude');
  assert.equal(cd('/srv/firstmate'), '  For several workers at once, type  cd /srv/firstmate  then  claude');
  assert.equal(cd(`${home}/my work/fm`), '  For several workers at once, type  cd "my work/fm"  then  claude');
});

test('something did not work: the first line is replaced, naming it in the screen\'s words', () => {
  const one = allSetLines({ os: 'linux', failed: ['Your notes folder'], home });
  assert.deepEqual(one.slice(0, 4), ['  Nearly all set. 1 thing did not work: your notes folder.', AGAIN, WHAT_WENT_WRONG, '']);
  assert.ok(!one.includes(ALL_SET));
  assert.equal(AGAIN, '  Run the setup again later. It skips what is already done.');
  assert.equal(WHAT_WENT_WRONG, '  What went wrong is in setup-notes.md.');
  const three = allSetLines({ os: 'linux', failed: ['The basics', 'Skills', 'signing in to Claude'], home });
  assert.equal(three[0], '  Nearly all set. 3 things did not work: the basics, skills and signing in to Claude.');
});

test('a dry run names the notes file in its temporary folder', () => {
  const lines = allSetLines({ os: 'linux', home, notesFile: '/tmp/aiws-dry-run-x/setup-notes.md' });
  assert.equal(lines.at(-1), '  Your setup notes are in /tmp/aiws-dry-run-x/setup-notes.md');
});

const rec = (o = {}) => ({ failures: [], skips: [], todos: [], report: [], ...o });

test('setup-notes.md gets the summary: how it went, what did not work, the to-dos worded for Claude', () => {
  const md = notesSummary({
    results: [
      { m: { name: 'core', title: 'Core' }, rec: rec({ todos: ['restart the terminal'] }), status: 'done' },
      { m: { name: 'second-brain', title: 'Notes folder' }, rec: rec({ failures: ['Obsidian app: flatpak failed'] }), status: 'failed' },
      { m: { name: 'skills', title: 'Agent skills' }, rec: rec({ report: ['would install: tdd'] }), status: 'done' },
    ],
    missed: [{ name: 'wsl', reason: 'only on Windows' }],
    windowsSide: [{ m: { name: 'claude-code' }, note: 'the desktop app runs on Windows' }],
  });
  assert.match(md, /## How it went\n\n- core: done\n- second-brain: failed\n- skills: done/);
  assert.match(md, /## What did not work\n\nRunning the setup again skips what is already done and tries these again\.\n\n- second-brain: Obsidian app: flatpak failed/);
  assert.match(md, /## Left to do\n\nThe setup could not do these by itself\. Open Claude and say: "Read setup-notes\.md in my home folder and help me finish what is left, one step at a time\."\n\n- \[ \] core: restart the terminal/);
  assert.match(md, /## On the Windows side[\s\S]*- claude-code: the desktop app runs on Windows/);
  assert.match(md, /## Not set up on this system\n\n- wsl: only on Windows/);
  assert.match(md, /## Agent skills\n\n- would install: tdd/);
});

test('setup-notes.md leaves out empty sections', () => {
  const md = notesSummary({ results: [{ m: { name: 'core', title: 'Core' }, rec: rec(), status: 'done' }] });
  assert.doesNotMatch(md, /What did not work|Left to do|Windows side|Not set up/);
});
