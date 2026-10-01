// The lookout: while a conversation runs, the voice speaks up on its own when something new
// waits on you or a worker stopped or failed. It reads the ledger module's live board
// (`/api/board` on 127.0.0.1, else `ledger board --json`), never the Firstmate homes
// themselves, so "waits on you" is the board's own rule, the same one /bearings uses.
//
// - The first read ever is a silent baseline: what is already on the board is not announced.
// - Each event has a key and is said once. What is seen, and what is not said yet, lives in
//   one local state file, so events found near the end of a conversation are said once at
//   the start of the next one. With no conversation running nothing is read, shown or said;
//   the next conversation compares the board with the state file and says what is new and
//   still true.
// - Events found within `batchSec` become one line, and at most one line is spoken every
//   `gapSec`; more roll into "and N more".
// Nothing goes to any model but the one line, through the conversation that is running.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CONFIG_DIR, expandHome } from './config.mjs';

const MAX_SEEN = 2000;
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}...` : t;
};
// A task id said aloud: "blue-header" reads as "blue header".
const spoken = (name) => String(name || 'a task').replace(/[-_]+/g, ' ').trim();
const ORDER = { needs: 0, asks: 0, failed: 1, blocked: 1, stopped: 1 };

/** Only a loopback board: the lookout never talks to another machine. */
export function loopback(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * What the board says now that the lookout may speak about, keyed so each is said once:
 * holds that need you now, questions a worker raised that are not a hold yet, and workers
 * that failed, are blocked, or stopped (their agent was working and is gone) before finishing.
 * `prev` is the last board's rows by id ({ dot, state }), for the stopped check.
 */
export function boardEvents(board, prev = {}) {
  const out = [];
  const held = new Set();
  for (const n of board?.needs || []) {
    held.add(`${n.lane}/${n.task}`);
    const q = clip(n.question, 160);
    out.push({ key: `needs:${n.lane}/${n.task}:${n.since || ''}`, kind: 'needs', live: true, text: q ? `${spoken(n.name)} is waiting on you: ${q}` : `${spoken(n.name)} is waiting on you.` });
  }
  for (const r of board?.rows || []) {
    const name = spoken(r.name || r.task);
    if (r.asks && !held.has(r.id)) out.push({ key: `asks:${r.id}:${clip(r.asks, 80)}`, kind: 'asks', live: true, text: `${name} is asking you something: ${clip(r.asks, 160)}` });
    const last = clip(r.text, 140);
    if (r.state === 'failed') out.push({ key: `failed:${r.id}:${r.time || ''}`, kind: 'failed', live: true, text: `${name} failed${last ? `: ${last}` : '.'}` });
    else if (r.state === 'blocked') out.push({ key: `blocked:${r.id}:${r.time || ''}`, kind: 'blocked', live: true, text: `${name} is stuck${last ? `: ${last}` : '.'}` });
    else if (r.dot === 'stopped' && prev[r.id]?.dot === 'working' && !['done', 'paused', 'needs-decision', 'resolved'].includes(r.state)) {
      out.push({ key: `stopped:${r.id}:${r.time || ''}`, kind: 'stopped', live: false, text: `${name} stopped before finishing.${last ? ` Its last words: ${last}` : ''}` });
    }
  }
  return out;
}

/** Up to three events in one spoken line, what waits on you first; the rest as "and N more". */
export function lookoutLine(events, max = 3) {
  const sorted = [...events].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const said = sorted.slice(0, max).map((e) => (/[.!?]$/.test(e.text) ? e.text : `${e.text}.`));
  const more = sorted.length - said.length;
  return `${said.join(' ')}${more ? ` And ${more} more ${more === 1 ? 'thing' : 'things'} on the board.` : ''}`;
}

/** The board as JSON: the live board's API, else the ledger's own one-shot command. */
export async function readBoard(cfg, { fetchImpl = fetch, run = runJson } = {}) {
  if (cfg.url && loopback(cfg.url)) {
    try {
      const r = await fetchImpl(cfg.url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return await r.json();
    } catch {}
  }
  if ((cfg.command || []).length) return run(cfg.command);
  throw new Error('the board could not be read');
}

function runJson(argv, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (b) => (out += b));
    child.on('error', (err) => (clearTimeout(timer), reject(err)));
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error(`${argv[0]} exited ${code}`);
        resolve(JSON.parse(out));
      } catch (err) {
        reject(err);
      }
    });
  });
}

export const stateFile = (config) => (config.lookout.stateFile ? expandHome(config.lookout.stateFile) : path.join(config.file ? path.dirname(config.file) : CONFIG_DIR, 'lookout.json'));

export class Lookout {
  constructor(config, { fetchImpl = fetch, run = runJson, log = () => {} } = {}) {
    this.config = config;
    this.cfg = config.lookout;
    this.fetchImpl = fetchImpl;
    this.run = run;
    this.log = log;
    this.file = stateFile(config);
    this.state = this.load();
    this.busy = false;
    this.lastCheck = 0;
    this.lastSpoken = 0;
  }

  load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // What was found before this conversation started is due at once, not after a batch wait.
      return { rows: s.rows || {}, seen: s.seen || [], pending: (s.pending || []).map((e) => ({ ...e, at: 0 })), baseline: false };
    } catch {
      return { rows: {}, seen: [], pending: [], baseline: true };
    }
  }

  save() {
    const { rows, seen, pending } = this.state;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ rows, seen: seen.slice(-MAX_SEEN), pending })}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Read the board once and queue what is new; the first read ever only records what is there. */
  async check(now = Date.now()) {
    const board = await readBoard(this.cfg, { fetchImpl: this.fetchImpl, run: this.run });
    const events = boardEvents(board, this.state.rows);
    const current = new Set(events.map((e) => e.key));
    const seen = new Set(this.state.seen);
    const fresh = events.filter((e) => !seen.has(e.key));
    for (const e of fresh) this.state.seen.push(e.key);
    // An event that is no longer true (answered, retried) is not said late.
    this.state.pending = this.state.pending.filter((e) => !e.live || current.has(e.key));
    const queued = this.state.baseline ? [] : fresh;
    this.state.baseline = false;
    for (const e of queued) this.state.pending.push({ ...e, at: now });
    this.state.rows = Object.fromEntries((board.rows || []).map((r) => [r.id, { dot: r.dot, state: r.state }]));
    this.save();
    if (queued.length) this.log({ event: 'lookout', found: queued.length, pending: this.state.pending.length });
    return queued;
  }

  /** The line to say now, if one is due: the burst is gathered and the gap since the last line kept. */
  next(now = Date.now()) {
    const p = this.state.pending;
    if (!p.length) return null;
    if (now - this.lastSpoken < this.cfg.gapSec * 1000) return null;
    if (Math.min(...p.map((e) => e.at)) > now - this.cfg.batchSec * 1000) return null;
    const line = lookoutLine(p);
    this.log({ event: 'lookout-line', events: p.length });
    this.state.pending = [];
    this.lastSpoken = now;
    this.save();
    return line;
  }

  /** Called often from the conversation's own timer: polls every `everySec`, one read at a time. */
  tick(now = Date.now()) {
    if (!this.busy && now - this.lastCheck >= this.cfg.everySec * 1000) {
      this.busy = true;
      this.lastCheck = now;
      this.check(now)
        .catch((err) => this.log({ event: 'lookout-failed', error: err.message }))
        .finally(() => (this.busy = false));
    }
    return this.next(now);
  }
}
