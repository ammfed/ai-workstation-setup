// Tests for templates/claude-code/bin/update-check.mjs against throwaway git repositories:
// a clone behind its template gets one line with the count, an up-to-date clone gets
// nothing, a fork compares with `upstream`, a check runs at most once in 24 hours, and an
// unreachable remote, a missing clone or the opt-out variable print nothing and exit 0.
// The installer's hook entry is added once however often it runs, and answering no removes it.
// Run: node --test test/update-check.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context, detectPlatform } from '../lib/context.mjs';
import { removeHook, setHook, settingsPath } from '../lib/claude.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'templates', 'claude-code', 'bin', 'update-check.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-check-test-'));
const globalConfig = path.join(tmp, 'gitconfig');
fs.writeFileSync(globalConfig, '');
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: globalConfig,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test',
};
delete env.AI_WORKSTATION_SETUP_NO_UPDATE_CHECK;

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

let n = 0;
/** A bare template repo, a working copy to publish from, and a fresh home folder. */
function setup() {
  const base = path.join(tmp, `t${++n}`);
  const bare = path.join(base, 'template.git');
  const work = path.join(base, 'work');
  const home = path.join(base, 'home');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(home);
  git(base, 'init', '--quiet', '--bare', '--initial-branch=main', bare);
  git(work, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(work, 'README.md'), 'v1\n');
  git(work, 'add', '-A');
  git(work, 'commit', '--quiet', '-m', 'v1');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '--quiet', 'origin', 'main');
  const clone = path.join(base, 'clone');
  git(base, 'clone', '--quiet', bare, clone);
  return { base, bare, work, home, clone, state: path.join(home, '.config', 'ai-workstation-setup', 'update-check.json') };
}

function publish(t, count) {
  for (let i = 0; i < count; i += 1) {
    fs.appendFileSync(path.join(t.work, 'README.md'), `change ${i}\n`);
    git(t.work, 'commit', '--quiet', '-am', `change ${i}`);
  }
  git(t.work, 'push', '--quiet', 'origin', 'main');
}

function check(t, extraEnv = {}, clone = t.clone) {
  const r = spawnSync(process.execPath, [script, clone], {
    encoding: 'utf8',
    env: { ...env, HOME: t.home, USERPROFILE: t.home, ...extraEnv },
    timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout;
}

const message = (out) => (out ? JSON.parse(out).systemMessage : '');

test('a clone behind the template gets one line with the count and the commands', () => {
  const t = setup();
  publish(t, 3);
  const out = check(t);
  assert.match(message(out), /^ai-workstation-setup: 3 updates available\. Run .*update.*, then .*install.*\.$/);
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /3 updates available/);
  assert.equal(JSON.parse(fs.readFileSync(t.state, 'utf8')).behind, 3);
});

test('one commit behind reads as one update', () => {
  const t = setup();
  publish(t, 1);
  assert.match(message(check(t)), /: 1 update available\./);
});

test('an up-to-date clone prints nothing but records the check', () => {
  const t = setup();
  assert.equal(check(t), '');
  assert.equal(JSON.parse(fs.readFileSync(t.state, 'utf8')).behind, 0);
});

test('a fork compares with its upstream remote, not origin', () => {
  const t = setup();
  const fork = path.join(t.base, 'fork.git');
  git(t.base, 'clone', '--quiet', '--bare', t.bare, fork);
  git(t.clone, 'remote', 'set-url', 'origin', fork);
  git(t.clone, 'remote', 'add', 'upstream', t.bare);
  publish(t, 2);
  assert.match(message(check(t)), /: 2 updates available\./);
});

test('the check runs at most once in 24 hours', () => {
  const t = setup();
  assert.equal(check(t), '');
  publish(t, 2);
  assert.equal(check(t), '', 'a second check inside 24 hours stays quiet');
  const state = JSON.parse(fs.readFileSync(t.state, 'utf8'));
  fs.writeFileSync(t.state, JSON.stringify({ ...state, checkedAt: Date.now() - 25 * 3600 * 1000 }));
  assert.match(message(check(t)), /: 2 updates available\./, 'after 24 hours it checks again');
  assert.equal(check(t), '', 'and shows the line once, not in every session');
});

test('an unreachable remote prints nothing, exits 0 and waits a day before trying again', () => {
  const t = setup();
  git(t.clone, 'remote', 'set-url', 'origin', path.join(t.base, 'gone.git'));
  assert.equal(check(t), '');
  assert.ok(fs.existsSync(t.state), 'a failed check is recorded, so an offline machine is not slowed every session');
});

test('a missing clone, a folder that is not a clone and a broken state file print nothing', () => {
  const t = setup();
  assert.equal(check(t, {}, path.join(t.base, 'nowhere')), '');
  assert.equal(check(t, {}, t.home), '');
  fs.mkdirSync(path.dirname(t.state), { recursive: true });
  fs.writeFileSync(t.state, '{ not json');
  publish(t, 1);
  assert.match(message(check(t)), /: 1 update available\./, 'a broken state file counts as no earlier check');
});

test('AI_WORKSTATION_SETUP_NO_UPDATE_CHECK silences it without a fetch', () => {
  const t = setup();
  publish(t, 1);
  assert.equal(check(t, { AI_WORKSTATION_SETUP_NO_UPDATE_CHECK: '1' }), '');
  assert.ok(!fs.existsSync(t.state));
});

test('a fetch that hangs is stopped by the timeout, silently', () => {
  const t = setup();
  const hang = path.join(t.base, 'hang.cjs');
  fs.writeFileSync(hang, 'setTimeout(() => {}, 120000);');
  git(t.clone, 'remote', 'set-url', 'origin', 'ssh://example.invalid/template.git');
  const start = Date.now();
  assert.equal(check(t, { GIT_SSH_COMMAND: `"${process.execPath}" "${hang}"` }), '');
  assert.ok(Date.now() - start < 25000, `took ${Date.now() - start} ms`);
});

test('the hook is added once on every rerun, kept beside other hooks, and removed on no', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'install-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun: false, interactive: false, answers: new Map(), prompter: null, repoRoot });
  ctx.beginModule('test');
  const command = `node "${path.join(home, '.claude', 'hooks', 'update-check.mjs')}" "${repoRoot}"`;
  setHook(ctx, 'SessionStart', 'other-hook', 'other-hook');
  setHook(ctx, 'SessionStart', 'update-check.mjs', command);
  setHook(ctx, 'SessionStart', 'update-check.mjs', command);
  const hooks = () => JSON.parse(fs.readFileSync(settingsPath(ctx), 'utf8')).hooks.SessionStart.flatMap((m) => m.hooks.map((h) => h.command));
  assert.deepEqual(hooks(), ['other-hook', command]);
  removeHook(ctx, 'SessionStart', 'update-check.mjs');
  assert.deepEqual(hooks(), ['other-hook']);
  assert.equal(removeHook(ctx, 'SessionStart', 'update-check.mjs'), false, 'removing an absent hook changes nothing');
});
