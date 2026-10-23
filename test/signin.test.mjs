// Tests for the sign-ins at the end of a run at a terminal: Claude's sign-in is the one stop
// on the default path, GitHub and Context7 go on the "Later" list unless picked under
// customise, a re-run offers them again, and --yes keeps every sign-in as a to-do.
// Run: node --test test/signin.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// A throwaway home before anything reads it: nothing here may touch the real one.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aiws-signin-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.NO_COLOR = '1';
// Keys come from the environment first; none may leak in from the machine running the tests.
for (const k of ['CLICKUP_TOKEN', 'OPENROUTER_API_KEY', 'CONTEXT7_API_KEY']) delete process.env[k];

const { Context, detectPlatform } = await import('../lib/context.mjs');
const { ENTER_CLAUDE, ENTER_OTHER, KEYS_HEAD, laterLines, runKeys, runSignIns, signInLines } = await import('../lib/signin.mjs');
const core = (await import('../modules/core/module.mjs')).default;
const claudeCode = (await import('../modules/claude-code/module.mjs')).default;
const agentClis = (await import('../modules/agent-clis/module.mjs')).default;
const clickup = (await import('../modules/clickup/module.mjs')).default;
const openrouter = (await import('../modules/openrouter/module.mjs')).default;
const mcpServers = (await import('../modules/mcp-servers/module.mjs')).default;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakePrompter(replies = [], secrets = []) {
  const asked = [];
  return {
    asked,
    question: async (text) => {
      asked.push(text);
      return replies.shift() ?? '';
    },
    ask: async (q, def) => {
      asked.push(q.key);
      return q.type === 'confirm' ? true : def;
    },
    multi: async (_m, _c, ticked) => ticked,
    secret: async (text) => {
      asked.push(text);
      return secrets.shift() ?? '';
    },
    release() {},
  };
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

// A dry run at a terminal of the parts that hold a sign-in, on simulated macOS (never this machine's own tools).
async function run({ answers = {}, acceptPlan = true, rerun = false, replies = [] } = {}) {
  const prompter = fakePrompter(replies);
  const ctx = new Context({ platform: detectPlatform('macos'), dryRun: true, interactive: true, answers: new Map(Object.entries(answers)), prompter, repoRoot });
  ctx.acceptPlan = acceptPlan;
  ctx.rerun = rerun;
  const questions = [];
  const { out } = await quietly(async () => {
    for (const m of [core, claudeCode, agentClis]) {
      const qs = typeof m.questions === 'function' ? m.questions(ctx) : m.questions;
      for (const q of qs) if (!q.when || q.when(ctx)) await ctx.ask(q);
    }
    questions.push(...prompter.asked);
    const during = prompter.asked.length;
    for (const m of [core, claudeCode, agentClis]) {
      ctx.beginModule(m.name);
      await m.install(ctx);
    }
    assert.equal(prompter.asked.length, during, 'nothing is asked while the install runs');
    prompter.asked.length = 0;
    await runSignIns(ctx);
  });
  return { ctx, prompter, out, questions };
}

test('default path: the only stop at the end is Claude, with the exact words', async () => {
  const { ctx, prompter, out, questions } = await run();
  assert.deepEqual(questions, [], 'going ahead with the plan asks no question in these parts');
  assert.deepEqual(prompter.asked, [ENTER_CLAUDE]);
  assert.ok(out.includes(signInLines({ name: 'Claude' }, { only: true }).join('\n')));
  assert.match(out, /Almost done\. Last step: sign in to Claude\./);
  assert.match(out, /No account yet\? You can make one on the same page\./);
  assert.match(out, /would run: claude auth login/);
  assert.doesNotMatch(out, /would run: gh auth login|would run: ctx7 setup/);
  assert.deepEqual(laterLines(ctx.signIns), [
    'Later, when you want them:',
    '  • GitHub, to save your work online',
    '  • Context7, for fresh answers about code tools',
    'Run the setup again any time to sign in to these. It asks nothing else.',
  ]);
});

test('call 2 A: GitHub and Context7 wait by default, in every recommended answer', () => {
  for (const [m, key] of [[core, 'CORE_GH_LOGIN'], [agentClis, 'CTX7_SETUP']]) {
    const q = m.questions.find((x) => x.key === key);
    assert.equal(q.default, false, key);
    assert.ok(!q.alwaysAsk, key);
  }
});

test('customise: a sign-in picked there comes after Claude at the end, and s skips it', async () => {
  const { ctx, prompter, out } = await run({ acceptPlan: false, replies: ['', 's', ''] });
  // Asked under customise, answered yes by the stand-in, so both join Claude at the end.
  assert.deepEqual(prompter.asked, [ENTER_CLAUDE, ENTER_OTHER, ENTER_OTHER]);
  assert.match(out, /Almost done\. First, sign in to Claude\./);
  assert.match(out, /Sign in to GitHub, to save your work online\./);
  assert.doesNotMatch(out, /would run: gh auth login/);
  assert.match(out, /would run: ctx7 setup --claude --cli -y/);
  assert.deepEqual(laterLines(ctx.signIns).slice(1, -1), ['  • GitHub, to save your work online']);
});

test('saved answers win: a saved yes signs in to GitHub at the end without asking', async () => {
  const { ctx, questions } = await run({ answers: { CORE_GH_LOGIN: 'yes', CTX7_SETUP: 'no' }, acceptPlan: false });
  assert.ok(questions.length > 0, 'customise asks the other questions');
  assert.ok(!questions.includes('CORE_GH_LOGIN') && !questions.includes('CTX7_SETUP'));
  assert.deepEqual(ctx.signIns.map((s) => [s.name, s.wanted]), [['GitHub', true], ['Claude', true], ['Context7', false]]);
});

test('a re-run offers the sign-ins left for later', async () => {
  const { ctx, prompter } = await run({ answers: { CORE_GH_LOGIN: 'no', CTX7_SETUP: 'no' }, rerun: true });
  assert.deepEqual(ctx.signIns.filter((s) => s.wanted).map((s) => s.name), ['GitHub', 'Claude', 'Context7']);
  assert.deepEqual(prompter.asked, [ENTER_CLAUDE, ENTER_OTHER, ENTER_OTHER]);
  assert.deepEqual(laterLines(ctx.signIns), []);
});

test('--yes: no sign-in screen; every sign-in stays a to-do', () => {
  const r = spawnSync(
    process.execPath,
    ['lib/installer.mjs', '--dry-run', '--yes', '--modules', 'core,claude-code,agent-clis', '--answers', 'answers.example.env', '--platform', 'macos'],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' }, stdin: 'ignore' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Almost done|Later, when you want them/);
  assert.match(r.stdout, /claude-code: run `claude` once and sign in/);
  assert.match(r.stdout, /core: gh auth login/);
});

// The parts that need a key, picked under customise: a dry run at a terminal on simulated macOS.
async function runWithKeys({ interactive = true, secrets = [] } = {}) {
  const prompter = fakePrompter([], secrets);
  const answers = new Map(Object.entries({ MCP_SERVERS: 'context7', CLICKUP_DEFAULT_LIST: 'Inbox' }));
  const ctx = new Context({ platform: detectPlatform('macos'), dryRun: true, interactive, answers, prompter, repoRoot });
  ctx.acceptPlan = true;
  const parts = [mcpServers, clickup, openrouter];
  const recs = {};
  const { out } = await quietly(async () => {
    for (const m of parts) for (const q of m.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
    assert.deepEqual(prompter.asked, [], 'no key is asked among the questions');
    for (const m of parts) {
      recs[m.name] = ctx.beginModule(m.name);
      await m.install(ctx);
    }
    assert.deepEqual(prompter.asked, [], 'nothing is asked while the install runs');
    await runKeys(ctx);
  });
  return { ctx, prompter, out, recs };
}

test('keys wait for the last screen: a pasted one is used, an empty one becomes a to-do', async () => {
  const pasted = ['ctx7-test-value', 'cu-test-value', ''];
  const { ctx, prompter, out, recs } = await runWithKeys({ secrets: [...pasted] });
  assert.deepEqual(ctx.keys.map((k) => k.name), ['Context7', 'ClickUp', 'OpenRouter']);
  assert.deepEqual(prompter.asked, [
    '    Context7 key (on context7.com: Dashboard): ',
    '    ClickUp key (in ClickUp: Settings, Apps): ',
    '    OpenRouter key (on openrouter.ai: Keys): ',
  ]);
  assert.ok(out.includes(['  Almost done.', ...KEYS_HEAD].join('\n')));
  assert.match(out, /would run: claude mcp add --scope user --header "Authorization: Bearer \*\*\*" --transport http context7/);
  assert.match(out, /would run: clickup-axi auth login/);
  assert.match(out, /would run: clickup-axi config set default_list "Inbox"/);
  for (const v of pasted.filter(Boolean)) assert.ok(!out.includes(v), 'a key is never printed');
  assert.match(recs.openrouter.todos.join('\n'), /put your OpenRouter key in/);
  assert.deepEqual(recs.clickup.todos, []);
  assert.deepEqual(recs['mcp-servers'].todos, []);
});

test('keys left for later: Context7 is added without one, ClickUp and its list become to-dos', async () => {
  const { out, recs } = await runWithKeys();
  assert.match(out, /would run: claude mcp add --scope user --transport http context7/);
  assert.doesNotMatch(out, /clickup-axi auth login|default_list/);
  assert.match(recs.clickup.todos.join('\n'), /clickup-axi auth login .*then: clickup-axi config set default_list "Inbox"/);
});

test('--yes: no key screen; missing keys stay to-dos as before', async () => {
  const { ctx, prompter, out, recs } = await runWithKeys({ interactive: false });
  assert.deepEqual(ctx.keys, []);
  assert.deepEqual(prompter.asked, []);
  assert.doesNotMatch(out, /These need a key/);
  assert.match(out, /would run: claude mcp add --scope user --transport http context7/);
  assert.match(recs.clickup.todos.join('\n'), /clickup-axi auth login/);
  assert.match(recs.openrouter.todos.join('\n'), /put your OpenRouter key in/);
});
