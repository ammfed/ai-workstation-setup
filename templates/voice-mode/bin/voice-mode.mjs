#!/usr/bin/env node
// voice-mode: talk with your assistant and hear it answer, speech to speech.
//
//   voice-mode start               talk, in this terminal: the mic is open until you stop it
//   voice-mode toggle              the hotkey: start a conversation in the background, or end it
//   voice-mode reply <id> "<answer>"
//                                  answer a hand-off; the voice speaks it (now, or at the next start)
//   voice-mode briefing            print the live briefing the voice gets (after redaction)
//   voice-mode do "<request>" [--dry-run]
//                                  for the assistant's own session: the chooser picks one desktop
//                                  action from the same safe list and it is carried out
//   voice-mode say "<text>" [--dry-run]
//                                  speak text aloud, word for word, in the configured voice (into
//                                  a running conversation when there is one)
//   voice-mode stop | status
//   voice-mode check               what is configured and what is missing (never prints keys)
//   voice-mode pick "<words>"      which desktop action the chooser would take (opens nothing)
//   voice-mode bench [--clip f.wav] [--runs N] [--play]
//                                  measure first-audio and action latency from a recorded clip
//   voice-mode latency             median latencies from the metrics log
//   voice-mode help                this text
//
// Config: ~/.config/ai-workstation-setup/voice/config.json (VOICE_MODE_CONFIG overrides).
// Exit status: 0 ok, 1 a run failed, 2 usage or config error.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR, loadConfig, merge, readKey } from './config.mjs';
import { Records, TOOLS, runTool } from './records.mjs';
import { Chooser, TEXT_KINDS, buildCatalog, describe, perform } from './desk.mjs';
import { Mic, Speaker, audioTools, has, play, resample, rms, startEchoCancel, tone, wavToPcm } from './audio.mjs';
import { PROVIDERS, createProvider, synthesize } from './providers.mjs';
import { orbRunner, startOrb, toLevel } from './orb.mjs';
import { briefingChanges, briefingStamp, buildBriefing, redact } from './briefing.mjs';
import { Deliveries, handoffDir, newId, noteText, saveMessage, savePending, saveReply } from './handoff.mjs';

const SELF = fileURLToPath(import.meta.url);

// Node gives each address of a host only 250 ms to connect before it tries the next one. A
// busy Wi-Fi link can take longer, and with no IPv6 route every address of a host then fails
// at once ("fetch failed", cause ETIMEDOUT), which is what dropped decision calls whenever a
// new connection was needed. One second per address.
net.setDefaultAutoSelectFamilyAttemptTimeout?.(1000);
const RUNTIME = process.env.XDG_RUNTIME_DIR || CONFIG_DIR;
const SOCKET = process.platform === 'win32' ? '\\\\.\\pipe\\voice-mode' : path.join(RUNTIME, 'voice-mode.sock');
const LOCK = path.join(RUNTIME, 'voice-mode.lock');

// ------------------------------------------------------------------ one session at a time
//
// A session holds LOCK (its pid) from before it does anything slow until it exits, so a
// second start, however quick, refuses. A lock whose pid is gone, or is no longer voice
// mode, is stale and taken over.

function isVoiceMode(pid) {
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err.code !== 'EPERM') return false;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('voice-mode.mjs');
  } catch {
    return true; // no /proc (macOS): a live pid is taken as the holder
  }
}

/** The pid of the running (or starting) session, or null. */
export function lockHolder(file = LOCK) {
  let pid;
  try {
    pid = Number(fs.readFileSync(file, 'utf8').trim());
  } catch {
    return null;
  }
  return pid > 0 && pid !== process.pid && isVoiceMode(pid) ? pid : null;
}

/** Write `pid` into a free (or stale) lock; false when a live session holds it. */
export function claimLock(pid, file = LOCK) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 3; i++) {
    try {
      fs.writeFileSync(file, String(pid), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    if (lockHolder(file)) return false;
    fs.rmSync(file, { force: true }); // stale: its pid is gone or is no longer voice mode
  }
  return false;
}

export function acquireLock(file = LOCK) {
  // `toggle` claims the lock for the session it starts, before it is even running.
  try {
    if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) return true;
  } catch {}
  if (!claimLock(process.pid, file)) return false;
  // Two starts that both cleared the same stale lock can both get here; after a moment
  // only one pid is left in the file, and the other gives way.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
  return fs.readFileSync(file, 'utf8').trim() === String(process.pid);
}

export function releaseLock(file = LOCK) {
  try {
    if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.rmSync(file, { force: true });
  } catch {}
}

const RULES = `How you work:
- The briefing below (when there is one) is your own memory: your recent conversation with the user, the work under way and who is doing it, your notes and what you have learned. Speak from it as yourself; never call it a briefing.
- When the briefing answers a question, answer at once without tools, unless the user asks you to read, look up or check notes, files or records: then always read them with the tools, since they are newer than your memory.
- For anything else about notes, files, documents, the notes vault, memories, records, people, projects, plans, decisions or work, look it up yourself first, in the same reply: search_records with a few keywords (and the source, when the user names one), list_records for what is newest in a source, read_record to read one in full. Then answer from what they return, the newest record first when they disagree. Never make up a status.
- Only when those do not answer (after you looked), or the user asks for real work (changing, renaming, moving or deleting files, code, tasks or messages, running or checking anything now, research, anything that takes effort), or for something outside your records (mail, messages, the web, other people's replies), say one short line such as "Let me check; I'll tell you here as soon as it's back" and call hand_off in that same reply, with the request in the user's words. Saying you will check without calling a tool leaves the user waiting for nothing. It goes to your own working session, which can do it; never say the work is done until an answer says so. Every new request needs its own hand_off, even one asked before.
- When an answer to a hand-off arrives (a line starting "Answer arrived"), tell the user at once, briefly, as your own answer. You are one assistant: never say that someone else, another session or another assistant answered.
- A separate desktop helper acts on the computer while the user is still talking: it opens apps, websites, folders and records, switches to an open app, minimizes, maximizes or moves the window in front, shows the desktop or the overview, turns the volume up or down or mutes it, plays, pauses or skips media, changes screen brightness, takes a screenshot, locks the screen, writes a note, searches the web, and types dictated text. What it did may already be in the conversation as a line starting "Desktop helper:"; then confirm it in a few words. Otherwise, when the user asked for one of those, call desktop_action to learn what it did. If it did nothing, say you could not tell what to do.
- The helper itself never deletes or moves files, sends messages or email, buys anything, changes settings, runs commands, or closes or quits apps. That limits only the helper: such requests are real work, so hand them off.
- You are heard, not read: short spoken sentences, no lists, no markdown, no links read aloud. Keep an answer under about twenty seconds unless asked for more.`;

// Without a queue command there is no hand-off: those rules give way to a plain refusal.
const NO_HANDOFF = '- You cannot do work, and you know only the briefing and the records. When they do not answer, or you are asked for more, say plainly that voice mode cannot do that.';

function rules(handoff) {
  if (handoff) return RULES;
  const lines = RULES.split('\n').filter((l) => !/hand_off|Answer arrived/.test(l));
  lines.splice(lines.findIndex((l) => l.includes('look it up yourself')) + 1, 0, NO_HANDOFF);
  return lines.join('\n').replace('That limits only the helper: such requests are real work, so hand them off.', 'Neither do you.');
}

// Provider errors that no retry fixes.
const FATAL = /credits|billing|quota|api key|unauthori[sz]ed|permission|\b40[13]\b/i;

// A reply that promises to look into something, which only a hand-off can keep.
export const PROMISE = /\b(let me (check|find out|look into)|i('| wi)ll (check|find out|look into) (that|it|now))\b|^\W*(on it|checking)\b/i;

const HANDOFF_TOOL = {
  name: 'hand_off',
  // The conversation goes on while it runs (Gemini: a non-blocking call).
  async: true,
  description:
    'Send a question that the briefing and your records (search_records, list_records, read_record) do not answer, or any real work, to your own working session, which has the full context and can act. ' +
    'Its answer comes back into this conversation later; speak it then. Say a short line like "Let me check; I\'ll tell you here as soon as it\'s back" before calling this.',
  parameters: {
    type: 'object',
    properties: {
      request: { type: 'string', description: "the question or request in the user's words, with any detail they gave" },
      kind: { type: 'string', enum: ['question', 'task'], description: 'question: they want an answer; task: they want something done' },
    },
    required: ['request'],
  },
};

const DESKTOP_TOOL = {
  name: 'desktop_action',
  description: 'Call when the user asked the computer to do something (open, switch, volume, media, a note, a search, typing...): returns what the desktop helper did this turn, if anything.',
  parameters: { type: 'object', properties: {} },
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** One readable line per decision-model call, for logs/decisions.log. */
export function decisionLine(rec, { withText = false } = {}) {
  const time = rec.at.replace('T', ' ').slice(0, 21);
  const heard = withText && rec.text ? `  "${rec.text}"` : '';
  const turn = rec.from === 'assistant' ? 'typed request' : rec.final ? 'end of sentence' : `${rec.words} word${rec.words === 1 ? '' : 's'} in`;
  if (rec.event === 'chooser-error') return `${time}  FAILED ${rec.cause || rec.error} after ${rec.ms} ms (${rec.final ? 'end of sentence' : 'mid-sentence'})${heard}`;
  if (rec.event === 'action' && rec.from === 'assistant') return `${time}  -> ${rec.done}, asked by the assistant (voice-mode do), ${rec.ms_from_request} ms after the request${rec.dry_run ? ' (dry run: nothing ran)' : ''}`;
  if (rec.event === 'action') return `${time}  -> ${rec.done}, ${rec.ms_from_speech_start ?? '?'} ms after you started speaking`;
  if (rec.event === 'action-failed') return `${time}  -> could not open ${rec.target}: ${rec.error}`;
  return `${time}  ${rec.choice === 'none' ? 'nothing to open' : rec.choice} (p ${Number(rec.p).toFixed(2)}, ${rec.ms} ms, ${turn})${heard}`;
}

/** Log records: decisions.log (readable), metrics.jsonl (numbers), and stderr or `file` (JSON lines). */
export function makeLogger(config, { quiet = false, file = '', extra = {} } = {}) {
  fs.mkdirSync(config.logDir, { recursive: true });
  const metrics = path.join(config.logDir, 'metrics.jsonl');
  const decisions = path.join(config.logDir, 'decisions.log');
  return (r) => {
    const rec = { ...r, ...extra };
    let line = { at: new Date().toISOString(), ...rec };
    if (config.actions.decisionLog && ['chooser', 'chooser-error', 'action', 'action-failed'].includes(rec.event)) {
      fs.appendFileSync(decisions, `${decisionLine(line, { withText: config.logTranscripts })}\n`);
    }
    if ('text' in line && !config.logTranscripts) {
      const { text, ...rest } = line;
      line = rest;
    }
    if (file) fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    else if (!quiet) process.stderr.write(`${JSON.stringify(line)}\n`);
    if (rec.event === 'turn' || (rec.event === 'action' && !rec.from)) {
      const { text, reply, ...numbers } = line;
      fs.appendFileSync(metrics, `${JSON.stringify(numbers)}\n`);
    }
  };
}

export function instructionsFor(config, records, briefing = '') {
  const sources = records.describe();
  const brief = briefing ? `\n\nBriefing: what you currently know (your own recent conversation, current work and notes; newest last):\n${briefing}` : '';
  return `${config.persona}\n\n${rules((config.queue.command || []).length > 0)}${sources ? `\n\nRecord sources:\n${sources}` : ''}${brief}`;
}

// ------------------------------------------------------------------ session

/**
 * One conversation: microphone to provider, provider to speaker, tool calls to the records,
 * and the partial transcript to the action chooser. Mic and speaker are optional, so the
 * same session runs from a clip (bench, tests) as from the laptop's audio devices.
 */
export class Session {
  constructor(config, { provider, records, catalog, chooser, speaker, log, performImpl = perform, script, briefing = '' } = {}) {
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
    this.handoff = (config.queue.command || []).length > 0;
    const tools = [...TOOLS, ...(this.handoff ? [HANDOFF_TOOL] : []), ...(this.chooser.ready ? [DESKTOP_TOOL] : [])];
    const keyName = PROVIDERS[config.provider].keyName;
    this.provider =
      provider ||
      createProvider(config, {
        instructions: instructionsFor(config, this.records, briefing),
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
      if (this.aside) this.aside.reply = (this.aside.reply || '') + d;
      else if (this.turn) this.turn.reply = (this.turn.reply || '') + d;
    });
    p.on('tool-call', (call) => this.onToolCall(call));
    p.on('reply-done', () => {
      const a = this.aside;
      if (a && !a.heard) this.dropAside('no audio');
      else if (a) {
        if (this.config.logTranscripts) this.log({ event: 'handoff-spoken', id: a.id, reply: a.reply });
        this.aside = null;
      }
      this.finishTurn();
    });
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
    if (this.aside && !this.aside.heard) {
      // OpenAI cancels the answer's reply when the user talks first, so it is tried again later;
      // Gemini cannot cancel and will give it anyway, so it counts as delivered.
      if (this.provider.canCancel === false) {
        this.onAnswer?.(this.aside);
        this.aside = null;
      } else this.dropAside('the user spoke first');
    }
    // The local loudness onset is the true start; a provider's own event can come late
    // (Gemini has none, and its first words arrive after the user stops).
    const t0 = this.onset !== null && (!this.turn || this.onset > this.turn.t0) && now - this.onset < 15000 ? this.onset : now;
    this.turn = { t0, text: '', actions: [], firstAudio: null };
    this.chooser.reset(t0);
  }

  onReplyAudio(pcm) {
    const now = performance.now();
    const t = this.turn;
    // The first audio of an answer that came back from a hand-off: the round trip.
    const a = this.aside;
    if (a && !a.heard) {
      a.heard = true;
      this.speaker?.beginReply();
      this.log({ event: 'handoff-answer', id: a.id, round_trip_ms: a.askedAt ? Date.now() - a.askedAt : null, speak_ms: Math.round(now - a.sentAt) });
      this.onAnswer?.(a);
    }
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
    const slot = info.slot || '';
    const done = describe(item, slot);
    // The same thing opened twice in a row (a repeated or split sentence) opens once;
    // "volume up" twice is meant twice.
    const last = this.lastAction;
    if (item.kind !== 'system' && !TEXT_KINDS.has(item.kind) && last && last.key === key && started - last.at < 8000) {
      turn?.actions.push({ key, done, ms: turn ? Math.round(started - turn.t0) : null, repeat: true });
      return;
    }
    this.lastAction = { key, at: started };
    try {
      await this.performImpl(item, { roots: this.roots, has, slot, ...(this.config.actions.dryRun ? this.dryRun(slot) : {}) });
      this.provider.note?.(`Desktop helper: ${done} for the user.`);
      const rec = { event: 'action', target: key, done, words: info.text.split(/\s+/).length, final: info.final, p: info.p };
      if (!this.config.logTranscripts) rec.done = describe(item, slot, { words: false });
      rec.ms_from_speech_start = turn ? Math.round(performance.now() - turn.t0) : null;
      rec.launch_ms = Math.round(performance.now() - started);
      turn?.actions.push({ key, done, ms: rec.ms_from_speech_start, at: performance.now() });
      this.log(rec);
      this.onAction?.(done);
    } catch (err) {
      turn?.actions.push({ key, error: err.message });
      this.log({ event: 'action-failed', target: key, error: err.message });
    }
  }

  /** actions.dryRun: log what would run instead of running it (the dictated words only with logTranscripts). */
  dryRun(slot) {
    const hide = (a) => (slot && !this.config.logTranscripts && String(a).includes(slot.trim().slice(0, 12)) ? '<dictated words>' : a);
    return {
      run: async (argv) => this.log({ event: 'dry-run', argv: argv.map(hide) }),
      exec: async (argv) => (this.log({ event: 'dry-run', argv: argv.slice(0, 9) }), '(0,)'),
      note: (folder) => path.join(folder, '(dry run).md'),
    };
  }

  async onToolCall(call) {
    const started = performance.now();
    let result;
    try {
      if (call.name === 'desktop_action') result = await this.desktopResult();
      else if (call.name === 'hand_off') result = await this.handOff(call.args);
      else result = await runTool(this.records, call.name, call.args);
    } catch (err) {
      result = { error: err.message };
    }
    if (this.turn) (this.turn.tools ||= []).push(call.name);
    this.log({ event: 'tool', name: call.name, ms: Math.round(performance.now() - started), ok: !result?.error });
    // A hand-off after the reply already said "Let me check" needs no second reply.
    this.provider.toolResult(call, result, { quiet: call.name === 'hand_off' && !!result?.handed_off && this.turn?.firstAudio != null });
  }

  /** Send a question or task to the assistant's own session, with an id its answer comes back under. */
  async handOff({ request, kind } = {}) {
    const text = String(request || '').trim();
    if (!text) return { handed_off: false, error: 'nothing to hand off' };
    const id = newId();
    const k = kind === 'task' ? 'task' : 'question';
    // The question ended at the user's last loud frame; the round trip is timed from there.
    const t = this.turn;
    const end = t && this.lastLoud > t.t0 ? this.lastLoud : t?.vadEnd ?? performance.now();
    savePending(this.config, { id, kind: k, request: text, askedAt: Math.round(Date.now() - (performance.now() - end)), at: Date.now() });
    const r = await this.records.queue(noteText({ id, kind: k, request: text, replyCommand: this.config.handoff.replyCommand }));
    this.log({ event: 'handoff', id, kind: k, sent: !!r.queued, ...(r.error ? { error: r.error } : {}) });
    if (!r.queued) return { handed_off: false, error: r.error };
    this.onHandOff?.({ id, request: text });
    return { handed_off: true, note: 'Sent. The answer will arrive in this conversation; you already said you are on it, so say nothing more about it now unless asked.' };
  }

  /** A quiet moment to speak a hand-off's answer: nobody talking, nothing playing or pending. */
  quiet() {
    const now = performance.now();
    return !this.aside && !this.speaker?.busy(300) && now - this.lastLoud > 1200 && (!this.turn || this.turn.logged) && !this.provider.responseActive;
  }

  /**
   * Speak an answer that came back from a hand-off, or a message from the assistant's own
   * session (`voice-mode say`), which is said word for word. False when the provider is busy.
   */
  speakAnswer(entry) {
    const q = entry.question?.request;
    const text = entry.verbatim
      ? `A message from your working session, to say out loud now. Say exactly these words, and nothing before or after them: "${redact(entry.text)}"`
      : redact(`Answer arrived${q ? ` to what the user asked earlier ("${q}")` : ''}: ${entry.text}`) + `\nTell the user now, briefly, in your own words, as your own answer.`;
    if (!this.provider.say?.(text)) return false;
    this.aside = { id: entry.id, text, askedAt: entry.question?.askedAt, sentAt: performance.now() };
    return true;
  }

  /** An answer that was not heard: it stays queued, to be tried again. */
  dropAside(why) {
    const a = this.aside;
    this.aside = null;
    this.log({ event: 'handoff-unheard', id: a.id, why, ...(why === 'no audio' && this.provider.lastResponse ? { response: this.provider.lastResponse } : {}) });
    this.onUnheard?.(a);
  }

  /** What the chooser did this turn, waiting briefly for a decision still in flight. */
  async desktopResult() {
    const until = performance.now() + this.config.actions.chooser.timeoutMs + 500;
    const busy = () => this.chooser.inflight > 0 || this.chooser.pending || (this.chooser.textAction && !this.chooser.textAction.done);
    while (busy() && performance.now() < until) await new Promise((r) => setTimeout(r, 50));
    const acts = this.turn?.actions || [];
    if (!acts.length) return { opened: null, note: 'Nothing was done: the request did not clearly match something the helper can do.' };
    return { opened: acts.map((a) => a.done || `failed to open (${a.error})`) };
  }

  finishTurn() {
    const t = this.turn;
    if (!t || t.logged) return;
    t.logged = true;
    // Said it would check but called no tool at all: hand off the user's own words.
    if (this.handoff && t.text && !(t.tools || []).length && PROMISE.test(t.reply || '')) {
      (t.tools ||= []).push('hand_off (auto)');
      this.handOff({ request: t.text }).catch(() => {});
    }
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

export class Live {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.stopping = false;
    this.micLevel = 0;
    // Hand-offs from this conversation whose answers have not been heard yet, by id.
    this.waiting = new Map();
  }

  /** One conversation, mic open from start to stop: the hotkey starts it and ends it. */
  async start() {
    const c = this.config;
    this.lastSpeech = Date.now();
    for (const bin of audioTools()) if (!has(bin)) throw new Error(`\`${bin}\` is not installed (needed for the microphone and speaker)`);
    this.orb = c.orb.enabled ? startOrb(c, { state: () => this.orbState(), stop: () => this.stop(), log: this.log }) : null;
    // Full duplex (the default): talk over a reply to cut in. That needs the reply kept out
    // of the mic: echo cancellation (loaded here) or a headset (echoCancel false). Without
    // either, half duplex: the mic is muted while a reply plays and a moment after.
    const full = c.audio.duplex === 'full';
    this.ec = full && c.audio.echoCancel ? startEchoCancel(this.log, c.audio) : null;
    this.halfDuplex = !full || (c.audio.echoCancel && !this.ec);
    if (full && this.halfDuplex) this.log({ event: 'half-duplex', why: 'echo cancellation is unavailable' });
    try {
      await this.connect();
    } catch (err) {
      // Say why on the orb before it goes, since a hotkey press has no terminal.
      if (this.orb) {
        this.lastAction = { label: `Cannot connect: ${err.message.replace(/^[^:]*: /, '').slice(0, 60)}`, at: Date.now() };
        await new Promise((r) => setTimeout(r, 3500));
      }
      throw err;
    }
    if (this.stopping) return;
    this.mic = new Mic({ rate: this.session.provider.inputRate, device: this.ec?.input || c.audio.input });
    this.mic.on('data', (pcm) => {
      this.micLevel = rms(pcm);
      if (this.halfDuplex && this.session.speaker.busy(400)) return;
      this.session.feed(pcm);
      if (this.micLevel > 800) this.lastSpeech = Date.now();
    });
    // A session nobody talks to ends itself, so nothing lingers in the background; not while
    // an answer it handed off is still coming.
    this.idle = setInterval(() => {
      if (!this.session.speaker.busy() && Date.now() - this.lastSpeech > c.listen.exitAfterMin * 60000 && !this.answersComing()) {
        this.log({ event: 'idle-exit' });
        this.stop();
      }
    }, 1000);
    // Answers to hand-offs (including ones that came back while no session ran) are spoken
    // in the first quiet moment; the briefing is refreshed when its sources change.
    this.watch = setInterval(() => {
      this.deliverAnswers();
      this.stillComing();
      this.refreshBriefing();
      this.sendBriefingChanges();
    }, 250);
    this.server = net.createServer((sock) => {
      sock.setEncoding('utf8');
      sock.on('data', (d) => {
        const cmd = d.trim();
        sock.end(`${JSON.stringify({ provider: c.provider, running: !this.stopping, mode: this.orbState().mode, orb: !!this.orb })}\n`);
        if (cmd === 'toggle' || cmd === 'stop') this.stop();
      });
      sock.on('error', () => {});
    });
    // Holding the lock means any socket file left here belongs to a session that is gone.
    if (process.platform !== 'win32') fs.rmSync(SOCKET, { force: true });
    this.server.listen(SOCKET);
    this.ownsSocket = true;
    this.mic.start();
    this.cue(880);
    this.log({ event: 'ready', echo_cancel: !!this.ec, half_duplex: this.halfDuplex, orb: !!this.orb });
  }

  /** Connect, retrying with backoff: a dropped network should not end voice mode. */
  async connect(attempts = 5) {
    for (let i = 1; ; i++) {
      try {
        return await this.connectOnce();
      } catch (err) {
        this.session?.provider.close();
        // A key or billing problem does not go away by retrying.
        if (this.stopping || i >= attempts || FATAL.test(err.message)) throw err;
        this.log({ event: 'connect-retry', attempt: i, error: err.message });
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
      }
    }
  }

  async connectOnce() {
    const c = this.config;
    const speaker = this.session?.speaker;
    // Gemini hands out a resumption handle: a reconnect with it continues the same conversation.
    const resume = this.session?.provider.resumeHandle;
    // Records (with their read cache) and the action catalog outlive a reconnect.
    if (!this.records) {
      this.records = new Records(c);
      this.log({ event: 'records-warm', ...this.records.warm() });
      this.catalog = c.actions.enabled ? buildCatalog(c, this.records) : new Map();
    }
    this.refreshBriefing(true);
    const session = new Session(c, { log: this.log, records: this.records, catalog: this.catalog, briefing: this.briefing });
    // What the decision model just did shows on the orb for a few seconds.
    session.onAction = (done) => (this.lastAction = { label: done[0].toUpperCase() + done.slice(1), at: Date.now() });
    // A hand-off's answer leaves the queue once heard; one not heard is tried again.
    session.onHandOff = (h) => this.waiting.set(h.id, { ...h, at: Date.now() });
    session.onAnswer = (a) => {
      this.waiting.delete(a.id);
      this.deliveries?.heard(a.id);
    };
    session.onUnheard = (a) => {
      if (!this.deliveries?.failed(a.id)) return;
      this.waiting.delete(a.id);
      this.log({ event: 'handoff-gave-up', id: a.id });
    };
    session.speaker = speaker || new Speaker({ rate: session.provider.outputRate, device: this.ec?.output || c.audio.output });
    if (resume) session.provider.resumeHandle = resume;
    this.session = session;
    await session.connect();
    session.provider.on('go-away', (timeLeft) => this.log({ event: 'go-away', time_left: timeLeft }));
    session.provider.on('close', (e) => {
      if (this.stopping || this.session !== session) return;
      this.log({ event: 'disconnected', code: e?.code, reason: e?.reason, resume: !!session.provider.resumeHandle });
      this.connect(Infinity).catch((err) => this.log({ event: 'reconnect-failed', error: err.message }));
    });
  }

  /** Rebuild the briefing when a source changed or `refreshMin` passed; push it to the provider. */
  refreshBriefing(initial = false) {
    const b = this.config.briefing;
    if (!b.enabled || !(b.parts || []).length) return;
    const now = Date.now();
    if (!initial && now - (this.briefCheckAt || 0) < 5000) return;
    this.briefCheckAt = now;
    const stamp = briefingStamp(this.config);
    if (!initial && stamp === this.briefStamp && now - this.briefAt < b.refreshMin * 60000) return;
    if (initial && this.briefing !== undefined) return;
    const { text, missing, chars } = buildBriefing(this.config);
    this.briefStamp = stamp;
    this.briefAt = now;
    if (text === this.briefing) return;
    this.briefing = text;
    this.log({ event: 'briefing', chars, ...(missing.length ? { missing } : {}) });
    if (initial) this.briefKnown = text;
    // A provider that cannot replace its instructions (Gemini) is told what changed instead,
    // in the next quiet moment.
    else if (this.session && !this.session.provider.setInstructions?.(instructionsFor(this.config, this.records, text))) this.briefPending = true;
    else this.briefKnown = text;
  }

  /** Tell the model what changed in the briefing since it last saw it. */
  sendBriefingChanges() {
    const s = this.session;
    if (!this.briefPending || !s || !s.quiet()) return;
    this.briefPending = false;
    const changes = briefingChanges(this.briefKnown || '', this.briefing);
    this.briefKnown = this.briefing;
    if (changes && s.provider.note?.(`Briefing update, what changed just now:\n${changes}`)) this.log({ event: 'briefing-update', chars: changes.length });
  }

  /** True while an answer handed off in this conversation (within handoff.waitMin) is not heard yet. */
  answersComing(now = Date.now()) {
    for (const [id, w] of this.waiting) if (now - w.at > this.config.handoff.waitMin * 60000) this.waiting.delete(id);
    return this.waiting.size > 0;
  }

  /**
   * Once per hand-off whose answer is slow (handoff.stillComingSec): in a quiet moment, the
   * voice says the answer is still coming and will be said here, so the user stays on.
   */
  stillComing() {
    const s = this.session;
    const after = this.config.handoff.stillComingSec * 1000;
    if (!s || !this.mic || !after || !this.answersComing() || !s.quiet() || s.speaker.busy(3000) || performance.now() - s.lastLoud < 5000) return;
    const now = Date.now();
    const replies = path.join(handoffDir(this.config), 'replies');
    const due = [...this.waiting.values()].filter((w) => !w.nudged && now - w.at > after && !fs.existsSync(path.join(replies, `${w.id}.json`)));
    if (!due.length) return;
    const what = due.map((w) => `"${w.request}"`).join(' and ');
    if (!s.provider.say?.(redact(`Your working session is still on ${what}. Tell the user in one short sentence that the answer is still coming and that you will say it here as soon as it lands.`))) return;
    for (const w of due) w.nudged = true;
    this.log({ event: 'still-coming', ids: due.map((w) => w.id) });
  }

  deliverAnswers() {
    const s = this.session;
    if (!s || !this.mic || !s.quiet()) return;
    this.deliveries ||= new Deliveries(this.config);
    let next;
    try {
      next = this.deliveries.next();
    } catch {
      return;
    }
    if (!next || !s.speakAnswer(next)) return;
    this.lastAction = { label: 'Answer ready', at: Date.now() };
  }

  /**
   * What the orb shows: speaking (reply level), listening (voice level), thinking or idle,
   * plus the last desktop action for a few seconds after it happened.
   */
  orbState() {
    const a = this.lastAction && Date.now() - this.lastAction.at < 3500 ? { action: this.lastAction.label, actionAt: this.lastAction.at } : {};
    return { ...this.orbMode(), ...a };
  }

  orbMode() {
    const s = this.session;
    if (!s || !this.mic) return { mode: 'thinking', level: 0 };
    const now = performance.now();
    if (s.speaker.busy()) return { mode: 'speaking', level: toLevel(s.speaker.level()) };
    if (now - s.lastLoud < 350) return { mode: 'listening', level: toLevel(this.micLevel) };
    const t = s.turn;
    if (t && !t.logged && now - Math.max(s.lastLoud, t.t0) < 20000) return { mode: 'thinking', level: 0 };
    return { mode: 'idle', level: toLevel(this.micLevel) };
  }

  cue(hz) {
    if (this.config.audio.earcons) this.session?.speaker.write(tone(this.session.provider.outputRate, hz, 90));
  }

  stop() {
    if (this.stopping) return;
    this.stopping = true;
    clearInterval(this.idle);
    clearInterval(this.watch);
    this.mic?.stop();
    this.orb?.stop();
    this.server?.close();
    // The socket and lock are this session's own: it holds the lock.
    if (this.ownsSocket && process.platform !== 'win32') fs.rmSync(SOCKET, { force: true });
    releaseLock();
    this.session?.speaker.cut();
    this.cue(440);
    // Answers still coming are spoken at the next start.
    this.log({ event: 'stopped', ...(this.answersComing() ? { answers_waiting: this.waiting.size } : {}) });
    // Let the closing tone play, then let go of the provider and the echo canceller.
    setTimeout(() => {
      this.session?.close();
      this.ec?.stop();
      process.exit(this.exitCode ?? 0);
    }, 250);
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
  try {
    const { pcm, rate: from } = wavToPcm(fs.readFileSync(file), rate);
    return resample(pcm, from, rate);
  } catch (err) {
    throw new Error(`${file}: ${err.message}`);
  }
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
      // The same instructions a conversation starts with.
      briefing: config.briefing.enabled && (config.briefing.parts || []).length ? buildBriefing(config).text : '',
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
  if (process.platform === 'linux' && config.orb.enabled) {
    const runner = orbRunner(config);
    add(!!runner, runner ? `orb (${runner})` : 'orb: the Qt 6 qml tool (Debian and Ubuntu: qml-qt6)');
  }
  const records = new Records(config);
  for (const s of config.sources) add(s.command ? has(s.command[0]) : fs.existsSync(s.path), `source "${s.name}"`);
  add(!!(config.queue.command || []).length && (path.isAbsolute(config.queue.command[0]) ? fs.existsSync(config.queue.command[0]) : has(config.queue.command[0])), 'queue command (hand-off)');
  if ((config.queue.command || []).length) rows.push(`     answers come back with: ${config.handoff.replyCommand} <id> "<answer>"`);
  if (config.briefing.enabled && (config.briefing.parts || []).length) {
    const b = buildBriefing(config);
    add(!b.missing.length, `briefing: ${config.briefing.parts.length} parts, ${b.chars} characters${b.missing.length ? ` (cannot read: ${b.missing.join(', ')})` : ''}`);
  }
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

/**
 * `voice-mode do "<request>"`: the assistant's own session asks for one desktop action in
 * plain words. The chooser picks from the same fixed catalog as the voice, with the same
 * checks, and it is carried out (or, with dryRun, only described). Nothing is done when no
 * action fits. Returns { key, name, done, ms } or { key: null, ... }.
 */
export async function doRequest(config, text, { log = () => {}, performImpl = perform, records, catalog, chooser, dryRun = false } = {}) {
  records ||= new Records(config);
  catalog ||= buildCatalog(config, records);
  const roots = [config.actions.documents, ...records.roots].filter(Boolean);
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  let result = null;
  const execute = async (key, info) => {
    const item = catalog.get(key);
    const slot = info.slot || '';
    const done = describe(item, slot);
    const logged = config.logTranscripts ? done : describe(item, slot, { words: false });
    const argv = [];
    // A dry run goes through the same checks and only records what would have run.
    const stub = dryRun ? { run: async (a) => argv.push(a), exec: async (a) => (argv.push(a), '(0,)'), note: (folder) => path.join(folder, '(dry run).md') } : {};
    try {
      await performImpl(item, { roots, has, slot, ...stub });
      result = { key, name: item.name, done, ms: ms(), ...(dryRun ? { dry_run: true, would_run: argv[0] || null } : {}) };
      log({ event: 'action', target: key, done: logged, p: info.p, ms_from_request: result.ms, ...(dryRun ? { dry_run: true } : {}) });
    } catch (err) {
      result = { key, name: item.name, error: err.message, ms: ms() };
      log({ event: 'action-failed', target: key, error: err.message });
    }
  };
  // Nobody is mid-sentence here, so a slow first call (a cold connection) may take longer.
  chooser ||= new Chooser(merge(config, { actions: { chooser: { timeoutMs: Math.max(config.actions.chooser.timeoutMs, 10000) } } }), catalog, { execute, log });
  chooser.execute = execute;
  if (!chooser.ready) return { key: null, error: `the chooser has no key (${config.actions.chooser.keyName}) or there are no actions` };
  await chooser.ask(String(text).trim(), true);
  return result || { key: null, note: 'no action in the catalog fits; nothing was done', ms: ms() };
}

/**
 * `voice-mode say "<text>"`: the words, as given and redacted, spoken aloud. A running
 * conversation says them itself (through the hand-off queue), so there is never a second
 * audio stream; otherwise they are turned into speech once and played.
 */
export async function sayText(config, text, { running, fetchImpl = fetch, playImpl = play, dryRun = false } = {}) {
  const words = redact(String(text || '').replace(/\s+/g, ' ').trim());
  if (!words) throw new Error('nothing to say');
  if (running) {
    if (dryRun) return { delivered: 'conversation', dry_run: true, chars: words.length };
    return { delivered: 'conversation', id: saveMessage(config, words), chars: words.length };
  }
  const t0 = performance.now();
  const speech = await synthesize(config, words, { fetchImpl });
  const out = { delivered: 'speech', provider: speech.provider, model: speech.model, voice: speech.voice, chars: words.length, seconds: Math.round((speech.pcm.length / 2 / speech.rate) * 10) / 10, synth_ms: Math.round(performance.now() - t0) };
  if (dryRun) return { ...out, dry_run: true };
  await playImpl(speech.pcm, { rate: speech.rate, device: config.audio.output });
  return out;
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

const FLAGS = ['clip', 'runs', 'play', 'say', 'config', 'dry-run', 'help'];

/** The usage at the top of this file. */
function usage() {
  const head = fs.readFileSync(SELF, 'utf8').split('\n').slice(1);
  return head.slice(0, head.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  // Opening the mic takes an explicit start: no command, help or an unknown flag never does.
  if (!cmd || cmd === 'help' || cmd === '-h' || args.help) {
    (cmd || args.help ? console.log : console.error)(usage());
    return cmd || args.help ? 0 : 2;
  }
  const unknown = cmd === 'say' ? [] : Object.keys(args).filter((k) => k !== '_' && !FLAGS.includes(k));
  if (unknown.length) {
    console.error(`voice-mode: unknown option --${unknown[0]} (see voice-mode help)`);
    return 2;
  }
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
      // A press that ends the conversation can come while it is still starting.
      let live = null;
      process.on('exit', () => releaseLock());
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => (live ? live.stop() : process.exit(0)));
      const keyName = PROVIDERS[config.provider].keyName;
      if (keyName && !readKey(config.keysFile, keyName)) {
        console.error(`voice-mode: ${keyName} is empty in ${config.keysFile}; add it there, or set "provider" in ${config.file}`);
        return 2;
      }
      // Strictly one session: the lock is taken before anything slow happens.
      if (!acquireLock()) {
        console.error(`voice-mode is already running (pid ${lockHolder() ?? '?'}); \`voice-mode toggle\` talks to it`);
        return 2;
      }
      live = new Live(config, makeLogger(config));
      try {
        await live.start();
      } catch (err) {
        console.error(`voice-mode: ${err.message}`);
        // stop() exits once the echo canceller and the rest are released.
        live.exitCode = 1;
        live.stop();
        return new Promise(() => {});
      }
      return new Promise(() => {});
    }
    case 'toggle':
    case 'stop': {
      // On and off: a running session ends (one still connecting is told by signal); with
      // none running, toggle starts one in the background.
      const r = await send('stop');
      const pid = r ? null : lockHolder();
      if (pid) process.kill(pid, 'SIGTERM');
      if (r || pid || cmd === 'stop') {
        if (cmd === 'stop') console.log(r || (pid ? `stopping (pid ${pid})` : 'not running'));
        return 0;
      }
      fs.mkdirSync(config.logDir, { recursive: true });
      const out = fs.openSync(path.join(config.logDir, 'voice-mode.log'), 'a');
      const child = spawn(process.execPath, [SELF, 'start'], { detached: true, stdio: ['ignore', out, out] });
      // The lock is the new session's from this moment, so a quick second press finds it
      // and ends it. Losing the lock to a simultaneous press means that one started it.
      if (!claimLock(child.pid)) child.kill('SIGTERM');
      child.unref();
      return 0;
    }
    case 'reply': {
      // The assistant's answer to a hand-off: voice-mode reply <id> "<answer>"
      // Raw words, so an answer may contain anything, "--" included.
      const [id, ...words] = argv.slice(argv.indexOf('reply') + 1);
      try {
        saveReply(config, id, words.join(' '));
      } catch (err) {
        console.error(`voice-mode reply: ${err.message}`);
        return 2;
      }
      const running = await send('status');
      console.log(running ? `${id}: queued; it will be spoken as soon as the user is not talking` : `${id}: saved; no conversation is running, so the next one starts with it`);
      return 0;
    }
    case 'briefing': {
      const b = buildBriefing(config);
      console.log(b.text || '(empty: add parts to "briefing" in the config)');
      console.error(`\n${b.chars} characters${b.missing.length ? `; could not read: ${b.missing.join(', ')}` : ''}`);
      return 0;
    }
    case 'do': {
      const words = args._.slice(1).join(' ');
      if (!words.trim()) {
        console.error('voice-mode do: say what to do, e.g. voice-mode do "open the documents folder"');
        return 2;
      }
      fs.mkdirSync(config.logDir, { recursive: true });
      const log = makeLogger(config, { file: path.join(config.logDir, 'voice-mode.log'), extra: { from: 'assistant' } });
      const r = await doRequest(config, words, { log, dryRun: !!args['dry-run'] });
      console.log(JSON.stringify(r));
      return r.key && !r.error ? 0 : r.error && !r.key ? 2 : 1;
    }
    case 'say': {
      // Raw words, so the text may contain anything, "--" included; only a leading --dry-run is read.
      const rest = argv.slice(argv.indexOf('say') + 1);
      const dryRun = rest[0] === '--dry-run';
      const text = (dryRun ? rest.slice(1) : rest).join(' ');
      fs.mkdirSync(config.logDir, { recursive: true });
      const log = makeLogger(config, { file: path.join(config.logDir, 'voice-mode.log'), extra: { from: 'assistant' } });
      try {
        const r = await sayText(config, text, { running: !!(await send('status')), dryRun });
        log({ event: 'say', ...r, ...(config.logTranscripts ? { text } : {}) });
        console.log(JSON.stringify(r));
        return 0;
      } catch (err) {
        log({ event: 'say-failed', error: err.message });
        console.error(`voice-mode say: ${err.message}`);
        return err.message === 'nothing to say' ? 2 : 1;
      }
    }
    case 'status': {
      const r = await send('status');
      console.log(r || (lockHolder() ? 'starting' : 'not running'));
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
      console.error(`voice-mode: unknown command "${cmd}" (start, toggle, stop, status, reply, briefing, do, say, check, pick, bench, latency, help)`);
      return 2;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).then((code) => {
    if (typeof code === 'number') process.exit(code);
  });
}

export { main, os };
