// Tests for the first screen shown before anything is installed: the recommended picks are
// selected by default, the screen lists what you get in plain words before any install step,
// Enter goes ahead (every question takes its recommended answer), "c" opens the module picker
// and the questions, and saved answers win.
// Run: node --test test/plan.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context, detectPlatform } from '../lib/context.mjs';
import { GROUPS, START_LINE, UPDATE_LINE, confirmPlan, newSettings, planLines, selectModules, youGetLines } from '../lib/plan.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The modules as the installer loads them, with the same fallbacks.
const modules = [];
for (const name of fs.readdirSync(path.join(repoRoot, 'modules')).sort()) {
  const file = path.join(repoRoot, 'modules', name, 'module.mjs');
  if (!fs.existsSync(file)) continue;
  const m = (await import(pathToFileURL(file).href)).default;
  modules.push({ requires: [], default: false, unsupported: {}, questions: [], ...m });
}
modules.sort((a, b) => a.order - b.order);
const recommended = modules.filter((m) => m.default && m.platforms.includes('linux')).map((m) => m.name);

// A terminal that answers each prompt from a list and records what it was asked.
function fakePrompter(replies, picked) {
  const asked = [];
  return {
    asked,
    question: async (text) => {
      asked.push(text);
      return replies.shift() ?? '';
    },
    multi: async (message, choices, ticked) => {
      asked.push({ message, ticked });
      return picked ?? ticked;
    },
    ask: async (q) => {
      asked.push(q.key);
      return 'asked';
    },
  };
}

function ctxFor({ interactive = true, answers = {}, replies = [], picked, os: system = 'linux' } = {}) {
  const prompter = fakePrompter(replies, picked);
  const ctx = new Context({
    platform: detectPlatform(system),
    dryRun: true,
    interactive,
    answers: new Map(Object.entries(answers)),
    prompter,
    repoRoot,
  });
  return { ctx, prompter };
}

async function quietly(fn) {
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try {
    return { value: await fn(), out: lines.join('\n') };
  } finally {
    console.log = log;
  }
}

test('every module has a plan group and a short plain summary', () => {
  for (const m of modules) {
    assert.ok(Object.hasOwn(GROUPS, m.group), `${m.name}: group ${m.group}`);
    assert.ok(typeof m.summary === 'string' && m.summary.length > 0 && m.summary.length <= 60, `${m.name}: summary`);
    // Plain words only: no flag names, answer keys or module ids.
    assert.doesNotMatch(m.summary, /--|[A-Z]{2,}_[A-Z]|\bmodule\b/, m.name);
  }
});

// The first screen's words, as the design has them (Linux and Mac).
const HELLO = `  Hi! This sets up an AI assistant on your computer.

  You get:
    ✓ Claude, an AI assistant you talk to in plain words
    ✓ The tools it needs to do real work for you
    ✓ Skills that help it plan with you and check its own work
    ✓ Good habits: plain words, and it checks with you before big steps
    ✓ A notes folder it can read and keep tidy, with the Obsidian app
    ✓ A helper that runs several AI workers for you

  Your computer asks for your password once. You sign in at the end.
  After that you can leave it running.`;

test('the first screen lists what you get in plain words, one line per part', () => {
  const { ctx } = ctxFor();
  const lines = planLines(modules.filter((m) => recommended.includes(m.name)), 'recommended', ctx);
  assert.equal(lines.join('\n'), HELLO);
  assert.ok(lines.every((l) => l.length <= 72), 'fits a 72-column terminal');
  assert.doesNotMatch(lines.join('\n'), /platform:|package manager|Not available|outside connections/);
});

test('the first screen names the Obsidian app only when it is set up, and Windows gets its own lines', () => {
  const picked = modules.filter((m) => recommended.includes(m.name));
  const yes = ctxFor({ answers: { VAULT_APP: 'yes' } }).ctx;
  assert.ok(youGetLines(picked, yes).includes('A notes folder it can read and keep tidy, with the Obsidian app'));
  const no = ctxFor({ answers: { VAULT_APP: 'no' } }).ctx;
  assert.ok(youGetLines(picked, no).includes('A notes folder it can read and keep tidy'));

  const win = ctxFor({ os: 'windows' }).ctx;
  const onWindows = modules.filter((m) => m.default && m.platforms.includes('windows'));
  const text = planLines(onWindows, 'recommended', win).join('\n');
  assert.match(text, /Claude, an AI assistant you talk to in plain words, with its app/);
  assert.match(text, /Windows may ask you to allow changes\. Click Yes\./);
  assert.doesNotMatch(text, /password|several AI workers/);
});

test('a part outside the recommended set shows its own plain summary', () => {
  const picked = modules.filter((m) => ['claude-code', 'voice-mode'].includes(m.name));
  assert.deepEqual(youGetLines(picked, ctxFor().ctx), ['Claude, an AI assistant you talk to in plain words', 'Talking with it by voice']);
});

test('the recommended picks are selected by default', async () => {
  const { ctx } = ctxFor({ interactive: false });
  const { value, out } = await quietly(() => selectModules(ctx, modules));
  assert.deepEqual(value.map((m) => m.name), recommended);
  assert.match(out, /Hi! This sets up an AI assistant on your computer\./);
  assert.equal(ctx.acceptPlan, false);
});

test('Enter goes ahead: no module picker, and questions take their recommended answer', async () => {
  const { ctx, prompter } = ctxFor({ replies: [''] });
  const { value } = await quietly(() => selectModules(ctx, modules));
  assert.deepEqual(value.map((m) => m.name), recommended);
  assert.equal(ctx.acceptPlan, true);
  assert.equal(prompter.asked.length, 1, 'only the go-ahead prompt');
  assert.equal(prompter.asked[0].trim(), START_LINE);
  assert.equal(START_LINE, 'Press Enter to start, or type c to choose for yourself.');

  assert.equal(await ctx.ask({ key: 'Q_PLAIN', type: 'text', message: 'q', default: 'recommended' }), 'recommended');
  assert.equal(await ctx.ask({ key: 'Q_NONE', type: 'text', message: 'q', default: '', alwaysAsk: true }), 'asked');
  assert.deepEqual(prompter.asked.slice(1), ['Q_NONE'], 'only the question with no recommended answer is asked');
});

test('typing c opens the module picker, ticked with the recommended picks, then the questions', async () => {
  const { ctx, prompter } = ctxFor({ replies: ['c'], picked: ['core', 'skills'] });
  const { value, out } = await quietly(() => selectModules(ctx, modules));
  const picker = prompter.asked[1];
  assert.equal(picker.message, 'Which modules should be set up?');
  assert.deepEqual(picker.ticked, recommended);
  assert.deepEqual(value.map((m) => m.name), ['core', 'skills']);
  assert.deepEqual(ctx.values.MODULES, ['core', 'skills']);
  assert.match(out, /Your picks:/);
  assert.equal(ctx.acceptPlan, false);
  assert.equal(await ctx.ask({ key: 'Q_PLAIN', type: 'text', message: 'q', default: 'recommended' }), 'asked');
});

test('a reply that is neither Enter nor c is asked again', async () => {
  const prompter = fakePrompter(['maybe', 'C']);
  assert.equal(await quietly(() => confirmPlan(prompter)).then((r) => r.value), 'change');
  assert.equal(prompter.asked.length, 2);
});

test('saved answers win over the recommended picks and answers', async () => {
  const { ctx } = ctxFor({ replies: [''], answers: { MODULES: 'core,second-brain', Q_SAVED: 'mine' } });
  const { value, out } = await quietly(() => selectModules(ctx, modules));
  assert.deepEqual(value.map((m) => m.name), ['core', 'second-brain']);
  assert.match(out, /Welcome back! Your earlier choices are kept\./);
  assert.equal(await ctx.ask({ key: 'Q_SAVED', type: 'text', message: 'q', default: 'recommended' }), 'mine');
});

// Every question a part asks, each answered as a first run would (saved answers are what a run keeps).
function firstRunAnswers(names) {
  const ctx = ctxFor().ctx;
  const answers = { MODULES: names.join(',') };
  for (const m of modules.filter((x) => names.includes(x.name))) {
    for (const q of typeof m.questions === 'function' ? m.questions(ctx) : m.questions) {
      if (q.type === 'secret') continue;
      const v = typeof q.default === 'function' ? q.default(ctx) : q.default;
      answers[q.key] = Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v ?? '');
    }
  }
  return answers;
}

test('running it again: welcome back, the count of new settings, and Enter to update', async () => {
  const answers = firstRunAnswers(recommended);
  delete answers.VAULT_APP;
  delete answers.SKILLS;
  const { ctx, prompter } = ctxFor({ replies: [''], answers });
  const { value, out } = await quietly(() => selectModules(ctx, modules));
  assert.deepEqual(value.map((m) => m.name), recommended);
  const screen = out.trim().split('\n').map((l) => l.trimEnd());
  assert.deepEqual(screen, ['Welcome back! Your earlier choices are kept.', '  2 new settings take their recommended answers.']);
  assert.equal(prompter.asked.length, 1);
  assert.equal(prompter.asked[0].trim(), UPDATE_LINE);
  assert.equal(UPDATE_LINE, 'Press Enter to update, or type c to change your choices.');
  assert.equal(ctx.acceptPlan, true);
  assert.doesNotMatch(out, /You get|password/);
});

test('running it again counts one new setting in the singular, and none at all without a line', async () => {
  const answers = firstRunAnswers(recommended);
  const none = await quietly(() => selectModules(ctxFor({ replies: [''], answers }).ctx, modules));
  assert.deepEqual(none.out.trim().split('\n'), ['Welcome back! Your earlier choices are kept.']);
  delete answers.VAULT_APP;
  const one = await quietly(() => selectModules(ctxFor({ replies: [''], answers }).ctx, modules));
  assert.match(one.out, /^  1 new setting takes its recommended answer\.$/m);
});

test('a follow-up question counts only when the saved answer it follows brings it up', () => {
  const picked = modules.filter((m) => m.name === 'agent-clis');
  const answers = firstRunAnswers(['agent-clis']);
  assert.match(answers.AGENT_CLIS, /herdr/);
  assert.equal(newSettings(ctxFor({ answers }).ctx, picked), 0, 'every saved answer kept: nothing new');
  // herdr left out of the saved tools: its two follow-ups are not brought up, so not counted.
  const without = { ...answers, AGENT_CLIS: answers.AGENT_CLIS.split(',').filter((x) => x !== 'herdr').join(',') };
  delete without.HERDR_CLAUDE_INTEGRATION;
  delete without.HERDR_SETTINGS;
  assert.equal(newSettings(ctxFor({ answers: without }).ctx, picked), 0);
  // The tool list itself new: its default brings herdr in, so it and both follow-ups count.
  const fresh = { ...answers };
  for (const k of ['AGENT_CLIS', 'HERDR_CLAUDE_INTEGRATION', 'HERDR_SETTINGS']) delete fresh[k];
  const ctx = ctxFor({ answers: fresh }).ctx;
  assert.equal(newSettings(ctx, picked), 3);
  assert.deepEqual(ctx.values, {}, 'counting leaves no answers behind');
});

test('running it again under --yes still lists what you get, for an assistant reading', async () => {
  const answers = firstRunAnswers(recommended);
  delete answers.VAULT_APP;
  const { out } = await quietly(() => selectModules(ctxFor({ interactive: false, answers }).ctx, modules));
  assert.match(out, /Welcome back! Your earlier choices are kept\.\n  1 new setting takes its recommended answer\.\n\n  You get:/);
});

test('running it again, c still opens the picker ticked with the saved picks', async () => {
  const { ctx, prompter } = ctxFor({ replies: ['c'], answers: { MODULES: 'core,skills' }, picked: ['core'] });
  const { value } = await quietly(() => selectModules(ctx, modules));
  assert.deepEqual(prompter.asked[1].ticked, ['core', 'skills']);
  assert.deepEqual(value.map((m) => m.name), ['core']);
  assert.equal(ctx.acceptPlan, false);
});

test('the first screen hides the system line and the parts this system cannot run', async () => {
  const { ctx } = ctxFor({ replies: [''] });
  const { out } = await quietly(() => selectModules(ctx, modules));
  assert.doesNotMatch(out, /Not available on/);
  const unattended = ctxFor({ interactive: false }).ctx;
  assert.match((await quietly(() => selectModules(unattended, modules))).out, /Not available on linux:/, 'an assistant reading the output still sees them');
});

test('going ahead with the plan asks no other question in any recommended part', () => {
  const ctx = ctxFor().ctx;
  for (const m of modules.filter((x) => x.default)) {
    const qs = typeof m.questions === 'function' ? m.questions(ctx) : m.questions;
    for (const q of qs) assert.ok(!q.alwaysAsk, `${m.name}: ${q.key}`);
  }
});

test('a dry run prints the first screen before any install step, also under --yes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-test-'));
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', 'linux', '--answers', path.join(repoRoot, 'answers.example.env')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
    stdin: 'ignore',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const plan = r.stdout.indexOf('Hi! This sets up an AI assistant on your computer.');
  const firstStep = r.stdout.indexOf('\n[core]');
  assert.ok(plan > 0 && firstStep > plan, r.stdout.slice(0, 2000));
  for (const name of recommended) assert.match(r.stdout, new RegExp(`\\n\\[${name}\\]`), name);
});
