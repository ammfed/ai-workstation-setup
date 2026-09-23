// Tests for templates/daily-sync/bin/daily-sync.mjs against throwaway folders and git repos:
// a quiet run is one line and sends nothing, a missing raw folder, an unfinished or stale run
// are FAILED and sent, clean repos are fast-forwarded while dirty or diverged ones are only
// reported, watched repos are never fetched, and a model is asked only about new drift.
// Run: node --test test/daily-sync.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'templates', 'daily-sync', 'bin', 'daily-sync.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-sync-test-'));
const globalConfig = path.join(tmp, 'gitconfig');
fs.writeFileSync(globalConfig, '');
// Built at run time so this file does not itself hold an address the privacy scan would report.
const email = ['tester', 'example.invalid'].join('@');
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: globalConfig,
  GIT_AUTHOR_NAME: 'tester',
  GIT_AUTHOR_EMAIL: email,
  GIT_COMMITTER_NAME: 'tester',
  GIT_COMMITTER_EMAIL: email,
};

// Helpers written as scripts, so the notify and model commands are plain `node "<file>"`.
const helpers = path.join(tmp, 'helpers');
fs.mkdirSync(helpers);
fs.writeFileSync(path.join(helpers, 'notify.cjs'), "require('fs').appendFileSync(process.argv[2], require('fs').readFileSync(0, 'utf8') + '\\n=====\\n');");
fs.writeFileSync(path.join(helpers, 'model.cjs'), "require('fs').readFileSync(0); require('fs').appendFileSync(process.argv[2], 'call\\n'); console.log('stub explanation');");
fs.writeFileSync(path.join(helpers, 'print.cjs'), 'console.log(process.argv.slice(2).join(" "));');
// Stand-ins for clickup-axi and a TickTick CLI, printing the shapes the real ones print.
fs.writeFileSync(
  path.join(helpers, 'clickup.cjs'),
  `console.log(${JSON.stringify('count: 3 active lists in space 9\nlists[3]{id,name,folder}:\n  "101",Milestones,(folderless)\n  "102",Deliverables,Team A\n  "103",Findings,Team B\nhelp[1]:\n  Run `clickup-axi lists --space "<name|id>" --archived` to see archived lists')});`,
);
fs.writeFileSync(path.join(helpers, 'ticktick.cjs'), `console.log(JSON.stringify([{ name: 'Work' }, { name: 'Personal' }, { name: 'Errands' }]));`);
const node = (file, ...rest) => [`"${process.execPath}"`, `"${path.join(helpers, file)}"`, ...rest.map((r) => `"${r}"`)].join(' ');

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

let n = 0;
/** A job folder with its own config.json; `notified` and `modelCalls` read what was sent. */
function job(config) {
  const dir = path.join(tmp, `job${++n}`);
  fs.mkdirSync(dir);
  const notes = path.join(dir, 'notes.txt');
  const calls = path.join(dir, 'model-calls.txt');
  const file = path.join(dir, 'config.json');
  const write = (c) => fs.writeFileSync(file, JSON.stringify({ notify: node('notify.cjs', notes), model: { command: node('model.cjs', calls) }, ...c }));
  write(config);
  return {
    dir,
    write,
    run: (...extra) => {
      const r = spawnSync(process.execPath, [script, '--config', file, ...extra], { encoding: 'utf8', env });
      return { code: r.status, out: r.stdout + r.stderr };
    },
    notified: () => (fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8').split('\n=====\n').filter(Boolean) : []),
    modelCalls: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length : 0),
    latest: () => fs.readFileSync(path.join(dir, 'reports', 'latest.md'), 'utf8').trim(),
    state: () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')),
    setState: (s) => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s)),
  };
}

function rawFolder(files = 1) {
  const dir = path.join(tmp, `raw${++n}`);
  fs.mkdirSync(dir);
  for (let i = 0; i < files; i += 1) fs.writeFileSync(path.join(dir, `f${i}.txt`), 'x');
  return dir;
}

const vault = (rawDir, dryRunOutput = 'nothing new') => ({
  path: tmp,
  rawDir,
  dryRun: node('print.cjs', dryRunOutput),
  run: node('print.cjs', 'ingesting: one'),
  requireClean: false,
});

/** A bare remote with one commit, and a clone of it. */
function remoteAndClone() {
  const remote = path.join(tmp, `remote${++n}.git`);
  const seed = path.join(tmp, `seed${n}`);
  const clone = path.join(tmp, `clone${n}`);
  spawnSync('git', ['init', '--bare', '-q', '-b', 'main', remote], { env });
  spawnSync('git', ['clone', '-q', remote, seed], { env });
  fs.writeFileSync(path.join(seed, 'a.txt'), '1\n');
  git(seed, ['add', 'a.txt']);
  git(seed, ['commit', '-q', '-m', 'one']);
  git(seed, ['push', '-q', 'origin', 'HEAD:main']);
  spawnSync('git', ['clone', '-q', remote, clone], { env });
  const upstreamCommit = (file = 'b.txt') => {
    git(seed, ['pull', '-q', '--ff-only', 'origin', 'main']);
    fs.writeFileSync(path.join(seed, file), `${Date.now()}\n`);
    git(seed, ['add', file]);
    git(seed, ['commit', '-q', '-m', `add ${file}`]);
    git(seed, ['push', '-q', 'origin', 'HEAD:main']);
  };
  return { remote, clone, upstreamCommit };
}

test('a quiet run writes a one-line report, sends nothing and calls no model', () => {
  const j = job({ vault: vault(rawFolder()) });
  const r = j.run();
  assert.equal(r.code, 0, r.out);
  assert.match(j.latest(), /^daily-sync \d{4}-\d\d-\d\d \d\d:\d\d: all quiet \(1 check\(s\), no model calls\)$/);
  assert.deepEqual(j.notified(), []);
  assert.equal(j.modelCalls(), 0);
  assert.ok(j.state().lastSuccess);
  assert.equal(spawnSync(process.execPath, [script, '--config', path.join(j.dir, 'config.json'), '--status'], { encoding: 'utf8' }).stdout, '');
});

test('a missing raw folder fails loudly instead of reporting nothing new', () => {
  const j = job({ vault: vault(path.join(tmp, 'no-such-raw-folder')) });
  const r = j.run();
  assert.equal(r.code, 1, r.out);
  const [note] = j.notified();
  assert.match(note, /^FAILED daily-sync .*1 failed/);
  assert.match(note, /raw folder .*no-such-raw-folder does not exist, so ingest would read nothing/);
  const status = () => spawnSync(process.execPath, [script, '--config', path.join(j.dir, 'config.json'), '--status'], { encoding: 'utf8' }).stdout;
  assert.match(status(), /^FAILED daily-sync: the last run .* had 1 failed step/);
  // Fixed: the next run says so once, and the session check goes quiet.
  j.write({ vault: vault(rawFolder()) });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[1], /^daily-sync .*1 changed[\s\S]*recovered: the run at .* failed; this one did not/);
  assert.equal(status(), '');
  j.run();
  assert.equal(j.notified().length, 2);
});

test('an empty raw folder fails too', () => {
  const j = job({ vault: vault(rawFolder(0)) });
  assert.equal(j.run().code, 1);
  assert.match(j.notified()[0], /has no files, so ingest would read nothing/);
});

test('new raw files are ingested and reported as changed, counted as model use', () => {
  const j = job({ vault: vault(rawFolder(), 'would ingest: one') });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.match(note, /1 changed \(model calls: 1 by the vault ingest\)/);
  assert.match(note, /vault: ingested 1 new raw file\(s\)/);
});

test('a previous run that never finished and a stale last success are both FAILED', () => {
  const j = job({ vault: vault(rawFolder()) });
  fs.writeFileSync(path.join(j.dir, 'run.lock'), JSON.stringify({ pid: 2 ** 22 + 7, startedAt: Date.now() - 30 * 3_600_000 }));
  j.setState({ lastSuccess: Date.now() - 30 * 3_600_000 });
  assert.equal(j.run().code, 1);
  const [note] = j.notified();
  assert.match(note, /^FAILED /);
  assert.match(note, /the previous run \(started .*\) never finished/);
  assert.match(note, /no successful run since .* \(30h ago\)/);
  // This run's own checks passed, so the next run only says it recovered, then all is quiet.
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[1], /recovered: the run at .* failed; this one did not/);
  assert.equal(j.run().code, 0);
  assert.equal(j.notified().length, 2);
  assert.match(j.latest(), /all quiet/);
});

test('a clean repo that is behind is fast-forwarded', () => {
  const { clone, upstreamCommit } = remoteAndClone();
  upstreamCommit();
  const j = job({ pull: [clone] });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /fast-forwarded 1 commit\(s\) from origin\/main/);
  assert.ok(fs.existsSync(path.join(clone, 'b.txt')));
});

test('a dirty repo is reported, not pulled, and not re-sent while unchanged', () => {
  const { clone, upstreamCommit } = remoteAndClone();
  upstreamCommit();
  fs.writeFileSync(path.join(clone, 'a.txt'), 'local edit\n');
  const j = job({ pull: [clone] });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /1 upstream commit\(s\) waiting, but it has uncommitted changes \(a\.txt\); not pulled/);
  assert.ok(!fs.existsSync(path.join(clone, 'b.txt')));
  assert.equal(fs.readFileSync(path.join(clone, 'a.txt'), 'utf8'), 'local edit\n');
  assert.equal(j.run().code, 0);
  assert.equal(j.notified().length, 1, 'the same drift is not sent twice in a row');
  assert.match(j.latest(), /\(still\) repo .*uncommitted changes/);
});

test('changes under an ignored prefix do not block a pull', () => {
  const { clone, upstreamCommit } = remoteAndClone();
  fs.mkdirSync(path.join(clone, '.obsidian'));
  fs.writeFileSync(path.join(clone, '.obsidian', 'workspace.json'), '{}');
  git(clone, ['add', '.obsidian']);
  git(clone, ['commit', '-q', '-m', 'settings']);
  git(clone, ['push', '-q', 'origin', 'HEAD:main']);
  upstreamCommit();
  fs.writeFileSync(path.join(clone, '.obsidian', 'workspace.json'), '{"open":1}');
  const j = job({ pull: [{ path: clone, ignoreDirty: ['.obsidian/'] }] });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /fast-forwarded 1 commit/);
});

test('a diverged repo is left alone, and only new drift reaches the model', () => {
  const { clone, upstreamCommit } = remoteAndClone();
  upstreamCommit();
  fs.writeFileSync(path.join(clone, 'local.txt'), 'mine\n');
  git(clone, ['add', 'local.txt']);
  git(clone, ['commit', '-q', '-m', 'local work']);
  const before = git(clone, ['rev-parse', 'HEAD']);
  const j = job({ pull: [clone] });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.match(note, /diverged from origin\/main \(1 local, 1 upstream commit\(s\)\); not pulled/);
  assert.match(note, /model: stub explanation/);
  assert.equal(git(clone, ['rev-parse', 'HEAD']), before);
  assert.equal(j.modelCalls(), 1);
  j.run();
  assert.equal(j.modelCalls(), 1, 'drift already reported is not explained again');
});

test('a watched repo is reported when behind and never fetched', () => {
  const { clone, upstreamCommit } = remoteAndClone();
  upstreamCommit();
  const tracking = git(clone, ['rev-parse', 'origin/main']);
  const j = job({ watch: [clone] });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /behind origin\/main .*watched only/);
  assert.equal(git(clone, ['rev-parse', 'origin/main']), tracking, 'no fetch happened');
});

test('a command that prints a finding is reported once per distinct finding', () => {
  const j = job({ commands: [{ name: 'tool updates', run: node('print.cjs', 'x update available') }] });
  j.run();
  j.run();
  assert.equal(j.notified().length, 1);
  j.write({ commands: [{ name: 'tool updates', run: node('print.cjs', 'tool updates: y update available') }] });
  j.run();
  assert.equal(j.notified().length, 2);
  assert.match(j.notified()[1], /- tool updates: y update available/);
  assert.doesNotMatch(j.notified()[1], /tool updates: tool updates/);
});

test('a recorded version behind the folder that holds it is drift', () => {
  const holder = path.join(tmp, 'holder');
  for (const v of ['v1.0', 'v1.2', 'v1.10-draft']) fs.mkdirSync(path.join(holder, v), { recursive: true });
  const record = path.join(tmp, 'record.md');
  fs.writeFileSync(record, 'We use Widget Kit v1.0, upgraded from Widget Kit v0.9.\n');
  const j = job({
    model: {},
    versions: [{ name: 'widget kit', recorded: { file: record, pattern: 'Widget Kit v(\\d+(?:\\.\\d+)*)' }, actual: { dir: holder, pattern: '^v(\\d+(?:\\.\\d+)*)' } }],
  });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /widget kit: 1\.0 on record in .*record\.md, but .*holder holds 1\.10/);
});

test('ClickUp lists are compared with an expected-lists file, read-only', () => {
  const board = path.join(tmp, 'board.json');
  fs.writeFileSync(board, JSON.stringify({ lists: { milestones: { id: '101', name: 'Milestones' }, gone: { id: '104', name: 'Old list' }, a: { id: '102' } } }));
  const j = job({ clickup: { command: node('clickup.cjs'), space: '9', lists: { file: board, key: 'lists' } } });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.match(note, /expected list 104 \(Old list\) is no longer active in space 9/);
  assert.match(note, /list 103 \(Team B \/ Findings\) is active in space 9 but not expected in .*board\.json/);
  assert.doesNotMatch(note, /list 10[12] /);
  assert.equal(j.modelCalls(), 2);
});

test('TickTick lists are compared with the ones you expect, and an expiring sign-in is flagged', () => {
  const j = job({ ticktick: { command: node('ticktick.cjs'), authCommand: node('print.cjs', 'Token: valid (expires 172800 seconds)'), lists: ['work', 'Personal', 'Health'] } });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.match(note, /ticktick: the sign-in expires in 2 day\(s\)/);
  assert.match(note, /ticktick: expected list "Health" is missing/);
  assert.match(note, /ticktick: list "Errands" is not one you expect/);
  assert.doesNotMatch(note, /"Work"|"work"|"Personal"/);
});

test('--dry-run changes nothing and sends nothing', () => {
  const { clone, upstreamCommit } = remoteAndClone();
  upstreamCommit();
  git(clone, ['fetch', '-q']);
  const j = job({ pull: [clone], vault: vault(path.join(tmp, 'missing-too')) });
  const r = j.run('--dry-run');
  assert.equal(r.code, 1);
  assert.match(r.out, /would fast-forward 1 commit/);
  assert.match(r.out, /this report would be sent/);
  assert.ok(!fs.existsSync(path.join(clone, 'b.txt')));
  assert.deepEqual(j.notified(), []);
  assert.ok(!fs.existsSync(path.join(j.dir, 'state.json')));
  assert.ok(!fs.existsSync(path.join(j.dir, 'reports')));
});

test('an off file pauses it, and --status stays silent while paused', () => {
  const j = job({ vault: vault(path.join(tmp, 'missing-again')) });
  fs.writeFileSync(path.join(j.dir, 'off'), '');
  assert.equal(j.run().code, 0);
  assert.deepEqual(j.notified(), []);
  assert.equal(spawnSync(process.execPath, [script, '--config', path.join(j.dir, 'config.json'), '--status'], { encoding: 'utf8' }).stdout, '');
});
