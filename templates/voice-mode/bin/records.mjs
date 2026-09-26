// What the voice agent may read, and how it hands real work over.
// Every source is read-only: this file opens files for reading and runs configured read
// commands, nothing else. The one write-shaped action, queueing work, runs the single
// command the config names and never touches a record itself.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const TEXT = new Set(['.md', '.txt', '.json', '.jsonl', '.log', '.status', '.yaml', '.yml', '.csv', '.toml', '']);
// Never read, even inside a source: anything that may hold a key.
const SECRET = /(^|[._-])(env|secrets?|tokens?|credentials?|keys?)([._-]|$)|\.(pem|key|p12)$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash', '.cache', 'venv', '.venv', '__pycache__']);
const MAX_FILE = 512 * 1024;
const MAX_FILES = 4000;
const READ_CAP = 12000;

const isText = (file) => TEXT.has(path.extname(file).toLowerCase()) && !path.basename(file).startsWith('.') && !SECRET.test(path.basename(file));

/** Resolve `p` and prove it sits inside one of `roots` (symlinks followed). */
export function inside(p, roots) {
  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    return null;
  }
  for (const root of roots) {
    let r;
    try {
      r = fs.realpathSync(root);
    } catch {
      continue;
    }
    if (real === r || real.startsWith(r + path.sep)) return real;
  }
  return null;
}

/** Text files under a file or folder, newest first, bounded by depth and count. */
export function walk(root, { depth = 4, limit = MAX_FILES } = {}) {
  const out = [];
  let st;
  try {
    st = fs.statSync(root);
  } catch {
    return out;
  }
  if (st.isFile()) return isText(root) ? [{ file: root, mtime: st.mtimeMs, size: st.size }] : out;
  const queue = [[root, 0]];
  while (queue.length && out.length < limit) {
    const [dir, d] = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (d < depth && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) queue.push([full, d + 1]);
      } else if (e.isFile() && isText(full)) {
        try {
          const s = fs.statSync(full);
          if (s.size <= MAX_FILE) out.push({ file: full, mtime: s.mtimeMs, size: s.size });
        } catch {}
      }
      if (out.length >= limit) break;
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function runRead(argv, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      resolve(`(could not run ${argv[0]}: ${err.message})`);
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (b) => {
      if (out.length < READ_CAP) out += b;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(`(could not run ${argv[0]}: ${err.message})`);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.slice(0, READ_CAP));
    });
  });
}

export class Records {
  constructor(config) {
    this.sources = config.sources || [];
    this.queueCfg = config.queue || {};
    this.roots = this.sources.filter((s) => s.path).map((s) => s.path);
    // File text by path, reused while the file's mtime is unchanged, so a search is a
    // walk of stats and in-memory matching rather than a read of every file.
    this.cache = new Map();
  }

  text(f) {
    const hit = this.cache.get(f.file);
    if (hit && hit.mtime === f.mtime) return hit;
    let text;
    try {
      text = fs.readFileSync(f.file, 'utf8');
    } catch {
      return null;
    }
    const entry = text.slice(0, 2000).includes('\0') ? { mtime: f.mtime, text: '', lower: '' } : { mtime: f.mtime, text, lower: text.toLowerCase() };
    this.cache.set(f.file, entry);
    return entry;
  }

  /** Read every source once, so the first spoken question does not pay for it. */
  warm() {
    const t = performance.now();
    let files = 0;
    for (const s of this.sources) if (s.path) for (const f of walk(s.path)) files += this.text(f) ? 1 : 0;
    return { files, ms: Math.round(performance.now() - t) };
  }

  /** A short index of the sources for the voice model's instructions. */
  describe() {
    return this.sources.map((s) => `- ${s.name}${s.about ? `: ${s.about}` : ''}`).join('\n');
  }

  /** Short names of records that can be shown on screen, for the action chooser. */
  showable() {
    const out = [];
    for (const s of this.sources) {
      if (!s.path || s.show === false) continue;
      let st;
      try {
        st = fs.statSync(s.path);
      } catch {
        continue;
      }
      if (st.isFile()) out.push({ id: s.name, name: s.about ? `${s.name} (${s.about})` : s.name, path: s.path });
      else if (s.show)
        for (const f of walk(s.path, { depth: 0, limit: 40 })) {
          if (path.extname(f.file) === '.md') out.push({ id: `${s.name}/${path.basename(f.file, '.md')}`, name: `${path.basename(f.file, '.md')} in ${s.name}`, path: f.file });
        }
    }
    return out;
  }

  label(file) {
    for (const s of this.sources) {
      if (!s.path) continue;
      if (file === s.path) return s.name;
      if (file.startsWith(s.path + path.sep)) return `${s.name}/${path.relative(s.path, file)}`;
    }
    return file;
  }

  /** Resolve "source/relative/path" or a source name to a readable file inside the roots. */
  resolve(name) {
    const clean = String(name || '').trim();
    for (const s of [...this.sources].sort((a, b) => b.name.length - a.name.length)) {
      if (!s.path) continue;
      if (clean === s.name) return inside(s.path, this.roots);
      if (clean.startsWith(`${s.name}/`)) return inside(path.join(s.path, clean.slice(s.name.length + 1)), this.roots);
    }
    return path.isAbsolute(clean) ? inside(clean, this.roots) : null;
  }

  /** Sources called `name`, or named after it ("second mate" covers "second mate web"); all without a name. */
  pick(name) {
    const want = String(name || '').trim().toLowerCase();
    return this.sources.filter((s) => !want || s.name.toLowerCase() === want || s.name.toLowerCase().startsWith(`${want} `));
  }

  async search(query, { limit = 8, source = '' } = {}) {
    const words = String(query || '').toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((w) => w.length > 2);
    if (!words.length) return { results: [], note: 'give a few keywords' };
    const sources = this.pick(source);
    if (!sources.length) return { results: [], note: `no source called "${source}"; the sources are: ${this.sources.map((s) => s.name).join(', ')}` };
    const hits = [];
    const candidates = [];
    const deadline = Date.now() + 4000;
    // Command sources run while the files are searched.
    const regex = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const commands = sources
      .filter((s) => s.command)
      .map(async (s) => {
        const text = (await runRead(s.command.map((a) => a.replace('{query}', () => words.join(' ')).replace('{regex}', () => regex)))).trim();
        if (text) hits.push({ score: words.length, source: s.name, text: text.slice(0, 1500) });
      });
    for (const s of sources) {
      if (!s.path) continue;
      for (const f of walk(s.path)) {
        if (Date.now() > deadline) break;
        const entry = this.text(f);
        if (!entry || !entry.text) continue;
        const { lower } = entry;
        const nameHit = words.filter((w) => f.file.toLowerCase().includes(w)).length;
        const bodyHit = words.filter((w) => lower.includes(w)).length;
        // Newer files win ties: a status question is about now.
        if (nameHit || bodyHit) candidates.push({ f, entry, score: nameHit * 2 + bodyHit * 2 + f.mtime / 1e13 });
      }
    }
    // Only the best candidates are cut into lines for a snippet.
    candidates.sort((a, b) => b.score - a.score);
    for (const { f, entry, score } of candidates.slice(0, limit * 3)) {
      const lines = entry.text.split('\n');
      let best = -1;
      let bestScore = 0;
      entry.lower.split('\n').forEach((l, i) => {
        const sc = words.filter((w) => l.includes(w)).length;
        if (sc > bestScore) [best, bestScore] = [i, sc];
      });
      const snippet = best >= 0 ? lines.slice(Math.max(0, best - 1), best + 3).join('\n') : lines.slice(0, 3).join('\n');
      hits.push({ score: score + bestScore, source: this.label(f.file), text: snippet.slice(0, 600) });
    }
    await Promise.all(commands);
    hits.sort((a, b) => b.score - a.score);
    return { results: hits.slice(0, limit).map(({ source, text }) => ({ record: source, text })) };
  }

  read(name, { tail = false } = {}) {
    const file = this.resolve(name);
    if (!file) return { error: `no readable record called "${name}"; use list_records or search_records for names` };
    const st = fs.statSync(file);
    if (st.isDirectory()) return this.list(name);
    if (!isText(file)) return { error: `${name} is not a text record` };
    const text = fs.readFileSync(file, 'utf8');
    const cut = text.length > READ_CAP;
    return { record: this.label(file), text: cut ? (tail ? text.slice(-READ_CAP) : text.slice(0, READ_CAP)) : text, truncated: cut };
  }

  list(name) {
    const src = name ? this.resolve(name) : null;
    if (name && !src) return { error: `no record folder called "${name}"` };
    const roots = src ? [src] : this.roots;
    const files = roots.flatMap((r) => walk(r, { depth: 2, limit: 200 })).sort((a, b) => b.mtime - a.mtime).slice(0, 40);
    return {
      sources: name ? undefined : this.sources.map((s) => s.name),
      recent: files.map((f) => ({ record: this.label(f.file), modified: new Date(f.mtime).toISOString().slice(0, 16) })),
    };
  }

  /** Hand work over through the configured command; the text is one argument, never a shell string. */
  queue(text) {
    const argv = this.queueCfg.command || [];
    const body = String(text || '').trim();
    if (!argv.length) return Promise.resolve({ queued: false, error: 'no queue command is configured' });
    if (!body) return Promise.resolve({ queued: false, error: 'nothing to queue' });
    return new Promise((resolve) => {
      let err = '';
      const child = spawn(argv[0], [...argv.slice(1), body], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...(this.queueCfg.env || {}) } });
      child.stderr.on('data', (b) => (err += b));
      child.on('error', (e) => resolve({ queued: false, error: e.message }));
      child.on('close', (code) => resolve(code === 0 ? { queued: true } : { queued: false, error: err.trim().slice(0, 300) || `exit ${code}` }));
    });
  }
}

/** Tool declarations in one neutral shape; each provider adapter converts them. */
export const TOOLS = [
  {
    name: 'search_records',
    description:
      'Search your own records, notes, memories, documents and notes vault for keywords; returns matching lines and the name of each record. ' +
      'Use it first for any question about work, projects, people, plans, decisions, notes or files, before saying you do not know or handing anything off.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'a few keywords' },
        source: { type: 'string', description: 'optional: search only this source (a name from the record sources), such as the notes vault when the user names it' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_record',
    description: 'Read one record in full by the name search_records or list_records gave. Set tail for logs, to get the newest lines.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, tail: { type: 'boolean' } }, required: ['name'] },
  },
  {
    name: 'list_records',
    description: 'List the record sources, or the most recently changed records in one source, newest first: for "what is new", "what did I write lately" or "the latest notes".',
    parameters: { type: 'object', properties: { source: { type: 'string', description: 'optional source name' } } },
  },
];

export async function runTool(records, name, args = {}) {
  switch (name) {
    case 'search_records':
      return records.search(args.query, { source: args.source });
    case 'read_record':
      return records.read(args.name, { tail: !!args.tail });
    case 'list_records':
      return records.list(args.source);
    default:
      return { error: `unknown tool ${name}` };
  }
}
