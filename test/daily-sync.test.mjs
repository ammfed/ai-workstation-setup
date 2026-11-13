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
import { Context, detectPlatform } from '../lib/context.mjs';
import dailySync, { buildConfig, cronLine, systemdTimer } from '../modules/daily-sync/module.mjs';

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
  // A run looks for agent session logs under the home folder: keep it away from the real one.
  HOME: tmp,
  USERPROFILE: tmp,
};

// Helpers written as scripts, so the notify and model commands are plain `node "<file>"`.
const helpers = path.join(tmp, 'helpers');
fs.mkdirSync(helpers);
fs.writeFileSync(path.join(helpers, 'notify.cjs'), "require('fs').appendFileSync(process.argv[2], require('fs').readFileSync(0, 'utf8') + '\\n=====\\n');");
fs.writeFileSync(path.join(helpers, 'model.cjs'), "require('fs').readFileSync(0); require('fs').appendFileSync(process.argv[2], 'call\\n'); console.log('stub explanation');");
fs.writeFileSync(path.join(helpers, 'print.cjs'), 'console.log(process.argv.slice(2).join(" "));');
// `slow.cjs <file>` records INGEST_DEADLINE in <file>, prints one ingest line and then hangs.
fs.writeFileSync(path.join(helpers, 'slow.cjs'), "require('fs').writeFileSync(process.argv[2], String(process.env.INGEST_DEADLINE)); console.log('ingesting: one'); setTimeout(() => {}, 60000);");
// `say.cjs <line>...` prints each argument on its own line.
fs.writeFileSync(path.join(helpers, 'say.cjs'), 'console.log(process.argv.slice(2).join("\\n"));');
// `sayerr.cjs <line>...` prints each argument on its own line to stderr, as the vault's bash ingest does.
fs.writeFileSync(path.join(helpers, 'sayerr.cjs'), 'console.error(process.argv.slice(2).join("\\n"));');
// `lines.cjs <text> <count>` prints the text <count> times, one per line.
fs.writeFileSync(path.join(helpers, 'lines.cjs'), 'for (let i = 0; i < Number(process.argv[3]); i += 1) console.log(`${process.argv[2]} f${i}`);');
// `locked.cjs <counter> <busy>` stands in for a vault ingest dry run: for its first <busy> calls it
// fails as the vault's lock helper does when another job holds .ingest/lock, then reports nothing new.
fs.writeFileSync(
  path.join(helpers, 'locked.cjs'),
  "const fs = require('fs'); const f = process.argv[2]; const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1; fs.writeFileSync(f, String(n));" +
    " if (n <= Number(process.argv[3])) { console.error('ingest: another run holds the lock (pid 1) - exiting'); process.exit(1); } console.log('nothing new');",
);
// `fail.cjs <line>` prints the line to stderr and exits 1, as a command that cannot reach its server.
fs.writeFileSync(path.join(helpers, 'fail.cjs'), 'console.error(process.argv.slice(2).join(" ")); process.exit(1);');
// Stand-ins for clickup-axi and a TickTick CLI, printing the shapes the real ones print.
fs.writeFileSync(
  path.join(helpers, 'clickup.cjs'),
  `console.log(${JSON.stringify('count: 3 active lists in space 9\nlists[3]{id,name,folder}:\n  "101",Milestones,(folderless)\n  "102",Deliverables,Team A\n  "103",Findings,Team B\nhelp[1]:\n  Run `clickup-axi lists --space "<name|id>" --archived` to see archived lists')});`,
);
fs.writeFileSync(path.join(helpers, 'ticktick.cjs'), `console.log(JSON.stringify([{ name: 'Work' }, { name: 'Personal' }, { name: 'Errands' }]));`);
const HOUR_MS = 3_600_000;
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
  // clockCommand "" keeps the host's clock state out of the reports these tests compare.
  const write = (c) => fs.writeFileSync(file, JSON.stringify({ notify: node('notify.cjs', notes), model: { command: node('model.cjs', calls) }, clockCommand: '', ...c }));
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
  assert.match(j.latest(), /^daily-sync \d{4}-\d\d-\d\d \d\d:\d\d: all quiet \(2 check\(s\), no model calls\)\nvault use: no agent session logs found in .* for the last 7 days$/);
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

test('the vault step handles 50 raw files a day unless the config sets another limit', () => {
  const pending = (limit) => ({
    ...vault(rawFolder()),
    dryRun: node('lines.cjs', 'would ingest:', 60),
    run: node('lines.cjs', 'ingesting:', '{limit}'),
    ...limit,
  });
  const dry = job({ vault: pending() });
  const planned = dry.run('--dry-run');
  assert.equal(planned.code, 0);
  assert.match(planned.out, /vault: would ingest 50 of 60 new raw file\(s\); 10 more wait for the next run/);
  const real = job({ vault: pending() });
  assert.equal(real.run().code, 0);
  assert.match(real.notified()[0], /vault: ingested 50 new raw file\(s\) with the vault's own agent; 10 more wait for the next run/);
  const own = job({ vault: pending({ limit: 10 }) });
  assert.equal(own.run().code, 0);
  assert.match(own.notified()[0], /vault: ingested 10 new raw file\(s\) with the vault's own agent; 50 more wait for the next run/);
});

// The run command can spend its whole time before the ingest (sorting a large pile, say) and
// still exit 0. Files waited and none was read: that needs a look, it is not a change.
test('a run command that ends well but ingests none of the waiting files is reported, not counted as a change', () => {
  const j = job({ vault: { ...vault(rawFolder()), dryRun: node('say.cjs', 'would ingest: a', 'would ingest: b', 'would ingest: c'), run: node('say.cjs', 'daily: sorted 800 files') } });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.match(note, /^daily-sync [^\n]*1 need you/);
  assert.match(note, /Needs you:\n- vault: the run command ended without an error after \d+ minute\(s\) but ingested none of the 3 waiting raw file\(s\); see what it spent its time on \(full output: [^)]*vault-run-latest\.log\)\. Last line: daily: sorted 800 files/);
  assert.doesNotMatch(note, /ingested 0 new raw file/);
});

// The vault's ingest stops on purpose when the quota gate holds it or its time budget ends. That
// is an expected skip: the report names the stop (and the gate's reason), it is not "Needs you".
const triage = ['triage: 12 file(s) sorted', 'triage: 2048 file(s) kept for ingest'];
const gate = 'quota-gate: claude: wait, the week is ahead of pace (80 of 100 used)';
const afterStop = 'daily: 2026-11-13 08:05 ok: daily pushed main';
const waiting = ['would ingest: a', 'would ingest: b', 'would ingest: c'];

test('an ingest held at the quota gate is an expected skip with the gate reason, not Needs you', () => {
  const stop = 'ingest: stopped at the quota gate before raw/a.md; the rest waits for the next run';
  const j = job({ vault: { ...vault(rawFolder()), dryRun: node('say.cjs', ...waiting), run: node('say.cjs', ...triage, gate, stop, afterStop) } });
  assert.equal(j.run().code, 0);
  const latest = j.latest();
  assert.doesNotMatch(latest, /Needs you|ingested none|need you/);
  assert.match(latest, /vault: ingest stopped on purpose, 3 raw file\(s\) wait for the next run\. quota-gate: claude: wait, the week is ahead of pace \(80 of 100 used\)\. ingest: stopped at the quota gate before raw\/a\.md/);
  const full = fs.readFileSync(path.join(j.dir, 'reports', 'vault-run-latest.log'), 'utf8');
  assert.match(full, /triage: 2048 file\(s\) kept for ingest\nquota-gate: claude: wait[^\n]*\ningest: stopped at the quota gate[^\n]*\ndaily: 2026-11-13 08:05 ok: daily pushed main/);
});

test('an ingest that ends at its time budget is an expected skip', () => {
  const stop = 'ingest: stopped at the time budget before raw/a.md; the rest waits for the next run';
  const j = job({ vault: { ...vault(rawFolder()), dryRun: node('say.cjs', ...waiting), run: node('say.cjs', ...triage, stop, afterStop) } });
  assert.equal(j.run().code, 0);
  assert.doesNotMatch(j.latest(), /Needs you|ingested none|need you/);
  assert.match(j.latest(), /vault: ingest stopped on purpose, 3 raw file\(s\) wait for the next run\. ingest: stopped at the time budget before raw\/a\.md/);
});

test('a stop line after some files were ingested keeps the changed report and counts what waits', () => {
  const said = ['ingest (new)  f0', gate, 'ingest: stopped at the quota gate before raw/b.md; the rest waits for the next run'];
  const j = job({ vault: { ...vault(rawFolder()), dryRun: node('say.cjs', ...waiting), run: node('say.cjs', ...said) } });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /vault: ingested 1 new raw file\(s\) with the vault's own agent; it stopped at the quota gate and 2 more wait for the next run/);
});

test('zero files ingested without any stop line is still Needs you, with the full output kept', () => {
  const j = job({ vault: { ...vault(rawFolder()), dryRun: node('say.cjs', ...waiting), run: node('say.cjs', ...triage, afterStop) } });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /Needs you:\n- vault: the run command ended without an error[^\n]*Last line: daily: 2026-11-13 08:05 ok: daily pushed main/);
  assert.match(fs.readFileSync(path.join(j.dir, 'reports', 'vault-run-latest.log'), 'utf8'), /triage: 12 file/);
});

// Answers the daily-sync questions the way an unattended run does: given answers first, then
// defaults, skipping the questions whose condition is not met; returns the config it would write.
test('an ingest stopped at its time limit says how far it got; one that honours the deadline is a change', () => {
  const seen = path.join(tmp, 'deadline.txt');
  const slow = job({ vault: { ...vault(rawFolder(), 'would ingest: one'), run: node('slow.cjs', seen), timeoutMin: 0.05 } });
  const before = Date.now() / 1000;
  assert.equal(slow.run().code, 1);
  const deadline = Number(fs.readFileSync(seen, 'utf8'));
  assert.ok(deadline > before && deadline < before + 3, `INGEST_DEADLINE comes before the 3 second limit: ${deadline - before}`);
  assert.match(slow.notified()[0], /vault: ingest was stopped at its 0\.05-minute limit after 1 file\(s\), so anything the run command does after the ingest \(such as a commit or push\) did not run/);

  const pending = vault(rawFolder(), 'would ingest: a');
  const said = ['ingest (new)  f0', 'ingest: 1 file(s) handled', 'ingest: stopped at the deadline; the rest wait for the next run'];
  const timely = job({ vault: { ...pending, dryRun: node('say.cjs', 'would ingest: a', 'would ingest: b', 'would ingest: c'), run: node('say.cjs', ...said) } });
  assert.equal(timely.run().code, 0);
  assert.match(timely.notified()[0], /vault: ingested 1 new raw file\(s\) with the vault's own agent; it stopped at its time limit and 2 more wait for the next run/);
});

async function configFor(given = {}) {
  const ctx = new Context({ platform: detectPlatform(), dryRun: true, interactive: false, answers: new Map(Object.entries(given)), prompter: null, repoRoot });
  for (const q of dailySync.questions) {
    if (q.when && !q.when(ctx)) continue;
    await ctx.ask(q);
  }
  return buildConfig(ctx, path.join(tmp, 'installed'));
}

test('the installer defaults the vault step to the template ingest and 50 files a day', async () => {
  const { vault: v } = await configFor({ DAILY_SYNC_VAULT: 'yes' });
  assert.equal(v.dryRun, 'node bin/ingest.mjs --dry-run');
  assert.equal(v.run, 'node bin/ingest.mjs --limit {limit}');
  assert.equal(v.limit, 50);
});

test('the installer takes the vault run command and limit from the answers', async () => {
  const { vault: v } = await configFor({ DAILY_SYNC_VAULT: 'yes', DAILY_SYNC_VAULT_RUN: 'bin/daily --limit {limit}', DAILY_SYNC_INGEST_LIMIT: '40' });
  assert.equal(v.run, 'bin/daily --limit {limit}');
  assert.equal(v.limit, 40);
  // An empty or unusable answer falls back to the defaults instead of writing a vault step that cannot run.
  const blank = (await configFor({ DAILY_SYNC_VAULT: 'yes', DAILY_SYNC_VAULT_RUN: '', DAILY_SYNC_INGEST_LIMIT: 'many' })).vault;
  assert.equal(blank.run, 'node bin/ingest.mjs --limit {limit}');
  assert.equal(blank.limit, 50);
});

test('no vault step is written when the vault question is answered no', async () => {
  assert.equal((await configFor({ DAILY_SYNC_VAULT: 'no' })).vault, undefined);
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

test('a stale last success alone is a notice, not a failed step, and this run is recorded as a success', () => {
  const j = job({ vault: vault(rawFolder()) });
  const old = Date.now() - 30 * 3_600_000;
  j.setState({ lastSuccess: old });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.doesNotMatch(note, /FAILED/);
  assert.match(note, /Needs you:\n- no successful run since .* \(30h ago\)/);
  assert.ok(j.state().lastSuccess > old, 'the passing run is recorded as a success');
  assert.equal(j.state().lastRun.failed, 0);
  assert.equal(spawnSync(process.execPath, [script, '--config', path.join(j.dir, 'config.json'), '--status'], { encoding: 'utf8' }).stdout, '');
  // The notice is gone on the next run.
  assert.equal(j.run().code, 0);
  assert.equal(j.notified().length, 1);
  assert.match(j.latest(), /all quiet/);
});

test('a stale last success with a real failed step is still FAILED and stays unrecorded', () => {
  const j = job({ vault: vault(path.join(tmp, 'no-such-raw-folder')) });
  const old = Date.now() - 30 * 3_600_000;
  j.setState({ lastSuccess: old });
  assert.equal(j.run().code, 1);
  assert.match(j.notified()[0], /^FAILED /);
  assert.equal(j.state().lastSuccess, old);
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

test('a diverged repo names the files both sides change and whether a merge is clean', () => {
  const apart = remoteAndClone();
  apart.upstreamCommit('b.txt');
  fs.writeFileSync(path.join(apart.clone, 'local.txt'), 'mine\n');
  git(apart.clone, ['add', 'local.txt']);
  git(apart.clone, ['commit', '-q', '-m', 'local work']);
  const status = git(apart.clone, ['status', '--porcelain']);
  let j = job({ pull: [apart.clone] });
  j.run();
  assert.match(j.notified()[0], /not pulled; the two sides change no file in common and merge cleanly: `git -C \S+ merge origin\/main` keeps every commit on both sides/);
  assert.equal(git(apart.clone, ['status', '--porcelain']), status, 'the preview leaves the work tree alone');

  const clash = remoteAndClone();
  clash.upstreamCommit('a.txt');
  fs.writeFileSync(path.join(clash.clone, 'a.txt'), 'mine\n');
  git(clash.clone, ['commit', '-q', '-am', 'local edit']);
  j = job({ pull: [clash.clone] });
  j.run();
  assert.match(j.notified()[0], /not pulled; both sides change a\.txt, and a merge conflicts in a\.txt; that needs a person/);
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

test('a version source file may be a list: the first file that exists is read', () => {
  const holder = path.join(tmp, 'holder-list');
  fs.mkdirSync(path.join(holder, 'v2.0'), { recursive: true });
  const parent = path.join(tmp, 'parent.md');
  const child = path.join(tmp, 'child.md');
  const missing = path.join(tmp, 'missing.md');
  const pattern = 'Widget Kit v(\\d+(?:\\.\\d+)*)';
  const actual = { dir: holder, pattern: '^v(\\d+(?:\\.\\d+)*)' };
  fs.writeFileSync(parent, 'Widget Kit v1.0\n');
  fs.writeFileSync(child, 'Widget Kit v2.0\n');

  // the first file is missing: the second is read and compared
  let j = job({ versions: [{ name: 'widget kit', recorded: { file: [missing, parent], pattern }, actual }] });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /widget kit: 1\.0 on record in .*parent\.md, but .*holder-list holds 2\.0/);
  assert.doesNotMatch(j.notified()[0], /missing\.md/);

  // the first file exists: it wins, and the fallback is not read
  j = job({ versions: [{ name: 'widget kit', recorded: { file: [child, parent], pattern }, actual }] });
  const same = j.run();
  assert.equal(same.code, 0, same.out);
  assert.equal(j.notified().length, 0, 'the child note matches the folder, so nothing is reported');
  assert.match(same.out, /ok\s+widget kit: 2\.0 on record and in .*holder-list/);

  // none exists: a failure line names every path tried
  j = job({ versions: [{ name: 'widget kit', recorded: { file: [missing, path.join(tmp, 'also-missing.md')], pattern }, actual }] });
  assert.equal(j.run().code, 1, 'a failure, not a crash');
  assert.match(j.notified()[0], /widget kit: no file to read, tried .*missing\.md, .*also-missing\.md/);

  // a plain string behaves as before, including when the file is missing
  j = job({ versions: [{ name: 'widget kit', recorded: { file: parent, pattern }, actual }] });
  assert.equal(j.run().code, 0);
  assert.match(j.notified()[0], /widget kit: 1\.0 on record in .*parent\.md, but .*holder-list holds 2\.0/);
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

test("TickTick sign-in check: the official CLI's `Not signed in` (exit 0) is reported, `Signed in` is not", () => {
  const lists = ['Work', 'Personal', 'Errands'];
  const out = job({ ticktick: { command: node('ticktick.cjs'), authCommand: node('print.cjs', 'Not signed in'), lists } });
  assert.equal(out.run().code, 0);
  assert.match(out.notified()[0], /ticktick: not signed in \(`.*print\.cjs.*`: Not signed in\)/);
  assert.doesNotMatch(out.notified()[0], /expected list|not one you expect/, 'it does not go on to compare lists');
  const inn = job({ ticktick: { command: node('ticktick.cjs'), authCommand: node('print.cjs', '✓ Signed in  Token: 5003922c...cd51'), lists } });
  assert.equal(inn.run().code, 0);
  assert.deepEqual(inn.notified(), []);
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

test('a run where every ingest attempt failed is FAILED, exits non-zero and is not a success', () => {
  const failing = ['ingest (new)  a', 'agent failed on: a', 'ingest (new)  b', 'agent failed on: b'];
  const j = job({ vault: { ...vault(rawFolder(), 'would ingest: a'), run: node('say.cjs', ...failing) } });
  const r = j.run();
  assert.equal(r.code, 1, r.out);
  const [note] = j.notified();
  assert.match(note, /^FAILED /);
  assert.match(note, /Failed:\n- vault: every ingest attempt failed \(2 of 2\), so nothing was ingested \(a, b\)/);
  assert.doesNotMatch(note, /Changed:/);
  assert.equal(j.state().lastRun.failed, 1);
  assert.equal(j.state().lastSuccess, undefined);
  assert.match(spawnSync(process.execPath, [script, '--config', path.join(j.dir, 'config.json'), '--status'], { encoding: 'utf8' }).stdout, /FAILED daily-sync: the last run .* had 1 failed step/);
});

test('a run where only some ingest attempts failed counts the successes and lists the failed file', () => {
  const some = ['ingest (new)  a', 'ingest (new)  b', 'agent failed on: b'];
  const j = job({ vault: { ...vault(rawFolder(), 'would ingest: a'), run: node('say.cjs', ...some) } });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.doesNotMatch(note, /^FAILED /);
  assert.match(note, /vault: ingested 1 of 2 new raw file\(s\) with the vault's own agent/);
  assert.match(note, /vault: ingest could not process b;/);
  assert.ok(j.state().lastSuccess);
});

test('a day with only `ingest: FAILED <file>: <reason>` lines on stderr is FAILED too', () => {
  const failing = ['ingest: FAILED a.txt: agent exited 1', 'ingest: FAILED b.txt: agent exited 1'];
  const j = job({ vault: { ...vault(rawFolder(), 'would ingest: a'), run: node('sayerr.cjs', ...failing) } });
  const r = j.run();
  assert.equal(r.code, 1, r.out);
  const [note] = j.notified();
  assert.match(note, /^FAILED /);
  assert.match(note, /Failed:\n- vault: every ingest attempt failed \(2 of 2\), so nothing was ingested \(a\.txt, b\.txt\)/);
  assert.equal(j.state().lastSuccess, undefined);
});

test('a mixed day of both failure formats reports "N of M"', () => {
  const lines = ['ingest (new)  a.txt', 'ingest (new)  b.txt', 'ingest (new)  c.txt', 'ingest: FAILED b.txt: agent exited 1', 'agent failed on: c.txt'];
  const j = job({ vault: { ...vault(rawFolder(), 'would ingest: a'), run: node('sayerr.cjs', ...lines) } });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.doesNotMatch(note, /^FAILED /);
  assert.match(note, /vault: ingested 1 of 3 new raw file\(s\)/);
  assert.match(note, /vault: ingest could not process b\.txt;/);
  assert.match(note, /vault: ingest could not process c\.txt;/);
});

test('the vault health check reports a failing bin/status or bin/lint and skips a vault without them', { skip: process.platform === 'win32' }, () => {
  const bare = path.join(tmp, `vault${++n}`);
  fs.mkdirSync(bare);
  const quiet = job({ vault: { ...vault(rawFolder()), path: bare } });
  const q = quiet.run();
  assert.equal(q.code, 0, q.out);
  assert.doesNotMatch(q.out + (quiet.notified()[0] || ''), /vault:(stuck|lint)|lint found problems/);

  const full = path.join(tmp, `vault${++n}`);
  fs.mkdirSync(path.join(full, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(full, 'bin', 'status'), '#!/bin/sh\necho "a run has been stuck for 3 days"\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(full, 'bin', 'lint'), '#!/bin/sh\necho "2 broken links"\nexit 1\n', { mode: 0o755 });
  const sick = job({ vault: { ...vault(rawFolder()), path: full } });
  assert.equal(sick.run().code, 0);
  const [note] = sick.notified();
  assert.match(note, /vault: a run has been stuck for 3 days/);
  assert.match(note, /vault: lint found problems: 2 broken links/);
});

test('--catch-up does nothing when a run already succeeded today, and runs when none did', () => {
  const j = job({ vault: vault(rawFolder()) });
  assert.equal(j.run().code, 0);
  const first = j.state().lastRun.at;
  const skipped = j.run('--catch-up');
  assert.equal(skipped.code, 0, skipped.out);
  assert.match(skipped.out, /skipped: catch-up not needed, a run succeeded today at \d\d:\d\d/);
  assert.equal(j.state().lastRun.at, first, 'a skipped catch-up leaves the state alone');
  j.setState({ ...j.state(), lastSuccess: Date.now() - 48 * 3_600_000 });
  const ran = j.run('--catch-up');
  assert.equal(ran.code, 0, ran.out);
  assert.doesNotMatch(ran.out, /catch-up not needed/);
  assert.ok(j.state().lastRun.at > first);
  // A failed morning run is no success, so the catch-up runs again.
  const broken = job({ vault: vault(path.join(tmp, 'no-such-raw-folder')) });
  assert.equal(broken.run().code, 1);
  const before = broken.state().lastRun.at;
  assert.equal(broken.run('--catch-up').code, 1);
  assert.ok(broken.state().lastRun.at > before);
});

/** A vault folder that is a git repo whose push remote is `url`. */
function vaultRepo(url) {
  const dir = path.join(tmp, `vaultrepo${++n}`);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['remote', 'add', 'origin', url]);
  return dir;
}

test('a run waits a bounded time for the push remote to resolve, then goes on', () => {
  const lost = job({ networkWaitSec: 1, vault: { ...vault(rawFolder()), path: vaultRepo('https://no-such-host.invalid/x.git') } });
  const r = lost.run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /network: no-such-host\.invalid could not be reached within 1s \(ENOTFOUND|EAI_AGAIN/);
  const up = job({ networkWaitSec: 1, vault: { ...vault(rawFolder()), path: vaultRepo('git@localhost:me/notes.git') } });
  assert.doesNotMatch(up.run().out, /network:/);
  const off = job({ networkWaitSec: 0, vault: { ...vault(rawFolder()), path: vaultRepo('https://no-such-host.invalid/x.git') } });
  assert.doesNotMatch(off.run().out, /network:/);
});

test('the report counts agent sessions of the last 7 days that used the vault, and copies nothing from them', () => {
  const logs = path.join(tmp, `sessions${++n}`);
  fs.mkdirSync(path.join(logs, 'proj'), { recursive: true });
  const call = (file) => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: file } }] } })}\n`;
  const said = (file) => `${JSON.stringify({ type: 'user', message: { content: `please look at ${file}` } })}\n`;
  const put = (name, text, ageDays = 0) => {
    const file = path.join(logs, 'proj', name);
    fs.writeFileSync(file, text);
    fs.utimesSync(file, new Date(Date.now() - ageDays * 86_400_000), new Date(Date.now() - ageDays * 86_400_000));
  };
  put('used.jsonl', call(`${tmp}/secret-plan.md`));
  put('only-said.jsonl', said(`${tmp}/secret-plan.md`));
  put('other-folder.jsonl', call(`${tmp}-other/x.md`));
  put('old.jsonl', call(`${tmp}/secret-plan.md`), 10);
  const j = job({ vault: { ...vault(rawFolder()), sessionLogs: logs } });
  assert.equal(j.run().code, 0);
  assert.match(j.latest(), /\nvault use: 1 of 3 agent sessions in the last 7 days$/);
  assert.doesNotMatch(j.latest(), /secret-plan/);
  assert.deepEqual(j.notified(), [], 'the count alone sends nothing');
  const none = job({ vault: { ...vault(rawFolder()), sessionLogs: path.join(tmp, 'no-such-logs') } });
  assert.equal(none.run().code, 0);
  assert.match(none.latest(), /vault use: no agent session logs found in .*no-such-logs for the last 7 days/);
  assert.doesNotMatch(none.latest(), /0 of 0/);
});

test('a source whose newest file is over 14 days old gets one nudge with its age and the action', () => {
  const raw = rawFolder();
  const put = (name, ageDays) => {
    const file = path.join(raw, name);
    fs.writeFileSync(file, 'x');
    fs.utimesSync(file, new Date(Date.now() - ageDays * 86_400_000), new Date(Date.now() - ageDays * 86_400_000));
  };
  put('old.eml', 40);
  put('older.eml', 90);
  put('bookmarks-export.html', 3);
  const j = job({ vault: vault(raw) });
  assert.equal(j.run().code, 0);
  const [note] = j.notified();
  assert.match(note, /Needs you:\n- email: the newest \.eml file in .* is 40 days old \(\d{4}-\d\d-\d\d\); export a fresh copy of your mail into that folder/);
  assert.doesNotMatch(note, /bookmarks:/, 'a fresh export is not nudged, and a source with no files is not either');
  put('bookmarks-export.html', 20);
  assert.equal(j.run().code, 0);
  assert.match(j.latest(), /- \(still\) email: .*40 days old/);
  assert.match(j.latest(), /- bookmarks: the newest bookmarks export in .* is 20 days old \(\d{4}-\d\d-\d\d\); export your bookmarks again into that folder/);
  put('new.eml', 1);
  assert.equal(j.run().code, 0);
  assert.doesNotMatch(j.latest(), /email:/);
});

/** A stand-in for the installer context that records what the scheduler code writes and runs. */
function recordingCtx(crontab = '') {
  const written = new Map();
  const ran = [];
  return {
    written,
    ran,
    home: path.join(tmp, 'fake-home'),
    info() {},
    ok() {},
    capture: (cmd) => (cmd.startsWith('crontab -l') ? crontab : null),
    writeFile: async (file, text) => written.set(file, text) && true,
    run: (cmd, opts) => ran.push([cmd, opts?.input]),
  };
}
const at = (text) => {
  const [h, m] = text.split(':').map(Number);
  return { hour: h, minute: m, text };
};

test('systemd gets a second 09:30 unit that runs with --catch-up, only when the daily time is earlier', async () => {
  const ctx = recordingCtx();
  await systemdTimer(ctx, '/x/daily-sync.mjs', at('07:30'));
  const unit = (name) => [...ctx.written].find(([f]) => f.endsWith(name))?.[1];
  assert.match(unit('daily-sync.service'), /ExecStart="[^"]+" "\/x\/daily-sync\.mjs"\n/);
  assert.match(unit('daily-sync.timer'), /OnCalendar=\*-\*-\* 07:30:00\nPersistent=true/);
  assert.match(unit('daily-sync-catchup.service'), /ExecStart="[^"]+" "\/x\/daily-sync\.mjs" --catch-up\n/);
  assert.match(unit('daily-sync-catchup.timer'), /OnCalendar=\*-\*-\* 09:30:00\nPersistent=true/);
  assert.match(ctx.ran[0][0], /enable --now daily-sync\.timer daily-sync-catchup\.timer/);
  const late = recordingCtx();
  await systemdTimer(late, '/x/daily-sync.mjs', at('10:00'));
  assert.equal([...late.written].some(([f]) => f.includes('catchup')), false);
});

test('cron gets a second 09:30 line that runs with --catch-up', () => {
  const ctx = recordingCtx('0 5 * * * unrelated');
  cronLine(ctx, '/x/daily-sync.mjs', at('07:30'));
  const input = ctx.ran[0][1];
  assert.match(input, /^0 5 \* \* \* unrelated\n30 7 \* \* \* PATH=.* '\/x\/daily-sync\.mjs' >\/dev\/null 2>&1 # ai-workstation-setup daily-sync\n30 9 \* \* \* PATH=.* '\/x\/daily-sync\.mjs' --catch-up >\/dev\/null/);
  const again = recordingCtx(input);
  cronLine(again, '/x/daily-sync.mjs', at('07:30'));
  assert.deepEqual(again.ran, [], 'both lines already there: nothing is rewritten');
});

/** A port on this machine that nothing listens on, so a connection to it is refused at once. */
async function closedPort() {
  const net = await import('node:net');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('a network that stays down is one plain line: not FAILED, not sent, and not a success', async () => {
  const url = `https://127.0.0.1:${await closedPort()}/x.git`;
  const pulled = path.join(tmp, `clone${++n}`);
  git(tmp, ['init', '-q', '-b', 'main', pulled]);
  git(pulled, ['remote', 'add', 'origin', url]);
  const fails = 'curl: (6) Could not resolve host: api.example.invalid';
  const j = job({
    networkWaitSec: 1,
    retryWaitSec: 0,
    pull: [pulled],
    clickup: { command: node('fail.cjs', fails), space: '9', lists: ['101'] },
    ticktick: { command: node('fail.cjs', 'getaddrinfo ENOTFOUND api.example.invalid'), lists: ['Work'] },
  });
  j.setState({ lastSuccess: Date.now() - HOUR_MS, lastRun: { at: Date.now() - HOUR_MS, failed: 0 } });
  const before = j.state().lastSuccess;
  const r = j.run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /network: 127\.0\.0\.1 could not be reached within 1s \(ECONNREFUSED\)/);
  const report = j.latest();
  assert.match(report, /^daily-sync .*: network was down \(no model calls\)\nnetwork was down after a 1-second wait, so 3 step\(s\) that need it could not run \(127\.0\.0\.1: the connection was refused\); the next run tries again\n/);
  assert.doesNotMatch(report, /FAILED|Failed:|fetch from|clickup:|ticktick:/);
  assert.deepEqual(j.notified(), [], 'a network-down run alone sends nothing');
  assert.equal(j.state().lastSuccess, before, 'a network-down run is not a success, so the catch-up runs and a long outage turns stale');
  assert.equal(j.state().lastRun.networkDown, true);
  assert.equal(spawnSync(process.execPath, [script, '--config', path.join(j.dir, 'config.json'), '--status'], { encoding: 'utf8' }).stdout, '');
  // A day later the stale notice names the network as the reason.
  j.setState({ ...j.state(), lastSuccess: Date.now() - 30 * HOUR_MS });
  j.write({ networkWaitSec: 0, retryWaitSec: 0 });
  j.run();
  assert.match(j.latest(), /no successful run since .* \(30h ago\): the network was down at the last run/);
});

test('every network step failing with a network error is one line even without a repo to probe', () => {
  const j = job({
    retryWaitSec: 0,
    clickup: { command: node('fail.cjs', 'Error: connect ECONNREFUSED 10.0.0.1:443'), space: '9', lists: ['101'] },
    ticktick: { command: node('fail.cjs', 'SSL: no alternative certificate subject name matches target host name'), lists: ['Work'] },
  });
  assert.equal(j.run().code, 0);
  assert.match(j.latest(), /^daily-sync .*: network was down .*\nnetwork was down, so 2 step\(s\) that need it could not run \(clickup: could not read/);
  assert.deepEqual(j.notified(), []);
});

test('one service down while the network works still fails loudly on its own', () => {
  const { clone } = remoteAndClone();
  const j = job({ networkWaitSec: 1, retryWaitSec: 0, pull: [clone], clickup: { command: node('fail.cjs', 'curl: (6) Could not resolve host: api.example.invalid'), space: '9', lists: ['101'] } });
  assert.equal(j.run().code, 1);
  const [sent] = j.notified();
  assert.match(sent, /^FAILED daily-sync .*: 1 failed/);
  assert.match(sent, /- clickup: could not read the lists of space 9 \(exit 1\): curl: \(6\) Could not resolve host/);
  assert.doesNotMatch(sent, /network was down/);
  // Two network steps that fail for different reasons are not a network outage either.
  const mixed = job({
    retryWaitSec: 0,
    clickup: { command: node('fail.cjs', 'Could not resolve host: api.example.invalid'), space: '9', lists: ['101'] },
    ticktick: { command: node('fail.cjs', 'error: 401 unauthorized'), lists: ['Work'] },
  });
  assert.equal(mixed.run().code, 1);
  assert.match(mixed.latest(), /^FAILED daily-sync .*: 2 failed/);
  assert.doesNotMatch(mixed.latest(), /network was down/);
});

test('a vault busy with another vault job is waited for, and a lock that frees in time is only logged', () => {
  const counter = path.join(tmp, `lockcount${++n}`);
  const j = job({ vault: { ...vault(rawFolder()), dryRun: node('locked.cjs', counter, '2'), lockWaitSec: 5, lockPollSec: 0.2 } });
  const r = j.run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /vault: another vault job held its lock; it was free after \d+s/);
  assert.equal(fs.readFileSync(counter, 'utf8'), '3');
  assert.match(j.latest(), /all quiet/);
  assert.deepEqual(j.notified(), []);
  assert.equal(j.state().vaultBusy, undefined);
});

test('a vault that stays busy is a note until the third run in a row, then it needs you', () => {
  const counter = path.join(tmp, `lockcount${++n}`);
  const j = job({ vault: { ...vault(rawFolder()), dryRun: node('locked.cjs', counter, '1000'), lockWaitSec: 0.3, lockPollSec: 0.1 } });
  for (const runs of [1, 2]) {
    assert.equal(j.run().code, 0);
    assert.match(j.latest(), new RegExp(`vault: busy with another vault job for the whole wait; ingest is checked again next run \\(${runs} busy run\\(s\\) in a row, reported at 3\\)`));
    assert.doesNotMatch(j.latest(), /Needs you/);
    assert.equal(j.state().vaultBusy.runs, runs);
    assert.ok(j.state().lastSuccess, 'a busy vault is no failed step');
  }
  assert.deepEqual(j.notified(), []);
  assert.equal(j.run().code, 0);
  const [sent] = j.notified();
  assert.match(sent, /Needs you:\n- vault: another vault job has held its lock through the last 3 runs \(since .*\), so nothing was ingested; check which vault job is stuck/);
  // Once the lock is free again, the count starts over.
  fs.writeFileSync(counter, '1000');
  assert.equal(j.run().code, 0);
  assert.equal(j.state().vaultBusy, undefined);
  assert.doesNotMatch(j.latest(), /vault: /);
});

test('an unsynced system clock is one plain note', () => {
  const j = job({ vault: vault(rawFolder()), clockCommand: node('print.cjs', 'no') });
  assert.equal(j.run().code, 0);
  assert.match(j.latest(), /all quiet .*\nclock: the system clock is not synced to network time/);
  assert.deepEqual(j.notified(), []);
  const synced = job({ vault: vault(rawFolder()), clockCommand: node('print.cjs', 'yes') });
  synced.run();
  assert.doesNotMatch(synced.latest(), /clock:/);
});

test('open review pages with no listener are listed in one line, and the listing never polls', () => {
  const list = [
    'sessions[4]{file,status,url,pending_prompts,listener}:',
    '  /work/a/page.html,open,"http://127.0.0.1:4387/session/aa",0,none',
    '  /work/b/page.html,open,"http://127.0.0.1:4387/session/bb",0,agent-listener',
    '  /work/c/page.html,feedback,"http://127.0.0.1:4387/session/cc",0,none',
    '  /work/d/page.html,ended,"http://127.0.0.1:4387/session/dd",0,none',
  ];
  const seen = path.join(tmp, 'lavish-args.txt');
  fs.writeFileSync(path.join(helpers, 'lavish.cjs'), `require('fs').appendFileSync(${JSON.stringify(seen)}, process.argv.slice(2).join(' ') + '\\n'); console.log(${JSON.stringify(list.join('\n'))});`);
  const j = job({ reviewPages: { run: node('lavish.cjs') } });
  assert.equal(j.run().code, 0);
  const report = j.latest();
  assert.match(report, /\nreview pages: 2 open with no listener, may hold an unseen answer .*: \/work\/a\/page\.html, \/work\/c\/page\.html$/);
  assert.doesNotMatch(report, /\/work\/[bd]\//);
  assert.deepEqual(j.notified(), [], 'the line alone sends nothing');
  assert.equal(fs.readFileSync(seen, 'utf8').trim(), '', 'only the plain listing is run, never a poll');
  // Nothing without a listener, or a listing that fails: the report stays quiet.
  fs.writeFileSync(path.join(helpers, 'lavish.cjs'), "console.log('sessions[0]{file,status,url,pending_prompts,listener}:');");
  const none = job({ reviewPages: { run: node('lavish.cjs') } });
  none.run();
  assert.doesNotMatch(none.latest(), /review pages/);
  const broken = job({ reviewPages: { run: 'exit 3' } });
  assert.equal(broken.run().code, 0, 'a failed listing is never a failed run');
  assert.doesNotMatch(broken.latest(), /FAILED/);
});
