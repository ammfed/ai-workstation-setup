// Tests for scripts/privacy-scan.sh against throwaway local git repositories: the real script
// scans each one, the way it scans this clone before a push. Needs bash, like the script.
// Run: node --test test/privacy.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scan = path.join(repoRoot, 'scripts', 'privacy-scan.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-test-'));
const globalConfig = path.join(tmp, 'gitconfig');
fs.writeFileSync(globalConfig, '');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, PRIVACY_SCAN_DOCKER: '0', NO_COLOR: '1' };

// Built at run time so this file does not itself hold an address the scan would report.
const personal = ['someone', 'mail.test'].join('@');
const noreply = { name: 'someone', email: '123456+someone@users.noreply.github.com' };
const webFlow = { name: 'GitHub', email: 'noreply@github.com' };

function git(dir, args, extra = {}) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

let n = 0;
function makeRepo() {
  const dir = path.join(tmp, `r${++n}`);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  return dir;
}

/** Commits the given files as `author`, committed by `committer`; returns the short sha the scan prints. */
function commit(dir, { author = noreply, committer = author, files = {}, remove = [], message = 'change' } = {}) {
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  if (Object.keys(files).length) git(dir, ['add', ...Object.keys(files)]);
  if (remove.length) git(dir, ['rm', '-q', ...remove]);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message], {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
  });
  return git(dir, ['rev-parse', '--short=12', 'HEAD']);
}

function runScan(dir, denylist = path.join(tmp, 'no-denylist')) {
  const r = spawnSync('bash', [scan, '--denylist', denylist], { cwd: dir, encoding: 'utf8', env });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('GitHub noreply identities pass: your own and the one github.com commits merges with', () => {
  const dir = makeRepo();
  commit(dir, { files: { 'README.md': 'hello\n' } });
  commit(dir, { committer: webFlow, message: 'Merge pull request #1 from someone/branch' });
  const { code, out } = runScan(dir);
  assert.equal(code, 0, out);
  assert.match(out, /\nclean\n?$/);
});

test('a personal author or committer address is reported by commit, without the address', () => {
  const dir = makeRepo();
  commit(dir, { files: { 'README.md': 'hello\n' } });
  const byAuthor = commit(dir, { author: { name: 'someone', email: personal }, committer: noreply });
  const byCommitter = commit(dir, { author: noreply, committer: { name: 'someone', email: personal } });
  const { code, out } = runScan(dir);
  assert.equal(code, 1, out);
  assert.ok(out.includes(`[email] commit ${byAuthor}:author\n`), out);
  assert.ok(out.includes(`[email] commit ${byCommitter}:committer\n`), out);
  assert.ok(!out.includes(`commit ${byAuthor}:committer`), out);
  assert.ok(!out.includes(personal), out);
});

test('an address committed and later deleted is reported by commit and file, never by content', () => {
  const dir = makeRepo();
  const added = commit(dir, { files: { 'notes.txt': `write to ${personal}\n` } });
  const removed = commit(dir, { remove: ['notes.txt'] });
  const { code, out } = runScan(dir);
  assert.equal(code, 1, out);
  assert.ok(out.includes(`[email] commit ${added}:notes.txt\n`), out);
  assert.ok(out.includes(`[email] commit ${removed}:notes.txt\n`), out);
  assert.ok(!out.includes(personal), out);
});

test('a noreply address on a line does not hide a personal one next to it', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'notes.txt'), `${noreply.email} or ${personal}\n`);
  const { code, out } = runScan(dir);
  assert.equal(code, 1, out);
  assert.ok(out.includes('[email] notes.txt:1\n'), out);
});

test('a denylisted term in a commit author name is reported', () => {
  const dir = makeRepo();
  const denylist = path.join(tmp, 'denylist.txt');
  fs.writeFileSync(denylist, '# private terms\nzorblax\n');
  commit(dir, { files: { 'README.md': 'hello\n' } });
  const named = commit(dir, { author: { name: 'Zorblax Person', email: noreply.email } });
  const { code, out } = runScan(dir, denylist);
  assert.equal(code, 1, out);
  assert.ok(out.includes(`[denylist] commit ${named}:author\n`), out);
  assert.ok(!/zorblax/i.test(out), out);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
