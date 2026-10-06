#!/usr/bin/env node
// ledger - one append-only record of what you say and decide, and of the work under way,
// captured the moment it happens, with a live "Now" page rebuilt from it within seconds.
//
// Capture is automatic and read-only. Source adapters read Firstmate homes (every
// configured home's state/*.status lines and state/inbox notes) and the Claude Code session
// transcripts of those homes (your own typed messages, and the coordinating agent's final
// replies), and each new item becomes one JSON line in ledger.jsonl with your exact words
// (secrets redacted), where it came from and what kind of entry it is. Per-source cursors
// and deterministic entry ids mean a restart neither skips nor duplicates; a half-written
// line is left for the next read. Nothing is ever written into a home, a project or a vault.
//
// now.md, next to the ledger, shows what is waiting on you, what is in flight and who is
// working on it, your latest words and rulings, and the latest status per task. The service
// rebuilds it within about a second of any change (fs.watch on the folders it reads, plus a
// periodic rescan for dropped events), writing only when its content changed.
//
// The live board (optional, off unless config.json turns it on) is the same picture as a web
// page on 127.0.0.1, with a live working dot per agent from `herdr agent list`; see board.html.
//
// Usage:
//   node ledger.mjs serve                 the always-on service (capture, watch, rebuild now.md)
//   node ledger.mjs scan [--dry-run]      one capture pass and rebuild, then exit
//   node ledger.mjs add [options] <text>  append one entry ("-" reads the text from stdin)
//        --kind message|status|decision|task|fact  --source S  --project P  --home H  --ref R
//   node ledger.mjs tail [-n 20] [--json] [--kind K]
//   node ledger.mjs now [--rebuild]       print now.md (optionally rebuilt from the records first)
//   node ledger.mjs check                 exit 0 only when the service runs and now.md is fresh
//   node ledger.mjs board [--json]        the live board on its own (the service serves it when
//                                         config.json has "board": {"enabled": true}); --json prints one snapshot
//   --config F                            another config file (default: config.json next to this script)
//
// Installed by ai-workstation-setup (ledger module). No dependencies.

import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
const rest = command === 'help' ? argv : argv.slice(1);
const flag = (name) => rest.includes(name);
const option = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 && i + 1 < rest.length ? rest[i + 1] : fallback;
};

const KINDS = ['message', 'status', 'decision', 'task', 'fact'];
const CHUNK = 1024 * 1024;
const VIEW_BYTES = 8 * 1024 * 1024;
const LOCK_STALE_MS = 30_000;
const LIVE_WINDOW_MS = 10_000;

const expandHome = (p) => path.resolve(String(p).replace(/^~(?=$|[\\/])/, os.homedir()));
const tilde = (p) => {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
};
const pad = (n) => String(n).padStart(2, '0');
function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => {
  const t = oneLine(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function die(code, message) {
  console.error(`ledger: ${message}`);
  process.exit(code);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function statOf(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** What a live pid is running, as one command line; null where this system cannot say. */
function commandOf(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+/g, ' ').trim();
  } catch {
    // no /proc (macOS), or not readable: ask ps
  }
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** A pid that is alive and is (or cannot be told apart from) a ledger: after a power loss the pid
 * in a lock file can belong to any process. Unknown counts as held, so two ledgers never run. */
function ledgerAlive(pid) {
  if (!alive(pid)) return false;
  const command = commandOf(pid);
  return command === null || /(?:^|[\\/\s])node(?:js)?(?:\.exe)?\s(?:.*[\\/\s])?ledger\.mjs(?:\s|$)/.test(command);
}

/** key=value lines, as Firstmate's .meta files and inbox note headers are written. */
function parseKv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// ---------------------------------------------------------------- config

const configFile = expandHome(option('--config', path.join(HERE, 'config.json')));

function homeSpec(h, fallbackName) {
  const spec = typeof h === 'string' ? { path: h } : h || {};
  if (!spec.path) return null;
  const p = expandHome(spec.path);
  return { name: spec.name || fallbackName || path.basename(p).replace(/^\./, ''), path: p, sessions: (spec.sessions || []).map(expandHome) };
}

function loadConfig() {
  const raw = readJson(configFile, null);
  if (!raw) die(2, `cannot read ${configFile}; it is written by the ledger module of ai-workstation-setup`);
  let redact;
  try {
    redact = (raw.redact || []).map((s) => new RegExp(s, 'g'));
  } catch (err) {
    die(2, `${configFile}: a redact pattern is not a valid regular expression (${err.message})`);
  }
  return {
    dataDir: expandHome(raw.dataDir || '~/.local/share/ai-workstation-setup/ledger'),
    mainHome: raw.mainHome ? { ...homeSpec({ name: raw.mainHomeName || 'main', path: raw.mainHome, sessions: raw.mainSessions }), main: true } : null,
    extraHomes: (raw.extraHomes || []).map((h) => homeSpec(h)).filter(Boolean),
    discoverSecondmates: raw.discoverSecondmates !== false,
    transcripts: raw.transcripts !== false,
    claudeProjects: expandHome(raw.claudeProjects || '~/.claude/projects'),
    backfillHours: Number(raw.backfillHours) || 0,
    rescanSeconds: Math.max(2, Number(raw.rescanSeconds) || 20),
    debounceMs: Number.isFinite(raw.debounceMs) ? raw.debounceMs : 150,
    replyChars: Number(raw.replyChars) || 2000,
    now: { messages: 15, statuses: 25, ...(raw.now || {}) },
    redact,
    holdAgeDays: Number.isInteger(raw.holdAgeDays) && raw.holdAgeDays >= 0 ? raw.holdAgeDays : 14,
    board: boardConfig(raw.board),
  };
}

/** The live board is off unless config.json turns it on; it only ever listens on 127.0.0.1. */
function boardConfig(b = {}) {
  const port = Number(b.port ?? 4391);
  if (!Number.isInteger(port) || port < 0 || port > 65535) die(2, `${configFile}: board.port must be a port number, got "${b.port}"`);
  const agents = b.agents === false ? null : Array.isArray(b.agents) && b.agents.length ? b.agents.map(String) : ['herdr', 'agent', 'list'];
  return { enabled: b.enabled === true, port, theme: b.theme ? expandHome(b.theme) : null, agents, pollSeconds: Number(b.pollSeconds) > 0 ? Number(b.pollSeconds) : 2.5 };
}

let cfg;
let FILES;

function setup() {
  cfg = loadConfig();
  FILES = {
    ledger: path.join(cfg.dataDir, 'ledger.jsonl'),
    cursors: path.join(cfg.dataDir, 'cursors.json'),
    now: path.join(cfg.dataDir, 'now.md'),
    heartbeat: path.join(cfg.dataDir, 'serve.json'),
    lock: path.join(cfg.dataDir, 'ledger.lock'),
    owner: path.join(cfg.dataDir, 'capture.pid'),
  };
}

/** The ledger holds your private words: its folder is yours alone (700) and every file 600. */
function ensureDataDir() {
  fs.mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    fs.chmodSync(cfg.dataDir, 0o700);
    for (const f of [FILES.ledger, FILES.cursors, FILES.now, FILES.heartbeat]) {
      if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    }
  }
}

// ---------------------------------------------------------------- redaction

// Common credential shapes. Your own patterns go in config.json "redact".
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bpk_\d+_[A-Za-z0-9]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|token|password|passwd)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,
];

export function redact(text, extra = []) {
  let out = String(text);
  for (const re of [...SECRET_PATTERNS, ...extra]) {
    out = out.replace(re, (match, prefix) => (typeof prefix === 'string' && match.startsWith(prefix) && prefix !== match ? `${prefix}[redacted]` : '[redacted]'));
  }
  return out;
}

// ---------------------------------------------------------------- parsing

/** One Firstmate status line: `state [key=...] corr=...: text`. */
export function parseStatus(line) {
  const text = line.replace(/\r$/, '');
  if (!text.trim()) return null;
  const m = /^([a-z][a-z-]*)((?:\s*\[[^\]]*\]|\s+corr=\S+)*)\s*:\s?([\s\S]*)$/.exec(text);
  if (!m) return { state: 'note', key: null, text: text.trim() };
  const key = /\bkey=([^\]\s]+)/.exec(m[2]);
  return { state: m[1], key: key ? key[1] : null, text: m[3].trim() };
}

/**
 * The words you typed, or null for operational noise: Firstmate's own injected turns
 * (FIRSTMATE_OP, U+2063), instruction doorbells, Stop hook feedback, notifications, local
 * command output, interruptions and compaction summaries. A slash command keeps its
 * arguments ("/name args"); a bare one is dropped.
 */
export function ownerText(raw) {
  let t = String(raw || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!t) return null;
  if (t.startsWith('FIRSTMATE_OP') || t.startsWith('⁣')) return null;
  const head = t.slice(0, 400);
  if (head.includes('Firstmate instruction waiting')) return null;
  if (/Stop hook (feedback|blocking error)/.test(head)) return null;
  if (/^<(task-notification|local-command-|bash-|command-stdout|user-memory-input)/.test(t)) return null;
  if (/^\[Request interrupted/.test(t)) return null;
  if (/^This session is being continued from a previous conversation/.test(t)) return null;
  const cmd = /<command-name>\/?([^<]*)<\/command-name>/.exec(t);
  if (cmd) {
    const a = /<command-args>([\s\S]*?)<\/command-args>/.exec(t);
    const args = (a?.[1] || '').trim();
    return args ? `/${cmd[1].trim()} ${args}` : null;
  }
  return t;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const text = content.filter((x) => x?.type === 'text').map((x) => x.text).join('\n');
  if (!text && content.some((x) => x?.type === 'image')) return '[image]';
  return text;
}

/** One transcript line -> { role: 'owner' | 'agent' | 'other', text } or null (skip). */
export function sessionItem(d) {
  if (!d || typeof d !== 'object' || d.isSidechain) return null;
  if (d.type === 'user' && d.message?.role === 'user') {
    const ct = d.message.content;
    if (Array.isArray(ct) && ct.some((x) => x?.type === 'tool_result')) return null;
    if (d.isMeta || d.isCompactSummary) return null;
    // Turns Firstmate or Claude Code injected mark the turn as not yours.
    if (d.origin && d.origin.kind !== 'human') return { role: 'other' };
    const text = ownerText(contentText(ct));
    return text ? { role: 'owner', text } : { role: 'other' };
  }
  if (d.type === 'assistant' && d.message?.role === 'assistant' && d.message.stop_reason === 'end_turn' && !d.isApiErrorMessage) {
    const text = contentText(d.message.content).trim();
    return text ? { role: 'agent', text } : null;
  }
  return null;
}

// Most transcript lines are tool calls and results, often large; only user turns and final
// replies are parsed, which keeps a backfill over big sessions light.
// The test runs on the raw bytes, so a skipped line is never even decoded.
const has = (bytes, ...needles) => needles.some((n) => bytes.indexOf(n) !== -1);
const worthParsing = (bytes) =>
  has(bytes, '"type":"assistant"', '"type": "assistant"')
    ? has(bytes, '"end_turn"')
    : has(bytes, '"type":"user"', '"type": "user"') && !has(bytes, '"type":"tool_result"', '"type": "tool_result"');

/** Inbox note (fm-inbox.sh): key=value header, a `--` line, then the body. */
function parseNote(text) {
  const i = text.search(/^--\r?$/m);
  if (i < 0) return null;
  const header = parseKv(text.slice(0, i));
  const body = text.slice(i).replace(/^--\r?\n?/, '').trim();
  return body ? { header, body } : null;
}

/** Claude Code keeps a folder's sessions in ~/.claude/projects/<path with every other character as ->. */
export const projectDirName = (dir) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');

// ---------------------------------------------------------------- homes

function secondmateNames(home) {
  const text = readText(path.join(home.path, 'data', 'secondmates.md')) || '';
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+([A-Za-z0-9._-]+)\s+-\s/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

const metaOf = (home, task) => parseKv(readText(path.join(home.path, 'state', `${task}.meta`)));

/** The main home, its second mates (data/secondmates.md + state/<name>.meta home=), and extra homes. */
function discoverHomes() {
  const homes = [];
  const seen = new Set();
  const add = (h) => {
    if (!h || seen.has(h.path) || !statOf(path.join(h.path, 'state'))?.isDirectory()) return;
    seen.add(h.path);
    homes.push(h);
  };
  if (cfg.mainHome) {
    add(cfg.mainHome);
    if (cfg.discoverSecondmates) {
      for (const name of secondmateNames(cfg.mainHome)) {
        const home = metaOf(cfg.mainHome, name).home;
        if (home) add({ name, path: expandHome(home), sessions: [] });
      }
    }
  }
  for (const h of cfg.extraHomes) add(h);
  return homes;
}

function sessionDirs(home) {
  if (!cfg.transcripts) return [];
  return [...new Set([home.path, ...home.sessions].map((d) => path.join(cfg.claudeProjects, projectDirName(d))))];
}

// ---------------------------------------------------------------- ledger file

function withLock(fn) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const fd = fs.openSync(FILES.lock, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const st = statOf(FILES.lock);
      const pid = Number(readText(FILES.lock)) || 0;
      if (st && (Date.now() - st.mtimeMs > LOCK_STALE_MS || (pid && !alive(pid)))) {
        fs.rmSync(FILES.lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`the ledger is locked by another writer (${FILES.lock})`);
      sleepSync(15);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(FILES.lock, { force: true });
  }
}

/** Append entries under the lock, one write, never onto a half-written last line. */
function appendEntries(entries) {
  if (!entries.length) return;
  withLock(() => {
    const st = statOf(FILES.ledger);
    let prefix = '';
    if (st && st.size > 0) {
      const fd = fs.openSync(FILES.ledger, 'r');
      const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, st.size - 1);
      fs.closeSync(fd);
      if (b[0] !== 10) prefix = '\n';
    }
    fs.appendFileSync(FILES.ledger, prefix + entries.map((e) => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600 });
  });
}

/**
 * Complete lines of `file` from byte `from` up to `to`, read in chunks; a partial last line is
 * not returned. A line `accept(bytes)` turns down comes back with `text: null`, never decoded.
 */
function* linesFrom(file, from, to, accept) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return;
  }
  try {
    let pos = from;
    let parts = []; // the pieces of a line longer than what was read so far, joined once at its newline
    let partStart = from;
    while (pos < to) {
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, to - pos));
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const data = buf.subarray(0, n);
      const base = pos;
      pos += n;
      let start = 0;
      let nl;
      while ((nl = data.indexOf(10, start)) !== -1) {
        const offset = parts.length ? partStart : base + start;
        const bytes = parts.length ? Buffer.concat([...parts, data.subarray(start, nl)]) : data.subarray(start, nl);
        parts = [];
        const text = accept && !accept(bytes) ? null : bytes.toString('utf8').replace(/\r$/, '');
        yield { text, offset, end: base + nl + 1 };
        start = nl + 1;
      }
      if (start < n) {
        if (!parts.length) partStart = base + start;
        parts.push(data.subarray(start));
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

function parseEntry(text) {
  try {
    const e = JSON.parse(text);
    return e && typeof e === 'object' && e.id ? e : null;
  } catch {
    return null;
  }
}

/** Recent ledger entries, read from the end of the file (the Now page and `tail` need no more). */
function readRecent(bytes = VIEW_BYTES) {
  const st = statOf(FILES.ledger);
  if (!st) return [];
  const from = Math.max(0, st.size - bytes);
  const out = [];
  let first = from > 0;
  for (const l of linesFrom(FILES.ledger, from, st.size)) {
    if (first) {
      first = false;
      continue;
    }
    const e = parseEntry(l.text);
    if (e) out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------- capture

/** Shared by the service and `scan`: cursors, known ids, and the source adapters. */
class Capture {
  constructor({ dryRun = false } = {}) {
    this.dryRun = dryRun;
    this.cursors = readJson(FILES.cursors, null) || { version: 1, homes: {}, units: {} };
    this.firstRun = !this.cursors.initialized;
    this.ids = new Set();
    this.viewOffset = 0;
    this.view = [];
    this.projects = new Map();
    this.loadLedger();
  }

  /** Every id already in the ledger, so an item captured twice (a crash before the cursor save) is written once. */
  loadLedger() {
    const st = statOf(FILES.ledger);
    if (!st) return;
    for (const l of linesFrom(FILES.ledger, 0, st.size)) {
      const e = parseEntry(l.text);
      if (!e) continue;
      this.ids.add(e.id);
      this.view.push(e);
      if (this.view.length > 4000) this.view.splice(0, 1000);
      this.viewOffset = l.end;
    }
  }

  /** New ledger lines, including ones `ledger add` wrote from another process. */
  refreshView() {
    const st = statOf(FILES.ledger);
    if (!st || st.size <= this.viewOffset) return;
    for (const l of linesFrom(FILES.ledger, this.viewOffset, st.size)) {
      const e = parseEntry(l.text);
      if (e) {
        this.ids.add(e.id);
        this.view.push(e);
      }
      this.viewOffset = l.end;
    }
    if (this.view.length > 4000) this.view.splice(0, this.view.length - 3000);
  }

  projectOf(home, task) {
    const k = `${home.path}\0${task}`;
    const meta = metaOf(home, task);
    if (meta.kind === 'secondmate') this.projects.set(k, task);
    else if (meta.project) this.projects.set(k, path.basename(meta.project));
    return this.projects.get(k) ?? null;
  }

  /**
   * A unit (one file or folder) seen for the first time starts at its end when its home is
   * new in this pass (history is not news), unless backfillHours asks for the recent past;
   * a new file in a home already watched is read from its start.
   */
  startMode(home) {
    if (!this.newHomes.has(home.path)) return 'start';
    return cfg.backfillHours > 0 ? 'backfill' : 'end';
  }

  /** New complete lines of a file since its cursor; `mode` applies only to a unit without one. */
  tail(key, file, mode, { countLines = false, accept } = {}) {
    const st = statOf(file);
    if (!st?.isFile()) return [];
    let cur = this.cursors.units[key];
    if (!cur) {
      const skip = mode === 'end' || (mode === 'backfill' && st.mtimeMs < this.cutoff);
      cur = { offset: skip ? st.size : 0, line: 0, ino: st.ino };
      if (skip && countLines) for (const _ of linesFrom(file, 0, st.size)) cur.line++;
      this.cursors.units[key] = cur;
      this.dirty = true;
      if (skip) return [];
    }
    if (st.ino !== cur.ino || st.size < cur.offset) Object.assign(cur, { offset: 0, line: 0, ino: st.ino, turn: undefined });
    if (st.size === cur.offset) return [];
    const out = [];
    for (const l of linesFrom(file, cur.offset, st.size, accept)) {
      cur.line++;
      out.push({ ...l, line: cur.line, mtimeMs: st.mtimeMs });
    }
    if (out.length) {
      cur.offset = out.at(-1).end;
      this.dirty = true;
    }
    return out;
  }

  emit(entry, idSeed) {
    const e = {
      id: hash(idSeed),
      time: entry.time,
      source: entry.source,
      home: entry.home ?? null,
      project: entry.project ?? null,
      ...(entry.task ? { task: entry.task } : {}),
      kind: entry.kind,
      ...(entry.state ? { state: entry.state } : {}),
      ...(entry.key ? { key: entry.key } : {}),
      text: redact(entry.text, cfg.redact),
      ref: entry.ref,
      replaces: null,
      ...(entry.via ? { via: entry.via } : {}),
      ...(entry.approx ? { approx: true } : {}),
      ...(entry.truncated ? { truncated: true } : {}),
    };
    if (this.ids.has(e.id)) return;
    this.ids.add(e.id);
    this.pending.push(e);
  }

  /** Time of a line with no timestamp of its own: now when just written, else the file's mtime. */
  lineTime(mtimeMs) {
    return Date.now() - mtimeMs < LIVE_WINDOW_MS ? { time: new Date().toISOString() } : { time: new Date(mtimeMs).toISOString(), approx: true };
  }

  scan() {
    this.pending = [];
    this.dirty = false;
    this.homes = discoverHomes();
    this.newHomes = new Set(this.homes.filter((h) => !this.cursors.homes[h.path]).map((h) => h.path));
    this.cutoff = Date.now() - cfg.backfillHours * 3_600_000;
    for (const adapter of ADAPTERS) {
      for (const home of this.homes) {
        try {
          adapter.scan(this, home);
        } catch (err) {
          console.error(`ledger: ${adapter.name} in ${tilde(home.path)}: ${err.message}`);
        }
      }
    }
    for (const h of this.newHomes) this.cursors.homes[h] = new Date().toISOString();
    if (this.newHomes.size || this.firstRun) this.dirty = true;
    this.cursors.initialized ||= new Date().toISOString();
    this.firstRun = false;
    const captured = this.pending.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    if (this.dryRun) return captured;
    appendEntries(captured);
    if (this.dirty) writeAtomic(FILES.cursors, `${JSON.stringify(this.cursors)}\n`);
    this.refreshView();
    return captured;
  }
}

// Source adapters. Each reads one kind of record, read-only, and emits entries through
// run.emit(entry, idSeed); the id seed names the item's place in its source so a re-read
// never duplicates it. More sources (task managers, calendars) are more objects here.
const ADAPTERS = [
  {
    name: 'status',
    scan(run, home) {
      const dir = path.join(home.path, 'state');
      for (const name of listDir(dir)) {
        if (!name.endsWith('.status') || name.startsWith('.')) continue;
        const task = name.slice(0, -'.status'.length);
        const file = path.join(dir, name);
        const key = `status:${file}`;
        for (const l of run.tail(key, file, run.startMode(home), { countLines: true })) {
          const s = parseStatus(l.text);
          if (!s) continue;
          run.emit(
            {
              ...run.lineTime(l.mtimeMs),
              source: 'status',
              home: home.name,
              project: run.projectOf(home, task),
              task,
              kind: s.state === 'resolved' ? 'decision' : 'status',
              state: s.state,
              key: s.key,
              text: s.text,
              ref: `${file}:${l.line}`,
            },
            // The text is part of the seed: a status file cleared and rewritten for a reused task id
            // repeats offsets, not lines.
            `${key}@${l.offset}:${l.text}`,
          );
        }
      }
    },
  },
  {
    name: 'inbox',
    scan(run, home) {
      const key = `inbox:${home.path}`;
      const mode = run.cursors.units[key] ? 'start' : run.startMode(home);
      const cur = (run.cursors.units[key] ||= { seen: {} });
      for (const sub of ['inbox', path.join('inbox', 'handled')]) {
        const dir = path.join(home.path, 'state', sub);
        for (const name of listDir(dir)) {
          if (!name.endsWith('.note')) continue;
          const file = path.join(dir, name);
          const note = parseNote(readText(file) || '');
          if (!note) continue; // not fully written yet
          const id = note.header.id || name.slice(0, -'.note'.length);
          if (cur.seen[id]) continue;
          cur.seen[id] = 1;
          run.dirty = true;
          const at = Date.parse(note.header.at) || statOf(file)?.mtimeMs || Date.now();
          if (mode === 'end' || (mode === 'backfill' && at < run.cutoff)) continue;
          run.emit(
            { time: new Date(at).toISOString(), source: 'inbox', home: home.name, kind: 'message', text: note.body, via: note.header.source, ref: file },
            `inbox:${home.path}:${id}`,
          );
        }
      }
    },
  },
  {
    name: 'session',
    scan(run, home) {
      for (const dir of sessionDirs(home)) {
        for (const name of listDir(dir)) {
          if (!name.endsWith('.jsonl')) continue;
          const file = path.join(dir, name);
          const key = `session:${file}`;
          const mode = run.startMode(home);
          const fresh = !run.cursors.units[key];
          const lines = run.tail(key, file, mode, { accept: worthParsing });
          const cur = run.cursors.units[key];
          for (const l of lines) {
            if (l.text === null) continue;
            let d;
            try {
              d = JSON.parse(l.text);
            } catch {
              continue;
            }
            const item = sessionItem(d);
            if (!item) continue;
            // An agent reply belongs to the turn that started it; in a second mate's home a turn
            // Firstmate started is operational, so only replies to your own words are kept there.
            if (item.role !== 'agent') cur.turn = item.role;
            if (item.role === 'other') continue;
            if (item.role === 'agent' && !home.main && cur.turn !== 'owner') continue;
            const t = Date.parse(d.timestamp);
            if (fresh && mode === 'backfill' && !(t >= run.cutoff)) continue;
            let text = item.text;
            const truncated = item.role === 'agent' && text.length > cfg.replyChars;
            if (truncated) text = `${text.slice(0, cfg.replyChars - 1)}…`;
            run.emit(
              {
                time: Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(),
                source: item.role === 'owner' ? 'owner' : 'agent',
                home: home.name,
                project: home.main ? null : home.name,
                kind: 'message',
                text,
                truncated,
                ref: `${file}#${d.uuid || l.offset}`,
              },
              `${key}@${d.uuid || l.offset}`,
            );
          }
        }
      }
    },
  },
];

// ---------------------------------------------------------------- the Now page

// Backlog rows, read the way Firstmate's fleet snapshot reads them (bin/fm-fleet-snapshot.sh,
// backlog_json), so a hold is "now" or "parked" here exactly when /bearings puts it in Captain's
// Call or in Charted Next. Only rows under "## In flight", "## Queued" and "## Done" count; an
// indented line under a row is its body.
const rowMeta = (rest, key) => oneLine(new RegExp(`.*(?:\\(|,\\s*)${key}:\\s*([^,)]*)`).exec(rest)?.[1] ?? '') || null;
const metaWord = (rest, key) => oneLine(new RegExp(`.*(?:\\(|,\\s*)${key}\\s+([^,)]*)`).exec(rest)?.[1] ?? '') || null;
const SECTIONS = { 'In flight': 'in_flight', Queued: 'queued', Done: 'done' };

function epochOf(d) {
  if (typeof d !== 'string') return null;
  const t = Date.parse(d.includes('T') ? d : `${d}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** Title of a backlog row without its links, blockers and trailing (key: value) groups. */
function rowTitle(rest) {
  let t = rest.replace(/<?https?:\/\/[^\s)"<>]+>?/g, '').replace(/\s*blocked-by:\s+[^\s)]+\s+-\s+.*$/, '').replace(/\s*blocked-by:\s+\S+/g, '');
  for (let i = 0; i < 20; i++) {
    const next = t.replace(/\s*\(\s*(?:(?:repo|kind|priority|hold|hold-kind|hold-until):\s*[^)]*|(?:since|merged|reported|done)\s+[^)]*)\s*\)\s*$/, '');
    if (next === t) break;
    t = next;
  }
  return oneLine(t.replace(/\s+-?\s*data\/[^\s)]+\/report\.md$/, '').replace(/\s+-?\s*local main$/, '').replace(/\s+-\s*$/, ''));
}

/**
 * Every structured row of a backlog, each captain hold with its bucket: "blocked" when any
 * blocked-by id is not Done, else "dated" while hold-until is after today (UTC), else "aged"
 * when an undated hold was set at least `ageDays` ago, else "live" (it needs you now).
 * Mirrors hold_bucket in bin/fm-fleet-snapshot.sh; prose is never read. `text` is the row's body
 * as written, without its indent, for the task sync (sync.mjs).
 */
export function backlogRows(text, { now = Date.now(), ageDays = 14 } = {}) {
  const rows = [];
  let section = null;
  let last = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      section = SECTIONS[h[1].trim()] || null;
      last = null;
      continue;
    }
    if (!section) continue;
    if (!line.trim()) {
      if (last) last.raw.push('');
      continue;
    }
    const m = /^[-*]\s+\[[ xX]\]\s+(\S+)\s+-\s+(.*)$/.exec(line) || /^[-*]\s+\*\*([^*]+)\*\*\s+-\s+(.*)$/.exec(line);
    if (m) {
      const rest = m[2];
      last = {
        id: m[1].trim(),
        state: section,
        title: rowTitle(rest),
        repo: rowMeta(rest, 'repo'),
        holdReason: oneLine(/.*\(hold:\s*([^)]*)/.exec(rest)?.[1] ?? '') || null,
        holdKind: rowMeta(rest, 'hold-kind'),
        holdUntil: rowMeta(rest, 'hold-until'),
        blockedBy: [...new Set([...rest.matchAll(/blocked-by:\s+([^\s)]+)/g)].map((x) => x[1]))],
        since: metaWord(rest, 'since'),
        completion: ['merged', 'reported', 'done'].map((verb) => ({ verb, date: metaWord(rest, verb) })).find((c) => c.date) || null,
        body: [],
        raw: [],
      };
      rows.push(last);
    } else if (last && /^\s/.test(line)) {
      last.body.push(line.trim());
      last.raw.push(line.replace(/^ {1,2}/, ''));
    } else last = null;
  }
  const done = {};
  for (const r of rows) done[r.id] = (done[r.id] ?? true) && r.state === 'done';
  const today = new Date(now).toISOString().slice(0, 10);
  for (const r of rows) {
    r.text = r.raw.join('\n').trim();
    delete r.raw;
    r.holdSet = /^Captain hold set:\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?)$/.exec(r.body[0] || '')?.[1] || null;
    const from = epochOf(r.holdSet || r.since);
    r.holdAgeDays = from === null ? null : Math.floor((now - from) / 86_400_000);
    r.unresolved = r.blockedBy.filter((id) => done[id] !== true);
    r.bucket =
      r.holdKind !== 'captain' || r.holdReason === null || r.state === 'done'
        ? null
        : r.unresolved.length
          ? 'blocked'
          : r.holdUntil !== null && r.holdUntil > today
            ? 'dated'
            : r.holdUntil === null && r.holdAgeDays !== null && r.holdAgeDays >= ageDays
              ? 'aged'
              : 'live';
  }
  return rows;
}

/** Why a hold is parked, in plain words. */
function parkedWhy(r) {
  if (r.bucket === 'blocked') return `after ${r.unresolved.join(', ')}`;
  if (r.bucket === 'dated') return `until ${r.holdUntil}`;
  if (r.bucket === 'aged') return `held ${r.holdAgeDays} days`;
  return null;
}

/** Open backlog items held for you (Firstmate captain holds) in a home's data/backlog.md. */
function captainHolds(home) {
  return backlogRows(readText(path.join(home.path, 'data', 'backlog.md')), { ageDays: cfg.holdAgeDays })
    .filter((r) => r.bucket)
    .map((r) => ({
      home: home.name,
      task: r.id,
      title: r.title,
      question: r.holdReason || r.title,
      since: epochOf(r.holdSet || r.since),
      parked: r.bucket === 'live' ? null : parkedWhy(r),
    }));
}

/** Tasks with a live record (state/<id>.meta): what they do now, from the last status line. */
function tasksInFlight(home) {
  const dir = path.join(home.path, 'state');
  const out = [];
  for (const name of listDir(dir)) {
    if (!name.endsWith('.meta') || name.startsWith('.')) continue;
    const task = name.slice(0, -'.meta'.length);
    const meta = parseKv(readText(path.join(dir, name)));
    const statusFile = path.join(dir, `${task}.status`);
    const lines = (readText(statusFile) || '').split(/\r?\n/).map(parseStatus).filter(Boolean);
    out.push({
      home: home.name,
      task,
      secondmate: meta.kind === 'secondmate',
      project: meta.kind === 'secondmate' ? null : meta.project ? path.basename(meta.project) : null,
      worktree: meta.worktree || meta.home || null,
      last: lines.at(-1) || null,
      updated: statOf(statusFile)?.mtimeMs || statOf(path.join(dir, name))?.mtimeMs || 0,
      open: openDecisions(lines),
      pane: meta.herdr_pane_id || null,
    });
  }
  return out;
}

/** needs-decision lines not yet closed by a `resolved` line with the same key. */
function openDecisions(lines) {
  const open = new Map();
  let n = 0;
  for (const s of lines) {
    if (s.state === 'needs-decision') open.set(s.key || `#${n++}`, s);
    else if (s.state === 'resolved') {
      if (s.key) open.delete(s.key);
      else for (const k of [...open.keys()]) if (k.startsWith('#')) open.delete(k);
    }
  }
  return [...open.values()];
}

const md = (s) => String(s).replace(/([\\`*<>|])/g, '\\$1');

export function buildNow(homes, entries) {
  const holds = homes.flatMap(captainHolds);
  const active = holds.filter((h) => !h.parked).sort((a, b) => (b.since || 0) - (a.since || 0));
  const parked = holds.filter((h) => h.parked);
  const held = new Set(holds.map((h) => h.task));
  const tasks = homes.flatMap(tasksInFlight).sort((a, b) => b.updated - a.updated);
  // A worker's question already held as a backlog item is shown once, as the hold.
  const echoes = (t, d) => held.has(t.task) || [...held].some((id) => d.text.includes(`captain hold ${id}`) || (d.key || '').includes(id));
  const raised = tasks.flatMap((t) => t.open.filter((d) => !echoes(t, d)).map((d) => ({ ...t, decision: d })));
  const out = ['# Now', ''];
  const sources = homes.map((h) => h.name).join(', ') || 'none found';
  out.push(`Homes: ${md(sources)}. Ledger entries read: ${entries.length}.`, '');

  out.push(`## Waiting on you (${active.length + raised.length})`, '');
  if (!active.length && !raised.length) out.push('- nothing');
  for (const h of active) {
    out.push(`- **${md(h.task)}** (${md(h.home)}): ${md(clip(h.question, 400))}${h.since ? ` _(held since ${stamp(h.since)})_` : ''}`);
  }
  for (const r of raised) {
    out.push(`- **${md(r.task)}** (${md(r.home)}) asks: ${md(clip(r.decision.text, 400))} _(${stamp(r.updated)})_`);
  }
  if (parked.length) out.push('', `Parked: ${parked.map((h) => `${md(h.task)} (${md(h.parked)})`).join(', ')}.`);
  out.push('');

  const workers = tasks.filter((t) => !t.secondmate);
  const mates = tasks.filter((t) => t.secondmate);
  out.push(`## In flight (${workers.length})`, '');
  if (!workers.length) out.push('- nothing');
  for (const t of workers) {
    const doing = t.last ? `${t.last.state}: ${clip(t.last.text, 240)}` : 'no status yet';
    const copy = t.worktree ? ` · copy \`${tilde(t.worktree)}\`` : '';
    out.push(`- **${md(t.task)}** (${md(t.home)}) · ${md(t.project || 'no project')}${copy} · ${md(doing)} _(${t.updated ? stamp(t.updated) : 'never'})_`);
  }
  if (mates.length) {
    out.push('', `Second mates (${mates.length}):`, '');
    for (const t of mates) {
      const doing = t.last ? `${t.last.state}: ${clip(t.last.text, 200)}` : 'no status yet';
      out.push(`- **${md(t.task)}** (${md(t.home)}) · ${md(doing)} _(${t.updated ? stamp(t.updated) : 'never'})_`);
    }
  }
  out.push('');

  // Lines whose time is only their file's mtime (a backfill) would crowd out what was really said last.
  const words = entries
    .filter((e) => !e.approx && (e.source === 'owner' || e.kind === 'decision' || e.source === 'inbox'))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .slice(-cfg.now.messages)
    .reverse();
  out.push('## Latest from you and rulings', '');
  if (!words.length) out.push('- nothing yet');
  for (const e of words) {
    const who = e.kind === 'decision' ? `resolved ${e.task ? md(e.task) : ''}`.trim() : e.source === 'inbox' ? `note${e.via ? ` (${md(e.via)})` : ''}` : 'you';
    out.push(`- ${stamp(Date.parse(e.time))} · ${md(e.home || '-')} · ${who}: ${md(clip(e.text, 300))}`);
  }
  out.push('');

  const latest = new Map();
  for (const e of entries) if (e.source === 'status' && e.task) latest.set(`${e.home}\0${e.task}`, e);
  const statuses = [...latest.values()].sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, cfg.now.statuses);
  out.push('## Latest status per task', '');
  if (!statuses.length) out.push('- nothing yet');
  for (const e of statuses) {
    out.push(`- ${stamp(Date.parse(e.time))} · **${md(e.task)}** (${md(e.home)}) ${md(e.state || e.kind)}: ${md(clip(e.text, 240))}`);
  }
  out.push('');
  return out.join('\n');
}

/** Write now.md when its content changed; the rebuild time is part of the page only then. */
function writeNow(homes, entries) {
  const body = buildNow(homes, entries);
  const old = readText(FILES.now);
  if (old !== null && old.replace(/^Rebuilt .*\n\n/m, '') === body) return false;
  writeAtomic(FILES.now, body.replace(/^# Now\n\n/, `# Now\n\nRebuilt ${stamp(Date.now())}:${pad(new Date().getSeconds())}\n\n`));
  return true;
}

// ---------------------------------------------------------------- the live board

// A read-only page on 127.0.0.1 over the same records as the Now page, plus which agents are
// working right now (`herdr agent list`). One JSON snapshot (/api/board) and one page that polls
// it; a card's timeline comes from the ledger (/api/timeline). It never answers, steers or writes.

const WORDS = { working: 'Working', 'needs-decision': 'Asking', blocked: 'Blocked', paused: 'Waiting', done: 'Done', failed: 'Failed', resolved: 'Answered', note: 'Note' };
export const stateWord = (s) => WORDS[s] || (s ? s[0].toUpperCase() + s.slice(1).replace(/-/g, ' ') : 'Quiet');

/** The agents in `herdr agent list` output, or null when it cannot be read. */
export function parseAgents(text) {
  try {
    const d = JSON.parse(text);
    const list = d?.result?.agents ?? d?.agents ?? d;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
// A status line's words without the correlation id a relay put in front of them.
const plain = (text, n) => clip(String(text || '').replace(/^corr=\S+\s*/, ''), n);

/**
 * The board snapshot: counts, one lane per home (the main home first, then each second mate),
 * one row per task with a live record, and the holds split into "needs you now" and "parked" by
 * the same buckets as /bearings. Names come from the backlog, never from terminal titles.
 * `agents` null means the live status could not be read: every dot is then "unknown".
 */
export function buildBoard(homes, agents, { now = Date.now(), ageDays = 14 } = {}) {
  const panes = new Map((agents || []).map((a) => [a.pane_id, a]));
  const dot = (a) => (!agents ? 'unknown' : !a ? 'stopped' : a.agent_status === 'working' ? 'working' : 'idle');
  const today = stamp(now).slice(0, 10);
  const lanes = [];
  const rows = [];
  const needs = [];
  const parked = [];
  const landed = [];
  const mates = new Map();
  const claimed = new Set();
  const perHome = homes.map((home) => {
    const tasks = tasksInFlight(home);
    for (const t of tasks) if (t.pane) claimed.add(t.pane);
    if (home.main) for (const t of tasks) if (t.secondmate) mates.set(t.task, t);
    return { home, tasks, backlog: backlogRows(readText(path.join(home.path, 'data', 'backlog.md')), { now, ageDays }) };
  });
  for (const { home, tasks, backlog } of perHome) {
    const titles = new Map(backlog.map((r) => [r.id, r]));
    const name = (id) => titles.get(id)?.title || id;
    // A home's own agent: the pane its record names, else one running in the home or its session folders.
    const mate = mates.get(home.name);
    const dirs = [home.path, ...home.sessions];
    const free = (agents || []).filter((a) => !claimed.has(a.pane_id));
    const own = (mate?.pane && panes.get(mate.pane)) || free.find((a) => dirs.includes(a.foreground_cwd)) || free.find((a) => dirs.includes(a.cwd));
    const says = mate?.last;
    lanes.push({
      id: home.name,
      main: !!home.main,
      dot: dot(own),
      ...(mate ? { home: mainName(homes), task: home.name } : {}),
      word: says ? stateWord(says.state) : null,
      text: says ? plain(says.text, 300) : null,
      time: iso(mate?.updated),
    });
    for (const t of tasks.filter((x) => !x.secondmate)) {
      const agent = (t.pane && panes.get(t.pane)) || (t.worktree && (agents || []).find((a) => a.foreground_cwd === t.worktree));
      rows.push({
        id: `${home.name}/${t.task}`,
        lane: home.name,
        task: t.task,
        name: name(t.task),
        project: t.project || titles.get(t.task)?.repo || null,
        dot: dot(agent),
        state: t.last?.state || null,
        word: t.last ? stateWord(t.last.state) : 'Quiet',
        text: t.last ? plain(t.last.text, 300) : null,
        time: iso(t.updated),
        asks: t.open.length ? plain(t.open.at(-1).text, 300) : null,
      });
    }
    for (const r of backlog) {
      const item = { lane: home.name, task: r.id, name: r.title || r.id };
      if (r.bucket === 'live') needs.push({ ...item, question: clip(r.holdReason, 400), since: iso(epochOf(r.holdSet || r.since)) });
      else if (r.bucket) parked.push({ ...item, why: parkedWhy(r), question: clip(r.holdReason, 400) });
      if (r.state === 'done' && r.completion?.date === today) landed.push({ ...item, verb: r.completion.verb });
    }
  }
  const rank = { working: 0, idle: 1, unknown: 1, stopped: 2 };
  rows.sort((a, b) => rank[a.dot] - rank[b.dot] || String(b.time).localeCompare(String(a.time)));
  needs.sort((a, b) => String(b.since).localeCompare(String(a.since)));
  return {
    generated_at: new Date(now).toISOString(),
    counts: { needs: needs.length, working: rows.filter((r) => r.dot === 'working').length, landed: landed.length, parked: parked.length },
    live: agents ? 'ok' : 'unavailable',
    lanes,
    rows,
    needs,
    parked,
    landed,
  };
}

const mainName = (homes) => homes.find((h) => h.main)?.name || 'main';

/** One task's entries in the ledger, newest first. */
export function timeline(entries, home, task, limit = 100) {
  return entries
    .filter((e) => e.home === home && e.task === task)
    .slice(-limit)
    .reverse()
    .map((e) => ({ time: e.time, approx: !!e.approx, word: e.state ? stateWord(e.state) : stateWord(e.kind), text: e.text }));
}

const TYPES = { '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * Serve the board on 127.0.0.1. `source()` gives the homes for a snapshot. Only GET,
 * only a Host of 127.0.0.1 or localhost on this port (a page elsewhere cannot rebind a name to
 * it), and the theme folder is the only other folder it reads files from.
 */
function startBoard(source, { onListen, onError } = {}) {
  const page = readText(path.join(HERE, 'board.html'));
  if (!page) {
    onError?.(new Error(`${tilde(path.join(HERE, 'board.html'))} is missing; run the installer again`));
    return null;
  }
  const b = cfg.board;
  let agents = { at: 0, list: null, pending: null };
  const readAgents = () => {
    if (!b.agents) return Promise.resolve(null);
    if (Date.now() - agents.at < 2000) return Promise.resolve(agents.list);
    agents.pending ||= new Promise((resolve) => {
      execFile(b.agents[0], b.agents.slice(1), { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        agents = { at: Date.now(), list: err ? null : parseAgents(stdout), pending: null };
        resolve(agents.list);
      });
    });
    return agents.pending;
  };
  let snap = { at: 0, body: null };
  const snapshot = async () => {
    if (Date.now() - snap.at < 1000 && snap.body) return snap.body;
    const list = await readAgents();
    const homes = source();
    const board = buildBoard(homes, list, { ageDays: cfg.holdAgeDays });
    board.poll_seconds = b.pollSeconds;
    snap = { at: Date.now(), body: JSON.stringify(board) };
    return snap.body;
  };
  const themeDir = b.theme ? path.dirname(b.theme) : null;

  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const port = server.address()?.port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(403, 'text/plain', 'forbidden\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'read only\n');
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', page);
      if (url.pathname === '/api/board') return send(200, 'application/json', await snapshot());
      if (url.pathname === '/api/timeline') {
        const home = url.searchParams.get('home');
        const task = url.searchParams.get('task');
        if (!home || !task) return send(400, 'text/plain', 'home and task are required\n');
        return send(200, 'application/json', JSON.stringify({ home, task, entries: timeline(readRecent(), home, task) }));
      }
      if (url.pathname === '/theme.css') return send(200, 'text/css', (b.theme && readText(b.theme)) || '/* no theme set: board.theme in config.json */\n');
      const file = /^\/theme\/([A-Za-z0-9_-][A-Za-z0-9._-]*)$/.exec(url.pathname)?.[1];
      if (file && themeDir && TYPES[path.extname(file)]) {
        try {
          return send(200, TYPES[path.extname(file)], fs.readFileSync(path.join(themeDir, file)));
        } catch {
          return send(404, 'text/plain', 'not found\n');
        }
      }
      return send(404, 'text/plain', 'not found\n');
    } catch (err) {
      console.error(`ledger: board: ${err.stack || err.message}`);
      return send(500, 'text/plain', 'the board could not be built; see the ledger log\n');
    }
  });
  server.on('error', (err) => onError?.(err));
  server.listen(b.port, '127.0.0.1', () => onListen?.(`http://127.0.0.1:${server.address().port}/`));
  return server;
}

// ---------------------------------------------------------------- commands

/** One capturer at a time: the service, or a `scan` while no service runs. */
function takeCapture() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(FILES.owner, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      const release = () => {
        if (Number(readText(FILES.owner)) === process.pid) fs.rmSync(FILES.owner, { force: true });
      };
      process.on('exit', release);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const pid = Number(readText(FILES.owner)) || 0;
      if (pid !== process.pid && ledgerAlive(pid)) die(2, `the ledger service is already capturing (pid ${pid})`);
      fs.rmSync(FILES.owner, { force: true });
    }
  }
  die(2, `cannot take ${FILES.owner}`);
}

function cmdScan() {
  ensureDataDir();
  const dryRun = flag('--dry-run');
  if (!dryRun) takeCapture();
  const cap = new Capture({ dryRun });
  const captured = cap.scan();
  if (dryRun) {
    console.log(`would capture ${captured.length} entr${captured.length === 1 ? 'y' : 'ies'} from ${cap.homes.length} home(s): ${cap.homes.map((h) => h.name).join(', ')}`);
    for (const e of captured.slice(-10)) console.log(`  ${e.time} [${e.source} ${e.home}] ${clip(e.text, 120)}`);
    return;
  }
  writeNow(cap.homes, cap.view);
  console.log(`captured ${captured.length} entr${captured.length === 1 ? 'y' : 'ies'} from ${cap.homes.length} home(s); ${tilde(FILES.now)} is current`);
}

function cmdServe() {
  ensureDataDir();
  takeCapture();
  const cap = new Capture();
  const watchers = new Map();
  let timer = null;
  let running = false;
  let again = false;
  let lastBeat = 0;
  let boardUrl = null;
  const started = new Date().toISOString();

  // The heartbeat says the service is alive and how far into the ledger the Now page has read.
  let beatBytes = -1;
  const beat = (force) => {
    if (!force && beatBytes === cap.viewOffset && Date.now() - lastBeat < 5000) return;
    lastBeat = Date.now();
    beatBytes = cap.viewOffset;
    const hb = { pid: process.pid, started, beat: new Date().toISOString(), rescanSeconds: cfg.rescanSeconds, ledgerBytes: cap.viewOffset, homes: (cap.homes || []).map((h) => h.name), ...(boardUrl ? { board: boardUrl } : {}) };
    writeAtomic(FILES.heartbeat, `${JSON.stringify(hb)}\n`);
  };

  const scan = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const captured = cap.scan();
        if (captured.length) console.log(`captured ${captured.length} entr${captured.length === 1 ? 'y' : 'ies'}`);
        writeNow(cap.homes, cap.view);
        arm();
      } while (again);
      beat(false);
    } catch (err) {
      console.error(`ledger: scan failed: ${err.stack || err.message}`);
    } finally {
      running = false;
    }
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(scan, cfg.debounceMs);
  };

  const watch = (target, opts, accept) => {
    const key = target;
    if (watchers.has(key) || !statOf(target)) return;
    try {
      const w = fs.watch(target, opts, (_event, name) => {
        if (accept(name ? String(name) : null)) soon();
      });
      w.on('error', () => {
        w.close();
        watchers.delete(key);
      });
      watchers.set(key, w);
    } catch (err) {
      console.error(`ledger: cannot watch ${tilde(target)} (${err.code || err.message}); the periodic rescan covers it`);
    }
  };
  const relevant = (name) => !name || /\.(status|meta|note)$/.test(name);
  // Plain watches on exactly the folders the sources read: Node's recursive watch on Linux
  // re-walks the whole tree on every change, and a busy state/ folder made that the main cost.
  function arm() {
    for (const home of cap.homes) {
      const state = path.join(home.path, 'state');
      for (const d of [state, path.join(state, 'inbox'), path.join(state, 'inbox', 'handled')]) watch(d, {}, relevant);
      watch(path.join(home.path, 'data'), {}, (n) => !n || n === 'backlog.md' || n === 'secondmates.md');
      for (const dir of sessionDirs(home)) watch(dir, {}, (n) => !n || n.endsWith('.jsonl'));
    }
    const expected = new Set(cap.homes.flatMap(sessionDirs).map((d) => path.basename(d)));
    if (cfg.transcripts) watch(cfg.claudeProjects, {}, (n) => !n || expected.has(n));
    watch(cfg.dataDir, {}, (n) => !n || n === 'ledger.jsonl');
  }

  const stop = () => {
    for (const w of watchers.values()) w.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  scan();
  beat(true);
  if (cfg.board.enabled) {
    startBoard(() => cap.homes || [], {
      onListen: (url) => {
        boardUrl = url;
        beat(true);
        console.log(`ledger board: ${url}`);
      },
      // The board is a view: when it cannot start, capture and the Now page carry on.
      onError: (err) => console.error(`ledger: the board is not served (${err.code === 'EADDRINUSE' ? `port ${cfg.board.port} is in use; set board.port in ${configFile}` : err.message})`),
    });
  }
  console.log(`ledger service ${process.pid}: ${cap.homes.length} home(s) (${cap.homes.map((h) => h.name).join(', ')}), ${watchers.size} watch(es), ledger ${tilde(FILES.ledger)}`);
  // The rescan catches events the kernel dropped; now and then every watch is renewed, in
  // case a watched folder was replaced underneath it.
  let ticks = 0;
  setInterval(() => {
    if (++ticks % 30 === 0) {
      for (const w of watchers.values()) w.close();
      watchers.clear();
    }
    scan();
    beat(true);
  }, cfg.rescanSeconds * 1000);
}

function cmdAdd() {
  const valueFlags = ['--kind', '--source', '--project', '--home', '--ref', '--task', '--config'];
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    if (valueFlags.includes(rest[i])) i++;
    else words.push(rest[i]);
  }
  let text = words.join(' ');
  if (text === '-') text = fs.readFileSync(0, 'utf8');
  text = text.trim();
  if (!text) die(2, 'nothing to add: give the text, or "-" to read it from stdin');
  const kind = option('--kind', 'message');
  if (!KINDS.includes(kind)) die(2, `--kind must be one of ${KINDS.join(', ')}`);
  ensureDataDir();
  const entry = {
    id: crypto.randomBytes(8).toString('hex'),
    time: new Date().toISOString(),
    source: option('--source', 'add'),
    home: option('--home', null),
    project: option('--project', null),
    ...(option('--task') ? { task: option('--task') } : {}),
    kind,
    text: redact(text, cfg.redact),
    ref: option('--ref', null),
    replaces: null,
  };
  appendEntries([entry]);
  console.log(entry.id);
}

/** `board`: one snapshot as JSON (--json), or the board on its own while no service serves it. */
async function cmdBoard() {
  if (flag('--json')) {
    const b = cfg.board;
    const text = b.agents ? await new Promise((resolve) => execFile(b.agents[0], b.agents.slice(1), { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? null : out))) : null;
    const board = buildBoard(discoverHomes(), text === null ? null : parseAgents(text), { ageDays: cfg.holdAgeDays });
    console.log(JSON.stringify(board, null, 2));
    return;
  }
  const hb = readJson(FILES.heartbeat, null);
  if (hb?.board && alive(hb.pid)) {
    console.log(`the ledger service (pid ${hb.pid}) serves the board: ${hb.board}`);
    return;
  }
  startBoard(discoverHomes, {
    onListen: (url) => console.log(`ledger board: ${url} (read only; Ctrl-C stops it)`),
    onError: (err) => die(2, err.code === 'EADDRINUSE' ? `port ${cfg.board.port} is in use; set board.port in ${configFile}` : err.message),
  });
}

function cmdTail() {
  const n = Number(option('-n', 20)) || 20;
  const kind = option('--kind');
  const entries = readRecent().filter((e) => !kind || e.kind === kind).slice(-n);
  for (const e of entries) {
    if (flag('--json')) console.log(JSON.stringify(e));
    else console.log(`${stamp(Date.parse(e.time))} [${e.kind} · ${e.source}${e.home ? ` · ${e.home}` : ''}${e.task ? ` · ${e.task}` : ''}] ${clip(e.text, 300)}`);
  }
}

function cmdNow() {
  if (flag('--rebuild') || !fs.existsSync(FILES.now)) {
    ensureDataDir();
    writeNow(discoverHomes(), readRecent());
  }
  process.stdout.write(readText(FILES.now) || '');
}

function cmdCheck() {
  const problems = [];
  const hb = readJson(FILES.heartbeat, null);
  const now = Date.now();
  if (!hb) problems.push(`the service has never run (no ${tilde(FILES.heartbeat)})`);
  else {
    const age = (now - Date.parse(hb.beat)) / 1000;
    if (!alive(hb.pid)) problems.push(`the service (pid ${hb.pid}) is not running`);
    else if (age > Math.max(60, (hb.rescanSeconds || 20) * 3)) problems.push(`the service's last heartbeat was ${Math.round(age)}s ago`);
    else if (cfg.board.enabled && !hb.board) problems.push('the board is turned on but not served (restart the service; its log says why)');
  }
  const page = statOf(FILES.now);
  const ledger = statOf(FILES.ledger);
  if (!page) problems.push(`${tilde(FILES.now)} does not exist`);
  else if (hb && ledger && ledger.size > (hb.ledgerBytes ?? 0) && now - ledger.mtimeMs > 5000) {
    problems.push(`the Now page has not taken in ledger entries written ${Math.round((now - ledger.mtimeMs) / 1000)}s ago`);
  }
  if (problems.length) {
    console.log(`FAILED ledger: ${problems.join('; ')}`);
    process.exit(1);
  }
  const lines = ledger ? readRecent(1024 * 1024).length : 0;
  console.log(
    `ok: ledger service pid ${hb.pid} watching ${hb.homes.length} home(s), heartbeat ${Math.round((now - Date.parse(hb.beat)) / 1000)}s ago; ` +
      `now.md rebuilt ${stamp(page.mtimeMs)}${ledger ? `, ledger ${Math.round(ledger.size / 1024)} KB (${lines} recent entries)` : ''}${hb.board ? `; board ${hb.board}` : ''}`,
  );
}

function help() {
  console.log(
    [
      'ledger - an append-only record of what you say and decide, with a live Now page',
      '',
      'usage: ledger serve | scan [--dry-run] | add [--kind K] [--source S] [--project P] [--home H] [--ref R] <text|-> |',
      '       tail [-n N] [--json] [--kind K] | now [--rebuild] | check | board [--json]     (all take --config F)',
    ].join('\n'),
  );
}

const COMMANDS = { serve: cmdServe, scan: cmdScan, add: cmdAdd, tail: cmdTail, now: cmdNow, check: cmdCheck, board: cmdBoard };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (command === 'help' || flag('--help') || flag('-h')) help();
  else if (!COMMANDS[command]) {
    help();
    process.exit(2);
  } else {
    setup();
    COMMANDS[command]();
  }
}
