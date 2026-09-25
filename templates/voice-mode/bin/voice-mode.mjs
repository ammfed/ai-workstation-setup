#!/usr/bin/env node
// voice-mode: talk with your assistant and hear it answer, speech to speech.
//
//   voice-mode start [--listen]    run in this terminal (--listen opens the mic at once)
//   voice-mode toggle              the hotkey: open the mic, close it, or cut in on a reply;
//                                  starts voice mode in the background when it is not running
//   voice-mode stop | status
//   voice-mode check               what is configured and what is missing (never prints keys)
//   voice-mode pick "<words>"      which desktop action the chooser would take (opens nothing)
//   voice-mode bench [--clip f.wav] [--runs N] [--play]
//                                  measure first-audio and action latency from a recorded clip
//   voice-mode latency             median latencies from the metrics log
//
// Config: ~/.config/ai-workstation-setup/voice/config.json (VOICE_MODE_CONFIG overrides).
// Exit status: 0 ok, 1 a run failed, 2 usage or config error.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR, loadConfig, readKey } from './config.mjs';
import { Records, TOOLS, runTool } from './records.mjs';
import { Chooser, buildCatalog, describe, perform } from './desk.mjs';
import { Mic, Speaker, audioTools, has, resample, rms, startEchoCancel, tone } from './audio.mjs';
import { PROVIDERS, createProvider } from './providers.mjs';

const SELF = fileURLToPath(import.meta.url);
const SOCKET = process.platform === 'win32' ? '\\\\.\\pipe\\voice-mode' : path.join(process.env.XDG_RUNTIME_DIR || CONFIG_DIR, 'voice-mode.sock');

const RULES = `How you work:
- Your knowledge comes from the records. Use search_records, list_records and read_record before answering anything about work, status, plans, people or past decisions, and say so when the records do not tell you. Never make up a status.
- You cannot do work yourself. When the user asks for real work (changing code, files, tasks or messages, research, anything that takes effort), call queue_work with the request, then say plainly that it is queued. Never say it is done or that you are doing it.
- A separate desktop helper opens apps, websites, folders and records on screen while the user is still talking. What it did may already be in the conversation as a line starting "Desktop helper:"; then confirm it in a few words. Otherwise, when the user asked to open, launch or show something, call desktop_action to learn what it opened. If it opened nothing, say you could not tell what to open.
- You are heard, not read: short spoken sentences, no lists, no markdown, no links read aloud. Keep an answer under about twenty seconds unless asked for more.`;

const DESKTOP_TOOL = {
  name: 'desktop_action',
  description: 'Call when the user asked to open, launch or show something: returns what the desktop helper opened this turn, if anything.',
  parameters: { type: 'object', properties: {} },
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

function makeLogger(config, { quiet = false } = {}) {
  fs.mkdirSync(config.logDir, { recursive: true });
  const metrics = path.join(config.logDir, 'metrics.jsonl');
  return (rec) => {
    const line = { at: new Date().toISOString(), ...rec };
    if (!quiet) process.stderr.write(`${JSON.stringify(line)}\n`);
    if (rec.event === 'turn' || rec.event === 'action') {
      const { text, reply, ...numbers } = line;
      fs.appendFileSync(metrics, `${JSON.stringify(numbers)}\n`);
    }
  };
}

export function instructionsFor(config, records) {
  const sources = records.describe();
  return `${config.persona}\n\n${RULES}${sources ? `\n\nRecord sources:\n${sources}` : ''}`;
}

// ------------------------------------------------------------------ session

/**
 * One conversation: microphone to provider, provider to speaker, tool calls to the records,
 * and the partial transcript to the action chooser. Mic and speaker are optional, so the
 * same session runs from a clip (bench, tests) as from the laptop's audio devices.
 */
export class Session {
  constructor(config, { provider, records, catalog, chooser, speaker, log, performImpl = perform, script } = {}) {
    this.config = config;
    this.log = log || (() => {});
    this.records = records || new Records(config);
    this.catalog = catalog || (config.actions.enabled ? buildCatalog(config, this.records) : new Map());
    this.roots = [config.actions.documents, ...this.records.roots].filter(Boolean);
    this.performImpl = performImpl;
    this.chooser =
      chooser ||
      new Chooser(config, this.catalog, {
        execute: (key, info) => this.act(key, info),
        log: (r) => this.log(r),
      });
    if (chooser) chooser.execute = (key, info) => this.act(key, info);
    const tools = [...TOOLS, ...(this.chooser.ready ? [DESKTOP_TOOL] : [])];
    const keyName = PROVIDERS[config.provider].keyName;
    this.provider =
      provider ||
      createProvider(config, {
        instructions: instructionsFor(config, this.records),
        tools,
        key: keyName ? readKey(config.keysFile, keyName) : '',
        script,
      });
    this.speaker = speaker || null;
    this.turn = null;
    this.turns = [];
    this.listening = false;
    this.onset = null;
    this.lastLoud = 0;
    this.floor = 300;
    this.wire();
  }

  wire() {
    const p = this.provider;
    p.on('user-speech-start', () => this.onSpeechStart());
    p.on('user-speech-end', () => {
      if (this.turn) this.turn.vadEnd = performance.now();
    });
    p.on('user-text', (text, final) => {
      if (!this.turn) this.onSpeechStart();
      if (final) this.turn.text = text;
      this.log({ event: 'heard', final, words: text.trim().split(/\s+/).length, ms_from_speech_start: Math.round(performance.now() - this.turn.t0) });
      this.chooser.hear(text, final);
    });
    p.on('audio', (pcm) => this.onReplyAudio(pcm));
    p.on('reply-text', (d) => {
      if (this.turn) this.turn.reply = (this.turn.reply || '') + d;
    });
    p.on('tool-call', (call) => this.onToolCall(call));
    p.on('reply-done', () => this.finishTurn());
    p.on('interrupted', () => {
      this.speaker?.cut();
      if (this.turn?.firstAudio) this.turn.interrupted = true;
    });
    p.on('error', (err) => this.log({ event: 'provider-error', error: err.message }));
  }

  async connect() {
    await this.provider.connect();
    this.log({ event: 'connected', provider: this.config.provider, actions: this.chooser.ready ? this.catalog.size : 0 });
  }

  /** Microphone audio at the provider's input rate. `loud` comes from the local level check. */
  feed(pcm) {
    const now = performance.now();
    const level = rms(pcm);
    const loud = level > Math.max(500, this.floor * 3);
    if (!loud) this.floor = this.floor * 0.95 + level * 0.05;
    if (loud) {
      if (this.onset === null || now - this.lastLoud > 700) {
        this.onset = now;
        this.chooser.warm();
      }
      this.lastLoud = now;
    }
    this.provider.sendAudio(pcm);
  }

  onSpeechStart() {
    const now = performance.now();
    // Barge-in: the user talks over a reply.
    if (this.speaker?.busy()) {
      this.provider.interrupt(this.speaker.playedMs());
      this.speaker.cut();
      if (this.turn) this.turn.interrupted = true;
    }
    if (this.turn && !this.turn.logged) this.finishTurn();
    // The local loudness onset is the true start; a provider's own event can come late
    // (Gemini has none, and its first words arrive after the user stops).
    const t0 = this.onset !== null && (!this.turn || this.onset > this.turn.t0) && now - this.onset < 15000 ? this.onset : now;
    this.turn = { t0, text: '', actions: [], firstAudio: null };
    this.chooser.reset(t0);
  }

  onReplyAudio(pcm) {
    const now = performance.now();
    const t = this.turn;
    if (t && t.firstAudio === null) {
      t.firstAudio = now;
      // The user's speech ended at the last loud frame before the reply began.
      t.speechEnd ??= this.lastLoud > t.t0 ? this.lastLoud : undefined;
      this.speaker?.beginReply();
    }
    this.speaker?.write(pcm);
  }

  async act(key, info) {
    const item = this.catalog.get(key);
    const started = performance.now();
    const turn = this.turn;
    // The same thing asked for twice in a row (a repeated or split sentence) opens once.
    const last = this.lastAction;
    if (last && last.key === key && started - last.at < 8000) {
      turn?.actions.push({ key, done: describe(item), ms: turn ? Math.round(started - turn.t0) : null, repeat: true });
      return;
    }
    this.lastAction = { key, at: started };
    try {
      await this.performImpl(item, { roots: this.roots, has });
      this.provider.note?.(`Desktop helper: ${describe(item)} for the user.`);
      const rec = { event: 'action', target: key, done: describe(item), words: info.text.split(/\s+/).length, final: info.final, p: info.p };
      rec.ms_from_speech_start = turn ? Math.round(performance.now() - turn.t0) : null;
      rec.launch_ms = Math.round(performance.now() - started);
      turn?.actions.push({ key, done: describe(item), ms: rec.ms_from_speech_start, at: performance.now() });
      this.log(rec);
    } catch (err) {
      turn?.actions.push({ key, error: err.message });
      this.log({ event: 'action-failed', target: key, error: err.message });
    }
  }

  async onToolCall(call) {
    const started = performance.now();
    let result;
    try {
      if (call.name === 'desktop_action') result = await this.desktopResult();
      else result = await runTool(this.records, call.name, call.args);
    } catch (err) {
      result = { error: err.message };
    }
    if (this.turn) (this.turn.tools ||= []).push(call.name);
    this.log({ event: 'tool', name: call.name, ms: Math.round(performance.now() - started), ok: !result?.error });
    this.provider.toolResult(call, result);
  }

  /** What the chooser did this turn, waiting briefly for a decision still in flight. */
  async desktopResult() {
    const until = performance.now() + this.config.actions.chooser.timeoutMs + 500;
    while ((this.chooser.inflight > 0 || this.chooser.pending) && performance.now() < until) await new Promise((r) => setTimeout(r, 50));
    const acts = this.turn?.actions || [];
    if (!acts.length) return { opened: null, note: 'Nothing was opened: the request did not clearly match an app, site, folder or record the helper knows.' };
    return { opened: acts.map((a) => a.done || `failed to open (${a.error})`) };
  }

  finishTurn() {
    const t = this.turn;
    if (!t || t.logged) return;
    t.logged = true;
    const end = t.speechEnd ?? t.vadEnd;
    const rec = {
      event: 'turn',
      provider: this.config.provider,
      first_audio_ms: t.firstAudio && end ? Math.round(t.firstAudio - end) : null,
      first_audio_after_vad_ms: t.firstAudio && t.vadEnd ? Math.round(t.firstAudio - t.vadEnd) : null,
      action: t.actions[0]?.key || null,
      action_ms: t.actions[0]?.ms ?? null,
      action_before_speech_end: t.actions[0]?.at && end ? t.actions[0].at < end : null,
      tools: t.tools || [],
      interrupted: !!t.interrupted,
      chooser_calls: this.chooser.calls,
    };
    this.turns.push({ ...rec, text: t.text, reply: t.reply });
    this.log(this.config.logTranscripts ? { ...rec, text: t.text, reply: t.reply } : rec);
    this.speaker?.endReply?.();
  }

  close() {
    this.provider.close();
    this.speaker?.close();
  }
}

// ------------------------------------------------------------------ live daemon

class Live {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.stopping = false;
  }

  async start({ listen }) {
    const c = this.config;
    for (const bin of audioTools()) if (!has(bin)) throw new Error(`\`${bin}\` is not installed (needed for the microphone and speaker)`);
    // A chosen input device bypasses echo cancellation, which wraps the default devices.
    this.ec = c.audio.echoCancel && !c.audio.input ? startEchoCancel(this.log) : null;
    // Without echo cancellation the reply would be heard as the user talking over it, so
    // the mic is muted while a reply plays and the hotkey is the way to cut in.
    this.halfDuplex = !this.ec && !c.audio.fullDuplex;
    await this.connect();
    this.mic = new Mic({ rate: this.session.provider.inputRate, device: c.audio.input || this.ec?.input });
    this.mic.on('data', (pcm) => {
      if (!this.listening) return;
      if (this.halfDuplex && this.session.speaker.busy()) return;
      this.session.feed(pcm);
      if (rms(pcm) > 800) this.lastSpeech = Date.now();
    });
    this.idle = setInterval(() => {
      if (this.listening && !this.session.speaker.busy() && Date.now() - this.lastSpeech > c.listen.idleCloseSec * 1000) this.setListening(false, 'idle');
    }, 1000);
    this.server = net.createServer((sock) => {
      sock.setEncoding('utf8');
      sock.on('data', (d) => {
        const cmd = d.trim();
        if (cmd === 'toggle') this.toggle();
        else if (cmd === 'listen') this.setListening(true);
        else if (cmd === 'stop') this.stop();
        sock.end(`${JSON.stringify({ provider: c.provider, listening: this.listening, replying: this.session.speaker.busy() })}\n`);
      });
      sock.on('error', () => {});
    });
    if (process.platform !== 'win32') fs.rmSync(SOCKET, { force: true });
    this.server.listen(SOCKET);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => this.stop());
    this.log({ event: 'ready', echo_cancel: !!this.ec, hotkey_hint: 'voice-mode toggle' });
    if (listen) this.setListening(true);
  }

  /** Connect, retrying with backoff: a dropped network should not end voice mode. */
  async connect(attempts = 5) {
    for (let i = 1; ; i++) {
      try {
        return await this.connectOnce();
      } catch (err) {
        this.session?.provider.close();
        if (this.stopping || i >= attempts) throw err;
        this.log({ event: 'connect-retry', attempt: i, error: err.message });
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
      }
    }
  }

  async connectOnce() {
    const c = this.config;
    const speaker = this.session?.speaker;
    // Records (with their read cache) and the action catalog outlive a reconnect.
    if (!this.records) {
      this.records = new Records(c);
      this.log({ event: 'records-warm', ...this.records.warm() });
      this.catalog = c.actions.enabled ? buildCatalog(c, this.records) : new Map();
    }
    const session = new Session(c, { log: this.log, records: this.records, catalog: this.catalog });
    session.speaker = speaker || new Speaker({ rate: session.provider.outputRate, device: c.audio.output || this.ec?.output });
    this.session = session;
    await session.connect();
    session.provider.on('close', (e) => {
      if (this.stopping || this.session !== session) return;
      this.log({ event: 'disconnected', code: e?.code, reason: e?.reason });
      this.connect(Infinity).catch((err) => this.log({ event: 'reconnect-failed', error: err.message }));
    });
  }

  cue(hz) {
    if (this.config.audio.earcons) this.session.speaker.write(tone(this.session.provider.outputRate, hz, 90));
  }

  setListening(on, why) {
    if (on === this.listening) return;
    this.listening = on;
    if (on) {
      this.lastSpeech = Date.now();
      this.mic.start();
      this.cue(880);
    } else {
      // A little silence lets the provider close a turn cut off mid-sentence.
      this.session.provider.sendAudio(Buffer.alloc((this.session.provider.inputRate * 2 * 600) / 1000));
      this.mic.stop();
      this.cue(440);
    }
    this.log({ event: on ? 'listening' : 'mic-closed', why });
  }

  toggle() {
    const s = this.session;
    if (s.speaker.busy()) {
      s.provider.interrupt(s.speaker.playedMs());
      s.speaker.cut();
      if (s.turn) s.turn.interrupted = true;
      this.log({ event: 'barge-in', by: 'hotkey' });
      this.setListening(true);
      return;
    }
    this.setListening(!this.listening, 'hotkey');
  }

  stop() {
    if (this.stopping) return;
    this.stopping = true;
    clearInterval(this.idle);
    this.mic?.stop();
    this.session?.close();
    this.ec?.stop();
    this.server?.close();
    if (process.platform !== 'win32') fs.rmSync(SOCKET, { force: true });
    this.log({ event: 'stopped' });
    setTimeout(() => process.exit(0), 100);
  }
}

function send(cmd) {
  return new Promise((resolve) => {
    const sock = net.connect(SOCKET);
    let out = '';
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(`${cmd}\n`));
    sock.on('data', (d) => (out += d));
    sock.on('end', () => resolve(out.trim() || null));
    sock.on('error', () => resolve(null));
  });
}

// ------------------------------------------------------------------ bench

/** Read a WAV (16-bit PCM, mono or stereo) or headerless PCM at `rate`, as mono PCM at `rate`. */
export function readClip(file, rate) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return buf;
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error(`${file}: only 16-bit PCM WAV is supported`);
      let pcm = buf.subarray(off + 8, off + 8 + size);
      if (fmt.channels > 1) {
        const mono = Buffer.alloc(Math.floor(pcm.length / 2 / fmt.channels) * 2);
        for (let i = 0; i < mono.length / 2; i++) mono.writeInt16LE(pcm.readInt16LE(i * 2 * fmt.channels), i * 2);
        pcm = mono;
      }
      return resample(pcm, fmt.rate, rate);
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no audio data`);
}

/** Speech onset and end in a clip, in ms, by loudness in 20 ms frames. */
export function speechBounds(pcm, rate) {
  const frame = (rate / 50) * 2;
  let first = null;
  let last = null;
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    if (rms(pcm.subarray(i, i + frame)) > 500) {
      if (first === null) first = i;
      last = i + frame;
    }
  }
  return { startMs: first === null ? null : (first / 2 / rate) * 1000, endMs: last === null ? null : (last / 2 / rate) * 1000 };
}

/**
 * Stream a clip into a session in real time, as a microphone would, then trailing silence,
 * and wait for the reply to finish. Returns the turn record.
 */
export async function streamClip(session, pcm, { timeoutMs = 20000 } = {}) {
  const rate = session.provider.inputRate;
  const frame = (rate / 50) * 2;
  const tail = Buffer.alloc((rate * 2 * 1500) / 1000);
  const all = Buffer.concat([pcm, tail]);
  const bounds = speechBounds(pcm, rate);
  const t0 = performance.now();
  const turns = session.turns.length;
  // Done when a turn has been answered and finished (a pause in the clip can split it into
  // turns, the first cut off by the second), or at the timeout.
  const done = new Promise((resolve) => {
    const check = setInterval(() => {
      if (session.turns.slice(turns).some((t) => t.first_audio_ms !== null) || performance.now() - t0 > timeoutMs) {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });
  for (let i = 0, n = 0; i < all.length; i += frame, n++) {
    const now = performance.now();
    if (bounds.endMs !== null && Math.abs(n * 20 - bounds.endMs) < 10 && session.turn) session.turn.speechEnd = t0 + bounds.endMs;
    session.feed(all.subarray(i, i + frame));
    const wait = t0 + (n + 1) * 20 - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  if (session.turn && bounds.endMs !== null) session.turn.speechEnd ??= t0 + bounds.endMs;
  await done;
  if (session.turn && !session.turn.logged) session.finishTurn();
  const mine = session.turns.slice(turns);
  return mine.find((t) => t.first_audio_ms !== null) || mine[mine.length - 1] || null;
}

/** A clip of tone bursts shaped like a spoken sentence, for the fake provider. */
function syntheticClip(rate, ms = 1800) {
  const parts = [Buffer.alloc((rate * 2 * 300) / 1000)];
  for (let t = 0; t < ms; t += 200) parts.push(tone(rate, 180 + (t % 400), 160, 0.3), Buffer.alloc((rate * 2 * 40) / 1000));
  return Buffer.concat(parts);
}

async function bench(config, args, log) {
  const runs = Number(args.runs || 3);
  const results = [];
  for (let i = 0; i < runs; i++) {
    const session = new Session(config, {
      log,
      script: [{ text: args.say || 'please open the documents folder', tools: [{ name: 'desktop_action' }], reply: 'Opened it.' }],
      performImpl: args.open ? perform : async () => {},
    });
    if (args.play) session.speaker = new Speaker({ rate: session.provider.outputRate, device: config.audio.output });
    await session.connect();
    const rate = session.provider.inputRate;
    const pcm = args.clip ? readClip(args.clip, rate) : syntheticClip(rate);
    const turn = await streamClip(session, pcm);
    session.close();
    results.push(turn);
    process.stdout.write(`${JSON.stringify(turn)}\n`);
  }
  const fa = results.map((r) => r?.first_audio_ms).filter((x) => x != null);
  const ac = results.map((r) => r?.action_ms).filter((x) => x != null);
  process.stdout.write(`${JSON.stringify({ provider: config.provider, runs, answered: fa.length, first_audio_ms_median: median(fa), action_ms_median: median(ac), first_audio_ms: fa, action_ms: ac })}\n`);
  return fa.length === runs ? 0 : 1;
}

// ------------------------------------------------------------------ commands

function check(config) {
  const rows = [];
  const add = (ok, what) => rows.push(`${ok ? 'ok  ' : 'MISS'} ${what}`);
  add(true, `config ${config.file}${fs.existsSync(config.file) ? '' : ' (not found: defaults only)'}`);
  const keyName = PROVIDERS[config.provider].keyName;
  if (keyName) add(!!readKey(config.keysFile, keyName), `${keyName} in ${config.keysFile} (provider "${config.provider}")`);
  for (const [name, p] of Object.entries(PROVIDERS)) if (p.keyName && name !== config.provider) rows.push(`     ${p.keyName}: ${readKey(config.keysFile, p.keyName) ? 'set' : 'empty'} (switch with "provider": "${name}")`);
  for (const bin of audioTools()) add(has(bin), `\`${bin}\` for audio`);
  const records = new Records(config);
  for (const s of config.sources) add(s.command ? has(s.command[0]) : fs.existsSync(s.path), `source "${s.name}"`);
  add(!!(config.queue.command || []).length && (path.isAbsolute(config.queue.command[0]) ? fs.existsSync(config.queue.command[0]) : has(config.queue.command[0])), 'queue command');
  if (config.actions.enabled) {
    const catalog = buildCatalog(config, records);
    const chooser = new Chooser(config, catalog, {});
    add(chooser.ready, `action chooser ${config.actions.chooser.model} (${config.actions.chooser.keyName}${config.actions.chooser.keyFile ? ` in ${config.actions.chooser.keyFile}` : ' in the environment'})`);
    const kinds = {};
    for (const it of catalog.values()) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
    rows.push(`     ${catalog.size} actions: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  }
  console.log(rows.join('\n'));
  return rows.some((r) => r.startsWith('MISS')) ? 1 : 0;
}

async function pick(config, text) {
  const records = new Records(config);
  const catalog = buildCatalog(config, records);
  let chosen = null;
  const chooser = new Chooser(config, catalog, { execute: async (key, info) => (chosen = { key, ...info }), log: (r) => console.error(JSON.stringify(r)) });
  if (!chooser.ready) {
    console.error(`the chooser has no key (${config.actions.chooser.keyName}) or no actions`);
    return 2;
  }
  const words = text.split(/\s+/);
  const t0 = performance.now();
  for (let i = 1; i <= words.length && !chosen; i++) await chooser.ask(words.slice(0, i).join(' '), i === words.length);
  console.log(JSON.stringify(chosen ? { ...chosen, name: catalog.get(chosen.key).name, ms: Math.round(performance.now() - t0) } : { key: null }));
  return 0;
}

function latency(config) {
  const file = path.join(config.logDir, 'metrics.jsonl');
  const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const by = {};
  for (const r of rows.filter((x) => x.event === 'turn')) (by[r.provider] ||= []).push(r);
  for (const [p, rs] of Object.entries(by)) {
    const fa = rs.map((r) => r.first_audio_ms).filter((x) => x != null);
    const ac = rs.map((r) => r.action_ms).filter((x) => x != null);
    console.log(`${p}: ${rs.length} turns; first audio median ${median(fa)} ms (${fa.length}); action median ${median(ac)} ms (${ac.length})`);
  }
  if (!rows.length) console.log(`no turns logged yet in ${file}`);
  return 0;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && ['clip', 'runs', 'say', 'config'].includes(k)) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || 'start';
  if (args.config) process.env.VOICE_MODE_CONFIG = args.config;
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`voice-mode: ${err.message}`);
    return 2;
  }
  switch (cmd) {
    case 'start': {
      if (await send('status')) {
        console.error('voice-mode is already running; `voice-mode toggle` talks to it');
        return 2;
      }
      const keyName = PROVIDERS[config.provider].keyName;
      if (keyName && !readKey(config.keysFile, keyName)) {
        console.error(`voice-mode: ${keyName} is empty in ${config.keysFile}; add it there, or set "provider" in ${config.file}`);
        return 2;
      }
      const live = new Live(config, makeLogger(config));
      try {
        await live.start({ listen: !!args.listen });
      } catch (err) {
        console.error(`voice-mode: ${err.message}`);
        live.stop();
        return 1;
      }
      return new Promise(() => {});
    }
    case 'toggle': {
      if (await send('toggle')) return 0;
      fs.mkdirSync(config.logDir, { recursive: true });
      const out = fs.openSync(path.join(config.logDir, 'voice-mode.log'), 'a');
      spawn(process.execPath, [SELF, 'start', '--listen'], { detached: true, stdio: ['ignore', out, out] }).unref();
      return 0;
    }
    case 'stop':
    case 'status': {
      const r = await send(cmd);
      console.log(r || 'not running');
      return 0;
    }
    case 'check':
      return check(config);
    case 'pick':
      return pick(config, args._.slice(1).join(' '));
    case 'bench':
      return bench(config, args, makeLogger(config, { quiet: !args.verbose }));
    case 'latency':
      return latency(config);
    default:
      console.error(`voice-mode: unknown command "${cmd}" (start, toggle, stop, status, check, pick, bench, latency)`);
      return 2;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).then((code) => {
    if (typeof code === 'number') process.exit(code);
  });
}

export { main, os };
