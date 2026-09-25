// Tests for templates/voice-mode/bin against throwaway folders, a fake realtime provider, a
// stubbed decision model and a stubbed launcher: no network, no audio devices, nothing opened.
// Covers what may be read (and what never is), how questions and work are handed off (and answers come back), which actions can run,
// how the chooser decides mid-sentence, barge-in, and both provider adapters' event handling.
// Run: node --test test/voice-mode.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(repoRoot, 'templates', 'voice-mode', 'bin');
const { merge, parseEnvFile, readKey, expandGlob, loadConfig, DEFAULTS } = await import(path.join(bin, 'config.mjs'));
const { Records, runTool } = await import(path.join(bin, 'records.mjs'));
const { Chooser, buildCatalog, criteria, perform, controlActions, spans, focusScript, describe, typeable, SYSTEM } = await import(path.join(bin, 'desk.mjs'));
const { OpenAIRealtime, GeminiLive, FakeProvider } = await import(path.join(bin, 'providers.mjs'));
const { Session, PROMISE, streamClip, speechBounds, acquireLock, claimLock, releaseLock, lockHolder, decisionLine } = await import(path.join(bin, 'voice-mode.mjs'));
const net = await import('node:net');
const { spawn } = await import('node:child_process');
const { resample, tone, Speaker } = await import(path.join(bin, 'audio.mjs'));
const { startOrb, toLevel } = await import(path.join(bin, 'orb.mjs'));
const { redact, transcriptTail, sections, buildBriefing } = await import(path.join(bin, 'briefing.mjs'));
const { noteText, savePending, saveReply, waitingReplies, markSpoken, handoffDir, Deliveries } = await import(path.join(bin, 'handoff.mjs'));
const { parseCommand, qtKey } = await import(path.join(repoRoot, 'modules', 'voice-mode', 'module.mjs'));

// Resolved, because macOS's temp folder is a symlink and opened paths are resolved ones.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-mode-test-')));
const data = path.join(tmp, 'data');
const docs = path.join(tmp, 'Documents');
const outside = path.join(tmp, 'outside');
for (const d of [data, path.join(data, 'task-a'), docs, path.join(docs, 'Projects'), outside]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(data, 'backlog.md'), '# Backlog\n\n- fix the login bug (in progress)\n- write the quarterly summary (waiting on the owner)\n');
fs.writeFileSync(path.join(data, 'learnings.md'), '# Learnings\n\nCredential lookups dominate voice latency.\n');
fs.writeFileSync(path.join(data, 'task-a', 'report.md'), 'The login bug is a stale session cookie.\n');
fs.writeFileSync(path.join(data, 'api-keys.md'), 'login secret value\n');
fs.writeFileSync(path.join(data, '.env'), 'TOKEN=login\n');
fs.writeFileSync(path.join(outside, 'private.md'), 'login outside the sources\n');
fs.symlinkSync(path.join(outside, 'private.md'), path.join(data, 'escape.md'));
fs.writeFileSync(path.join(docs, 'notes.md'), 'a document\n');
fs.writeFileSync(path.join(docs, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
fs.writeFileSync(path.join(docs, 'app.desktop'), '[Desktop Entry]\n');

// A queue command that records its arguments, one per line.
const queued = path.join(tmp, 'queued.txt');
const queueScript = path.join(tmp, 'queue.cjs');
fs.writeFileSync(queueScript, `require('fs').appendFileSync(${JSON.stringify(queued)}, process.argv.slice(2).join('\\n') + '\\n=====\\n');`);

function config(over = {}) {
  return merge(merge(DEFAULTS, {
    provider: 'fake',
    logDir: path.join(tmp, 'logs'),
    sources: [{ name: 'notes', path: data, show: true, about: 'records' }],
    queue: { command: [process.execPath, queueScript, '--from-voice'], env: {} },
    handoff: { dir: path.join(tmp, 'handoff'), replyCommand: 'voice-mode reply' },
    actions: { documents: docs, discoverApps: false, apps: [{ id: 'firefox', name: 'Firefox web browser', desktop: 'firefox.desktop' }], sites: [{ id: 'mail', name: 'Mail', url: 'https://mail.example.com' }] },
  }), over);
}

// A stand-in for the decision model: answers by keyword, with a probability per option.
function fakeDecisions(rules, calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const heard = body.state.heard_so_far;
    calls.push(heard);
    const hit = rules.find(([re]) => re.test(heard));
    const [, choice, p] = hit || [null, 'none', 1];
    return { ok: true, json: async () => ({ answers: { target: { type: 'choice', choice, confidence: p, probabilities: { [choice]: p } } } }) };
  };
}

// ------------------------------------------------------------------ config

test('env files: values parsed, quotes stripped, missing file or key is empty', () => {
  assert.deepEqual(parseEnvFile('# c\nA=1\nexport B="two"\nC=\'3\'\n\nbad line'), { A: '1', B: 'two', C: '3' });
  const f = path.join(tmp, 'keys.env');
  fs.writeFileSync(f, 'OPENAI_API_KEY=abc\nGEMINI_API_KEY=\n');
  assert.equal(readKey(f, 'OPENAI_API_KEY'), 'abc');
  assert.equal(readKey(f, 'GEMINI_API_KEY'), '');
  assert.equal(readKey(path.join(tmp, 'none.env'), 'OPENAI_API_KEY'), '');
});

test('config: one provider line switches it; a wildcard source becomes one source per match', () => {
  const homes = path.join(tmp, 'homes');
  for (const h of ['one', 'two']) fs.mkdirSync(path.join(homes, h, 'data'), { recursive: true });
  const file = path.join(tmp, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ provider: 'gemini', sources: [{ name: 'home', path: path.join(homes, '*', 'data') }] }));
  const c = loadConfig(file);
  assert.equal(c.provider, 'gemini');
  assert.equal(c.providers.gemini.model, DEFAULTS.providers.gemini.model);
  assert.deepEqual(c.sources.map((s) => s.name), ['home one', 'home two']);
  assert.equal(expandGlob(path.join(homes, '*', 'missing')).length, 0);
  fs.writeFileSync(file, JSON.stringify({ provider: 'nope' }));
  assert.throws(() => loadConfig(file), /unknown provider/);
});

// ------------------------------------------------------------------ records

test('records: search finds text in the sources and never in key files or outside them', async () => {
  const r = new Records(config());
  const { results } = await r.search('login bug');
  const names = results.map((x) => x.record);
  assert.ok(names.includes('notes/backlog.md'));
  assert.ok(names.includes('notes/task-a/report.md'));
  assert.ok(!names.some((n) => /api-keys|\.env|escape/.test(n)), `unexpected: ${names}`);
});

test('records: read stays inside the sources, refusing traversal and symlinks out', () => {
  const r = new Records(config());
  assert.match(r.read('notes/backlog.md').text, /login bug/);
  assert.match(r.read('notes/../outside/private.md').error, /no readable record/);
  assert.match(r.read('notes/escape.md').error, /no readable record/);
  assert.match(r.read(path.join(outside, 'private.md')).error, /no readable record/);
  assert.match(r.read('notes/api-keys.md').error, /not a text record/);
  assert.ok(r.list().recent.some((x) => x.record === 'notes/backlog.md'));
});

test('records: the queue command gets the note as one argument, never through a shell', async () => {
  fs.rmSync(queued, { force: true });
  const r = new Records(config());
  const req = 'tidy the learnings; rm -rf ~ $(whoami) "quoted"';
  assert.deepEqual(await r.queue(req), { queued: true });
  assert.equal(fs.readFileSync(queued, 'utf8'), `--from-voice\n${req}\n=====\n`);
  assert.deepEqual(await new Records(config({ queue: { command: [] } })).queue('x'), { queued: false, error: 'no queue command is configured' });
});

// ------------------------------------------------------------------ desktop actions

test('catalog: apps, sites, documents folders and records, each with a fixed id', () => {
  const c = config();
  const cat = buildCatalog(c, new Records(c));
  for (const key of ['app:firefox', 'site:mail', 'folder:documents', 'folder:projects', 'record:notes-backlog']) assert.ok(cat.has(key), key);
  const crit = criteria(cat);
  assert.ok('none' in crit);
  assert.match(crit['record:notes-backlog'], /^Show on screen/);
});

test('perform: opens only catalog items, only inside the allowed folders, never a program', async () => {
  const runs = [];
  const run = async (argv) => runs.push(argv);
  const roots = [docs, data];
  await perform({ kind: 'app', name: 'Firefox', desktop: 'firefox.desktop' }, { roots, platform: 'linux', run, has: () => true });
  await perform({ kind: 'app', name: 'Firefox', desktop: 'firefox.desktop' }, { roots, platform: 'linux', run, has: () => false });
  await perform({ kind: 'app', name: 'Safari (Web Browser)' }, { roots, platform: 'darwin', run });
  await perform({ kind: 'site', url: 'https://mail.example.com' }, { roots, platform: 'linux', run });
  await perform({ kind: 'folder', path: path.join(docs, 'Projects') }, { roots, platform: 'linux', run });
  await perform({ kind: 'record', path: path.join(data, 'backlog.md') }, { roots, platform: 'darwin', run });
  assert.deepEqual(runs, [
    ['kstart', '--application', 'firefox.desktop'],
    ['gtk-launch', 'firefox.desktop'],
    ['open', '-a', 'Safari'],
    ['xdg-open', 'https://mail.example.com'],
    ['xdg-open', path.join(docs, 'Projects')],
    ['open', path.join(data, 'backlog.md')],
  ]);
  const refuse = (item, re) => assert.rejects(perform(item, { roots, platform: 'linux', run }), re);
  await refuse(undefined, /not in the catalog/);
  await refuse({ kind: 'site', url: 'file:///etc/passwd' }, /only http/);
  await refuse({ kind: 'file', path: path.join(outside, 'private.md') }, /outside/);
  await refuse({ kind: 'record', path: path.join(data, 'escape.md') }, /outside/);
  await refuse({ kind: 'file', path: path.join(docs, 'run.sh') }, /a program/);
  await refuse({ kind: 'file', path: path.join(docs, 'app.desktop') }, /a program/);
  await refuse({ kind: 'folder', path: path.join(docs, 'notes.md') }, /not a folder/);
  assert.equal(runs.length, 6);
});

test('chooser: acts once, mid-sentence, only above the threshold; a question opens nothing', async () => {
  const c = config();
  const cat = buildCatalog(c, new Records(c));
  const done = [];
  const calls = [];
  const fetchImpl = fakeDecisions([[/open firefox/i, 'app:firefox', 0.99], [/open fire/i, 'app:firefox', 0.6], [/documents/i, 'folder:documents', 0.8]], calls);
  const ch = new Chooser(c, cat, { execute: async (k, info) => done.push([k, info.final]), fetchImpl });
  ch.key = 'test';
  ch.reset(0);
  for (const t of ['can', 'can you open fire', 'can you open firefox', 'can you open firefox please']) {
    ch.hear(t);
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(done, [['app:firefox', false]]);
  assert.ok(!calls.includes('can you open firefox please'), 'no calls after acting');

  // Below the mid-sentence threshold, but enough once the sentence is final.
  done.length = 0;
  ch.reset(0);
  ch.hear('open my documents');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(done, []);
  ch.hear('open my documents', true);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(done, [['folder:documents', true]]);

  done.length = 0;
  ch.reset(0);
  ch.hear('what is waiting on me', true);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(done, []);
});

test('chooser: without a key it is off and never calls out', () => {
  const c = config();
  const ch = new Chooser(c, buildCatalog(c, new Records(c)), { fetchImpl: () => assert.fail('called') });
  ch.key = '';
  ch.hear('open firefox', true);
  assert.equal(ch.ready, false);
});

// ------------------------------------------------------------------ session, end to end on the fake provider

function clip(rate) {
  return Buffer.concat([Buffer.alloc(rate * 2 * 0.2), tone(rate, 200, 900, 0.3), Buffer.alloc(rate * 2 * 0.1)]);
}

test('session: speech opens the app before the sentence ends, the reply is timed, the model is told', async () => {
  const c = config();
  const performed = [];
  const logs = [];
  const script = [{ text: 'please open firefox for me now', tools: [{ name: 'desktop_action' }], reply: 'Firefox is open.' }];
  const session = new Session(c, { script, log: (r) => logs.push(r), performImpl: async (item) => performed.push(item.name) });
  session.provider.cfg.wordMs = 120;
  session.chooser.key = 'test';
  session.chooser.fetch = fakeDecisions([[/open firefox/i, 'app:firefox', 0.97]]);
  const results = [];
  session.provider.toolResult = ((orig) => (call, result) => {
    results.push(result);
    orig.call(session.provider, call, result);
  })(session.provider.toolResult);
  await session.connect();
  const turn = await streamClip(session, clip(session.provider.inputRate), { timeoutMs: 8000 });
  session.close();
  assert.deepEqual(performed, ['Firefox web browser']);
  assert.equal(turn.action, 'app:firefox');
  assert.equal(turn.action_before_speech_end, true);
  assert.ok(turn.action_ms > 0 && turn.action_ms < 1200, `action_ms ${turn.action_ms}`);
  assert.ok(turn.first_audio_ms > 0, `first_audio_ms ${turn.first_audio_ms}`);
  assert.deepEqual(results, [{ opened: ['opened Firefox web browser'] }]);
  assert.ok(logs.some((l) => l.event === 'turn'));
});

test('session: a hand-off sends one note with an id and the reply command, and its answer is spoken as the reply', async () => {
  fs.rmSync(queued, { force: true });
  const c = config();
  fs.rmSync(handoffDir(c), { recursive: true, force: true });
  const script = [{ text: 'is the login fix merged yet', tools: [{ name: 'hand_off', args: { request: 'is the login fix merged yet', kind: 'question' } }], reply: 'Let me check.' }];
  const logs = [];
  const session = new Session(c, { script, log: (r) => logs.push(r), performImpl: async () => assert.fail('nothing to open') });
  session.chooser.key = 'test';
  session.chooser.fetch = fakeDecisions([]);
  assert.ok(session.provider.tools.some((t) => t.name === 'hand_off'));
  await session.connect();
  const turn = await streamClip(session, clip(session.provider.inputRate), { timeoutMs: 8000 });
  assert.deepEqual(turn.tools, ['hand_off']);
  const note = fs.readFileSync(queued, 'utf8').split('\n')[1];
  const id = /^Voice question (vq-[0-9a-f]{6}): "is the login fix merged yet" -- .* with: voice-mode reply vq-[0-9a-f]{6} "<answer>"$/.exec(note)?.[1];
  assert.ok(id, note);
  // The answer comes back through the reply queue and is spoken in a quiet moment.
  saveReply(c, id, 'Yes, it merged this morning.');
  const [waiting] = waitingReplies(c);
  assert.equal(waiting.question.request, 'is the login fix merged yet');
  session.lastLoud = 0;
  assert.ok(session.quiet());
  assert.ok(session.speakAnswer(waiting));
  markSpoken(c, id);
  assert.equal(session.quiet(), false, 'one answer at a time');
  const until = performance.now() + 4000;
  while (!logs.some((l) => l.event === 'handoff-answer') && performance.now() < until) await new Promise((r) => setTimeout(r, 20));
  session.close();
  assert.match(session.provider.said[0], /Answer arrived .*"is the login fix merged yet".*: Yes, it merged this morning\./);
  assert.match(session.provider.said[0], /as your own answer/);
  const heard = logs.find((l) => l.event === 'handoff-answer');
  assert.equal(heard.id, id);
  assert.ok(heard.round_trip_ms > 0 && heard.speak_ms >= 0, JSON.stringify(heard));
  assert.deepEqual(waitingReplies(c), []);
  assert.throws(() => saveReply(c, id, 'again'), /already answered and spoken/);
});

test('session: an answer not heard stays queued, is tried again after a pause, then given up on', () => {
  const c = config();
  fs.rmSync(handoffDir(c), { recursive: true, force: true });
  const logs = [];
  const session = new Session(c, { script: [], log: (r) => logs.push(r) });
  const said = [];
  session.provider.say = (text) => said.push(text) > 0;
  const deliveries = new Deliveries(c, { maxTries: 3, backoffMs: 1000 });
  session.onUnheard = (a) => deliveries.failed(a.id, 0);
  session.onAnswer = (a) => deliveries.heard(a.id);
  savePending(c, { id: 'vq-00000a', request: 'q', askedAt: Date.now() });
  saveReply(c, 'vq-00000a', 'yes');
  assert.ok(session.speakAnswer(deliveries.next(0)));
  session.provider.emit('reply-done');
  assert.equal(session.aside, null);
  assert.deepEqual(logs.filter((l) => l.event === 'handoff-unheard').map((l) => l.why), ['no audio']);
  assert.equal(deliveries.next(500), null, 'waits before trying again');
  assert.equal(deliveries.next(1000).id, 'vq-00000a');
  // The user talking before it starts: not heard either.
  session.speakAnswer(deliveries.next(1000));
  session.onSpeechStart();
  assert.equal(logs.filter((l) => l.event === 'handoff-unheard').at(-1).why, 'the user spoke first');
  assert.equal(deliveries.next(1500), null, 'a longer pause the second time');
  // A provider that cannot cancel gives the answer anyway: delivered, not tried again.
  session.provider.canCancel = false;
  const delivered = [];
  session.onAnswer = (x) => delivered.push(x.id);
  session.speakAnswer(deliveries.next(10000));
  session.onSpeechStart();
  assert.deepEqual(delivered, ['vq-00000a']);
  session.onAnswer = (x) => deliveries.heard(x.id);
  session.provider.canCancel = undefined;
  saveReply(c, 'vq-00000a', 'yes');
  assert.equal(deliveries.failed('vq-00000a', 0), true, 'third miss: given up');
  assert.deepEqual(waitingReplies(c), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(handoffDir(c), 'spoken', 'vq-00000a.json'), 'utf8')).unheard, true);
  // Heard: out of the queue at once.
  savePending(c, { id: 'vq-00000b', request: 'q2' });
  saveReply(c, 'vq-00000b', 'no');
  session.speakAnswer(deliveries.next());
  session.onReplyAudio(Buffer.alloc(960));
  assert.deepEqual(waitingReplies(c), []);
  session.close();
});

test('session: a reply that promises to check without calling hand_off hands off the words itself', async () => {
  fs.rmSync(queued, { force: true });
  const c = config();
  const script = [{ text: 'did the vendor reply', reply: 'Let me check.' }];
  const session = new Session(c, { script, performImpl: async () => assert.fail('nothing to open') });
  session.chooser.key = 'test';
  session.chooser.fetch = fakeDecisions([]);
  session.provider.on('reply-text', () => {});
  await session.connect();
  session.provider.streamReply = function (spec) {
    this.emit('reply-text', spec.reply);
    this.emit('reply-done');
  };
  const turn = await streamClip(session, clip(session.provider.inputRate), { timeoutMs: 8000 });
  await new Promise((r) => setTimeout(r, 300));
  session.close();
  assert.deepEqual(turn.tools, ['hand_off (auto)']);
  assert.match(fs.readFileSync(queued, 'utf8'), /^Voice question vq-[0-9a-f]{6}: "did the vendor reply"/m);
  for (const yes of ['Let me check.', 'On it, captain.', "I'll look into it now.", 'Checking now.']) assert.match(yes, PROMISE, yes);
  for (const no of ['The team is working on it.', 'It is checking the build.', 'You can check the backlog.']) assert.doesNotMatch(no, PROMISE, no);
});

test('session: without a queue command there is no hand_off tool', () => {
  const session = new Session(config({ queue: { command: [] } }), { script: [] });
  assert.ok(!session.provider.tools.some((t) => t.name === 'hand_off'));
  assert.doesNotMatch(session.provider.instructions, /hand_off|hand them off|Answer arrived/);
  assert.match(session.provider.instructions, /voice mode cannot do that/);
  assert.match(new Session(config(), { script: [] }).provider.instructions, /call hand_off in that same reply/);
  session.close();
});

// ------------------------------------------------------------------ hand-off and briefing

test('handoff: the note format, and reply validation', () => {
  const c = config();
  assert.equal(
    noteText({ id: 'vq-0a1b2c', kind: 'task', request: 'draft\n the  summary', replyCommand: 'voice-mode reply' }),
    'Voice request vq-0a1b2c: "draft the summary" -- the user is waiting in voice mode; answer in one to three short spoken sentences with: voice-mode reply vq-0a1b2c "<answer>"',
  );
  assert.throws(() => saveReply(c, '../x', 'hi'), /not a voice hand-off id/);
  assert.throws(() => saveReply(c, 'vq-ffffff', 'hi'), /no voice hand-off vq-ffffff/);
  savePending(c, { id: 'vq-000001', request: 'first', at: 1 });
  savePending(c, { id: 'vq-000002', request: 'second', at: 2 });
  assert.throws(() => saveReply(c, 'vq-000001', '  '), /empty/);
  assert.throws(() => saveReply(c, 'vq-000001', 'x'.repeat(4001)), /4000/);
  saveReply(c, 'vq-000002', 'two');
  const t = Date.now();
  while (Date.now() === t);
  saveReply(c, 'vq-000001', 'one');
  const w = waitingReplies(c);
  assert.deepEqual(w.map((r) => r.text), ['two', 'one'], 'in the order the answers came');
  for (const r of w) markSpoken(c, r.id);
  assert.deepEqual(waitingReplies(c), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(handoffDir(c), 'spoken', 'vq-000001.json'), 'utf8')).reply.text, 'one');
});

test('redact: keys, tokens, passwords and secret lines go; ordinary ids stay', () => {
  // Built from pieces so no key-shaped literal sits in the repo for secret scanners to flag.
  const k = (...parts) => parts.join('');
  const cases = [
    [k('the one sk', '-', 'proj-AbC123dEf456GhI789jKl0 here'), /sk-proj/],
    [k('OPENROUTER_API_KEY=sk-', 'or-v1-0123456789abcdef0123'), /0123456789abcdef/],
    [k('export GEMINI_API_KEY="AI', 'zaSyA-1234567890abcdefghijklmnopqrstu"'), /zaSy/],
    [k('AI', 'zaSyA-1234567890abcdefghijklmnopqrstu alone'), /zaSy/],
    ['DB_PASSWORD=hunter2', /hunter2/],
    ['{"client_secret": "s3cr3t-value"}', /s3cr3t/],
    ['Authorization: Bearer abcdefghijklmnop.qrstuv', /abcdefghijklmnop/],
    [k('curl -H "x-api', '-key', ': ', '9f8e7d', '6c5b4a"'), /9f8e7d6c5b4a/],
    ['my password is correcthorse', /correcthorse/],
    ['git clone https://me:tok3n-value@example.com/r.git', /tok3n/],
    [k('gh', 'p_0123456789abcdefghijABCDEFGHIJ012345'), /p_0123/],
    [k('AK', 'IAQWERTYUIOPASDFGH'), /QWERTY/],
    [k('ey', 'JhbGciOiJIUzI1NiJ9.ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'), /JhbGci/],
    [k('-----BEGIN OPENSSH PRIV', 'ATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIV', 'ATE KEY-----'), /b3BlbnNz/],
    [k('token', ': ', 'Xy7Qw2Er9Ty4Ui8Op3As6Df1Gh5Jk0Lz'), /Xy7Qw2Er9/],
  ];
  for (const [text, gone] of cases) assert.doesNotMatch(redact(text), gone, text);
  const safe = 'commit 9d7fe7c0a1b2c3d4e5f60718293a4b5c6d7e8f90 on run 550e8400-e29b-41d4-a716-446655440000, PR 11, the key decision, tokens: 350k, password reset flow';
  assert.equal(redact(safe), safe);
});

test('briefing: transcript text only, sections, globs, budgets, and redaction', () => {
  const dir = path.join(tmp, 'brief');
  const proj = path.join(dir, 'project');
  fs.mkdirSync(proj, { recursive: true });
  const lines = [
    { type: 'user', message: { content: 'what is left on the login fix? <system-reminder>hidden</system-reminder>' } },
    { type: 'user', isMeta: true, message: { content: 'meta' } },
    { type: 'user', message: { content: '<task-notification>done</task-notification>' } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private' }, { type: 'tool_use', name: 'Bash', input: {} }, { type: 'text', text: `Only the review. Key sk-${'proj'}-AbC123dEf456GhI789jKl0.` }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'tool output' }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'side' }] } },
  ];
  fs.writeFileSync(path.join(proj, 'old.jsonl'), '{"type":"user","message":{"content":"older session"}}\n');
  fs.utimesSync(path.join(proj, 'old.jsonl'), new Date(0), new Date(0));
  fs.writeFileSync(path.join(proj, 'new.jsonl'), `partial line}\n${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  assert.deepEqual(transcriptTail(path.join(proj, 'new.jsonl')), [
    { who: 'User', text: 'what is left on the login fix?' },
    { who: 'Assistant', text: `Only the review. Key sk-${'proj'}-AbC123dEf456GhI789jKl0.` },
  ]);
  const md = '# Backlog\n\n## In flight\n- login fix\n\n## Done\n- old thing\n\n## Queued\n- summary\n';
  fs.writeFileSync(path.join(dir, 'backlog.md'), md);
  assert.equal(sections(md, ['In flight', 'queued']), '## In flight\n- login fix\n\n## Queued\n- summary');
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(path.join(dir, 'state', 'login.status'), 'working: started\nworking: tests green\n');
  fs.writeFileSync(path.join(dir, 'state', 'stale.status'), 'done: long ago\n');
  fs.utimesSync(path.join(dir, 'state', 'stale.status'), new Date(0), new Date(0));
  const b = buildBriefing(config({ briefing: { parts: [
    { name: 'Recent conversation', transcript: proj },
    { name: 'Current work', path: path.join(dir, 'backlog.md'), sections: ['In flight'] },
    { name: 'Live status', glob: path.join(dir, 'state', '*.status'), hours: 24 },
    { name: 'Gone', path: path.join(dir, 'missing.md') },
  ] } }));
  assert.deepEqual(b.missing, ['Gone']);
  assert.match(b.text, /## Recent conversation\nUser: what is left on the login fix\?\n\nAssistant: Only the review\. Key \[redacted key\]\./);
  assert.match(b.text, /## Current work\n## In flight\n- login fix/);
  assert.match(b.text, /## Live status\n- login: working: tests green/);
  assert.doesNotMatch(b.text, /older session|private|tool output|side|hidden|old thing|long ago|sk-proj/);
  // A budget keeps the newest messages.
  const small = buildBriefing(config({ briefing: { parts: [{ name: 'c', transcript: proj, maxChars: 80 }] } }));
  assert.doesNotMatch(small.text, /User:/);
  assert.match(small.text, /Assistant: Only the review/);
});

test('session: talking over a reply cuts it (barge-in), and the provider is told how much was heard', async () => {
  const c = config();
  const session = new Session(c, { script: [] });
  const calls = [];
  session.provider.interrupt = (ms) => calls.push(['interrupt', ms]);
  session.speaker = { busy: () => true, playedMs: () => 640, cut: () => calls.push(['cut']), beginReply() {}, write() {}, endReply() {}, close() {} };
  session.provider.emit('user-speech-start');
  assert.deepEqual(calls, [['interrupt', 640], ['cut']]);
  session.close();
});

// ------------------------------------------------------------------ provider adapters

test('openai adapter: session setup, mid-speech words, tool calls, and barge-in messages', () => {
  const sent = [];
  const p = new OpenAIRealtime(DEFAULTS.providers.openai, { instructions: 'be brief', tools: [{ name: 't', description: 'd', parameters: {} }], key: 'k' });
  p.send = (m) => sent.push(m);
  const ev = [];
  for (const e of ['user-speech-start', 'user-text', 'audio', 'tool-call', 'reply-done', 'interrupted']) p.on(e, (...a) => ev.push([e, ...a]));
  p.onMessage({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
  p.onMessage({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'u1', delta: 'open ' });
  p.onMessage({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'u1', delta: 'firefox' });
  p.onMessage({ type: 'input_audio_buffer.speech_started', item_id: 'u2' });
  p.onMessage({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'stale' });
  p.onMessage({ type: 'response.created' });
  p.onMessage({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'search_records', arguments: '{"query":"x"}' } });
  p.onMessage({ type: 'response.done', response: { status: 'completed' } });
  p.toolResult({ id: 'c1' }, { ok: 1 });
  p.onMessage({ type: 'response.created' });
  // Two spoken items, 1 s each: 1.5 s heard in all cuts the second item at 0.5 s.
  const second = Buffer.alloc(48000).toString('base64');
  p.onMessage({ type: 'response.output_audio.delta', item_id: 'a0', delta: second });
  p.onMessage({ type: 'response.output_audio.delta', item_id: 'a1', delta: second });
  p.interrupt(1500.7);
  assert.deepEqual(ev.map((e) => e[0]), ['user-speech-start', 'user-text', 'user-text', 'user-speech-start', 'tool-call', 'audio', 'audio']);
  assert.equal(ev[2][1], 'open firefox');
  assert.deepEqual(ev[4][1], { id: 'c1', name: 'search_records', args: { query: 'x' } });
  assert.deepEqual(sent.map((m) => m.type), ['conversation.item.create', 'response.create', 'response.cancel', 'conversation.item.truncate']);
  assert.deepEqual(sent[3], { type: 'conversation.item.truncate', item_id: 'a1', content_index: 0, audio_end_ms: 500 });

  // A tool still running when the user talks again is answered, but does not restart the old reply.
  sent.length = 0;
  p.onMessage({ type: 'response.created' });
  p.onMessage({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c2', name: 'search_records', arguments: '{}' } });
  p.onMessage({ type: 'response.done', response: { status: 'completed' } });
  p.onMessage({ type: 'input_audio_buffer.speech_started', item_id: 'u3' });
  p.toolResult({ id: 'c2' }, { ok: 1 });
  assert.deepEqual(sent.map((m) => m.type), ['conversation.item.create']);

  // A quiet result (a hand-off after "Let me check") ends the reply without asking for more.
  sent.length = 0;
  ev.length = 0;
  p.onMessage({ type: 'response.created' });
  p.onMessage({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c3', name: 'hand_off', arguments: '{}' } });
  p.onMessage({ type: 'response.done', response: { status: 'completed' } });
  p.toolResult({ id: 'c3' }, { handed_off: true }, { quiet: true });
  assert.deepEqual(sent.map((m) => m.type), ['conversation.item.create']);
  assert.deepEqual(ev.map((e) => e[0]), ['tool-call', 'reply-done']);
  // The session.update for a refreshed briefing, and an answer spoken on its own.
  sent.length = 0;
  p.setInstructions('new briefing');
  assert.deepEqual(sent[0], { type: 'session.update', session: { type: 'realtime', instructions: 'new briefing' } });
  assert.equal(p.say('Answer arrived: yes'), true);
  assert.deepEqual(sent.slice(1).map((m) => m.type), ['conversation.item.create', 'response.create']);
  assert.equal(sent[1].item.role, 'user');
  assert.match(sent[1].item.content[0].text, /^\(Not spoken by the user\.\) Answer arrived: yes$/);
  p.onMessage({ type: 'response.created' });
  assert.equal(p.say('again'), false, 'never over a reply in progress');
});

test('openai adapter: an error before the session is ready fails the connect with its message', async () => {
  const p = new OpenAIRealtime(DEFAULTS.providers.openai, { instructions: 'x', tools: [], key: 'k' });
  p.open = async () => {};
  p.send = () => {};
  p.on('error', () => {});
  const connecting = p.connect();
  await new Promise((r) => setImmediate(r));
  p.onMessage({ type: 'error', error: { message: 'You have no credits remaining.' } });
  await assert.rejects(connecting, /no credits remaining/);
});

test('gemini adapter: a turn ending in a tool call is not the reply; interrupted stops playback', () => {
  const sent = [];
  const p = new GeminiLive(DEFAULTS.providers.gemini, { instructions: 'x', tools: [], key: 'k' });
  p.send = (m) => sent.push(m);
  const ev = [];
  for (const e of ['user-speech-start', 'user-text', 'audio', 'tool-call', 'reply-done', 'interrupted']) p.on(e, (...a) => ev.push([e, ...a]));
  p.onMessage({ serverContent: { inputTranscription: { text: 'open firefox' } } });
  p.onMessage({ toolCall: { functionCalls: [{ id: 'g1', name: 'desktop_action', args: {} }] } });
  p.onMessage({ serverContent: { turnComplete: true } });
  p.toolResult({ id: 'g1', name: 'desktop_action' }, { opened: ['Firefox'] });
  p.onMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.from([0, 0]).toString('base64') } }] } } });
  p.interrupt();
  p.onMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.from([0, 0]).toString('base64') } }] } } });
  p.onMessage({ serverContent: { turnComplete: true } });
  assert.deepEqual(ev.map((e) => e[0]), ['user-speech-start', 'user-text', 'user-text', 'tool-call', 'audio', 'reply-done']);
  assert.deepEqual(sent, [{ toolResponse: { functionResponses: [{ id: 'g1', name: 'desktop_action', response: { output: { opened: ['Firefox'] } } }] } }]);
});

test('fake provider: finds speech by loudness and streams the scripted words', async () => {
  const p = new FakeProvider({ wordMs: 60, silenceMs: 100 }, { script: [{ text: 'one two three', reply: 'ok' }] });
  const texts = [];
  p.on('user-text', (t, final) => texts.push([t, final]));
  await p.connect();
  const loud = tone(24000, 300, 20, 0.3);
  for (let i = 0; i < 10; i++) {
    p.sendAudio(loud);
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 250));
  p.close();
  assert.deepEqual(texts.at(-1), ['one two three', true]);
  assert.ok(texts.some(([t, f]) => !f && t === 'one'));
});

// ------------------------------------------------------------------ audio helpers and installer parsing

test('audio: resampling keeps duration; speech bounds find the spoken part of a clip', () => {
  const pcm = tone(24000, 440, 1000);
  assert.equal(resample(pcm, 24000, 16000).length, 16000 * 2);
  const b = speechBounds(Buffer.concat([Buffer.alloc(24000), tone(24000, 300, 500, 0.3), Buffer.alloc(24000)]), 24000);
  assert.ok(Math.abs(b.startMs - 500) <= 20 && Math.abs(b.endMs - 1000) <= 20, JSON.stringify(b));
});

test('chooser: one call per new word, and a failed call logs its cause', async () => {
  const c = config();
  const cat = buildCatalog(c, new Records(c));
  const calls = [];
  const ch = new Chooser(c, cat, { execute: async () => {}, fetchImpl: fakeDecisions([], calls) });
  ch.key = 'test';
  ch.reset(0);
  // Repeated partials, and ones that differ only in case or punctuation, are one call.
  for (const t of ['Can you', 'can you', 'Can you,', 'can you open']) {
    ch.hear(t);
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.deepEqual(calls, ['Can you', 'can you open']);

  const logs = [];
  const failing = new Chooser(c, cat, {
    execute: async () => {},
    log: (r) => logs.push(r),
    fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new AggregateError([Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), Object.assign(new Error('u'), { code: 'ENETUNREACH' })]), { code: 'ETIMEDOUT' }) });
    },
  });
  failing.key = 'test';
  failing.reset(0);
  failing.hear('open fire');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(logs[0].event, 'chooser-error');
  assert.equal(logs[0].cause, 'ETIMEDOUT ETIMEDOUT ENETUNREACH');
});

test('connections: each address of a host gets a full second to connect', () => {
  // The default (250 ms) failed every address whenever a connect was slow and there was no IPv6 route.
  if (net.getDefaultAutoSelectFamilyAttemptTimeout) assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), 1000);
});

test('decisions log: one readable line per decision; the words heard only with transcripts on', () => {
  const at = '2026-01-02T03:04:05.678Z';
  assert.equal(decisionLine({ at, event: 'chooser', choice: 'none', p: 1, ms: 372, words: 1, final: false, text: 'open' }), '2026-01-02 03:04:05.6  nothing to open (p 1.00, 372 ms, 1 word in)');
  assert.equal(
    decisionLine({ at, event: 'chooser', choice: 'app:firefox', p: 0.97, ms: 380, words: 4, final: true, text: 'open firefox please' }, { withText: true }),
    '2026-01-02 03:04:05.6  app:firefox (p 0.97, 380 ms, end of sentence)  "open firefox please"',
  );
  assert.match(decisionLine({ at, event: 'chooser-error', cause: 'ETIMEDOUT', ms: 502, final: false }), /FAILED ETIMEDOUT after 502 ms \(mid-sentence\)$/);
  assert.match(decisionLine({ at, event: 'action', done: 'opened Firefox', ms_from_speech_start: 2100 }), /-> opened Firefox, 2100 ms after you started speaking$/);
});

// ------------------------------------------------------------------ PC control

const KDE = { platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'KDE' }, has: () => true, components: new Set(['kwin', 'kmix', 'mediacontrol', 'org_kde_powerdevil', 'org_kde_spectacle_desktop', 'ksmserver']) };

test('control: KDE shortcuts on Plasma, standard commands elsewhere, and nothing that deletes, sends or closes', () => {
  const c = config();
  const kde = new Map(controlActions(c, KDE));
  assert.deepEqual(kde.get('system:volume-up').invoke, ['kmix', 'increase_volume']);
  assert.equal(kde.get('system:lock-screen').final, true);
  assert.equal(kde.get('note:new').folder, path.join(docs, 'Notes'));
  assert.ok(kde.has('search:web') && kde.has('type:text'));
  assert.equal([...kde.keys()].filter((k) => k.startsWith('system:')).length, SYSTEM.length);
  // A component that is missing falls back to a standard command, or leaves the action out.
  const partial = new Map(controlActions(c, { ...KDE, components: new Set(['kwin']) }));
  assert.equal(partial.get('system:volume-up').argv[0], 'wpctl');
  assert.ok(!partial.has('system:screenshot'));
  // Other Linux desktops: only where a standard command is installed.
  const other = new Map(controlActions(c, { platform: 'linux', env: {}, has: (b) => b === 'wpctl' }));
  assert.deepEqual(other.get('system:volume-down').argv, ['wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', '5%-']);
  assert.ok(!other.has('system:media-next') && !other.has('system:window-minimize') && !other.has('type:text'));
  assert.equal(controlActions(merge(c, { actions: { control: false } }), KDE).length, 0);
  // The fixed list has no destructive kind at all.
  for (const [key] of kde) assert.doesNotMatch(key, /delete|remove|move-file|send|mail|buy|settings|shell|close|quit|kill/);
  assert.match(criteria(new Map()).none, /deleting or moving files, sending a message or email, buying something, changing settings, running a command, closing or quitting an app/);
});

test('control: each action runs exactly its fixed command; the words go only where they belong', async () => {
  const runs = [];
  const run = async (argv, env) => runs.push([argv, env]);
  const c = config();
  const cat = new Map(controlActions(c, KDE));
  await perform(cat.get('system:media-play-pause'), { run });
  assert.deepEqual(runs.pop()[0], ['gdbus', 'call', '--session', '--dest', 'org.kde.kglobalaccel', '--object-path', '/component/mediacontrol', '--method', 'org.kde.kglobalaccel.Component.invokeShortcut', 'playpausemedia']);

  await perform(cat.get('search:web'), { run, platform: 'linux', slot: 'cheap flights & hotels?' });
  assert.deepEqual(runs.pop()[0], ['xdg-open', 'https://duckduckgo.com/?q=cheap%20flights%20%26%20hotels']);

  await perform(cat.get('type:text'), { run, slot: 'hello\nworld\u0007 ok' });
  assert.deepEqual(runs.pop()[0], ['ydotool', 'type', '--key-delay', '8', '--', 'hello world ok']);
  assert.equal(typeable('\r\n\t'), '');
  await assert.rejects(perform(cat.get('type:text'), { run, slot: '\n' }), /nothing to type/);

  const folder = path.join(tmp, 'notes-test');
  await perform({ ...cat.get('note:new'), folder }, { run, platform: 'linux', slot: 'buy milk and eggs tomorrow', note: undefined });
  const [opened] = runs.pop();
  assert.equal(opened[0], 'xdg-open');
  assert.equal(fs.readFileSync(opened[1], 'utf8'), 'buy milk and eggs tomorrow\n');
  assert.match(path.basename(opened[1]), /^\d{4}-\d\d-\d\d \d{4} buy milk and eggs tomorrow\.md$/);
  // A second note with the same words never overwrites the first.
  await perform({ ...cat.get('note:new'), folder }, { run, platform: 'linux', slot: 'buy milk and eggs tomorrow' });
  assert.notEqual(runs.pop()[0][1], opened[1]);

  const calls = [];
  const exec = async (argv) => (calls.push(argv), argv.includes('org.kde.kwin.Scripting.loadScript') ? '(7,)' : '()');
  await perform({ kind: 'focus', name: 'Firefox', desktop: 'firefox.desktop' }, { exec });
  assert.ok(calls[0].includes('org.kde.kwin.Scripting.loadScript'));
  assert.deepEqual(calls[1].slice(-3), ['/Scripting/Script7', '--method', 'org.kde.kwin.Script.run']);
  assert.match(focusScript('org.kde.konsole.desktop'), /const want = "org\.kde\.konsole";/);
  assert.equal(describe(cat.get('system:volume-up')), 'turned the volume up');
  assert.equal(describe(cat.get('search:web'), 'cheap flights'), 'searched the web for "cheap flights"');
  assert.equal(describe(cat.get('note:new'), 'buy milk tomorrow', { words: false }), 'wrote a note (3 words)');
});

test('chooser: a note is picked mid-sentence and written with the words once the sentence ends; lock waits for the end', async () => {
  const c = merge(config(), { actions: { discoverApps: false } });
  const cat = buildCatalog(c, new Records(c), KDE);
  assert.ok(cat.has('focus:firefox') && cat.has('note:new'));
  const done = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const q = body.questions.target;
    const heard = body.state.heard_so_far;
    let choice = 'none';
    if (q.criteria['note:new']) choice = /note/.test(heard) ? 'note:new' : /lock/.test(heard) ? 'system:lock-screen' : 'none';
    else choice = Object.keys(q.criteria).find((k) => q.criteria[k] === '"buy milk tomorrow"') || 'none';
    return { ok: true, json: async () => ({ answers: { target: { choice, probabilities: { [choice]: 0.99 } } } }) };
  };
  const ch = new Chooser(c, cat, { execute: async (k, info) => done.push([k, info.slot, info.final]), fetchImpl });
  ch.key = 'test';
  ch.reset(0);
  ch.hear('make a note');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(done, []);
  ch.hear('make a note buy milk tomorrow', true);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(done, [['note:new', 'buy milk tomorrow', true]]);

  done.length = 0;
  ch.reset(0);
  ch.hear('lock my screen');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(done, [], 'not mid-sentence');
  ch.hear('lock my screen', true);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(done, [['system:lock-screen', undefined, true]]);

  const opts = spans('make a note buy milk tomorrow');
  assert.equal(opts['s3-6'], '"buy milk tomorrow"');
  assert.ok(Object.keys(spans(Array(80).fill('w').join(' '))).length <= 41);
});

test('installer: queue command lines and hotkeys are parsed', () => {
  assert.deepEqual(parseCommand('HOME_DIR=/x "/opt/my tools/inbox.sh" note'), { command: ['/opt/my tools/inbox.sh', 'note'], env: { HOME_DIR: '/x' } });
  assert.deepEqual(parseCommand(''), { command: [], env: {} });
  assert.equal(qtKey('Ctrl+2'), 0x04000000 | 0x32);
  assert.equal(qtKey('Meta+Shift+Space'), 0x10000000 | 0x02000000 | 0x20);
  assert.equal(qtKey('Ctrl+Alt+V'), 0x04000000 | 0x08000000 | 0x56);
  assert.equal(qtKey('Meta+F9'), 0x10000000 | 0x01000038);
  assert.throws(() => qtKey('Space'), /modifier/);
  assert.throws(() => qtKey('Meta+Enter'), /cannot read/);
});

test('one session: a live holder blocks a second start; a dead or foreign pid is a stale lock', { skip: process.platform === 'win32' }, async () => {
  const lock = path.join(tmp, 'run', 'voice-mode.lock');
  // A stand-in running session: its command line names voice mode, as a real one does.
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)', 'voice-mode.mjs'], { stdio: 'ignore' });
  await new Promise((r) => holder.once('spawn', r));
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, String(holder.pid));
  assert.equal(lockHolder(lock), holder.pid);
  assert.equal(acquireLock(lock), false);
  holder.kill('SIGKILL');
  await new Promise((r) => holder.once('exit', r));
  assert.equal(lockHolder(lock), null);
  assert.equal(acquireLock(lock), true);
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  releaseLock(lock);
  assert.equal(fs.existsSync(lock), false);

  // toggle claims the lock for the session it starts; that session then finds it its own.
  assert.equal(claimLock(process.pid, lock), true);
  assert.equal(acquireLock(lock), true);
  releaseLock(lock);

  // A live process that is not voice mode (a reused pid) does not hold the lock.
  const other = spawn('sleep', ['20'], { stdio: 'ignore' });
  await new Promise((r) => other.once('spawn', r));
  fs.writeFileSync(lock, String(other.pid));
  if (fs.existsSync('/proc')) assert.equal(acquireLock(lock), true);
  other.kill('SIGKILL');
  releaseLock(lock);
});

test('half duplex: the speaker counts as busy for a short tail after the reply', () => {
  // The real method on a bare object, so no audio player is started.
  const sp = Object.create(Speaker.prototype);
  sp.playEnd = performance.now() - 200;
  assert.equal(sp.busy(), false);
  assert.equal(sp.busy(400), true);
});

test('orb: serves its look and state behind a token, saves a drag, and its close control ends the conversation', { skip: process.platform !== 'linux' }, async () => {
  // A stand-in for the qml tool: it does what orb.qml does over the same local routes.
  const runner = path.join(tmp, 'fake-qml.mjs');
  fs.writeFileSync(
    runner,
    `#!${process.execPath}
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const url = process.argv[process.argv.indexOf('--') + 1];
const get = async (r) => (await fetch(url + '/' + r)).json();
const out = { look: await get('look'), state: await get('state'), wrong: (await fetch(url.replace(/[0-9a-f]{32}$/, 'x'.repeat(32)) + '/state')).status };
await fetch(url + '/moved', { method: 'POST', body: JSON.stringify({ x: 12, y: 34 }) });
require('node:fs').writeFileSync(${JSON.stringify(path.join(tmp, 'orb-seen.json'))}, JSON.stringify(out));
await fetch(url + '/stop', { method: 'POST', body: '{}' });
`,
    { mode: 0o755 },
  );
  const configFile = path.join(tmp, 'orb-config.json');
  fs.writeFileSync(configFile, JSON.stringify({ provider: 'fake', orb: { runner, size: 120, corner: 'top-left' } }));
  const config = loadConfig(configFile);
  const logs = [];
  let stopped;
  const done = new Promise((r) => (stopped = r));
  const orb = startOrb(config, { state: () => ({ mode: 'speaking', level: 0.5 }), stop: () => stopped(), log: (r) => logs.push(r), env: { DISPLAY: ':0' } });
  await done;
  orb.stop();
  const seen = JSON.parse(fs.readFileSync(path.join(tmp, 'orb-seen.json'), 'utf8'));
  assert.deepEqual(seen.look, { size: 120, corner: 'top-left', x: 40, y: 40, colors: DEFAULTS.orb.colors });
  assert.deepEqual(seen.state, { mode: 'speaking', level: 0.5 });
  assert.equal(seen.wrong, 404);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'orb-position.json'), 'utf8')), { x: 12, y: 34 });
  assert.equal(logs[0].event, 'orb');
  assert.equal(toLevel(50), 0);
  assert.ok(toLevel(3000) > 0.5 && toLevel(3000) < 1);
  assert.equal(toLevel(1e6), 1);
});

test('orb: nothing is started without a desktop session', () => {
  const config = loadConfig(path.join(tmp, 'no-such-config.json'));
  assert.equal(startOrb(config, { state: () => ({}), stop() {}, env: {} }), null);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
