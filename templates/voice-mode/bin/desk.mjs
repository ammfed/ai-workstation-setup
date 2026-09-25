// Desktop actions: a fixed catalog of safe things to do, a fast decision model that picks
// one of them from a partial transcript, and plain code that carries the pick out.
// The model only chooses: an id from the catalog, and for the few actions that take words
// (a note, a web search, text to type) which span of the user's own words they are. It
// never produces a command, a path or a URL. Nothing here deletes, moves, sends, buys,
// changes settings, closes apps or runs an arbitrary command.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
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

// PC control. On KDE Plasma each action is one of the desktop's own global shortcuts
// (component, shortcut name), invoked as if the key were pressed; elsewhere on Linux a
// standard command stands in where one exists. `final`: only once the sentence has ended.
export const SYSTEM = [
  { id: 'window-minimize', what: 'Minimize the window in front', done: 'minimized the window', kde: ['kwin', 'Window Minimize'] },
  { id: 'window-maximize', what: 'Maximize the window in front, or restore it', done: 'maximized the window', kde: ['kwin', 'Window Maximize'] },
  { id: 'window-next-screen', what: 'Move the window in front to the next screen or monitor', done: 'moved the window to the next screen', kde: ['kwin', 'Window to Next Screen'] },
  { id: 'window-next-desktop', what: 'Move the window in front to the next virtual desktop', done: 'moved the window to the next desktop', kde: ['kwin', 'Window to Next Desktop'] },
  { id: 'show-desktop', what: 'Show the desktop: hide all windows, or bring them back', done: 'showed the desktop', kde: ['kwin', 'Show Desktop'] },
  { id: 'overview', what: 'Show the overview of all open windows', done: 'showed the overview', kde: ['kwin', 'Overview'] },
  { id: 'volume-up', what: 'Turn the sound volume up', done: 'turned the volume up', kde: ['kmix', 'increase_volume'], linux: ['wpctl', 'set-volume', '-l', '1.5', '@DEFAULT_AUDIO_SINK@', '5%+'] },
  { id: 'volume-down', what: 'Turn the sound volume down', done: 'turned the volume down', kde: ['kmix', 'decrease_volume'], linux: ['wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', '5%-'] },
  { id: 'mute', what: 'Mute or unmute the sound', done: 'muted or unmuted the sound', kde: ['kmix', 'mute'], linux: ['wpctl', 'set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle'] },
  { id: 'media-play-pause', what: 'Play or pause the music or video that is playing', done: 'played or paused the media', kde: ['mediacontrol', 'playpausemedia'], linux: ['playerctl', 'play-pause'] },
  { id: 'media-next', what: 'Skip to the next track or video', done: 'skipped to the next track', kde: ['mediacontrol', 'nextmedia'], linux: ['playerctl', 'next'] },
  { id: 'media-previous', what: 'Go back to the previous track or video', done: 'went back a track', kde: ['mediacontrol', 'previousmedia'], linux: ['playerctl', 'previous'] },
  { id: 'brightness-up', what: 'Make the screen brighter', done: 'made the screen brighter', kde: ['org_kde_powerdevil', 'Increase Screen Brightness'], linux: ['brightnessctl', 'set', '+10%'] },
  { id: 'brightness-down', what: 'Make the screen dimmer', done: 'dimmed the screen', kde: ['org_kde_powerdevil', 'Decrease Screen Brightness'], linux: ['brightnessctl', 'set', '10%-'] },
  { id: 'screenshot', what: 'Take a screenshot of the whole screen', done: 'took a screenshot', kde: ['org_kde_spectacle_desktop', 'FullScreenScreenShot'] },
  { id: 'lock-screen', what: 'Lock the screen', done: 'locked the screen', kde: ['ksmserver', 'Lock Session'], linux: ['loginctl', 'lock-session'], final: true },
];

// The actions that take the user's words: which words is a second pick, once the sentence ends.
const TEXT = {
  note: { what: 'Write down a new note with text they dictate (take a note, note down, write down, remind me in a note)', slot: 'the text of the note' },
  search: { what: 'Search the web for something they say (search for, google, look up online)', slot: 'what to search the web for' },
  type: { what: 'Type text they dictate into the window in front (they say type)', slot: 'the text to type' },
};
export const TEXT_KINDS = new Set(Object.keys(TEXT));

export const isKde = (env = process.env) => /KDE/i.test(env.XDG_CURRENT_DESKTOP || '');

/** kglobalaccel components on this desktop, so actions whose component is missing are left out. */
function kdeComponents() {
  const r = spawnSync('gdbus', ['call', '--session', '--dest', 'org.kde.kglobalaccel', '--object-path', '/kglobalaccel', '--method', 'org.kde.KGlobalAccel.allComponents'], { encoding: 'utf8', timeout: 3000 });
  return new Set([...(r.stdout || '').matchAll(/\/component\/([A-Za-z0-9_]+)/g)].map((m) => m[1]));
}

/** The PC-control part of the catalog for this machine: [key, item] pairs. */
export function controlActions(config, { platform = process.platform, env = process.env, has = defaultHas, components } = {}) {
  const a = config.actions;
  const out = [];
  if (!a.control) return out;
  const kde = platform === 'linux' && isKde(env) && has('gdbus');
  const comps = kde ? components || kdeComponents() : new Set();
  for (const s of SYSTEM) {
    if (kde && comps.has(s.kde[0])) out.push([`system:${s.id}`, { kind: 'system', name: s.what, done: s.done, invoke: s.kde, final: !!s.final }]);
    else if (platform === 'linux' && s.linux && has(s.linux[0])) out.push([`system:${s.id}`, { kind: 'system', name: s.what, done: s.done, argv: s.linux, final: !!s.final }]);
  }
  out.push(['note:new', { kind: 'note', name: TEXT.note.what, folder: a.notes.folder || path.join(a.documents || os.homedir(), 'Notes') }]);
  if (a.searchUrl && /^https:\/\/[^\s]*\{q\}/.test(a.searchUrl)) out.push(['search:web', { kind: 'search', name: TEXT.search.what, url: a.searchUrl }]);
  if (platform === 'linux' && has('ydotool')) out.push(['type:text', { kind: 'type', name: TEXT.type.what, final: true }]);
  return out;
}

function defaultHas(bin) {
  return spawnSync('which', [bin], { stdio: 'ignore' }).status === 0;
}

/**
 * Every action the chooser may pick, keyed "kind:id". kinds: app, site, folder, file, record.
 * Built once at start from the config, installed apps, the documents folder and the records.
 */
export function buildCatalog(config, records, opts = {}) {
  const { apps } = opts;
  const a = config.actions;
  const items = new Map();
  const add = (kind, id, name, extra) => items.set(`${kind}:${slug(id) || id}`, { kind, name, ...extra });
  const appList = apps || [...(a.apps || []), ...(a.discoverApps && process.platform === 'linux' ? discoverApps() : [])];
  for (const app of appList) if (!items.has(`app:${slug(app.id)}`)) add('app', app.id, app.name, { desktop: app.desktop, mac: app.mac, command: app.command });
  for (const s of a.sites || []) if (/^https?:\/\//.test(s.url)) add('site', s.id || s.name, s.name, { url: s.url });
  for (const f of documentFolders(a.documents)) add('folder', f.id === '.' ? 'documents' : f.id, f.name, { path: f.path });
  for (const f of a.files || []) add('file', f.id || f.name, f.name, { path: f.path });
  for (const r of records ? records.showable() : []) add('record', r.id, `the ${r.name} record`, { path: r.path });
  const control = controlActions(config, opts);
  // Switching to an app's open window needs the desktop's window manager (KWin on Plasma).
  if (control.length && (opts.platform || process.platform) === 'linux' && isKde(opts.env) && (opts.has || defaultHas)('gdbus')) {
    for (const [key, it] of [...items]) if (it.kind === 'app' && it.desktop) items.set(`focus:${key.slice(4)}`, { kind: 'focus', name: it.name, desktop: it.desktop });
  }
  for (const [key, it] of control) items.set(key, it);
  return items;
}

const VERB = { app: 'Open', site: 'Open the website', folder: 'Open', file: 'Open the file', record: 'Show on screen', focus: 'Switch to the already open window of' };

export function criteria(catalog) {
  const out = {
    none:
      'Anything else: a question (including a question about what a record says), small talk, asking about status or news, ' +
      'asking for work to be done, or something the helper must not do: deleting or moving files, sending a message or email, ' +
      'buying something, changing settings, running a command, closing or quitting an app. Also this when it is not yet clear what should be done.',
  };
  for (const [key, it] of catalog) out[key] = VERB[it.kind] ? `${VERB[it.kind]} ${it.name}` : it.name;
  return out;
}

/** Candidate spans of the user's words for a text action: every tail, less up to two last words. */
export function spans(text, max = 40) {
  const w = String(text).trim().split(/\s+/).filter(Boolean);
  const out = { none: 'None of these: nothing to write, search for or type was said yet' };
  let n = 0;
  for (let i = 1; i < w.length && n < max; i++) {
    for (let cut = 0; cut <= 2 && w.length - cut > i && n < max; cut++, n++) out[`s${i}-${w.length - cut}`] = `"${w.slice(i, w.length - cut).join(' ')}"`;
  }
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
    this.textAction = null;
  }

  /** Open the connection before the first words arrive, so that call skips the TLS handshake. */
  warm() {
    if (this.ready) this.fetch(new URL(this.cfg.url).origin, { method: 'HEAD' }).catch(() => {});
  }

  /** Feed the transcript so far; final marks the end of the user's turn. */
  hear(text, final = false) {
    const clean = String(text || '').trim();
    // A note, search or typing was picked: its words are picked once the sentence has ended.
    if (this.textAction && final && clean && !this.textAction.filling) {
      this.fill(clean);
      return;
    }
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
      const item = this.catalog.get(answer.choice);
      if (answer.choice !== 'none' && item && p >= (final ? this.cfg.finalThreshold : this.cfg.threshold) && (final || !item.final || TEXT_KINDS.has(item.kind))) {
        this.done = true;
        this.pending = null;
        this.picked?.(answer.choice);
        if (TEXT_KINDS.has(item.kind)) {
          this.textAction = { key: answer.choice, p };
          if (final) this.fill(text);
          return;
        }
        await this.execute(answer.choice, { text, p, final });
        return;
      }
    }
    const next = this.pending;
    this.pending = null;
    if (next) this.ask(next.text, next.final);
  }

  /** The second pick for a note, search or typing: which span of the words is the text. */
  async fill(text) {
    const turn = this.turnId;
    const { key, p } = this.textAction;
    this.textAction.filling = true;
    const kind = this.catalog.get(key).kind;
    const options = spans(text);
    const started = performance.now();
    let answer = null;
    for (let tries = 2; tries > 0 && !answer; tries--) {
      try {
        answer = await this.decide(text, {
          instructions: `The person gave a spoken command to their computer. Which quoted part of their words is ${TEXT[kind].slot}, exactly as they said it, without the command words around it or trailing politeness like please or thanks?`,
          criteria: options,
        });
      } catch (err) {
        this.log({ event: 'chooser-error', final: true, error: String(err.message || err).slice(0, 200), cause: err.cause?.code, ms: Math.round(performance.now() - started), text });
      }
    }
    this.textAction.done = true;
    if (turn !== this.turnId || !answer) return;
    const slot = answer.choice !== 'none' ? options[answer.choice]?.slice(1, -1) : '';
    this.log({ event: 'chooser', words: text.split(/\s+/).length, final: true, choice: slot ? `${key} (${slot.split(/\s+/).length} words)` : `${key}: no text`, p: answer.probabilities?.[answer.choice] ?? 0, ms: Math.round(performance.now() - started), text: slot || text });
    if (slot) await this.execute(key, { text, p, final: true, slot });
  }

  async decide(text, question) {
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
            target: question
              ? { type: 'choice', ...question }
              : {
                  type: 'choice',
                  instructions:
                    'A person is speaking to their desktop voice assistant and may not have finished the sentence. ' +
                    'From what they have said so far, which one thing do they explicitly want done on their computer right now? ' +
                    'Opening an app starts it; switching to an app brings its open window to the front. ' +
                    'A question about something is not a request to do it.',
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

function launch(argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', env: env ? { ...process.env, ...env } : undefined });
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

const kdeShortcut = ([component, name]) => ['gdbus', 'call', '--session', '--dest', 'org.kde.kglobalaccel', '--object-path', `/component/${component}`, '--method', 'org.kde.kglobalaccel.Component.invokeShortcut', name];

const capture = (argv) =>
  new Promise((resolve, reject) => execFile(argv[0], argv.slice(1), { timeout: 3000 }, (err, out) => (err ? reject(err) : resolve(String(out)))));

/** The KWin script that brings an app's most recent window to the front; the target is from the catalog. */
export function focusScript(desktop) {
  const id = JSON.stringify(desktop.replace(/\.desktop$/, ''));
  return `const want = ${id};
const cls = (w) => String(w.resourceClass).toLowerCase();
const ws = workspace.windowList().filter((w) => w.normalWindow && (w.desktopFileName === want || cls(w) === want.toLowerCase() || cls(w) === want.toLowerCase().split(".").pop()));
if (ws.length) {
  const w = ws[ws.length - 1];
  w.minimized = false;
  workspace.activeWindow = w;
}
`;
}

let scripts = 0;
/** Load a script into KWin (Plasma's window manager) over D-Bus, run it, then unload it. */
async function kwinRun(js, { exec = capture } = {}) {
  const name = `voice-mode-${process.pid}-${++scripts}`;
  const file = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `${name}.js`);
  fs.writeFileSync(file, js, { mode: 0o600 });
  const call = (obj, method, ...args) => exec(['gdbus', 'call', '--session', '--dest', 'org.kde.KWin', '--object-path', obj, '--method', method, ...args]);
  try {
    const id = /(\d+)/.exec(await call('/Scripting', 'org.kde.kwin.Scripting.loadScript', file, name))?.[1];
    if (id === undefined) throw new Error('KWin did not load the script');
    await call(`/Scripting/Script${id}`, 'org.kde.kwin.Script.run');
  } finally {
    setTimeout(() => {
      call('/Scripting', 'org.kde.kwin.Scripting.unloadScript', name).catch(() => {});
      fs.rmSync(file, { force: true });
    }, 1000);
  }
}

/** A new note file: the date and first words as its name, never over an existing file. */
export function writeNote(folder, text, now = new Date()) {
  fs.mkdirSync(folder, { recursive: true });
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const title = text.split(/\s+/).slice(0, 6).join(' ').replace(/[^\p{L}\p{N} '-]/gu, '').trim() || 'note';
  for (let i = 1; ; i++) {
    const file = path.join(folder, `${stamp} ${title}${i > 1 ? ` ${i}` : ''}.md`);
    try {
      fs.writeFileSync(file, `${text.trim()}\n`, { flag: 'wx' });
      return file;
    } catch (err) {
      if (err.code !== 'EEXIST' || i > 50) throw err;
    }
  }
}

/** Typing sends keys: no Enter, tab or other control keys, only the dictated characters. */
export const typeable = (text) => String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/  +/g, ' ').trim();

/**
 * Carry out one catalog action. Everything it opens comes from the catalog entry, and
 * files and folders must still sit inside the documents folder or a record source. The
 * only words it takes are a note's text, a search's words and text to type (`slot`).
 */
export async function perform(item, { roots = [], platform = process.platform, run = launch, has = () => true, slot = '', exec = capture, note = writeNote } = {}) {
  if (!item) throw new Error('not in the catalog');
  switch (item.kind) {
    case 'system':
      return run(item.invoke ? kdeShortcut(item.invoke) : item.argv);
    case 'focus':
      return kwinRun(focusScript(item.desktop), { exec });
    case 'note': {
      if (!slot.trim()) throw new Error('no text for the note');
      const file = note(item.folder, slot);
      return run(opener(file, platform));
    }
    case 'search': {
      if (!slot.trim()) throw new Error('nothing to search for');
      const url = item.url.replace('{q}', encodeURIComponent(slot.trim().replace(/[.!?]+$/, '')));
      if (!/^https:\/\//.test(url)) throw new Error('only https search links are opened');
      return run(opener(url, platform));
    }
    case 'type': {
      const text = typeable(slot);
      if (!text) throw new Error('nothing to type');
      const sock = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', '.ydotool_socket');
      return run(['ydotool', 'type', '--key-delay', '8', '--', text], fs.existsSync(sock) ? { YDOTOOL_SOCKET: sock } : undefined);
    }
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

export function describe(item, slot = '', { words = true } = {}) {
  // Without the words (logs, unless transcripts are on): how many there were.
  const short = !words ? `${slot.split(/\s+/).filter(Boolean).length} words` : slot.length > 40 ? `${slot.slice(0, 38)}...` : slot;
  const q = words ? `"${short}"` : `(${short})`;
  switch (item.kind) {
    case 'record':
      return `showed ${item.name}`;
    case 'system':
      return item.done;
    case 'focus':
      return `switched to ${item.name.replace(/ \(.*\)$/, '')}`;
    case 'note':
      return `wrote a note ${q}`;
    case 'search':
      return `searched the web for ${q}`;
    case 'type':
      return `typed ${q}`;
    default:
      return `opened ${item.name}`;
  }
}
