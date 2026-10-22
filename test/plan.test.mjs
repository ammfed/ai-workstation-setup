// Tests for the plan shown before anything is installed: the recommended picks are selected by
// default, the plan prints before any install step, Enter goes ahead (every question takes its
// recommended answer), "c" opens the module picker and the questions, and saved answers win.
// Run: node --test test/plan.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context, detectPlatform } from '../lib/context.mjs';
import { GROUPS, confirmPlan, planLines, selectModules } from '../lib/plan.mjs';

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

function ctxFor({ interactive = true, answers = {}, replies = [], picked } = {}) {
  const prompter = fakePrompter(replies, picked);
  const ctx = new Context({
    platform: detectPlatform('linux'),
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

test('the plan is a few grouped lines, one per group in use', () => {
  const lines = planLines(modules.filter((m) => recommended.includes(m.name)));
  assert.match(lines[0], /recommended picks/);
  assert.ok(lines.length >= 2 && lines.length <= Object.keys(GROUPS).length + 1, lines.join('\n'));
  assert.match(lines.join('\n'), /Your AI assistant: Claude Code/);
});

test('the recommended picks are selected by default', async () => {
  const { ctx } = ctxFor({ interactive: false });
  const { value, out } = await quietly(() => selectModules(ctx, modules));
  assert.deepEqual(value.map((m) => m.name), recommended);
  assert.match(out, /What will be set up \(the recommended picks\)/);
  assert.equal(ctx.acceptPlan, false);
});

test('Enter goes ahead: no module picker, and questions take their recommended answer', async () => {
  const { ctx, prompter } = ctxFor({ replies: [''] });
  const { value } = await quietly(() => selectModules(ctx, modules));
  assert.deepEqual(value.map((m) => m.name), recommended);
  assert.equal(ctx.acceptPlan, true);
  assert.equal(prompter.asked.length, 1, 'only the go-ahead prompt');
  assert.match(prompter.asked[0], /Press Enter to go ahead, or type c to change the picks/);

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
  assert.match(out, /What will be set up \(your picks\)/);
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
  assert.match(out, /your saved picks/);
  assert.equal(await ctx.ask({ key: 'Q_SAVED', type: 'text', message: 'q', default: 'recommended' }), 'mine');
});

test('a dry run prints the plan before any install step, also under --yes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-test-'));
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', 'linux', '--answers', path.join(repoRoot, 'answers.example.env')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
    stdin: 'ignore',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const plan = r.stdout.indexOf('What will be set up (the recommended picks):');
  const firstStep = r.stdout.indexOf('\n[core]');
  assert.ok(plan > 0 && firstStep > plan, r.stdout.slice(0, 2000));
  for (const name of recommended) assert.match(r.stdout, new RegExp(`\\n\\[${name}\\]`), name);
});
