// Tests for templates/ledger/bin/ledger.mjs against invented Firstmate homes and Claude Code
// transcripts in a throwaway folder: cursors survive a restart and a half-written line, noise
// is filtered out of the transcripts while your words stay exact, secrets are redacted, the Now
// page has its sections, concurrent `add`s all land, and the service rebuilds the page from a
// watched change well inside the periodic rescan.
// The live board: holds split into "needs you now" and "parked" by the /bearings rule, names
// from the backlog, live dots from `herdr agent list` (a stand-in here), and a server that only
// answers GET for 127.0.0.1 or localhost.
// Run: node --test test/ledger.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'templates', 'ledger', 'bin', 'ledger.mjs');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const projectDirName = (dir) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const append = (file, text) => fs.appendFileSync(file, text);

let n = 0;
/** A world: a main home with one second mate, a Claude projects folder, and a ledger config. */
function world({ backfillHours = 0, rescanSeconds = 60, board } = {}) {
  const root = path.join(tmp, `w${++n}`);
  const main = path.join(root, 'main-home');
  const clone = path.join(root, 'firstmate-clone');
  const mate = path.join(root, 'mate-home');
  const projects = path.join(root, 'claude-projects');
  const data = path.join(root, 'ledger-data');
  write(path.join(main, 'data', 'secondmates.md'), '- mate-one - You own the example project end to end.\n');
  write(path.join(main, 'state', 'mate-one.meta'), `kind=secondmate\nhome=${mate}\n`);
  write(path.join(main, 'state', 'mate-one.status'), 'working: settled in\n');
  write(path.join(main, 'state', 'blue-task.meta'), `kind=ship\nproject=${path.join(root, 'projects', 'demo-app')}\nworktree=${path.join(root, 'pool', '1', 'demo-app')}\n`);
  write(path.join(main, 'state', 'blue-task.status'), 'working: old history line\n');
  fs.mkdirSync(path.join(main, 'state', 'inbox', 'handled'), { recursive: true });
  fs.mkdirSync(path.join(mate, 'state'), { recursive: true });
  write(
    path.join(main, 'data', 'backlog.md'),
    [
      '# Backlog',
      '',
      '## In flight',
      '- [ ] pick-colour - Pick the header colour (kind: task) (since 2026-01-02) (hold: Which colour should the header use, blue or green?) (hold-kind: captain)',
      `  Captain hold set: ${new Date(Date.now() - 86_400_000).toISOString().slice(0, 19)}Z`,
      '- [ ] later-thing - Something parked (since 2026-01-02) (hold: Parked by the captain until the launch.) (hold-kind: captain)',
      '- [ ] plain-work - Ordinary work (since 2026-01-02)',
      '',
      '## Done',
      '- [ ] old-call - An old call (hold: should not show) (hold-kind: captain)',
      '',
    ].join('\n'),
  );
  const mainSessions = path.join(projects, projectDirName(clone));
  const mateSessions = path.join(projects, projectDirName(mate));
  fs.mkdirSync(mainSessions, { recursive: true });
  fs.mkdirSync(mateSessions, { recursive: true });
  write(path.join(mainSessions, 'old-session.jsonl'), `${JSON.stringify(human('an old message from before', '2026-01-01T00:00:00Z'))}\n`);
  const config = path.join(root, 'config.json');
  write(
    config,
    JSON.stringify({
      dataDir: data,
      mainHome: main,
      mainSessions: [clone],
      claudeProjects: projects,
      backfillHours,
      rescanSeconds,
      debounceMs: 50,
      redact: ['PROJECT-[0-9]+'],
      ...(board ? { board } : {}),
    }),
  );
  const run = (...args) => spawnSync(process.execPath, [script, ...args, '--config', config], { encoding: 'utf8', input: '' });
  const entries = () => {
    const file = path.join(data, 'ledger.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const now = () => fs.readFileSync(path.join(data, 'now.md'), 'utf8');
  return { root, main, mate, projects, data, config, run, entries, now, mainSessions, mateSessions };
}

let uuid = 0;
function human(text, timestamp = new Date().toISOString()) {
  return { type: 'user', uuid: `u${++uuid}`, timestamp, origin: { kind: 'human' }, message: { role: 'user', content: text } };
}
function injected(text, kind = 'task-notification') {
  return { type: 'user', uuid: `u${++uuid}`, timestamp: new Date().toISOString(), origin: { kind }, message: { role: 'user', content: text } };
}
function reply(text, stop = 'end_turn') {
  return { type: 'assistant', uuid: `u${++uuid}`, timestamp: new Date().toISOString(), message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text }] } };
}
const jsonl = (...items) => items.map((i) => `${JSON.stringify(i)}\n`).join('');

function scan(w) {
  const r = w.run('scan');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return r;
}

test('the first scan starts at the end of existing history and makes the data folder private', () => {
  const w = world();
  scan(w);
  assert.deepEqual(w.entries(), []);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(w.data).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(w.data, 'now.md')).mode & 0o777, 0o600);
  }
});

test('status lines become entries with task, project, state and kind; a restart does not duplicate them', () => {
  const w = world();
  scan(w);
  const status = path.join(w.main, 'state', 'blue-task.status');
  append(status, 'needs-decision [key=colour]: blue or green?\nresolved [key=colour]: blue, said the owner\n');
  scan(w);
  scan(w); // a fresh process: cursors are read back from disk
  const got = w.entries();
  assert.equal(got.length, 2);
  assert.equal(got[0].task, 'blue-task');
  assert.equal(got[0].project, 'demo-app');
  assert.equal(got[0].home, 'main');
  assert.equal(got[0].source, 'status');
  assert.equal(got[0].state, 'needs-decision');
  assert.equal(got[0].kind, 'status');
  assert.equal(got[0].key, 'colour');
  assert.equal(got[0].replaces, null);
  assert.equal(got[1].kind, 'decision');
  assert.match(got[1].ref, /blue-task\.status:3$/);
  // A cursor lost after a crash re-reads the file, and the ids already written keep it single.
  fs.rmSync(path.join(w.data, 'cursors.json'));
  const cursors = { version: 1, homes: {}, units: {}, initialized: 'x' };
  for (const h of [w.main, w.mate]) cursors.homes[h] = 'x';
  write(path.join(w.data, 'cursors.json'), JSON.stringify(cursors));
  scan(w);
  assert.equal(w.entries().filter((e) => e.source === 'status' && e.task === 'blue-task').length, 3); // the old history line, once
  scan(w);
  assert.equal(w.entries().filter((e) => e.source === 'status' && e.task === 'blue-task').length, 3);
});

test('a status file cleared and rewritten for a reused task id is read again from its start', () => {
  const w = world();
  scan(w);
  const status = path.join(w.main, 'state', 'blue-task.status');
  append(status, 'working: first run\n');
  scan(w);
  // Shorter than before, with its second line at the byte where "first run" was.
  const firstLine = 'working: old history line\n';
  fs.writeFileSync(status, `${'x'.repeat(firstLine.length - 1)}\nworking: 2nd\n`);
  scan(w);
  assert.deepEqual(
    w.entries().map((e) => e.text),
    ['first run', 'x'.repeat(firstLine.length - 1), '2nd'],
  );
});

test('a half-written line waits for its newline', () => {
  const w = world();
  scan(w);
  const status = path.join(w.main, 'state', 'blue-task.status');
  append(status, 'working: halfway thr');
  scan(w);
  assert.equal(w.entries().length, 0);
  append(status, 'ough the build\n');
  scan(w);
  const got = w.entries();
  assert.equal(got.length, 1);
  assert.equal(got[0].text, 'halfway through the build');
});

test('transcripts keep your exact words and final replies, and drop operational noise', () => {
  const w = world();
  scan(w);
  const words = 'Ship the  blue version first,\nthen the green one.';
  const session = path.join(w.mainSessions, 'live-session.jsonl');
  append(
    session,
    jsonl(
      human(words),
      { type: 'assistant', uuid: 'tool1', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
      { type: 'user', uuid: 'res1', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'tool_result', content: 'output' }] } },
      reply('On it: blue first.'),
      human('FIRSTMATE_OP: v1 away-supervisor: something happened'),
      human('⁣FIRSTMATE_OP: v1 wake'),
      human(": Firstmate instruction waiting: list '/x/y.inbox'/*.msg and act"),
      injected('<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>'),
      human('<task-notification><summary>done</summary></task-notification>'),
      human('<local-command-stdout>Set effort</local-command-stdout>'),
      human('[Request interrupted by user]'),
      { ...human('This session is being continued from a previous conversation that ran out of context.'), isCompactSummary: true },
      { ...human('Base directory for this skill: /x'), isMeta: true },
      human('<command-message>kun</command-message>\n<command-name>/kun</command-name>\n<command-args>review my answers</command-args>'),
      human('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>'),
      human('Keep this<system-reminder>injected context</system-reminder>'),
      { ...reply('a side chain reply'), isSidechain: true },
    ),
  );
  scan(w);
  const got = w.entries();
  assert.deepEqual(
    got.map((e) => [e.source, e.text]),
    [
      ['owner', words],
      ['agent', 'On it: blue first.'],
      ['owner', '/kun review my answers'],
      ['owner', 'Keep this'],
    ],
  );
  assert.ok(got.every((e) => e.kind === 'message' && e.home === 'main' && e.project === null));
  assert.match(got[0].ref, /live-session\.jsonl#u\d+$/);
});

test("in a second mate's home only replies to your own words are kept", () => {
  const w = world();
  scan(w);
  append(
    path.join(w.mateSessions, 's.jsonl'),
    jsonl(injected('FIRSTMATE_OP: v1 launch-brief: charter', 'human'), reply('charter read'), human('Please rename the demo'), reply('Renamed it.')),
  );
  scan(w);
  assert.deepEqual(
    w.entries().map((e) => [e.source, e.home, e.project, e.text]),
    [
      ['owner', 'mate-one', 'mate-one', 'Please rename the demo'],
      ['agent', 'mate-one', 'mate-one', 'Renamed it.'],
    ],
  );
});

test('secrets are redacted and the rest of the words kept', () => {
  const w = world();
  scan(w);
  const key = ['sk', 'ant', 'api03', 'Zx9'.repeat(10)].join('-');
  const gh = `ghp_${'a1B2'.repeat(9)}`;
  append(path.join(w.mainSessions, 'live.jsonl'), jsonl(human(`use ${key} and ${gh} with password=hunter2hunter for PROJECT-42`)));
  scan(w);
  const [e] = w.entries();
  assert.equal(e.text, 'use [redacted] and [redacted] with password=[redacted] for [redacted]');
});

test('inbox notes, in the inbox and already handled, become one entry each', () => {
  const w = world();
  scan(w);
  write(path.join(w.main, 'state', 'inbox', '100-aaa.note'), 'id=100-aaa\nat=2026-01-05T09:00:00Z\nsource=voice\n--\nRemind me about the demo on Friday\n');
  write(path.join(w.main, 'state', 'inbox', 'handled', '101-bbb.note'), 'id=101-bbb\nat=2026-01-05T09:01:00Z\nsource=text\n--\nAlso the slides\n');
  write(path.join(w.main, 'state', 'inbox', '102-ccc.note'), 'id=102-ccc\nat=2026-01-05T09:02:00Z\n'); // still being written
  scan(w);
  fs.renameSync(path.join(w.main, 'state', 'inbox', '100-aaa.note'), path.join(w.main, 'state', 'inbox', 'handled', '100-aaa.note'));
  scan(w);
  assert.deepEqual(
    w.entries().map((e) => [e.source, e.via, e.text, e.time]),
    [
      ['inbox', 'voice', 'Remind me about the demo on Friday', '2026-01-05T09:00:00.000Z'],
      ['inbox', 'text', 'Also the slides', '2026-01-05T09:01:00.000Z'],
    ],
  );
});

test('backfill records the recent past only', () => {
  const w = world({ backfillHours: 2 });
  append(path.join(w.mainSessions, 'recent.jsonl'), jsonl(human('said an hour ago', new Date(Date.now() - 3_600_000).toISOString()), human('said last week', '2026-01-01T00:00:00Z')));
  scan(w);
  const texts = w.entries().map((e) => e.text);
  assert.ok(texts.includes('said an hour ago'));
  assert.ok(!texts.includes('said last week'));
  assert.ok(!texts.includes('an old message from before'));
});

test('add appends an entry other tools can write, concurrent adds all land, tail reads them back', async () => {
  const w = world();
  const r = w.run('add', '--kind', 'fact', '--source', 'voice', '--project', 'demo-app', 'The demo moved to Friday');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^[0-9a-f]{16}$/);
  assert.equal(w.run('add', '--kind', 'opinion', 'x').status, 2);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      new Promise((resolve) => spawn(process.execPath, [script, 'add', `parallel ${i}`, '--config', w.config]).on('exit', resolve)),
    ),
  );
  const got = w.entries();
  assert.equal(got.length, 13);
  assert.deepEqual(got[0], { ...got[0], kind: 'fact', source: 'voice', project: 'demo-app', text: 'The demo moved to Friday', replaces: null });
  const tail = w.run('tail', '-n', '1', '--kind', 'fact');
  assert.match(tail.stdout, /\[fact · voice\] The demo moved to Friday/);
});

test('the Now page shows what waits on you, what is in flight, your latest words and the latest status', () => {
  const w = world();
  scan(w);
  append(path.join(w.main, 'state', 'blue-task.status'), 'needs-decision [key=size]: small or large build?\nworking: building the blue header\n');
  append(path.join(w.main, 'state', 'mate-one.status'), 'needs-decision [key=a]: answered already\nresolved [key=a]: done\n');
  append(path.join(w.mainSessions, 'live.jsonl'), jsonl(human('Blue header first, please')));
  scan(w);
  const page = w.now();
  const section = (title) => page.split(`## ${title}`)[1].split('\n## ')[0];
  const waiting = section('Waiting on you');
  assert.match(waiting, /\*\*pick-colour\*\* \(main\): Which colour should the header use, blue or green\? _\(held since/);
  assert.match(waiting, /\*\*blue-task\*\* \(main\) asks: small or large build\?/);
  assert.doesNotMatch(waiting, /answered already|old-call|plain-work/);
  assert.match(waiting, /Parked: later-thing \(held \d+ days\)/);
  const flight = section('In flight');
  assert.match(flight, /\*\*blue-task\*\* \(main\) · demo-app · copy `[^`]*demo-app` · working: building the blue header/);
  assert.match(flight, /Second mates \(1\):[\s\S]*\*\*mate-one\*\* \(main\) · resolved: done/);
  assert.match(section('Latest from you and rulings'), /main · you: Blue header first, please/);
  assert.match(section('Latest status per task'), /\*\*blue-task\*\* \(main\) working: building the blue header/);
  // Nothing changed: the page is not rewritten.
  const mtime = fs.statSync(path.join(w.data, 'now.md')).mtimeMs;
  scan(w);
  assert.equal(fs.statSync(path.join(w.data, 'now.md')).mtimeMs, mtime);
});

test('the service rebuilds the Now page from a watched change within seconds, and check proves it', async (t) => {
  const w = world({ rescanSeconds: 120 });
  assert.equal(w.run('check').status, 1);
  const svc = spawn(process.execPath, [script, 'serve', '--config', w.config], { stdio: 'ignore' });
  t.after(() => svc.kill('SIGKILL'));
  const nowFile = path.join(w.data, 'now.md');
  const waitFor = async (pred, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };
  assert.ok(await waitFor(() => fs.existsSync(path.join(w.data, 'serve.json')) && fs.existsSync(nowFile), 5000), 'service started');
  assert.equal(w.run('scan').status, 2, 'a second capturer is refused while the service runs');
  const started = Date.now();
  append(path.join(w.main, 'state', 'blue-task.status'), 'working: watched change arrives\n');
  assert.ok(await waitFor(() => fs.readFileSync(nowFile, 'utf8').includes('watched change arrives'), 5000), 'Now page rebuilt from the watch');
  const latency = Date.now() - started;
  assert.ok(latency < 3000, `rebuilt in ${latency} ms`);
  // An entry another tool adds reaches the page too.
  w.run('add', '--source', 'voice', 'noted by voice');
  append(path.join(w.mainSessions, 'live.jsonl'), jsonl(human('typed while the service runs')));
  assert.ok(await waitFor(() => fs.readFileSync(nowFile, 'utf8').includes('typed while the service runs'), 5000));
  assert.ok(await waitFor(() => w.run('check').status === 0, 8000), 'check passes while it runs');
  svc.kill('SIGKILL');
  await new Promise((r) => svc.on('exit', r));
  const r = w.run('check');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAILED ledger: the service \(pid \d+\) is not running/);
});

// ---------------------------------------------------------------- the live board

const { backlogRows, buildBoard, timeline } = await import(script);

test('needs you now versus parked follows the /bearings hold buckets exactly', () => {
  // Mirrors hold_bucket in Firstmate's bin/fm-fleet-snapshot.sh: structured fields only.
  const now = Date.parse('2026-09-27T12:00:00Z');
  const text = [
    '# Backlog',
    '## In flight',
    '- [ ] live-one - A live call (since 2026-09-20) (hold: Pick A or B?) (hold-kind: captain)',
    '- [ ] aged-one - An old call (since 2026-09-01) (hold: Still open?) (hold-kind: captain)',
    '- [ ] edge-age - Exactly the threshold (since 2026-09-13) (hold: q) (hold-kind: captain)',
    '- [ ] stamped - An old row held again (since 2026-08-01) (hold: q) (hold-kind: captain)',
    '  Captain hold set: 2026-09-26T10:00:00Z',
    '',
    '  more body',
    '- [ ] dated-one - Later (since 2026-09-26) (hold: q) (hold-kind: captain) (hold-until: 2026-10-05)',
    '- [ ] date-came - The date arrived (since 2026-08-01) (hold: q) (hold-kind: captain) (hold-until: 2026-09-27)',
    '- [ ] blocked-one - Waits on open work (since 2026-09-26) blocked-by: dep-open (hold: q) (hold-kind: captain)',
    '- [ ] missing-dep - Waits on an unknown id (since 2026-09-26) blocked-by: no-such-task (hold: q) (hold-kind: captain)',
    '- [ ] freed - Its blocker is done (since 2026-09-26) blocked-by: dep-done (hold: q) (hold-kind: captain)',
    '- [ ] prose-parked - Prose is never read (since 2026-09-26) (hold: Parked by the captain until the launch) (hold-kind: captain)',
    '- [ ] no-reason - A captain row without a hold reason (since 2026-09-26) (hold-kind: captain)',
    '- [ ] worker-hold - Held for someone else (since 2026-09-26) (hold: q) (hold-kind: maintainer)',
    '## Queued',
    '- [ ] dep-open - Open work (since 2026-09-20)',
    '## Notes',
    '- [ ] not-a-row - Outside the three sections (hold: q) (hold-kind: captain)',
    '## Done',
    '- [x] dep-done - Finished (done 2026-09-27)',
    '- [x] closed-call - Answered (done 2026-09-27) (hold: q) (hold-kind: captain)',
  ].join('\n');
  const bucket = Object.fromEntries(backlogRows(text, { now }).map((r) => [r.id, r.bucket]));
  assert.deepEqual(bucket, {
    'live-one': 'live',
    'aged-one': 'aged',
    'edge-age': 'aged',
    stamped: 'live',
    'dated-one': 'dated',
    'date-came': 'live',
    'blocked-one': 'blocked',
    'missing-dep': 'blocked',
    freed: 'live',
    'prose-parked': 'live',
    'no-reason': null,
    'worker-hold': null,
    'dep-open': null,
    'dep-done': null,
    'closed-call': null,
  });
  // The age threshold is a setting (FM_SNAPSHOT_UNDATED_HOLD_AGE_DAYS in Firstmate).
  assert.equal(backlogRows(text, { now, ageDays: 30 }).find((r) => r.id === 'aged-one').bucket, 'live');
  const title = backlogRows(text, { now }).find((r) => r.id === 'blocked-one').title;
  assert.equal(title, 'Waits on open work');
});

/** A world for the board: holds of each kind, a landed row, and agents from a stand-in herdr. */
function boardWorld(extra = {}) {
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const recent = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const root = path.join(tmp, `b${++n}`);
  const agentsFile = path.join(root, 'agents.json');
  const stub = path.join(root, 'herdr-stub.mjs');
  write(stub, `import fs from 'node:fs';\nprocess.stdout.write(fs.readFileSync(${JSON.stringify(agentsFile)}, 'utf8'));\n`);
  const w = world({ board: { enabled: true, port: 0, agents: [process.execPath, stub], ...extra } });
  write(agentsFile, '[]');
  write(
    path.join(w.main, 'data', 'backlog.md'),
    [
      '# Backlog',
      '## In flight',
      `- [ ] blue-task - Build the blue header (repo: demo-app) (kind: ship) (since ${recent})`,
      `- [ ] pick-colour - Pick the header colour (since ${recent}) (hold: Blue or green?) (hold-kind: captain)`,
      `- [ ] wait-launch - After the launch (since ${recent}) (hold: q) (hold-kind: captain) (hold-until: 2999-01-01)`,
      '## Done',
      `- [x] shipped - The footer shipped (merged ${ymd})`,
      '- [x] old-ship - An older one (merged 2020-01-01)',
    ].join('\n'),
  );
  write(path.join(w.main, 'state', 'blue-task.meta'), `kind=ship\nproject=${path.join(w.root, 'projects', 'demo-app')}\nworktree=${path.join(w.root, 'pool', '1', 'demo-app')}\nherdr_pane_id=w1:p7\n`);
  write(path.join(w.main, 'state', 'mate-one.meta'), `kind=secondmate\nhome=${w.mate}\nherdr_pane_id=w2:p1\n`);
  write(path.join(w.mate, 'data', 'backlog.md'), `# Backlog\n## In flight\n- [ ] mate-call - A question from the mate (since ${recent}) (hold: Ship on Friday?) (hold-kind: captain)\n- [ ] mate-job - Tidy the docs (since ${recent})\n`);
  write(path.join(w.mate, 'state', 'mate-job.meta'), `kind=task\nproject=${path.join(w.root, 'projects', 'docs-site')}\nworktree=${path.join(w.root, 'pool', '2', 'docs-site')}\n`);
  write(path.join(w.mate, 'state', 'mate-job.status'), 'paused: waiting for the docs build\n');
  return { ...w, agentsFile };
}

const homesOf = (w) => [
  { name: 'main', path: w.main, sessions: [], main: true },
  { name: 'mate-one', path: w.mate, sessions: [] },
];

test('the board snapshot: counts, a lane per mate, names from the backlog, live dots', () => {
  const w = boardWorld();
  const agents = [
    { pane_id: 'w1:p7', agent_status: 'working', cwd: '/elsewhere', foreground_cwd: '/elsewhere', terminal_title: 'Firstmate operational input' },
    { pane_id: 'w2:p1', agent_status: 'idle', cwd: w.mate, foreground_cwd: w.mate, terminal_title: 'Firstmate operational input' },
  ];
  const b = buildBoard(homesOf(w), agents);
  assert.deepEqual(b.counts, { needs: 2, working: 1, landed: 1, parked: 1 });
  assert.equal(b.live, 'ok');
  assert.deepEqual(b.lanes.map((l) => [l.id, l.dot]), [['main', 'stopped'], ['mate-one', 'idle']]);
  assert.equal(b.lanes[1].word, 'Working');
  const blue = b.rows.find((r) => r.task === 'blue-task');
  assert.equal(blue.name, 'Build the blue header', 'the name comes from the task record, not the terminal title');
  assert.equal(blue.project, 'demo-app');
  assert.equal(blue.dot, 'working');
  assert.equal(blue.word, 'Working');
  const job = b.rows.find((r) => r.task === 'mate-job');
  assert.deepEqual([job.lane, job.name, job.dot, job.word, job.text], ['mate-one', 'Tidy the docs', 'stopped', 'Waiting', 'waiting for the docs build']);
  assert.ok(!b.rows.some((r) => r.task === 'mate-one'), 'a second mate is a lane, not a card');
  assert.deepEqual(b.needs.map((x) => [x.lane, x.task, x.question]).sort(), [['main', 'pick-colour', 'Blue or green?'], ['mate-one', 'mate-call', 'Ship on Friday?']]);
  assert.deepEqual(b.parked.map((x) => [x.task, x.why]), [['wait-launch', 'until 2999-01-01']]);
  assert.deepEqual(b.landed.map((x) => [x.task, x.verb]), [['shipped', 'merged']]);
  // Without live status, dots say so instead of claiming stopped.
  const blind = buildBoard(homesOf(w), null);
  assert.equal(blind.live, 'unavailable');
  assert.ok(blind.rows.every((r) => r.dot === 'unknown'));
});

test('a task asking a question shows it on its card; its timeline comes from the ledger, newest first', () => {
  const w = boardWorld();
  append(path.join(w.main, 'state', 'blue-task.status'), 'needs-decision [key=size]: small or large build?\n');
  const b = buildBoard(homesOf(w), []);
  const blue = b.rows.find((r) => r.task === 'blue-task');
  assert.equal(blue.word, 'Asking');
  assert.equal(blue.asks, 'small or large build?');
  const entries = [
    { home: 'main', task: 'blue-task', time: '2026-01-01T00:00:00Z', state: 'working', kind: 'status', text: 'first' },
    { home: 'mate-one', task: 'blue-task', time: '2026-01-01T00:01:00Z', state: 'working', kind: 'status', text: 'another home' },
    { home: 'main', task: 'blue-task', time: '2026-01-01T00:02:00Z', state: 'done', kind: 'status', text: 'second' },
  ];
  assert.deepEqual(timeline(entries, 'main', 'blue-task').map((e) => [e.word, e.text]), [['Done', 'second'], ['Working', 'first']]);
});

function request(port, pathname, { method = 'GET', host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the service serves the board on 127.0.0.1 only, read only, with the theme and its files', async (t) => {
  const themeDir = path.join(tmp, `theme${++n}`);
  write(path.join(themeDir, 'look.css'), ':root { --accent: #123456; }\n');
  write(path.join(themeDir, 'face.woff2'), 'font-bytes');
  const w = boardWorld({ theme: path.join(themeDir, 'look.css') });
  write(w.agentsFile, JSON.stringify({ result: { agents: [{ pane_id: 'w1:p7', agent_status: 'working', cwd: '/x', foreground_cwd: '/x' }] } }));
  const svc = spawn(process.execPath, [script, 'serve', '--config', w.config], { stdio: 'ignore' });
  t.after(() => svc.kill('SIGKILL'));
  const hbFile = path.join(w.data, 'serve.json');
  let url = null;
  for (const end = Date.now() + 5000; !url && Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
    url = fs.existsSync(hbFile) ? JSON.parse(fs.readFileSync(hbFile, 'utf8')).board : null;
  }
  assert.match(url || '', /^http:\/\/127\.0\.0\.1:\d+\/$/, 'the heartbeat names the board');
  const port = Number(new URL(url).port);
  const page = await request(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Needs you now[\s\S]*Working now[\s\S]*Landed today/);
  const snap = await request(port, '/api/board');
  const b = JSON.parse(snap.body);
  assert.deepEqual(b.counts, { needs: 2, working: 1, landed: 1, parked: 1 });
  assert.ok(b.generated_at && b.poll_seconds > 0);
  append(path.join(w.main, 'state', 'blue-task.status'), 'working: painting it blue\n');
  const end = Date.now() + 5000;
  let tl = [];
  while (Date.now() < end && !tl.some((e) => e.text === 'painting it blue')) {
    tl = JSON.parse((await request(port, '/api/timeline?home=main&task=blue-task')).body).entries;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(tl[0].text, 'painting it blue', 'a new status line reaches the timeline');
  assert.equal((await request(port, '/theme.css')).body, ':root { --accent: #123456; }\n');
  const font = await request(port, '/theme/face.woff2');
  assert.deepEqual([font.status, font.type, font.body], [200, 'font/woff2', 'font-bytes']);
  assert.equal((await request(port, '/theme/..%2Fsecret.css')).status, 404);
  assert.equal((await request(port, '/theme/config.json')).status, 404, 'only style and font files');
  assert.equal((await request(port, '/api/board', { host: 'attacker.example' })).status, 403, 'another host name is refused');
  assert.equal((await request(port, '/api/board', { method: 'POST' })).status, 405, 'read only');
  assert.equal(w.run('check').status, 0);
  assert.match(w.run('check').stdout, /board http:\/\/127\.0\.0\.1:/);
});
