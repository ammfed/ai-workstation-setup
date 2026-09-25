// Desktop actions: a fixed catalog of safe things to open, a fast decision model that picks
// one of them from a partial transcript, and plain code that carries the pick out.
// The model only chooses an id from the catalog; it never produces a command, a path or a URL.
// Nothing here closes, deletes, types or runs anything except opening what the catalog lists.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readKey } from './config.mjs';
import { inside } from './records.mjs';

// Launchers and scripts are never opened as files, whatever the catalog says.
const NEVER_OPEN = /\.(desktop|sh|bash|zsh|fish|py|pl|rb|js|mjs|cjs|exe|bat|cmd|ps1|com|msi|appimage|run|bin|jar|deb|rpm|app|command|scpt|applescript|lnk|url)$/i;

// ------------------------------------------------------------------ catalog

function xdgAppDirs() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  return [dataHome, ...dataDirs, '/var/lib/flatpak/exports/share', path.join(dataHome, 'flatpak', 'exports', 'share'), '/var/lib/snapd/desktop']
    .map((d) => path.join(d, 'applications'));
}

function parseDesktop(text) {
  const out = {};
  let inEntry = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('[')) inEntry = line.trim() === '[Desktop Entry]';
    else if (inEntry) {
      const m = /^([A-Za-z-]+)=(.*)$/.exec(line);
      if (m && !(m[1] in out)) out[m[1]] = m[2].trim();
    }
  }
  return out;
}

/** Installed desktop applications a person would ask for by name (Linux). */
export function discoverApps() {
  const seen = new Map();
  for (const dir of xdgAppDirs()) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith('.desktop') || seen.has(f)) continue;
      let d;
      try {
        d = parseDesktop(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        continue;
      }
      seen.set(f, null);
      if (d.Type !== 'Application' || d.NoDisplay === 'true' || d.Hidden === 'true' || !d.Name) continue;
      if (/(^|;)(Settings|X-KDE-settings[^;]*|ConsoleOnly)(;|$)/.test(d.Categories || '') || f.startsWith('kcm_')) continue;
      const what = d.GenericName || d.Comment || '';
      seen.set(f, { id: f.replace(/\.desktop$/, ''), name: what && what !== d.Name ? `${d.Name} (${what})` : d.Name, desktop: f });
    }
  }
  return [...seen.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

function documentFolders(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  out.push({ id: '.', name: `the ${path.basename(root)} folder itself`, path: root });
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.')) out.push({ id: e.name, name: `the ${e.name} folder in ${path.basename(root)}`, path: path.join(root, e.name) });
  }
  return out;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Every action the chooser may pick, keyed "kind:id". kinds: app, site, folder, file, record.
 * Built once at start from the config, installed apps, the documents folder and the records.
 */
export function buildCatalog(config, records, { apps } = {}) {
  const a = config.actions;
  const items = new Map();
  const add = (kind, id, name, extra) => items.set(`${kind}:${slug(id) || id}`, { kind, name, ...extra });
  const appList = apps || [...(a.apps || []), ...(a.discoverApps && process.platform === 'linux' ? discoverApps() : [])];
  for (const app of appList) if (!items.has(`app:${slug(app.id)}`)) add('app', app.id, app.name, { desktop: app.desktop, mac: app.mac, command: app.command });
  for (const s of a.sites || []) if (/^https?:\/\//.test(s.url)) add('site', s.id || s.name, s.name, { url: s.url });
  for (const f of documentFolders(a.documents)) add('folder', f.id === '.' ? 'documents' : f.id, f.name, { path: f.path });
  for (const f of a.files || []) add('file', f.id || f.name, f.name, { path: f.path });
  for (const r of records ? records.showable() : []) add('record', r.id, `the ${r.name} record`, { path: r.path });
  return items;
}

const VERB = { app: 'Open', site: 'Open the website', folder: 'Open', file: 'Open the file', record: 'Show on screen' };

export function criteria(catalog) {
  const out = {
    none:
      'Anything else: a question (including a question about what a record says), small talk, asking about status or news, ' +
      'or asking for work to be done. Also this when it is not yet clear what should be opened.',
  };
  for (const [key, it] of catalog) out[key] = `${VERB[it.kind]} ${it.name}`;
  return out;
}

// ------------------------------------------------------------------ chooser

/**
 * Picks at most one action per user turn from a growing transcript. Calls the decision
 * model on each new partial (a few calls in flight at once), acts when the top
 * choice clears the threshold, or the lower final threshold once the turn's text is final.
 */
export class Chooser {
  constructor(config, catalog, { execute, log = () => {}, fetchImpl = fetch } = {}) {
    this.cfg = config.actions.chooser;
    this.key = readKey(this.cfg.keyFile, this.cfg.keyName) || process.env[this.cfg.keyName] || '';
    this.catalog = catalog;
    this.criteria = criteria(catalog);
    this.execute = execute;
    this.log = log;
    this.fetch = fetchImpl;
    this.reset();
  }

  get ready() {
    return !!this.key && this.catalog.size > 0;
  }

  reset(t0 = null) {
    this.turnId = (this.turnId || 0) + 1;
    this.t0 = t0;
    this.done = false;
    this.inflight = 0;
    this.pending = null;
    this.lastText = '';
    this.calls = 0;
  }

  /** Open the connection before the first words arrive, so that call skips the TLS handshake. */
  warm() {
    if (this.ready) this.fetch(new URL(this.cfg.url).origin, { method: 'HEAD' }).catch(() => {});
  }

  /** Feed the transcript so far; final marks the end of the user's turn. */
  hear(text, final = false) {
    const clean = String(text || '').trim();
    if (!this.ready || this.done || !clean) return;
    // The same words again (a repeated partial, or only punctuation or case changed) add
    // nothing to decide on: one call per new word, not per transcript event.
    const words = clean.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, '').replace(/\s+/g, ' ').trim();
    if (words === this.lastText && !final) return;
    this.lastText = words;
    // Up to `parallel` calls in flight, so a new word never waits behind an older call;
    // beyond that, only the newest text waits.
    if (this.inflight >= (this.cfg.parallel || 3)) {
      this.pending = { text: clean, final };
      return;
    }
    this.ask(clean, final);
  }

  async ask(text, final) {
    const turn = this.turnId;
    this.inflight++;
    this.calls++;
    const started = performance.now();
    let answer = null;
    // The final sentence is the last chance this turn, so a failed call on it is tried twice.
    for (let tries = final ? 2 : 1; tries > 0 && !answer; tries--) {
      try {
        answer = await this.decide(text);
      } catch (err) {
        // fetch() says only "fetch failed"; the reason (a connect timeout, a reset) is its cause.
        const c = err.cause;
        const cause = c ? [c.code || c.name, ...(c.errors || []).map((e) => e.code)].filter(Boolean).join(' ') : undefined;
        this.log({ event: 'chooser-error', final, error: String(err.message || err).slice(0, 200), cause, ms: Math.round(performance.now() - started), text });
      }
    }
    if (turn !== this.turnId) return;
    this.inflight--;
    if (this.done) return;
    if (answer) {
      const p = answer.probabilities?.[answer.choice] ?? 0;
      this.log({ event: 'chooser', words: text.split(/\s+/).length, final, choice: answer.choice, p, ms: Math.round(performance.now() - started), text });
      if (answer.choice !== 'none' && this.catalog.has(answer.choice) && p >= (final ? this.cfg.finalThreshold : this.cfg.threshold)) {
        this.done = true;
        this.pending = null;
        await this.execute(answer.choice, { text, p, final });
        return;
      }
    }
    const next = this.pending;
    this.pending = null;
    if (next) this.ask(next.text, next.final);
  }

  async decide(text) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetch(this.cfg.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.cfg.model,
          state: { heard_so_far: text },
          questions: {
            target: {
              type: 'choice',
              instructions:
                'A person is speaking to their desktop voice assistant and may not have finished the sentence. ' +
                'From what they have said so far, which one thing do they explicitly want opened, launched or shown on screen right now? ' +
                'A question about something is not a request to open it.',
              criteria: this.criteria,
            },
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
      return body.answers?.target || null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ------------------------------------------------------------------ executor

function launch(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function opener(target, platform) {
  if (platform === 'darwin') return ['open', target];
  if (platform === 'win32') return ['explorer.exe', target];
  return ['xdg-open', target];
}

/**
 * Carry out one catalog action. Everything it opens comes from the catalog entry, and
 * files and folders must still sit inside the documents folder or a record source.
 */
export async function perform(item, { roots = [], platform = process.platform, run = launch, has = () => true } = {}) {
  if (!item) throw new Error('not in the catalog');
  switch (item.kind) {
    case 'app':
      if (item.command) return run(item.command);
      if (platform === 'darwin') return run(['open', '-a', item.mac || item.name.replace(/ \(.*\)$/, '')]);
      if (platform === 'linux' && item.desktop) return run(has('kstart') ? ['kstart', '--application', item.desktop] : ['gtk-launch', item.desktop]);
      throw new Error(`no way to start ${item.name} here`);
    case 'site':
      if (!/^https?:\/\//.test(item.url)) throw new Error('only http and https links are opened');
      return run(opener(item.url, platform));
    case 'folder':
    case 'file':
    case 'record': {
      const real = inside(item.path, roots);
      if (!real) throw new Error(`${item.path} is outside the allowed folders`);
      const st = fs.statSync(real);
      if (item.kind === 'folder' ? !st.isDirectory() : !st.isFile()) throw new Error(`${real} is not a ${item.kind === 'folder' ? 'folder' : 'file'}`);
      if (st.isFile() && (NEVER_OPEN.test(real) || (platform !== 'win32' && st.mode & 0o111))) throw new Error(`${path.basename(real)} is a program, not a document`);
      return run(opener(real, platform));
    }
    default:
      throw new Error(`unknown action kind ${item.kind}`);
  }
}

export function describe(item) {
  return item.kind === 'record' ? `showed ${item.name}` : `opened ${item.name}`;
}
