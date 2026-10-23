// Tests for the optional pieces: the Pixel Agents settings and office-names patch, the
// office-names helper, the stow reminder, the merge permission, the link-open guard, the
// lavish-axi wrapper, skill updates, OpenWhispr AppImage detection, and the value checks
// behind their questions. Invented values and
// invented program text only; a temporary folder stands in for the home.
// Run: node --test test/optional-pieces.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context, Skip, detectPlatform } from '../lib/context.mjs';
import { installSkill, setHook, settingsPath } from '../lib/claude.mjs';
import { cswapThreshold, researchBrowserPort } from '../modules/agent-clis/module.mjs';
import { createHash } from 'node:crypto';
import { PATCH_MARKER, PRISTINE_SHA256, earlierOfficeNamesHelper, mergePixelSettings, patchPixelAgents, patchPixelCli, planPixelPatch } from '../modules/agent-clis/pixel-agents.mjs';
import { PR_MERGE_RULES, registerContextReminder, reminderTokens } from '../modules/claude-code/module.mjs';
import { findOpenWhisprAppImage, lavishUnits, openGuardSeconds } from '../modules/extras/module.mjs';
import firstmate, { isLinkedWorktree, stowTokens } from '../modules/firstmate/module.mjs';
import preferences from '../modules/preferences/module.mjs';
import { renderBriefInclude } from '../modules/preferences/render.mjs';
import skills, { writeBundledSkill } from '../modules/skills/module.mjs';
import { cursorBlinkMs } from '../modules/terminal/module.mjs';
import { officeNames } from '../templates/pixel-agents/bin/pixel-office-names.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unix = process.platform !== 'win32';

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'optional-pieces-'));
}

function context(home, { dryRun = false } = {}) {
  const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun, interactive: false, answers: new Map(), prompter: null, repoRoot });
  ctx.beginModule('test');
  return ctx;
}

// A stand-in for the three places pixel-agents 1.4.1 hands a folder name on.
const FAKE_CLI = [
  '#!/usr/bin/env node',
  '"use strict";',
  'const n={sessionId:"s-1",folderName:"repo-a"},S={sessionId:"s-2",folderName:"repo-b"},f={sessionId:"s-3",folderName:"repo-c"},d={},g="k";',
  'const a={folderName:n.folderName,teamName:n.teamName};',
  'S.folderName&&(d[g]=S.folderName);',
  'const c={type:"agentCreated",id:l,folderName:f.folderName,x:1};',
].join('\n');

test('the office-names patch applies to a known version, once, after the strict directive', () => {
  const out = patchPixelCli(FAKE_CLI, '1.4.1');
  assert.ok(out.startsWith('#!/usr/bin/env node\n"use strict";\n'));
  assert.ok(out.includes(PATCH_MARKER));
  assert.ok(out.includes('folderName:(__awsName(n.sessionId)||n.folderName)'));
  assert.ok(out.includes('folderName:(__awsName(f.sessionId)||f.folderName)'));
  assert.equal(patchPixelCli(out, '1.4.1'), out);
});

test('the office-names patch refuses an unknown version and unexpected program text', () => {
  assert.throws(() => patchPixelCli(FAKE_CLI, '9.9.9'), (e) => e instanceof Skip && /not a version/.test(e.message));
  assert.throws(() => patchPixelCli(FAKE_CLI.replace('S.folderName&&', 'S.label&&'), '1.4.1'), (e) => e instanceof Skip && /0 times/.test(e.message));
  const twice = `${FAKE_CLI}\nconst b={folderName:n.folderName,teamName:n.teamName};`;
  assert.throws(() => patchPixelCli(twice, '1.4.1'), (e) => e instanceof Skip && /2 times/.test(e.message));
});

test('patched code takes a name from the names file and falls back to the folder', { skip: !unix }, () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, '.pixel-agents'));
  fs.writeFileSync(path.join(home, '.pixel-agents', 'agent-names.json'), JSON.stringify({ 's-1': 'Planner', 's-3': 'Builder' }));
  const body = patchPixelCli(FAKE_CLI, '1.4.1').replace(/^#!.*\n/, '');
  const probe = `const l=1;${body.replace('"use strict";', '')}\nconsole.log(JSON.stringify([a.folderName,d.k,c.folderName]));`;
  const file = path.join(home, 'probe.js');
  fs.writeFileSync(file, probe);
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['Planner', 'repo-b', 'Builder']);
});

// What an earlier, different office-names patch leaves behind: its own lookup, and none of the
// three places the shipped patch looks for.
const HAND_PATCHED = FAKE_CLI.replace('folderName:n.folderName,', 'folderName:__other(n),')
  .replace('S.folderName&&(d[g]=S.folderName)', '__other(S)&&(d[g]=__other(S))')
  .replace('folderName:f.folderName,x', 'folderName:__other(f),x');
const hash = (text) => createHash('sha256').update(text).digest('hex');

test('a pristine file is patched as it is, and copies beside it are not needed', () => {
  const plan = planPixelPatch(FAKE_CLI, '1.4.1', [], hash(FAKE_CLI));
  assert.deepEqual(plan, { patched: patchPixelCli(FAKE_CLI, '1.4.1'), from: null });
  const done = planPixelPatch(plan.patched, '1.4.1', [], hash(FAKE_CLI));
  assert.equal(done.patched, plan.patched);
});

test('a file another patch changed is patched from the untouched copy beside it, proved by its hash', () => {
  const siblings = [
    { name: 'cli.js.bak-20260101', text: HAND_PATCHED },
    { name: 'cli.js.orig', text: FAKE_CLI },
  ];
  const plan = planPixelPatch(HAND_PATCHED, '1.4.1', siblings, hash(FAKE_CLI));
  assert.equal(plan.from, 'cli.js.orig');
  assert.equal(plan.patched, patchPixelCli(FAKE_CLI, '1.4.1'));
  assert.ok(!plan.patched.includes('__other'));
});

test('a file another patch changed, with no untouched copy, is refused with the way out', () => {
  const edited = [{ name: 'cli.js.orig', text: `${FAKE_CLI}\n// edited` }];
  for (const siblings of [[], edited]) {
    assert.throws(
      () => planPixelPatch(HAND_PATCHED, '1.4.1', siblings, hash(FAKE_CLI)),
      (e) => e instanceof Skip && /already changed by another patch/.test(e.message) && /npm install -g pixel-agents@1\.4\.1/.test(e.message) && !/anchor/.test(e.message),
    );
  }
  const older = HAND_PATCHED.replace('"use strict";', '"use strict";\n/* ai-workstation-setup: office names */');
  assert.throws(() => planPixelPatch(older, '1.4.1', [], hash(FAKE_CLI)), (e) => e instanceof Skip && /older version of this office-names patch/.test(e.message));
});

test('an unknown version is refused before anything else, even with an untouched copy beside it', () => {
  const siblings = [{ name: 'cli.js.orig', text: FAKE_CLI }];
  for (const source of [FAKE_CLI, HAND_PATCHED]) {
    assert.throws(() => planPixelPatch(source, '9.9.9', siblings, hash(FAKE_CLI)), (e) => e instanceof Skip && /not a version this patch was written for/.test(e.message));
  }
});

test('the installer step restores a hand-patched cli.js from its untouched copy and keeps a backup', { skip: !unix }, async () => {
  const home = tempHome();
  const root = path.join(home, 'npm-root');
  const dist = path.join(root, 'pixel-agents', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(root, 'pixel-agents', 'package.json'), JSON.stringify({ name: 'pixel-agents', version: '1.4.1' }));
  fs.writeFileSync(path.join(dist, 'cli.js'), HAND_PATCHED);
  fs.writeFileSync(path.join(dist, 'cli.js.orig'), FAKE_CLI);
  const ctx = context(home);
  ctx.capture = (cmd) => (cmd === 'npm root -g' ? root : null);
  const saved = PRISTINE_SHA256['1.4.1'];
  PRISTINE_SHA256['1.4.1'] = hash(FAKE_CLI);
  try {
    await patchPixelAgents(ctx);
    assert.equal(fs.readFileSync(path.join(dist, 'cli.js'), 'utf8'), patchPixelCli(FAKE_CLI, '1.4.1'));
    const backups = fs.readdirSync(dist).filter((n) => n.startsWith('cli.js.bak-'));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(dist, backups[0]), 'utf8'), HAND_PATCHED);
    assert.equal(fs.readFileSync(path.join(dist, 'cli.js.orig'), 'utf8'), FAKE_CLI);
    await patchPixelAgents(ctx);
    assert.equal(fs.readdirSync(dist).filter((n) => n.startsWith('cli.js.bak-')).length, 1);
  } finally {
    PRISTINE_SHA256['1.4.1'] = saved;
  }
});

// A stand-in for herdr 0.9: `herdr <noun> list` prints { id, result: { type, <nouns>: [...] } },
// and an agent has no name of its own (`agent` is its kind).
const HERDR_09 = {
  agent: { id: 'r1', result: { type: 'agent_list', agents: [
    { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 's-1' }, agent_status: 'idle', pane_id: 'p1', tab_id: 't1', workspace_id: 'w1' },
    { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 's-2' }, agent_status: 'working', pane_id: 'p2', tab_id: 't2', workspace_id: 'w1' },
    { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 's-3' }, agent_status: 'idle', pane_id: 'p3', tab_id: 't3', workspace_id: 'w2' },
    { agent: 'claude', agent_status: 'idle', pane_id: 'p4', tab_id: 't3', workspace_id: 'w2' },
  ] } },
  tab: { id: 'r2', result: { type: 'tab_list', tabs: [
    { tab_id: 't1', label: 'xy-planner', number: 1, workspace_id: 'w1' },
    { tab_id: 't2', label: 'Docs site', number: 2, workspace_id: 'w1' },
    { tab_id: 't3', label: '1', number: 1, workspace_id: 'w2' },
  ] } },
  workspace: { id: 'r3', result: { type: 'workspace_list', workspaces: [
    { workspace_id: 'w1', label: 'Alpha', number: 1 },
    { workspace_id: 'w2', label: 'Beta', number: 2 },
  ] } },
};
const HERDR_09_NAMES = { 's-1': 'planner', 's-2': 'Docs site', 's-3': 'Beta' };

test('office names with herdr 0.9 output, where an agent has no name, come from tab then workspace labels', () => {
  const r = (noun, key) => HERDR_09[noun].result[key];
  assert.deepEqual(officeNames(r('agent', 'agents'), r('tab', 'tabs'), r('workspace', 'workspaces'), 'xy-'), HERDR_09_NAMES);
});

// Installs the shipped helper (prefix xy-) and a fake herdr 0.9 into a temporary home.
function helperHome() {
  const home = tempHome();
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const helper = context(home).template('pixel-agents/bin/pixel-office-names.mjs', { TAB_PREFIX: 'xy-' });
  fs.writeFileSync(path.join(bin, 'pixel-office-names'), helper, { mode: 0o755 });
  const fake = path.join(home, 'fake-bin');
  fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'herdr.json'), JSON.stringify(HERDR_09));
  fs.writeFileSync(
    path.join(fake, 'herdr'),
    `#!${process.execPath}\nconst all=require(${JSON.stringify(path.join(fake, 'herdr.json'))});\nprocess.stdout.write(JSON.stringify(all[process.argv[2]]));\n`,
    { mode: 0o755 },
  );
  const env = { ...process.env, HOME: home, PATH: `${fake}${path.delimiter}${process.env.PATH}` };
  return { home, helper: path.join(bin, 'pixel-office-names'), env };
}

test('pixel-office-names --print reads herdr 0.9 and prints the names without writing a file', { skip: !unix }, () => {
  const { home, helper, env } = helperHome();
  const r = spawnSync(process.execPath, [helper, '--print'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), HERDR_09_NAMES);
  assert.equal(fs.existsSync(path.join(home, '.pixel-agents')), false);
});

test('patched code asks the helper for names, with no names file and nothing running', { skip: !unix }, () => {
  const { home, env } = helperHome();
  const body = patchPixelCli(FAKE_CLI, '1.4.1').replace(/^#!.*\n/, '');
  const file = path.join(home, 'probe.js');
  fs.writeFileSync(file, `const l=1;${body.replace('"use strict";', '')}\nconsole.log(JSON.stringify([a.folderName,d.k,c.folderName]));`);
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['planner', 'Docs site', 'Beta']);
});

test('only an earlier office-names helper is taken for one the installer may replace', () => {
  const home = tempHome();
  const file = path.join(home, 'pixel-office-names');
  const shipped = '#!/usr/bin/env node\n// writes .pixel-agents/agent-names.json; --print prints it\n';
  assert.equal(earlierOfficeNamesHelper(file, shipped), false);
  fs.writeFileSync(file, '#!/bin/bash\n# writes ~/.pixel-agents/agent-names.json from herdr\n');
  assert.equal(earlierOfficeNamesHelper(file, shipped), true);
  fs.writeFileSync(file, shipped);
  assert.equal(earlierOfficeNamesHelper(file, shipped), false);
  fs.writeFileSync(file, '#!/bin/bash\n# my own tool that shares the name\n');
  assert.equal(earlierOfficeNamesHelper(file, shipped), false);
  fs.writeFileSync(file, '#!/bin/bash\n# agent-names.json, and answers --print too\n');
  assert.equal(earlierOfficeNamesHelper(file, shipped), false);
});

test('Pixel Agents settings fill in what is missing and keep what you set', () => {
  const config = mergePixelSettings({ standalone: { soundEnabled: true }, vscode: { showAreas: false } });
  assert.deepEqual(config.standalone, { alwaysShowLabels: true, watchAllSessions: true, showAreas: true, soundEnabled: true });
  assert.deepEqual(config.vscode, { showAreas: false });
});

test('office names come from the agent name, then the tab label without its prefix, then the workspace', () => {
  const agents = [
    { agent_session: { value: 'a' }, name: 'reviewer', tab_id: 't1', workspace_id: 'w1' },
    { agent_session: { value: 'b' }, tab_id: 't2', workspace_id: 'w1' },
    { agent_session: { value: 'c' }, tab_id: 't3', workspace_id: 'w2' },
    { agent_session: { value: 'd' }, tab_id: 't3', workspace_id: 'w3' },
    { tab_id: 't2', workspace_id: 'w1' },
  ];
  const tabs = [
    { tab_id: 't1', label: 'xy-ignored' },
    { tab_id: 't2', label: 'xy-sample-task' },
    { tab_id: 't3', label: '2' },
  ];
  const workspaces = [
    { workspace_id: 'w1', label: 'Alpha' },
    { workspace_id: 'w2', label: 'Beta' },
  ];
  assert.deepEqual(officeNames(agents, tabs, workspaces, 'xy-'), { a: 'reviewer', b: 'sample-task', c: 'Beta' });
  assert.equal(officeNames(agents, tabs, workspaces, '').b, 'xy-sample-task');
});

test('a stow reminder hook lands only in the settings file it is given', () => {
  const home = tempHome();
  const ctx = context(home);
  const local = path.join(home, 'fleet', '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, JSON.stringify({ env: { SAMPLE: '1' } }));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    setHook(ctx, 'UserPromptSubmit', 'context-reminder.mjs', 'node "context-reminder.mjs" 200000 "Run /stow now"', local);
    setHook(ctx, 'UserPromptSubmit', 'context-reminder.mjs', 'node "context-reminder.mjs" 300000 "Run /stow now"', local);
    const s = JSON.parse(fs.readFileSync(local, 'utf8'));
    assert.equal(s.env.SAMPLE, '1');
    assert.deepEqual(s.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: 'node "context-reminder.mjs" 300000 "Run /stow now"' }] }]);
    assert.equal(fs.existsSync(settingsPath(ctx)), false);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

// Runs the shipped context-reminder hook once, as Claude Code would, for a session whose
// latest turn used `tokens` of context and that started in `project`. Returns the reply's
// hookSpecificOutput, or null when the hook stays quiet.
function reminderReply(home, project, tokens, args, { event = 'UserPromptSubmit', session = `s${tokens}` } = {}) {
  const transcript = path.join(home, `${tokens}.jsonl`);
  const turn = { type: 'assistant', message: { usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
  fs.writeFileSync(transcript, `${JSON.stringify(turn)}\n`);
  const input = { hook_event_name: event, session_id: session, transcript_path: transcript, cwd: project };
  const script = path.join(repoRoot, 'templates', 'claude-code', 'bin', 'context-reminder.mjs');
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), TMPDIR: home, TMP: home, TEMP: home };
  const r = spawnSync(process.execPath, [script, ...args], { input: JSON.stringify(input), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

function runReminder(home, project, tokens, args, opts) {
  return reminderReply(home, project, tokens, args, opts)?.additionalContext || '';
}

function writeSettings(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

test('an auto save point sits at seven eighths of the auto-compact window that applies', () => {
  const home = tempHome();
  writeSettings(path.join(home, '.claude', 'settings.json'), { autoCompactWindow: 400000 });
  const plain = path.join(home, 'work');
  const coordinator = path.join(home, 'coordinator');
  fs.mkdirSync(path.join(plain, 'sub'), { recursive: true });
  writeSettings(path.join(coordinator, '.claude', 'settings.local.json'), { autoCompactWindow: 200000 });

  assert.equal(runReminder(home, plain, 340000, ['auto']), '');
  assert.match(runReminder(home, path.join(plain, 'sub'), 360000, ['auto']), /save what matters/);
  assert.equal(runReminder(home, coordinator, 170000, ['auto', 'Run /stow now']), '');
  assert.match(runReminder(home, coordinator, 180000, ['auto', 'Run /stow now']), /^Run \/stow now/);
});

test('an auto save point without any auto-compact window falls back to 150000 tokens', () => {
  const home = tempHome();
  assert.equal(runReminder(home, home, 140000, ['auto']), '');
  assert.match(runReminder(home, home, 160000, ['auto']), /save what matters/);
});

test("the default reminder yields to a project's own reminder", () => {
  const home = tempHome();
  const coordinator = path.join(home, 'coordinator');
  const command = 'node "context-reminder.mjs" auto "Run /stow now"';
  writeSettings(path.join(coordinator, '.claude', 'settings.local.json'), { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] } });
  assert.equal(runReminder(home, coordinator, 500000, ['auto']), '');
  assert.match(runReminder(home, coordinator, 500001, ['auto', 'Run /stow now']), /Run \/stow now/);
});

test("the user-level reminder yields to a project's own reminder even with custom text", () => {
  const home = tempHome();
  const coordinator = path.join(home, 'coordinator');
  const plain = path.join(home, 'plain');
  fs.mkdirSync(plain, { recursive: true });
  const command = 'node "context-reminder.mjs" auto "Run /stow now"';
  writeSettings(path.join(coordinator, '.claude', 'settings.local.json'), { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] } });
  const user = ['auto', '--user', 'Save your notes now'];
  assert.equal(runReminder(home, coordinator, 500000, user), '');
  assert.match(runReminder(home, coordinator, 500001, ['auto', 'Run /stow now']), /Run \/stow now/);
  assert.match(runReminder(home, plain, 500002, user), /^Save your notes now/);
});

test('the reminder answers for the event it was called for', () => {
  const home = tempHome();
  for (const event of ['UserPromptSubmit', 'PostToolUse']) {
    const reply = reminderReply(home, home, 160000, ['150000'], { event, session: `s-${event}` });
    assert.equal(reply.hookEventName, event);
    assert.match(reply.additionalContext, /save what matters/);
  }
});

test('a long run of tool calls gets one reminder per crossing', () => {
  const home = tempHome();
  const run = (tokens, event = 'PostToolUse') => runReminder(home, home, tokens, ['150000'], { event, session: 'long-run' });
  assert.equal(run(140000), '');
  assert.match(run(151000), /save what matters/);
  for (const tokens of [152000, 160000, 170000]) assert.equal(run(tokens), '');
  assert.equal(run(175000, 'UserPromptSubmit'), '');
  assert.equal(run(120000), ''); // compacted: below 90% re-arms it
  assert.match(run(155000), /save what matters/);
});

test('the context reminder is registered on prompts and on tool calls, once each', () => {
  const home = tempHome();
  const ctx = context(home);
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    writeSettings(settingsPath(ctx), { env: { SAMPLE: '1' } });
    const command = 'node "context-reminder.mjs" auto --user';
    registerContextReminder(ctx, command, true);
    registerContextReminder(ctx, command, true);
    const s = JSON.parse(fs.readFileSync(settingsPath(ctx), 'utf8'));
    const entry = [{ hooks: [{ type: 'command', command }] }];
    assert.deepEqual(s.hooks, { UserPromptSubmit: entry, PostToolUse: entry, SessionStart: entry });
    assert.equal(s.env.SAMPLE, '1');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test('reminder thresholds are auto or a whole number of tokens', () => {
  assert.equal(reminderTokens('auto', 'CLAUDE_CONTEXT_REMINDER_TOKENS'), 'auto');
  assert.equal(reminderTokens(' 150000 ', 'CLAUDE_CONTEXT_REMINDER_TOKENS'), 150000);
  assert.throws(() => reminderTokens('35%', 'CLAUDE_CONTEXT_REMINDER_TOKENS'), /CLAUDE_CONTEXT_REMINDER_TOKENS/);
  assert.throws(() => reminderTokens('1000', 'CLAUDE_CONTEXT_REMINDER_TOKENS'), /50000/);
});

test('the merge permission is a pair of gh and gh-axi allow rules', () => {
  assert.deepEqual(PR_MERGE_RULES, ['Bash(gh pr merge:*)', 'Bash(gh-axi pr merge:*)']);
});

test('writeFile replace keeps a backup and writes without asking', async () => {
  const home = tempHome();
  const file = path.join(home, 'tool.js');
  fs.writeFileSync(file, 'old');
  const ctx = context(home);
  assert.equal(await ctx.writeFile(file, 'new', { onConflict: 'replace' }), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.readdirSync(home).filter((f) => f.startsWith('tool.js.bak-')).length, 1);
  assert.equal(await context(home, { dryRun: true }).writeFile(file, 'newer', { onConflict: 'replace' }), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});

test('question values are checked', () => {
  assert.equal(stowTokens('350000'), 350000);
  assert.equal(stowTokens('auto'), 'auto');
  assert.throws(() => stowTokens('35%'), /FIRSTMATE_STOW_REMINDER_TOKENS/);
  assert.throws(() => stowTokens('1000'), /50000/);
  assert.equal(cswapThreshold(''), null);
  assert.equal(cswapThreshold('85'), 85);
  assert.throws(() => cswapThreshold('20'), /CSWAP_AUTO_THRESHOLD/);
  assert.equal(researchBrowserPort('9444'), 9444);
  assert.throws(() => researchBrowserPort('80'), /RESEARCH_BROWSER_PORT/);
  assert.equal(openGuardSeconds('7'), 7);
  assert.throws(() => openGuardSeconds('0'), /OPEN_GUARD_SECONDS/);
  assert.equal(cursorBlinkMs('0'), 0);
  assert.throws(() => cursorBlinkMs('fast'), /TERMINAL_CURSOR_BLINK_MS/);
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

// A home with grilling installed by the skills CLI (in its lock file) and teach copied in by hand.
function skillsHome() {
  const home = tempHome();
  for (const name of ['grilling', 'teach']) {
    fs.mkdirSync(path.join(home, '.claude', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
  fs.mkdirSync(path.join(home, '.agents'));
  fs.writeFileSync(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ version: 3, skills: { grilling: { source: 'example/skills' } } }));
  return home;
}

test('an installed skill is kept, or updated through the skills CLI, or added again when the CLI does not track it', async () => {
  const home = skillsHome();
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const ctx = context(home, { dryRun: true });
    const kept = await capture(() => installSkill(ctx, 'example/skills', 'grilling'));
    assert.match(kept, /skill grilling already installed/);
    assert.doesNotMatch(kept, /would run/);
    const update = { update: true };
    assert.match(await capture(() => installSkill(ctx, 'example/skills', 'grilling', update)), /would run: npx -y skills update grilling -g -y/);
    assert.match(await capture(() => installSkill(ctx, 'example/skills', 'teach', update)), /would run: npx -y skills add example\/skills --skill teach -g -a claude-code -y/);
    assert.match(await capture(() => installSkill(ctx, 'example/skills', 'tdd', update)), /would run: npx -y skills add example\/skills --skill tdd -g -a claude-code -y/);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test('the skill update question is asked only when a chosen skill is installed, and defaults to yes', async () => {
  const home = skillsHome();
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const ask = (chosen) => {
      const ctx = context(home, { dryRun: true });
      ctx.values.SKILLS = chosen;
      return skills.questions.find((q) => q.key === 'SKILLS_UPDATE').when(ctx);
    };
    assert.equal(ask(['tdd', 'codebase-design']), false);
    assert.equal(ask(['teach', 'tdd']), true);
    const choices = skills.questions.find((q) => q.key === 'SKILLS');
    for (const name of ['tdd', 'codebase-design']) assert.ok(choices.default.includes(name), name);
    for (const name of ['grilling', 'to-spec', 'to-tickets']) assert.ok(choices.choices.some((c) => c.value === name && c.repo === 'mattpocock/skills'), name);
    assert.equal(skills.questions.find((q) => q.key === 'SKILLS_UPDATE').default, true);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test('the workflow-playbook skill is written to ~/.claude/skills with valid SKILL.md frontmatter, and a local edit is kept', async () => {
  const home = tempHome();
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const choice = skills.questions.find((q) => q.key === 'SKILLS').choices.find((c) => c.value === 'workflow-playbook');
    assert.ok(choice?.install, 'workflow-playbook is a skills choice installed from this repo');
    await capture(() => choice.install(context(home)));
    const file = path.join(home, '.claude', 'skills', 'workflow-playbook', 'SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text, fs.readFileSync(path.join(repoRoot, 'templates', 'skills', 'workflow-playbook', 'SKILL.md'), 'utf8'));
    const front = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(front, 'SKILL.md opens with a frontmatter block');
    const fields = Object.fromEntries(front[1].split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
    assert.equal(fields.name, 'workflow-playbook');
    assert.ok(fields.description?.length > 20, 'it has a description');
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(text), 'no placeholder is left unfilled');
    const checks = path.join(home, '.claude', 'skills', 'workflow-playbook', 'principles', 'checks.md');
    assert.equal(fs.readFileSync(checks, 'utf8'), fs.readFileSync(path.join(repoRoot, 'templates', 'principles', 'checks.md'), 'utf8'), 'the principle check list sits in the playbook folder');
    const checker = path.join(home, '.claude', 'skills', 'workflow-playbook', 'principles', 'bin', 'principle-check.mjs');
    assert.equal(fs.readFileSync(checker, 'utf8'), fs.readFileSync(path.join(repoRoot, 'templates', 'principles', 'bin', 'principle-check.mjs'), 'utf8'), 'the checker sits beside the list');
    fs.writeFileSync(path.join(home, 'good.html'), '<!doctype html><style>body{line-height:1.6}</style><button>Send report</button>');
    fs.writeFileSync(path.join(home, 'bad.html'), '<!doctype html><style>body{line-height:1.6}</style><button><svg></svg></button>');
    assert.equal(spawnSync(process.execPath, [checker, path.join(home, 'good.html')]).status, 0, 'the installed checker passes a good page');
    assert.equal(spawnSync(process.execPath, [checker, path.join(home, 'bad.html')]).status, 1, 'and fails a page with an icon-only button');
    const second = await capture(() => choice.install(context(home)));
    assert.match(second, /checks\.md is already up to date/);
    assert.match(second, /principle-check\.mjs is already up to date/);
    fs.writeFileSync(file, `${text}\nA local rule.\n`);
    assert.match(await capture(() => writeBundledSkill(context(home), 'workflow-playbook')), /local edit/);
    assert.match(fs.readFileSync(file, 'utf8'), /A local rule\./);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test('the playbook sets the review stakes once per project at capture: full run for public or stakeholder work, self-review for private and throwaway work', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'templates', 'skills', 'workflow-playbook', 'SKILL.md'), 'utf8');
  const capture = text.split('\n').find((l) => l.startsWith('| 1. Capture |'));
  assert.match(capture, /review stakes once \(rule 2\.8\)/, 'the capture phase points at the stakes rule');
  const rule = text.slice(text.indexOf('8. **Set the review stakes once per project, at capture.**'), text.indexOf('## 3. Evidence and research'));
  assert.ok(rule.length > 100, 'rule 2.8 is in section 2');
  assert.match(rule, /\*\*Full review run:\*\* a public repository, or anything stakeholders/);
  assert.match(rule, /\*\*Self-review:\*\* private notes and throwaway prototypes/);
  assert.match(rule, /When unsure, pick the full run/);
  assert.match(rule, /an agent never lowers them on its own/);
});

test('the playbook names every skill the installer offers, once: as a phase owner or in its table of skills that own no phase', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'templates', 'skills', 'workflow-playbook', 'SKILL.md'), 'utf8');
  const section = text.slice(text.indexOf('## Phases'), text.indexOf('## 1. Stage gates'));
  const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
  const owners = section.split('\n').filter((l) => /^\| \d+\. /.test(l)).map((l) => cells(l)[4]).join(' ');
  const rest = section.slice(section.indexOf('**Skills that own no phase.**'));
  assert.ok(rest.length > 0 && section.includes('**Skills that own no phase.**'), 'the phases section has a table of skills that own no phase');
  const table = rest.slice(rest.indexOf('\n| Skill |'), rest.indexOf('\n\n', rest.indexOf('\n| Skill |')));
  const noPhase = table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Skill |') && !l.startsWith('| ---')).map((l) => cells(l)[0]);
  const named = (name, where) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`).test(where);
  const offered = skills.questions.find((q) => q.key === 'SKILLS').choices.flatMap((c) => [c.value, ...(c.helpers ?? [])]).filter((n) => n !== 'workflow-playbook');
  for (const name of offered) {
    assert.ok(named(name, owners) !== noPhase.includes(name), `${name} is named exactly once: as a phase owner or as a skill that owns no phase`);
  }
  for (const name of noPhase) assert.ok(offered.includes(name), `${name} in the playbook is a skill the installer offers`);
});

test('an OpenWhispr AppImage in ~/.local/opt or ~/Applications is found', () => {
  const home = tempHome();
  assert.equal(findOpenWhisprAppImage(home), null);
  fs.mkdirSync(path.join(home, 'Applications'));
  fs.writeFileSync(path.join(home, 'Applications', 'notes.AppImage'), '');
  assert.equal(findOpenWhisprAppImage(home), null);
  fs.writeFileSync(path.join(home, 'Applications', 'open-whispr-1.0.0-x86_64.AppImage'), '');
  assert.equal(findOpenWhisprAppImage(home), path.join(home, 'Applications', 'open-whispr-1.0.0-x86_64.AppImage'));
  fs.mkdirSync(path.join(home, '.local', 'opt'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local', 'opt', 'OpenWhispr.AppImage'), '');
  assert.equal(findOpenWhisprAppImage(home), path.join(home, '.local', 'opt', 'OpenWhispr.AppImage'));
});

function fakeTool(dir, name, line) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${line} $*"\n`, { mode: 0o755 });
}

test('the link-open guard drops a repeat of the same link and passes others on', { skip: !unix }, () => {
  const home = tempHome();
  const bin = path.join(home, 'bin');
  fakeTool(path.join(home, 'real'), 'xdg-open', 'REAL');
  fs.mkdirSync(bin);
  const guard = fs.readFileSync(path.join(repoRoot, 'templates', 'desktop', 'xdg-open.sh'), 'utf8').replace(/\{\{WINDOW_SECONDS\}\}/g, '30');
  fs.writeFileSync(path.join(bin, 'xdg-open'), guard, { mode: 0o755 });
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: '', XDG_CACHE_HOME: '', PATH: `${bin}:${path.join(home, 'real')}:/usr/bin:/bin` };
  const open = (url) => spawnSync('xdg-open', [url], { encoding: 'utf8', env }).stdout.trim();
  assert.equal(open('https://example.com/one'), 'REAL https://example.com/one');
  assert.equal(open('https://example.com/one'), '');
  assert.equal(open('https://example.com/two'), 'REAL https://example.com/two');
  assert.match(fs.readFileSync(path.join(home, '.local', 'state', 'xdg-open-guard.log'), 'utf8'), /skipped a repeat of https:\/\/example.com\/one/);
});

test('the lavish-axi wrapper sets no-open and runs the next lavish-axi on PATH', { skip: !unix }, () => {
  const home = tempHome();
  const bin = path.join(home, 'bin');
  const real = path.join(home, 'real');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'lavish-axi'), '#!/bin/sh\necho "real no_open=$LAVISH_AXI_NO_OPEN $*"\n', { mode: 0o755 });
  fs.mkdirSync(bin);
  fs.copyFileSync(path.join(repoRoot, 'templates', 'lavish', 'lavish-axi.sh'), path.join(bin, 'lavish-axi'));
  fs.chmodSync(path.join(bin, 'lavish-axi'), 0o755);
  const env = { ...process.env, LAVISH_AXI_NO_OPEN: '', NVM_BIN: '', PATH: `${bin}:${real}:/usr/bin:/bin` };
  const r = spawnSync('lavish-axi', ['page.html'], { encoding: 'utf8', env });
  assert.equal(r.stdout.trim(), 'real no_open=1 page.html');
  const alone = spawnSync(path.join(bin, 'lavish-axi'), [], { encoding: 'utf8', env: { ...env, PATH: `${bin}:/usr/bin:/bin` } });
  assert.equal(alone.status, 127);
});

test('a file this run created is not backed up when the same run changes it again', async () => {
  const home = tempHome();
  const file = path.join(home, 'settings.json');
  const ctx = context(home);
  ctx.updateJson(file, (s) => (s.a = 1));
  ctx.updateJson(file, (s) => (s.b = 2));
  await ctx.writeFile(path.join(home, 'note.txt'), 'one');
  await ctx.writeFile(path.join(home, 'note.txt'), 'two', { onConflict: 'replace' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1, b: 2 });
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.includes('.bak-')), []);
  // A file that was there before the run is still backed up, once.
  const next = context(home);
  next.updateJson(file, (s) => (s.c = 3));
  assert.equal(fs.readdirSync(home).filter((f) => f.startsWith('settings.json.bak-')).length, 1);
});

test('addUserPath adds a folder to PATH in the shell profile once, and skips one already on PATH', { skip: !unix }, async () => {
  const home = tempHome();
  const ctx = new Context({ platform: { ...detectPlatform(), os: 'linux', shell: 'bash', home }, dryRun: false, interactive: false, answers: new Map(), prompter: null, repoRoot });
  ctx.beginModule('test');
  await ctx.addUserPath(path.join(home, '.local', 'bin'));
  await ctx.addUserPath(path.join(home, '.local', 'bin'));
  const rc = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
  assert.equal(rc.split('\n').filter((l) => l.includes('.local/bin')).length, 1);
  assert.match(rc, /case ":\$PATH:" in \*":\$HOME\/\.local\/bin:"\*\) ;; \*\) export PATH="\$HOME\/\.local\/bin:\$PATH" ;; esac/);
  const first = process.env.PATH.split(path.delimiter)[0];
  await ctx.addUserPath(first);
  assert.doesNotMatch(fs.readFileSync(path.join(home, '.bashrc'), 'utf8'), new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a question with useDefault takes its default without asking', async () => {
  const asked = [];
  const prompter = { ask: async (q) => (asked.push(q.key), 'typed') };
  const ctx = new Context({ platform: { ...detectPlatform(), home: tempHome() }, dryRun: true, interactive: true, answers: new Map([['SAVED', 'kept']]), prompter, repoRoot });
  assert.equal(await ctx.ask({ key: 'QUIET', type: 'text', default: 'recommended', useDefault: () => true }), 'recommended');
  assert.equal(await ctx.ask({ key: 'SAVED', type: 'text', default: 'recommended', useDefault: () => true }), 'kept');
  assert.equal(await ctx.ask({ key: 'LOUD', type: 'text', default: 'recommended', useDefault: () => false }), 'typed');
  assert.deepEqual(asked, ['LOUD']);
});

test('preferences ask where to write, whether to go through each one and whether to prepare the next stage only when you choose; the rest take the recommended answer unless you do', () => {
  const qs = preferences.questions;
  assert.deepEqual(qs.slice(0, 3).map((q) => q.key), ['PREFS_TARGETS', 'PREFS_REVIEW_EACH', 'PREFS_PAGE_PREPARE_NEXT']);
  assert.equal(qs[1].default, false);
  assert.equal(qs[2].useDefault, undefined, 'preparing the next stage is asked when you choose for yourself');
  assert.equal(qs[2].default, false, 'a review page waits for your answer');
  assert.ok(!qs.some((q) => q.alwaysAsk), 'going ahead with the plan asks no preference');
  const ctx = { get: (k) => ({ PREFS_REVIEW_EACH: false })[k] };
  for (const q of qs.slice(3)) assert.equal(q.useDefault?.(ctx), true, q.key);
  const each = { get: (k) => ({ PREFS_REVIEW_EACH: true })[k] };
  for (const q of qs.slice(3)) assert.equal(q.useDefault(each), false, q.key);
});

test('the Firstmate brief include carries the house style to workers only when it is chosen', () => {
  assert.equal(renderBriefInclude((k) => ({ PREFS_WRITING_STYLE: 'plain' })[k]), '');
  const text = renderBriefInclude((k) => ({ PREFS_WRITING_STYLE: 'ste' })[k]);
  assert.match(text, /^## Writing style/);
  assert.match(text, /status lines, reports, questions and notes for firstmate/);
  assert.match(text, /ASD-STE100/);
  assert.doesNotMatch(text, /Delivery contract: mode=/);
});

test('the vision skill comes from its own upstream repository', () => {
  const q = skills.questions.find((x) => x.key === 'SKILLS');
  const vision = q.choices.find((c) => c.value === 'vision');
  assert.equal(vision?.repo, 'kunchenguid/vision');
});

test('the default skill set is every skill on offer, so a fresh clone gets the full set', () => {
  const q = skills.questions.find((x) => x.key === 'SKILLS');
  assert.deepEqual([...q.default].sort(), q.choices.map((c) => c.value).sort());
  const full = ['kun', 'vision', 'grilling', 'teach', 'tdd', 'codebase-design', 'to-spec', 'to-tickets', 'to-questionnaire', 'wayfinder', 'find-docs', 'no-mistakes', 'workflow-playbook', 'composio-cli'];
  for (const name of full) assert.ok(q.default.includes(name), name);
  assert.deepEqual(q.choices.find((c) => c.value === 'wayfinder').helpers, ['domain-modeling', 'research', 'prototype']);
});

// Ask the skills questions the way a rerun does, from saved answers.
async function askSkills(saved) {
  const ctx = new Context({ platform: { ...detectPlatform(), home: tempHome() }, dryRun: true, interactive: false, answers: new Map(Object.entries(saved)), prompter: null, repoRoot });
  ctx.beginModule('skills');
  const out = await capture(async () => {
    for (const q of skills.questions.filter((x) => x.key !== 'SKILLS_UPDATE')) await ctx.ask(q);
  });
  return { skills: ctx.values.SKILLS, offered: ctx.values.SKILLS_OFFERED, out };
}

test('a rerun adds the skills that are new since the last answer, and keeps a skill you unticked off', async () => {
  const all = skills.questions.find((x) => x.key === 'SKILLS').choices.map((c) => c.value);
  const { skills: chosen, offered, out } = await askSkills({ SKILLS: 'kun,tdd', SKILLS_OFFERED: all.filter((v) => v !== 'wayfinder').join(',') });
  assert.deepEqual(chosen, ['kun', 'tdd', 'wayfinder']);
  assert.match(out, /new skills added to your selection: wayfinder/);
  assert.deepEqual(offered.split(','), all, 'the list on offer now is saved for the next rerun');
  const again = await askSkills({ SKILLS: 'kun,tdd', SKILLS_OFFERED: all.join(',') });
  assert.deepEqual(again.skills, ['kun', 'tdd'], 'nothing new, so the saved choice stands');
  assert.doesNotMatch(again.out, /new skills added/);
});

test('a rerun of an install older than the offered list gets the full default set, but "none" stays none', async () => {
  const all = skills.questions.find((x) => x.key === 'SKILLS').choices.map((c) => c.value);
  const { skills: chosen } = await askSkills({ SKILLS: 'kun,grilling,teach,tdd,codebase-design,find-docs' });
  assert.deepEqual([...chosen].sort(), [...all].sort());
  assert.deepEqual((await askSkills({ SKILLS: 'none' })).skills, []);
});

// A dry run of the skills module alone, in an empty home. A simulated OS (not the host's) sees no tools on PATH.
const simulatedOs = process.platform === 'linux' ? 'macos' : 'linux';
function skillsDryRun(answers = '', modules = 'skills') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-run-'));
  const file = path.join(dir, 'answers.env');
  fs.writeFileSync(file, answers);
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', simulatedOs, '--answers', file, '--modules', modules], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', HOME: dir, USERPROFILE: dir, CLAUDE_CONFIG_DIR: path.join(dir, '.claude') },
    stdin: 'ignore',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('a skill whose tool is missing is skipped with a clear line, and the run still exits 0', () => {
  const { code, out } = skillsDryRun();
  assert.equal(code, 0, out);
  assert.match(out, /skipped: composio-cli: the composio CLI is not installed \(install it, then rerun with --modules skills\)/);
  assert.match(out, /skipped: no-mistakes: the no-mistakes CLI is not installed \(install it, then rerun with --modules skills\)/);
  assert.doesNotMatch(out, /would run: composio setup/);
  assert.doesNotMatch(out, /--skill no-mistakes/);
});

test('a skill whose tool this run installs is not skipped', () => {
  const { code, out } = skillsDryRun('AGENT_CLIS=no-mistakes,composio\n', 'agent-clis,skills');
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /skipped: (no-mistakes|composio-cli):/);
  assert.match(out, /would run: npx -y skills add kunchenguid\/no-mistakes --skill no-mistakes/);
});

test('the end of the install lists the skills installed and skipped, then says to restart Claude Code', () => {
  const { code, out } = skillsDryRun();
  assert.equal(code, 0, out);
  const tail = out.slice(out.indexOf('\nSummary'));
  assert.match(tail, /would install: kun, vision, grilling, teach, tdd, codebase-design, to-spec, to-tickets, to-questionnaire, wayfinder, domain-modeling \(for wayfinder\), research \(for wayfinder\), prototype \(for wayfinder\), find-docs, workflow-playbook\n/);
  assert.match(tail, /skipped: no-mistakes: the no-mistakes CLI is not installed/);
  assert.match(tail, /skipped: composio-cli: the composio CLI is not installed/);
  assert.doesNotMatch(tail, /failed:/);
  assert.match(tail, /Restart Claude Code so the new skills load\.\n?$/);
});

test('a skill whose download fails is reported as failed, and the others still install', async () => {
  const home = tempHome();
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const ctx = context(home);
    ctx.values.SKILLS = ['kun', 'tdd'];
    ctx.values.SKILLS_UPDATE = false;
    ctx.run = (cmd) => {
      if (cmd.includes('--skill tdd')) throw new Error('command failed (exit 1)');
    };
    await capture(() => skills.install(ctx));
    assert.deepEqual(ctx.record.failures, ['tdd: command failed (exit 1)']);
    assert.ok(ctx.record.report.some((l) => /^installed: kun$/.test(l)), ctx.record.report.join('\n'));
    assert.ok(ctx.record.report.some((l) => /^failed: tdd: command failed \(exit 1\)$/.test(l)), ctx.record.report.join('\n'));
    assert.equal(ctx.record.report.at(-1), 'Restart Claude Code so the new skills load.');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

// ---- firstmate: FM_HOME is never pinned on the clone or exported from the shell startup file

const gitq = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};

// A temporary home with a firstmate clone, a separate operational home, and two second-mate
// homes in the registry: one standalone folder, one linked git worktree of the clone.
function firstmateFixture() {
  const home = tempHome();
  const dir = path.join(home, 'fm-clone');
  const ops = path.join(home, 'fm-ops');
  fs.mkdirSync(dir, { recursive: true });
  gitq(dir, 'init', '-q');
  gitq(dir, '-c', 'user.name=t', '-c', `user.email=${['t', 'example.invalid'].join('@')}`, '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'seed');
  const standalone = path.join(home, 'mate-standalone');
  const linked = path.join(home, 'mate-linked');
  fs.mkdirSync(standalone, { recursive: true });
  gitq(dir, 'worktree', 'add', '-q', '-b', 'mate', linked);
  for (const m of [standalone, linked]) fs.writeFileSync(path.join(m, '.fm-secondmate-home'), '');
  fs.mkdirSync(path.join(ops, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ops, 'data', 'secondmates.md'), [`- standalone (home: ${standalone}; role: a)`, `- linked (home: ${linked}; role: b)`, ''].join('\n'));
  return { home, dir, ops, standalone, linked };
}

async function runFirstmate(f) {
  const answers = {
    FIRSTMATE_DIR: f.dir,
    FIRSTMATE_HOME: f.ops,
    FIRSTMATE_PIN_HOME: 'yes',
    FIRSTMATE_DISPATCH: 'none',
    FIRSTMATE_STOW_REMINDER: 'no',
    FIRSTMATE_WATCH_UPDATES: 'no',
  };
  const ctx = new Context({
    platform: { ...detectPlatform(), os: 'linux', shell: 'bash', home: f.home },
    dryRun: false,
    interactive: false,
    answers: new Map(Object.entries(answers)),
    prompter: null,
    repoRoot,
  });
  ctx.beginModule('firstmate');
  ctx.ensureTool = async () => {};
  ctx.run = () => {};
  for (const q of firstmate.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
  await capture(() => firstmate.install(ctx));
  return ctx;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const settingsOf = (where) => path.join(where, '.claude', 'settings.local.json');

test('isLinkedWorktree tells a git worktree from a main checkout and a plain folder', { skip: !unix }, () => {
  const f = firstmateFixture();
  assert.equal(isLinkedWorktree(f.linked), true);
  assert.equal(isLinkedWorktree(f.dir), false);
  assert.equal(isLinkedWorktree(f.standalone), false);
});

test('a fresh firstmate run pins no FM_HOME on the clone or a worktree home, and exports none', { skip: !unix }, async () => {
  const f = firstmateFixture();
  const ctx = await runFirstmate(f);
  assert.deepEqual(ctx.record.failures, []);
  assert.equal(fs.existsSync(settingsOf(f.dir)), false);
  assert.equal(fs.existsSync(settingsOf(f.linked)), false);
  assert.equal(readJson(settingsOf(f.standalone)).env.FM_HOME, f.standalone);
  const rc = fs.readFileSync(path.join(f.home, '.bashrc'), 'utf8');
  assert.doesNotMatch(rc, /export FM_HOME/);
  assert.match(rc, new RegExp(`^: "\\$\\{FM_HOME:=${f.ops}\\}"  # ai-workstation-setup$`, 'm'));
  // A second run changes nothing.
  const before = fs.readFileSync(path.join(f.home, '.bashrc'), 'utf8');
  await runFirstmate(f);
  assert.equal(fs.readFileSync(path.join(f.home, '.bashrc'), 'utf8'), before);
});

test('the FM_HOME default never overrides an FM_HOME set earlier in the shell', { skip: !unix }, async () => {
  const f = firstmateFixture();
  await runFirstmate(f);
  const rc = path.join(f.home, '.bashrc');
  const run = (pre) => spawnSync('bash', ['-c', `${pre}\n. "${rc}"\nprintf %s "$FM_HOME"`], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: f.home } }).stdout;
  assert.equal(run(''), f.ops);
  assert.equal(run('export FM_HOME=/per/directory/home'), '/per/directory/home');
});

test('a re-run over an older install removes the clone pin and the rc export, and keeps everything else', { skip: !unix }, async () => {
  const f = firstmateFixture();
  fs.mkdirSync(path.join(f.dir, '.claude'), { recursive: true });
  fs.writeFileSync(settingsOf(f.dir), JSON.stringify({ env: { FM_HOME: f.ops, KEEP: '1' }, permissions: { allow: ['Bash(ls)'] } }));
  const rc = path.join(f.home, '.bashrc');
  fs.writeFileSync(rc, ['alias ll="ls -l"', `export FM_HOME="${f.ops}"  # ai-workstation-setup`, 'export OTHER=1  # ai-workstation-setup', 'export FM_HOME_NOTE=mine', ''].join('\n'));
  await runFirstmate(f);
  assert.deepEqual(readJson(settingsOf(f.dir)), { env: { KEEP: '1' }, permissions: { allow: ['Bash(ls)'] } });
  assert.ok(fs.readdirSync(path.join(f.dir, '.claude')).some((n) => n.startsWith('settings.local.json.bak-')));
  const text = fs.readFileSync(rc, 'utf8');
  assert.doesNotMatch(text, /^export FM_HOME=/m);
  assert.match(text, /alias ll="ls -l"/);
  assert.match(text, /export OTHER=1/);
  assert.match(text, /export FM_HOME_NOTE=mine/);
  assert.ok(fs.readdirSync(f.home).some((n) => n.startsWith('.bashrc.bak-')));

  // A pin that was the only setting leaves no empty env behind.
  fs.writeFileSync(settingsOf(f.dir), JSON.stringify({ env: { FM_HOME: f.ops } }));
  await runFirstmate(f);
  assert.deepEqual(readJson(settingsOf(f.dir)), {});
});

test('without an operational home the firstmate run removes an older export and adds none', { skip: !unix }, async () => {
  const f = firstmateFixture();
  const rc = path.join(f.home, '.bashrc');
  fs.writeFileSync(rc, `export FM_HOME="${f.dir}"  # ai-workstation-setup\nexport FM_HOME=/mine\n`);
  const ctx = new Context({
    platform: { ...detectPlatform(), os: 'linux', shell: 'bash', home: f.home },
    dryRun: false,
    interactive: false,
    answers: new Map(Object.entries({ FIRSTMATE_DIR: f.dir, FIRSTMATE_HOME: '', FIRSTMATE_DISPATCH: 'none', FIRSTMATE_STOW_REMINDER: 'no', FIRSTMATE_WATCH_UPDATES: 'no' })),
    prompter: null,
    repoRoot,
  });
  ctx.beginModule('firstmate');
  ctx.ensureTool = async () => {};
  ctx.run = () => {};
  for (const q of firstmate.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
  await capture(() => firstmate.install(ctx));
  assert.equal(fs.readFileSync(rc, 'utf8'), 'export FM_HOME=/mine\n');
});

const hasAnalyze = spawnSync('systemd-analyze', ['--version'], { stdio: 'ignore' }).status === 0;

test('the Lavish Library units write WorkingDirectory as a bare path that systemd accepts', { skip: !hasAnalyze && 'systemd-analyze is not available here' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-'));
  const app = path.join(dir, 'my apps', 'lavish-library');
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(app, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(app, 'scripts', 'local-api.mjs'), '');
  fs.writeFileSync(path.join(app, 'node_modules', '.bin', 'vinext'), '');
  const { api, ui } = lavishUnits(app, null);
  for (const unit of [api, ui]) assert.match(unit, new RegExp(`^WorkingDirectory=${app}$`, 'm'));
  const files = [path.join(dir, 'lavish-library-api.service'), path.join(dir, 'lavish-library.service')];
  fs.writeFileSync(files[0], api);
  fs.writeFileSync(files[1], ui);
  const r = spawnSync('systemd-analyze', ['--user', 'verify', ...files], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.doesNotMatch(r.stdout + r.stderr, /WorkingDirectory|not absolute|fatal/i, r.stdout + r.stderr);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
