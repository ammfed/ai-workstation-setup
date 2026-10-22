// Tests for scripts/apply-to-machine.sh: dry run, apply, a second run, undo, and what it must
// leave alone. A temporary folder stands in for the home, with invented settings.
// Run: node --test test/apply-to-machine.test.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { planSettings, reminderCommand } from '../scripts/apply-to-machine.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unix = process.platform !== 'win32';
const sampleHome = path.join(os.tmpdir(), 'sample-home');
const shipped = (rel) => fs.readFileSync(path.join(repoRoot, 'templates', rel), 'utf8');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-to-machine-'));
  const claude = path.join(home, '.claude');
  const hook = path.join(claude, 'hooks', 'context-reminder.mjs');
  const settings = path.join(claude, 'settings.json');
  const other = { matcher: 'Edit', hooks: [{ type: 'command', command: 'lint-check' }] };
  const before = {
    env: { SAMPLE: '1' },
    model: 'sonnet',
    statusLine: { type: 'command', command: 'my-status-line' },
    modelSettings: { 'sample-model': { effortLevel: 'low' } },
    enabledPlugins: { 'diagram-design@diagram-design': true },
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "${hook}" auto` }] }], PostToolUse: [other] },
  };
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify(before));
  // A copy the setup shipped earlier, as its record of shipped files says: refreshed without a question.
  const older = shipped('claude-code/bin/context-reminder.mjs').replace('Installed by', 'Shipped by');
  fs.writeFileSync(hook, older);
  const record = path.join(home, '.config', 'ai-workstation-setup', 'shipped.json');
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(record, JSON.stringify({ [hook]: [crypto.createHash('sha256').update(older).digest('hex')] }));
  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  const run = (...args) => spawnSync('bash', [path.join(repoRoot, 'scripts', 'apply-to-machine.sh'), ...args], { encoding: 'utf8', env, input: '' });
  const sets = () => {
    const root = path.join(home, '.config', 'ai-workstation-setup', 'apply-backups');
    return fs.existsSync(root) ? fs.readdirSync(root) : [];
  };
  return { home, claude, hook, settings, before, other, run, sets };
}

test('the reminder command keeps its threshold and text and gains --user', () => {
  assert.equal(reminderCommand('/h/r.mjs', 'node "/old/context-reminder.mjs" auto'), 'node "/h/r.mjs" auto --user');
  assert.equal(reminderCommand('/h/r.mjs', 'node "/old/context-reminder.mjs" 200000 --user "Save now."'), 'node "/h/r.mjs" 200000 --user "Save now."');
  assert.equal(reminderCommand('/h/r.mjs', undefined), 'node "/h/r.mjs" auto --user');
});

test('the settings plan adds hooks and missing keys and keeps everything else', () => {
  const home = sampleHome;
  const settings = { theme: 'dark', model: 'sonnet', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } }, statusLine: { command: 'mine' } };
  const { data, changes } = planSettings(settings, { home, statusLine: 'keep', gitClone: false });
  assert.equal(data.theme, 'dark');
  assert.equal(data.model, 'sonnet');
  assert.equal(data.effortLevel, 'medium');
  assert.ok(changes.includes('set the default effort to medium'));
  assert.deepEqual(data.modelSettings, settings.modelSettings);
  assert.deepEqual(data.statusLine, { command: 'mine' });
  assert.deepEqual(Object.keys(data.hooks), ['UserPromptSubmit', 'PostToolUse', 'SessionStart']);
  assert.equal(changes.length, 4);
  assert.deepEqual(planSettings(data, { home, statusLine: 'keep', gitClone: false }).changes, []);
});

test('the settings plan sets the default model and effort only when you have not set them', () => {
  const { data, changes } = planSettings({}, { home: sampleHome, statusLine: 'keep', gitClone: false });
  assert.equal(data.model, 'opus');
  assert.equal(data.effortLevel, 'medium');
  assert.deepEqual(data.modelSettings, { 'claude-opus-5-5': { effortLevel: 'medium' } });
  assert.ok(changes.includes('set the default model to opus'));
  const own = planSettings({ model: 'haiku', effortLevel: 'low' }, { home: sampleHome, statusLine: 'keep', gitClone: false }).data;
  assert.equal(own.model, 'haiku');
  assert.equal(own.effortLevel, 'low');
});

test('a reminder hook of your own keeps its registered command', () => {
  const settings = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "/x/context-reminder.mjs" auto' }] }] } };
  const { data } = planSettings(settings, { home: sampleHome, statusLine: 'keep', gitClone: false, reminderCurrent: false });
  assert.equal(data.hooks.PostToolUse[0].hooks[0].command, 'node "/x/context-reminder.mjs" auto');
});

test('apply-to-machine: dry run, apply, a second run, then undo', { skip: !unix }, () => {
  const f = fixture();
  const oldSettings = fs.readFileSync(f.settings, 'utf8');
  const oldHook = fs.readFileSync(f.hook, 'utf8');

  let r = f.run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would register the context reminder on PostToolUse/);
  assert.match(r.stdout, /would ask: Your status line/);
  assert.equal(fs.readFileSync(f.settings, 'utf8'), oldSettings);
  assert.equal(fs.readFileSync(f.hook, 'utf8'), oldHook);
  assert.deepEqual(f.sets(), []);

  r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const after = JSON.parse(fs.readFileSync(f.settings, 'utf8'));
  const command = `node "${f.hook}" auto --user`;
  for (const key of ['env', 'model', 'statusLine', 'enabledPlugins']) assert.deepEqual(after[key], f.before[key], key);
  assert.deepEqual(after.modelSettings, { 'sample-model': { effortLevel: 'low' }, 'claude-opus-5-5': { effortLevel: 'medium' } });
  assert.deepEqual(after.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command }] }]);
  assert.deepEqual(after.hooks.PostToolUse, [f.other, { hooks: [{ type: 'command', command }] }]);
  assert.equal(after.hooks.SessionStart.filter((m) => m.hooks[0].command.includes('context-reminder.mjs')).length, 1);
  assert.equal(after.hooks.SessionStart.filter((m) => m.hooks[0].command.includes('update-check.mjs')).length, 1);
  assert.equal(fs.readFileSync(f.hook, 'utf8'), shipped('claude-code/bin/context-reminder.mjs'));
  assert.equal(fs.readFileSync(path.join(f.claude, 'agents', 'reader.md'), 'utf8'), shipped('claude-code/agents/reader.md'));
  assert.equal(fs.existsSync(path.join(f.claude, 'statusline-gauges.mjs')), false);
  assert.equal(f.sets().length, 1);

  const applied = fs.readFileSync(f.settings, 'utf8');
  r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /nothing to change/);
  assert.equal(fs.readFileSync(f.settings, 'utf8'), applied);
  assert.equal(f.sets().length, 1);

  r = f.run('--undo');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(f.settings, 'utf8'), oldSettings);
  assert.equal(fs.readFileSync(f.hook, 'utf8'), oldHook);
  assert.equal(fs.existsSync(path.join(f.claude, 'agents', 'reader.md')), false);
  assert.equal(fs.existsSync(path.join(f.claude, 'hooks', 'update-check.mjs')), false);

  r = f.run('--undo');
  assert.equal(r.status, 1);
});

test('apply-to-machine leaves a hook you edited and refuses settings it cannot read', { skip: !unix }, () => {
  const f = fixture();
  fs.writeFileSync(f.hook, '// a hook of my own\n');
  let r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(f.hook, 'utf8'), '// a hook of my own\n');
  assert.equal(JSON.parse(fs.readFileSync(f.settings, 'utf8')).hooks.PostToolUse[1].hooks[0].command, `node "${f.hook}" auto`);

  fs.writeFileSync(f.settings, '{ not json');
  r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.equal(fs.readFileSync(f.settings, 'utf8'), '{ not json');

  assert.equal(f.run('--sideways').status, 2);
});
