// Tests for lib/update.mjs against throwaway local git repositories: a "template"
// bare repo stands in for the public upstream, and clones or forks of it are updated.
// Run: node --test test/update.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-test-'));
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
  NO_COLOR: '1',
};

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

let n = 0;
/** A template (bare repo plus a working copy to publish from) holding the updater itself. */
function makeTemplate() {
  const base = path.join(tmp, `t${++n}`);
  const work = path.join(base, 'work');
  fs.mkdirSync(path.join(work, 'lib'), { recursive: true });
  for (const f of ['lib/update.mjs', 'lib/context.mjs', '.gitignore']) fs.copyFileSync(path.join(repoRoot, f), path.join(work, f));
  fs.writeFileSync(path.join(work, 'README.md'), 'v1\n');
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'v1');
  const bare = path.join(base, 'template.git');
  git(base, 'clone', '-q', '--bare', work, bare);
  git(work, 'remote', 'add', 'origin', bare);
  return { base, work, bare };
}

function publish(t, file, text, { force = false } = {}) {
  fs.writeFileSync(path.join(t.work, file), text);
  git(t.work, 'add', ...(force ? ['-f'] : []), file);
  git(t.work, 'commit', '-q', '-m', `change ${file}`);
  git(t.work, 'push', '-q', 'origin', 'main');
}

function cloneOf(t, from = t.bare, name = 'clone') {
  const dir = path.join(t.base, name);
  git(t.base, 'clone', '-q', from, dir);
  fs.writeFileSync(path.join(dir, 'answers.env'), 'VAULT_PATH=/somewhere/mine\n');
  return dir;
}

function update(dir, t, ...args) {
  const r = spawnSync(process.execPath, [path.join(dir, 'lib/update.mjs'), '--yes', '--upstream-url', t.bare, ...args], {
    encoding: 'utf8',
    env,
    stdin: 'ignore',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

const head = (dir) => git(dir, 'rev-parse', 'HEAD');
const tip = (t) => git(t.bare, 'rev-parse', 'main');
const answers = (dir) => fs.readFileSync(path.join(dir, 'answers.env'), 'utf8');

test('clean clone fast-forwards and keeps answers.env', () => {
  const t = makeTemplate();
  const dir = cloneOf(t);
  publish(t, 'README.md', 'v2\n');
  const r = update(dir, t);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Updated main/);
  assert.equal(head(dir), tip(t));
  assert.equal(answers(dir), 'VAULT_PATH=/somewhere/mine\n');

  const again = update(dir, t);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /Already up to date/);
});

test('dry run reports but does not move', () => {
  const t = makeTemplate();
  const dir = cloneOf(t);
  const before = head(dir);
  publish(t, 'README.md', 'v2\n');
  const r = update(dir, t, '--dry-run');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Would fast-forward/);
  assert.equal(head(dir), before);
});

test('dirty clone is refused and left as it was', () => {
  const t = makeTemplate();
  const dir = cloneOf(t);
  const before = head(dir);
  publish(t, 'README.md', 'v2\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'my edit\n');
  const r = update(dir, t);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /local changes/);
  assert.equal(head(dir), before);
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'my edit\n');
  assert.equal(git(dir, 'stash', 'list'), '');
});

test('untracked file counts as dirty', () => {
  const t = makeTemplate();
  const dir = cloneOf(t);
  publish(t, 'README.md', 'v2\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine\n');
  const r = update(dir, t);
  assert.equal(r.code, 1, r.out);
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
});

test('diverged clone is refused with the manual options', () => {
  const t = makeTemplate();
  const dir = cloneOf(t);
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'mine\n');
  git(dir, 'add', 'mine.txt');
  git(dir, 'commit', '-q', '-m', 'my commit');
  const before = head(dir);
  publish(t, 'README.md', 'v2\n');
  const r = update(dir, t);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /diverged/);
  assert.match(r.out, /git merge origin\/main/);
  assert.equal(head(dir), before);
});

test('clone ahead of upstream has nothing to take', () => {
  const t = makeTemplate();
  const dir = cloneOf(t);
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'mine\n');
  git(dir, 'add', 'mine.txt');
  git(dir, 'commit', '-q', '-m', 'my commit');
  const before = head(dir);
  const r = update(dir, t);
  assert.equal(r.code, 0, r.out);
  assert.equal(head(dir), before);
});

test('wrong branch is refused', () => {
  const t = makeTemplate();
  const dir = cloneOf(t);
  git(dir, 'switch', '-q', '-c', 'experiment');
  publish(t, 'README.md', 'v2\n');
  const r = update(dir, t);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /git switch main/);
});

test('upstream adding a path you already have is refused, your file kept', () => {
  const t = makeTemplate();
  const dir = cloneOf(t);
  const before = head(dir);
  publish(t, 'answers.env', 'UPSTREAM=1\n', { force: true });
  const r = update(dir, t);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /already exist here/);
  assert.equal(head(dir), before);
  assert.equal(answers(dir), 'VAULT_PATH=/somewhere/mine\n');
});

test('fork without upstream: refused unless consent is given, then updated', () => {
  const t = makeTemplate();
  const fork = path.join(t.base, 'fork.git');
  git(t.base, 'clone', '-q', '--bare', t.bare, fork);
  const dir = cloneOf(t, fork, 'fork-clone');
  publish(t, 'README.md', 'v2\n');

  const refused = update(dir, t);
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /git remote add upstream/);
  assert.equal(git(dir, 'remote'), 'origin');

  const dry = update(dir, t, '--add-upstream', '--dry-run');
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /would run: git remote add upstream/);
  assert.equal(git(dir, 'remote'), 'origin');

  const r = update(dir, t, '--add-upstream');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(git(dir, 'remote').split('\n').sort(), ['origin', 'upstream']);
  assert.equal(head(dir), tip(t));
  assert.equal(answers(dir), 'VAULT_PATH=/somewhere/mine\n');

  // From now on the fork updates from upstream with no questions.
  publish(t, 'README.md', 'v3\n');
  const next = update(dir, t);
  assert.equal(next.code, 0, next.out);
  assert.equal(head(dir), tip(t));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
