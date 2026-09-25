// Tests for templates/voice-mode/bin against throwaway folders, a fake realtime provider, a
// stubbed decision model and a stubbed launcher: no network, no audio devices, nothing opened.
// Covers what may be read (and what never is), how work is queued, which actions can run,
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
const { Chooser, buildCatalog, criteria, perform } = await import(path.join(bin, 'desk.mjs'));
const { OpenAIRealtime, GeminiLive, FakeProvider } = await import(path.join(bin, 'providers.mjs'));
const { Session, streamClip, speechBounds } = await import(path.join(bin, 'voice-mode.mjs'));
const { resample, tone } = await import(path.join(bin, 'audio.mjs'));
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

test('records: queue_work passes the request as one argument, never through a shell', async () => {
  fs.rmSync(queued, { force: true });
  const r = new Records(config());
  const req = 'tidy the learnings; rm -rf ~ $(whoami) "quoted"';
  assert.deepEqual(await runTool(r, 'queue_work', { request: req }), { queued: true });
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

test('session: real work is queued through the configured command and reported as queued', async () => {
  fs.rmSync(queued, { force: true });
  const c = config();
  const script = [{ text: 'queue a task to tidy the learnings', tools: [{ name: 'queue_work', args: { request: 'tidy the learnings' } }], reply: 'Queued.' }];
  const session = new Session(c, { script, performImpl: async () => assert.fail('nothing to open') });
  session.chooser.key = 'test';
  session.chooser.fetch = fakeDecisions([]);
  await session.connect();
  const turn = await streamClip(session, clip(session.provider.inputRate), { timeoutMs: 8000 });
  session.close();
  assert.deepEqual(turn.tools, ['queue_work']);
  assert.match(fs.readFileSync(queued, 'utf8'), /tidy the learnings/);
  assert.equal(turn.action, null);
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

test('installer: queue command lines and hotkeys are parsed', () => {
  assert.deepEqual(parseCommand('HOME_DIR=/x "/opt/my tools/inbox.sh" note'), { command: ['/opt/my tools/inbox.sh', 'note'], env: { HOME_DIR: '/x' } });
  assert.deepEqual(parseCommand(''), { command: [], env: {} });
  assert.equal(qtKey('Meta+Shift+Space'), 0x10000000 | 0x02000000 | 0x20);
  assert.equal(qtKey('Ctrl+Alt+V'), 0x04000000 | 0x08000000 | 0x56);
  assert.equal(qtKey('Meta+F9'), 0x10000000 | 0x01000038);
  assert.throws(() => qtKey('Space'), /modifier/);
  assert.throws(() => qtKey('Meta+Enter'), /cannot read/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
