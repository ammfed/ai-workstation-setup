// Tests for refreshing a shipped file under --yes: writeFile with onConflict 'ask' replaces a
// copy on disk that is a version this setup shipped (recorded in the manifest, or found in the
// clone's git history), and keeps any other difference as a local edit. Invented files only:
// a throwaway git repo stands in for the clone and a temporary folder for the home.
// Run: node --test test/refresh.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Context, detectPlatform } from '../lib/context.mjs';

const REL = 'demo/bin/demo.mjs';
const V1 = '// demo v1 for {{WHO}}\n';
const V2 = '// demo v2 for {{WHO}}\n';

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

// A clone whose history shipped V1, then V2 (the current template).
function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-test-'));
  const repo = path.join(tmp, 'repo');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(repo, 'templates', path.dirname(REL)), { recursive: true });
  fs.mkdirSync(home);
  git(repo, 'init', '-q');
  for (const v of [V1, V2]) {
    fs.writeFileSync(path.join(repo, 'templates', REL), v);
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'ship');
  }
  return { tmp, repo, home, target: path.join(home, 'bin', 'demo.mjs') };
}

function context(f, { dryRun = false, interactive = false, prompter = null } = {}) {
  const platform = { ...detectPlatform(), home: f.home };
  const ctx = new Context({ platform, dryRun, interactive, answers: new Map(), prompter, repoRoot: f.repo });
  return { ctx, rec: ctx.beginModule('test') };
}

const write = (ctx, f) => ctx.writeFile(f.target, ctx.template(REL, { WHO: 'you' }), { onConflict: 'ask' });

function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  return Promise.resolve(fn()).finally(() => (console.log = log)).then((v) => ({ v, out: lines.join('\n') }));
}

test('a missing file is written and recorded as shipped', async () => {
  const f = fixture();
  const { ctx } = context(f);
  assert.equal(await write(ctx, f), true);
  assert.equal(fs.readFileSync(f.target, 'utf8'), '// demo v2 for you\n');
  assert.equal(Object.keys(ctx.readShipped()).length, 1);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('an older shipped copy (found in git history) is replaced under --yes, with a backup', async () => {
  const f = fixture();
  fs.mkdirSync(path.dirname(f.target), { recursive: true });
  fs.writeFileSync(f.target, '// demo v1 for you\n');
  const { ctx, rec } = context(f);
  const { v, out } = await capture(() => write(ctx, f));
  assert.equal(v, true);
  assert.match(out, /replaced .*older version this setup shipped/);
  assert.equal(fs.readFileSync(f.target, 'utf8'), '// demo v2 for you\n');
  assert.equal(fs.readdirSync(path.dirname(f.target)).filter((n) => n.includes('.bak-')).length, 1);
  assert.deepEqual(rec.skips, []);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('a copy recorded in the manifest is replaced even when history does not have it', async () => {
  const f = fixture();
  fs.mkdirSync(path.dirname(f.target), { recursive: true });
  const old = '// demo from a clone without history\n';
  fs.writeFileSync(f.target, old);
  const { ctx } = context(f);
  ctx.recordShipped(f.target, old);
  assert.equal(await write(ctx, f), true);
  assert.equal(fs.readFileSync(f.target, 'utf8'), '// demo v2 for you\n');
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('a local edit is kept under --yes and said so', async () => {
  const f = fixture();
  fs.mkdirSync(path.dirname(f.target), { recursive: true });
  fs.writeFileSync(f.target, '// demo v1 for you, with my change\n');
  const { ctx, rec } = context(f);
  assert.equal(await write(ctx, f), false);
  assert.equal(fs.readFileSync(f.target, 'utf8'), '// demo v1 for you, with my change\n');
  assert.match(rec.skips.join('\n'), /local edit.*left untouched/);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('a dry run names the file it would replace and changes nothing', async () => {
  const f = fixture();
  fs.mkdirSync(path.dirname(f.target), { recursive: true });
  fs.writeFileSync(f.target, '// demo v1 for you\n');
  const { ctx } = context(f, { dryRun: true });
  const { v, out } = await capture(() => write(ctx, f));
  assert.equal(v, true);
  assert.match(out, new RegExp(`would replace ${f.target.replace(/[\\.]/g, '\\$&')} \\(it was an older version`));
  assert.equal(fs.readFileSync(f.target, 'utf8'), '// demo v1 for you\n');
  assert.equal(fs.existsSync(ctx.shippedManifest), false);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

test('an interactive run still asks, even for an older shipped copy', async () => {
  const f = fixture();
  fs.mkdirSync(path.dirname(f.target), { recursive: true });
  fs.writeFileSync(f.target, '// demo v1 for you\n');
  let asked = 0;
  const prompter = { confirm: async () => (asked++, false), release() {} };
  const { ctx } = context(f, { interactive: true, prompter });
  assert.equal(await write(ctx, f), false);
  assert.equal(asked, 1);
  assert.equal(fs.readFileSync(f.target, 'utf8'), '// demo v1 for you\n');
  fs.rmSync(f.tmp, { recursive: true, force: true });
});
