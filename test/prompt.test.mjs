// Tests for the multi-pick prompt: the picker's state logic (cursor, toggle, result), its key
// handling fed through a fake terminal stream, typed numbers that toggle instead of replacing
// the ticked set, and the "CLIs to install" list starting with the tools already installed.
// Run: node --test test/prompt.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context, detectPlatform } from '../lib/context.mjs';
import { pickMulti, pickerKey, pickerLines, pickerResult, pickerStart, toggleTyped } from '../lib/prompt.mjs';
import agentClis, { DEFAULTS } from '../modules/agent-clis/module.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const choices = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8', 'i9', 'j10', 'k11'].map((value) => ({ value }));

const press = (state, ...keys) => keys.reduce((s, k) => pickerKey(choices, s, k.str, k).state, state);
const down = { name: 'down' };
const up = { name: 'up' };
const space = { name: 'space', str: ' ' };
const digit = (d) => ({ str: d });

test('the cursor moves with the arrows and wraps at both ends', () => {
  let s = pickerStart(choices);
  assert.equal(s.cursor, 0);
  s = press(s, down, down);
  assert.equal(s.cursor, 2);
  s = press(s, up, up, up);
  assert.equal(s.cursor, choices.length - 1);
  s = press(s, down);
  assert.equal(s.cursor, 0);
});

test('space ticks and unticks the item under the cursor, keeping the rest', () => {
  let s = pickerStart(choices, ['a1', 'c3']);
  s = press(s, down, space);
  assert.deepEqual(pickerResult(choices, s), ['a1', 'b2', 'c3']);
  s = press(s, down, space);
  assert.deepEqual(pickerResult(choices, s), ['a1', 'b2']);
});

test('Enter confirms and Ctrl+C aborts', () => {
  const s = pickerStart(choices, ['a1']);
  assert.equal(pickerKey(choices, s, '\r', { name: 'return' }).done, true);
  assert.equal(pickerKey(choices, s, '\x03', { name: 'c', ctrl: true }).abort, true);
  assert.equal(pickerKey(choices, s, 'c', { name: 'c' }).abort, undefined);
});

test('a ticks every item, and again unticks every item', () => {
  let s = press(pickerStart(choices, ['a1']), { name: 'a', str: 'a' });
  assert.deepEqual(pickerResult(choices, s), choices.map((c) => c.value));
  s = press(s, { name: 'a', str: 'a' });
  assert.deepEqual(pickerResult(choices, s), []);
});

test('numbers typed in the picker toggle those items on Enter instead of confirming', () => {
  let s = pickerStart(choices, ['a1', 'h8']);
  s = press(s, digit('8'), digit(','), digit('1'), digit('0'));
  assert.equal(s.typed, '8,10');
  const r = pickerKey(choices, s, '\r', { name: 'return' });
  assert.equal(r.done, undefined);
  assert.deepEqual(pickerResult(choices, r.state), ['a1', 'j10']);
  assert.equal(r.state.typed, '');
  const bad = pickerKey(choices, press(r.state, digit('9'), digit('9')), '\r', { name: 'return' });
  assert.match(bad.state.note, /"99"/);
  assert.deepEqual(pickerResult(choices, bad.state), ['a1', 'j10']);
});

test('each line shows [x] or [ ] and the cursor', () => {
  const lines = pickerLines('Pick', choices, press(pickerStart(choices, ['b2']), down));
  assert.equal(lines[0], '? Pick');
  assert.equal(lines[1], '     1) [ ] a1');
  assert.equal(lines[2], '  >  2) [x] b2');
});

test('typed numbers toggle against the current set and never replace it', () => {
  const current = ['a1', 'b2', 'c3'];
  assert.deepEqual(toggleTyped(choices, current, '8').value, ['a1', 'b2', 'c3', 'h8']);
  assert.deepEqual(toggleTyped(choices, current, '2, 8').value, ['a1', 'c3', 'h8']);
  assert.deepEqual(toggleTyped(choices, current, 'c3').value, ['a1', 'b2']);
  assert.deepEqual(toggleTyped(choices, current, '').value, current);
  assert.deepEqual(toggleTyped(choices, current, 'none').value, []);
  assert.deepEqual(toggleTyped(choices, current, 'ALL').value, choices.map((c) => c.value));
  assert.equal(toggleTyped(choices, current, '1,12').bad, '12');
});

// A readable stream that stands in for a terminal: it records raw mode switches.
function fakeTerminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.raw = [];
  input.setRawMode = (on) => input.raw.push(on);
  const output = new PassThrough();
  let written = '';
  output.on('data', (d) => (written += d));
  return { input, output, written: () => written };
}

test('keypresses through a fake terminal move, tick and confirm, then raw mode is off', async () => {
  const t = fakeTerminal();
  const done = pickMulti({ input: t.input, output: t.output, message: 'CLIs', choices, ticked: ['a1'] });
  // down, down, space (ticks c3), up, space (ticks b2), up, space (unticks a1), Enter.
  t.input.write('\x1b[B\x1b[B \x1b[A \x1b[A \r');
  assert.deepEqual(await done, ['b2', 'c3']);
  assert.deepEqual(t.input.raw, [true, false]);
  assert.equal(t.input.listenerCount('keypress'), 0);
  assert.match(t.written(), /\[x\] c3/);
  assert.match(t.written(), /\x1b\[\d+F/, 'redraws in place');
});

test('Ctrl+C through a fake terminal rejects as an abort and turns raw mode off', async () => {
  const t = fakeTerminal();
  const done = pickMulti({ input: t.input, output: t.output, message: 'CLIs', choices, ticked: ['a1'] });
  t.input.write(' \x03');
  await assert.rejects(done, { code: 'ABORT' });
  assert.deepEqual(t.input.raw, [true, false]);
});

test('typed numbers through a fake terminal toggle, then Enter confirms', async () => {
  const t = fakeTerminal();
  const done = pickMulti({ input: t.input, output: t.output, message: 'CLIs', choices, ticked: ['a1', 'b2'] });
  t.input.write('8\r\r');
  assert.deepEqual(await done, ['a1', 'b2', 'h8']);
});

// ------------------------------------------------------- installed tools in the default

const cliQuestion = agentClis.questions.find((q) => q.key === 'AGENT_CLIS');

async function askClis({ answers = {}, platform = detectPlatform() } = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-test-'));
  // codex and herdr stand in for tools already on this machine; nothing else is on PATH.
  for (const name of ['codex', 'herdr']) fs.writeFileSync(path.join(bin, name), '');
  const savedPath = process.env.PATH;
  process.env.PATH = bin;
  let offered;
  const prompter = { ask: async (q, def) => ((offered = def), def) };
  try {
    const ctx = new Context({ platform, dryRun: true, interactive: true, answers: new Map(Object.entries(answers)), prompter, repoRoot });
    ctx.beginModule('agent-clis');
    return { value: await ctx.ask(cliQuestion), offered };
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

test('with no saved answer, tools already installed are ticked alongside the defaults', async () => {
  const { value, offered } = await askClis();
  assert.deepEqual(offered, [...DEFAULTS, 'herdr', 'codex']);
  assert.deepEqual(value, offered);
});

test('a saved answer wins over what is installed', async () => {
  const { value, offered } = await askClis({ answers: { AGENT_CLIS: 'gh-axi' } });
  assert.equal(offered, undefined, 'not asked');
  assert.deepEqual(value, ['gh-axi']);
});

test('a simulated platform detects nothing, so only the defaults are ticked', async () => {
  const { offered } = await askClis({ platform: { ...detectPlatform('windows'), simulated: true } });
  assert.deepEqual(offered, DEFAULTS);
});
