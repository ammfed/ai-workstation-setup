// Tests for the computer password screen: asked once at a terminal on Linux and WSL, in the
// design's words, never under --yes, never on macOS or Windows, never as root.
// Run: node --test test/password.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aiws-password-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.NO_COLOR = '1';

const { Context, detectPlatform } = await import('../lib/context.mjs');
const { PASSWORD_LINES, PASSWORD_PROMPT, askPassword, needsPassword } = await import('../lib/password.mjs');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakePrompter() {
  const asked = [];
  return {
    asked,
    question: async (t) => (asked.push(t), ''),
    secret: async (t, opts) => (asked.push({ t, opts }), 'typed'),
    release() {},
  };
}

// Simulated systems only (a dry run), so this machine's own sudo is never touched.
async function screen(os, { interactive = true, platform = {} } = {}) {
  const prompter = interactive ? fakePrompter() : null;
  const ctx = new Context({ platform: { ...detectPlatform(os), ...platform }, dryRun: true, interactive, answers: new Map(), prompter, repoRoot });
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let shown;
  try {
    shown = await askPassword(ctx);
  } finally {
    console.log = log;
  }
  return { shown, out: lines.join('\n'), asked: prompter?.asked ?? [] };
}

const SIMULATED = process.platform === 'linux' ? ['wsl'] : ['linux', 'wsl'];

test('the password screen shows the design words and asks once, on Linux and WSL', async () => {
  for (const os of SIMULATED) {
    const { shown, out, asked } = await screen(os);
    assert.equal(shown, true, os);
    assert.ok(out.includes(PASSWORD_LINES.join('\n')), out);
    assert.deepEqual(PASSWORD_LINES.slice(0, 3), [
      '  First, your computer password.',
      '  It lets the setup install things without stopping halfway.',
      '  Nothing shows while you type. That is normal.',
    ]);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].t, PASSWORD_PROMPT);
    assert.equal(PASSWORD_PROMPT, '  Password: ');
    assert.deepEqual(asked[0].opts, { plain: true });
    // A dry run never keeps or prints what was typed.
    assert.ok(!out.includes('typed'));
    for (const l of PASSWORD_LINES) assert.ok(l.length <= 72);
  }
});

test('no password screen under --yes, on macOS or Windows, or as root', async () => {
  for (const os of SIMULATED) {
    const yes = await screen(os, { interactive: false });
    assert.equal(yes.shown, false);
    assert.equal(yes.out, '');
    const root = await screen(os, { platform: { isRoot: true } });
    assert.equal(root.shown, false);
    assert.equal(root.asked.length, 0);
  }
  for (const os of ['macos', 'windows']) {
    const r = await screen(os);
    assert.equal(r.shown, false, os);
    assert.equal(r.asked.length, 0, os);
  }
});

test('the installer asks the password after the questions and before anything installs', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'lib/installer.mjs'), 'utf8');
  const at = (s) => src.indexOf(s);
  assert.ok(at('await askPassword(ctx)') > at('saveAnswers(file'));
  assert.ok(at('await askPassword(ctx)') < at('await m.install(ctx)'));
  assert.equal(typeof needsPassword, 'function');
});
