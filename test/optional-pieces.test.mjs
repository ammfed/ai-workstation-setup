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
import { PATCH_MARKER, mergePixelSettings, patchPixelCli } from '../modules/agent-clis/pixel-agents.mjs';
import { PR_MERGE_RULES } from '../modules/claude-code/module.mjs';
import { findOpenWhisprAppImage, openGuardSeconds } from '../modules/extras/module.mjs';
import { dispatchProfiles, stowTokens } from '../modules/firstmate/module.mjs';
import skills from '../modules/skills/module.mjs';
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

test('the capable dispatch profile sends small clear tasks to Sonnet at xhigh', () => {
  const capable = dispatchProfiles('capable', 'claude');
  const small = capable.rules.find((r) => /small, well-defined task/.test(r.when));
  assert.deepEqual(small.use, [{ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'xhigh' }]);
  assert.deepEqual(capable.default, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' }]);
  assert.deepEqual(dispatchProfiles('capable', 'codex').rules[1].use, [{ harness: 'codex', effort: 'xhigh' }]);
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
    for (const name of ['grill-with-docs', 'to-spec', 'to-tickets']) assert.ok(choices.choices.some((c) => c.value === name && c.repo === 'mattpocock/skills'), name);
    assert.equal(skills.questions.find((q) => q.key === 'SKILLS_UPDATE').default, true);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
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
