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
// - A line is not a script. It hands the voice the context of each event (the project in plain
//   words, what the work is about, what happened and what you need to do) to say in its own
//   words, by project and topic; a task's name is given only when two items would otherwise
//   be confused.
// Nothing goes to any model but that line, through the conversation that is running.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CONFIG_DIR, expandHome } from './config.mjs';

const MAX_SEEN = 2000;
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}...` : t;
};
// A name made of dashes said as words: "demo-app" reads as "demo app".
const words = (s) => String(s || '').replace(/[-_]+/g, ' ').trim();
const ORDER = { needs: 0, asks: 0, failed: 1, blocked: 1, stopped: 1 };
// Each kind of event in plain words: the short sentence, what happened, what the user can do.
const WHAT = {
  needs: ['is waiting on you', 'it is waiting on the user for a decision', 'make the call'],
  asks: ['has a question for you', 'the worker on it asked the user a question', 'answer the question'],
  failed: ['failed', 'the work failed', 'look at what went wrong when they can'],
  blocked: ['is stuck', 'the worker on it is stuck', 'help it get unstuck'],
  stopped: ['stopped before finishing', 'the worker on it stopped before finishing', 'check whether it should be picked up again'],
};
// The brief the voice model gets with the lookout's facts; it speaks them in its own words.
export const SAY =
  'Tell the user now, briefly, in plain natural speech, like a colleague catching them up: go by project and topic, ' +
  'say in a few words what each piece of work is about, what happened and what they need to do. ' +
  'Never read task ids, slugs, codes or links aloud. Keep it under about twenty seconds.';
const TELL_APART = 'Some items share a topic: only for those, say the name given to tell them apart, naturally, for example "the one called ...".';

/**
 * Firstmate stores a captain-hold reason as "fm-hold-v1:" and base64 text. The words, not the
 * code: a value that has the mark but does not decode cleanly (clipped, say) becomes empty.
 */
export function holdText(s) {
  const t = String(s ?? '').trim();
  if (!t.startsWith('fm-hold-v1:')) return t;
  const b64 = t.slice('fm-hold-v1:'.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || Buffer.from(b64, 'base64').toString('base64') !== b64) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(b64, 'base64'));
  } catch {
    return '';
  }
}

// What a hold or worker said, ready to hear: decoded, links, file paths and status tags out, one short line.
const heard = (s, n) =>
  clip(
    holdText(s)
      .replace(/<?https?:\/\/[^\s<>"]+>?/g, 'a link')
      .replace(/(^|[\s(])[~.\w-]*\/[\w./-]*\.[A-Za-z]\w*/g, '$1a file')
      .replace(/\s*\[[\w-]+=[^\]]*\]/g, '')
      .replace(/(^|\s)[\w-]+=\S+/g, '$1'),
    n,
  );
// The work in a few words: the board's title without its asides, or nothing when it has none.
const topicOf = (name, task) => (name && name !== task ? clip(String(name).replace(/\s*\([^)]*\)/g, ''), 80) : null);

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
 * Each event carries its context: the project in words, the topic (the board's title, or null
 * when it has none), what was said, and the task, which is only said to tell two items apart.
 */
export function boardEvents(board, prev = {}) {
  const out = [];
  const held = new Set();
  const byId = new Map((board?.rows || []).map((r) => [r.id, r]));
  const mainLane = new Set((board?.lanes || []).filter((l) => l.main).map((l) => l.id).concat('main'));
  const projectOf = (lane, project) => words(project) || (mainLane.has(lane) ? null : words(lane)) || null;
  const event = (key, kind, live, { lane, task, name, project }, detail) => {
    const ctx = { project: projectOf(lane, project), topic: topicOf(name, task), task, detail };
    const where = ctx.project ? `In ${ctx.project}, ` : '';
    const what = ctx.topic ? `the work on ${ctx.topic}` : 'a piece of work';
    out.push({ key, kind, live, ...ctx, text: `${where}${what} ${WHAT[kind][0]}${detail ? `: ${detail}` : '.'}` });
  };
  for (const n of board?.needs || []) {
    const id = `${n.lane}/${n.task}`;
    held.add(id);
    event(`needs:${id}:${n.since || ''}`, 'needs', true, { ...n, project: byId.get(id)?.project }, heard(n.question, 160));
  }
  for (const r of board?.rows || []) {
    if (r.asks && !held.has(r.id)) event(`asks:${r.id}:${clip(r.asks, 80)}`, 'asks', true, r, heard(r.asks, 160));
    const last = heard(r.text, 140);
    if (r.state === 'failed') event(`failed:${r.id}:${r.time || ''}`, 'failed', true, r, last);
    else if (r.state === 'blocked') event(`blocked:${r.id}:${r.time || ''}`, 'blocked', true, r, last);
    else if (r.dot === 'stopped' && prev[r.id]?.dot === 'working' && !['done', 'paused', 'needs-decision', 'resolved'].includes(r.state)) {
      event(`stopped:${r.id}:${r.time || ''}`, 'stopped', false, r, last);
    }
  }
  return out;
}

/**
 * Up to three events, what waits on you first, the rest as "and N more", as the facts the voice
 * model says in its own words (`SAY`). Two items with the same topic in one line get the
 * task's name to tell them apart; otherwise no task name is given at all.
 */
export function lookoutLine(events, max = 3) {
  const sorted = [...events].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const said = sorted.slice(0, max);
  // Untitled work is described from what was said, so only the same words would confuse it.
  const same = (e) => `${e.project || ''}|${e.topic ? e.topic.toLowerCase() : `untitled:${e.detail || ''}`}`;
  const count = {};
  for (const e of said) count[same(e)] = (count[same(e)] || 0) + 1;
  const twins = said.some((e) => count[same(e)] > 1);
  const items = said.map((e) => {
    // A line queued before events carried context: its text is all there is.
    if (!WHAT[e.kind] || !('topic' in e)) return `- ${e.text}`;
    const [, happened, todo] = WHAT[e.kind];
    const parts = [
      `Project: ${e.project || 'not named'}.`,
      `Work: ${e.topic || 'no title on the board, so describe it in a few words from what was said'}.`,
      ...(count[same(e)] > 1 && e.task ? [`Name to tell it apart: ${words(e.task)}.`] : []),
      `What happened: ${happened}.`,
      ...(e.detail ? [`What was said: "${e.detail}".`] : []),
      `What the user needs to do: ${todo}.`,
    ];
    return `- ${parts.join(' ')}`;
  });
  const more = sorted.length - said.length;
  return [
    'What is new on the board:',
    ...items,
    ...(more ? [`And ${more} more ${more === 1 ? 'thing' : 'things'} on the board; say that in a few words at the end.`] : []),
    twins ? `${SAY} ${TELL_APART}` : SAY,
  ].join('\n');
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
