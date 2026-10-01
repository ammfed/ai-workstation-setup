// Configuration for voice mode: one JSON file, plus env files that hold keys.
// Keys are read at run time from the env files the config names and are never copied,
// logged or written anywhere else.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'ai-workstation-setup', 'voice');

export const DEFAULTS = {
  // The one line that switches the realtime voice provider: openai | gemini | fake.
  provider: 'openai',
  keysFile: path.join(CONFIG_DIR, '.env'),
  providers: {
    // ttsModel: plain text to speech for `voice-mode say` outside a conversation, same voice.
    openai: { model: 'gpt-realtime', voice: 'marin', transcribeModel: 'gpt-live-transcribe', silenceMs: 500, ttsModel: 'gpt-4o-mini-tts' },
    gemini: { model: 'gemini-3.8-live', voice: 'Puck', silenceMs: 500, ttsModel: 'gemini-3.8-flash-lite-tts' },
    fake: { replyDelayMs: 300 },
  },
  persona:
    'You are a voice assistant. Be brief, plain and friendly: one to three short spoken sentences, ' +
    'no lists, no markdown. Answer from the records your tools return and say so when they do not say.',
  personaFile: '',
  // A conversation ends by itself after exitAfterMin without speech.
  listen: { exitAfterMin: 10 },
  // duplex: full (talk over a reply to cut in; needs echoCancel, or a headset with echoCancel
  // false) or half (the mic is muted while a reply plays). Full falls back to half when echo
  // cancellation cannot load.
  audio: { duplex: 'full', echoCancel: true, input: '', output: '', earcons: true },
  // The floating orb shown while a conversation runs (Linux desktops with Qt 6 QML).
  // corner: bottom-right | bottom-left | top-right | top-left; margin in pixels from it.
  orb: {
    enabled: true,
    size: 150,
    corner: 'bottom-right',
    margin: 40,
    colors: { idle: '#7c8aa5', listening: '#38bdf8', thinking: '#fbbf24', speaking: '#c084fc', action: '#34d399' },
    runner: '',
  },
  actions: {
    enabled: true,
    chooser: {
      url: 'https://openrouter.ai/api/alpha/decisions',
      model: 'typesafe/jev-1.13',
      keyName: 'OPENROUTER_API_KEY',
      keyFile: '',
      threshold: 0.9,
      finalThreshold: 0.7,
      // A browser button that sends or changes something is only asked about when picked.
      askThreshold: 0.5,
      timeoutMs: 3000,
    },
    // One line per decision in logs/decisions.log (what was chosen, how sure, how fast;
    // the words heard only with logTranscripts).
    decisionLog: true,
    // PC control: window, media, volume, brightness, screenshot, lock, switching to an open
    // app (KDE Plasma), notes, web search and typing dictated text (with ydotool).
    control: true,
    // Where notes go (default: a Notes folder in the documents folder); opened with the default app.
    notes: { folder: '' },
    searchUrl: 'https://duckduckgo.com/?q={q}',
    // Log what an action would run instead of running it.
    dryRun: false,
    apps: [],
    discoverApps: true,
    sites: [
      { id: 'github', name: 'GitHub', url: 'https://github.com' },
      { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com' },
      { id: 'calendar', name: 'Google Calendar', url: 'https://calendar.google.com' },
      { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' },
    ],
    documents: path.join(os.homedir(), 'Documents'),
    files: [],
  },
  // Browser control (browser.mjs): the current page of a Chrome started for the assistant
  // with its own profile and --remote-debugging-port. endpoint must be a loopback address;
  // tabs whose URL starts with an ignore entry are never read, switched to or closed.
  // maxItems: links, buttons and fields offered per page; confirmSec: how long a button
  // that sends or changes something waits for a spoken yes. With it on, listed sites and
  // web searches open in that window.
  browser: { enabled: false, endpoint: 'http://127.0.0.1:9222', ignore: [], maxItems: 60, confirmSec: 30, timeoutMs: 3000 },
  // Read-only sources: { name, path, about?, show? } or { name, command: [..., '{query}'], about?, timeoutSec? }.
  sources: [],
  // Name patterns (`*` and `?`, any case) for files and folders that are never listed, read,
  // offered to the decision model or opened, in the documents folder and every source. Yours
  // alone: they live in this local file only.
  exclude: [],
  // The lookout (lookout.mjs): while a conversation runs, speak up when something new waits on
  // you or a worker stopped or failed, read from the ledger's live board (url, else command).
  // everySec: how often the board is read; batchSec: events this close together are one line;
  // gapSec: at most one line this often.
  lookout: { enabled: false, url: 'http://127.0.0.1:4391/api/board', command: ['ledger', 'board', '--json'], everySec: 5, batchSec: 30, gapSec: 120, stateFile: '' },
  // Questions about the notes vault go to agy (notes.mjs), which reads the vault and answers in
  // a few sentences; the voice never reads the vault itself. vault: the vault folder (a git
  // repository, so a run that changed a file can be caught); rawDir: raw material agy is told
  // never to read; waitSec: how long an answer may take.
  notes: { enabled: false, vault: '', agy: 'agy', rawDir: '', waitSec: 30 },
  // Today's and overdue tasks (tasks.mjs), read when asked through the `voice-mode tasks` source.
  tasks: { command: ['ticktick', '--format', 'json', 'tasks', 'due', '1'], timeoutSec: 5 },
  // Where real work and deeper questions are handed over: argv with the note appended; env is added.
  queue: { command: [], env: {} },
  // Answers to hand-offs come back with `<replyCommand> <id> "<answer>"` (see handoff.mjs).
  // A conversation stays open while an answer is coming (up to waitMin), and says once that
  // it is still coming when it takes longer than stillComingSec (0: never).
  handoff: { dir: '', replyCommand: 'voice-mode reply', waitMin: 15, stillComingSec: 20 },
  // The live briefing (see briefing.mjs), rebuilt at start, every refreshMin minutes and when
  // a source changes. parts, each with maxChars:
  //   { name, transcript: <Claude Code project folder>, messages?, skip?: [regex] }
  //   { name, path, sections?: ['In flight'], lineChars? }
  //   { name, files: <glob>, except?: [file names] }     whole files, such as memories
  //   { name, glob, hours? }                              the newest line of each log
  //   { name, tasks: <glob or [globs] of <id>.meta>, days? }   who is working on what
  // Gemini Live takes up to its whole 131,072-token context as instructions, but every turn
  // bills the whole context again: see docs/voice-mode.md before raising maxChars.
  briefing: { enabled: true, refreshMin: 3, maxChars: 120000, parts: [] },
  logDir: path.join(CONFIG_DIR, 'logs'),
  // Also write what was said and answered to the run log (never to the metrics file).
  logTranscripts: false,
};

export function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

/** Parse KEY=value lines; quotes stripped, `#` comments and blank lines ignored. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** One key from an env file, or '' when the file or the value is missing. */
export function readKey(file, name) {
  if (!file) return '';
  try {
    return parseEnvFile(fs.readFileSync(expandHome(file), 'utf8'))[name] || '';
  } catch {
    return '';
  }
}

/** A glob of `*` and `?` as a whole-name, case-insensitive pattern. */
const globRe = (g) => new RegExp(`^${String(g).split('').map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 'i');

/**
 * True when a folder or file name along `p` matches one of the `exclude` patterns. Only the
 * part of the path below whichever of `roots` holds it counts (the folders above a root are
 * not yours to name); outside every root, only its own name does.
 */
export function excluded(p, patterns = [], roots = []) {
  if (!patterns.length || !p) return false;
  const res = patterns.map(globRe);
  const full = path.resolve(String(p));
  const root = roots.map((r) => path.resolve(String(r))).filter((r) => full === r || full.startsWith(r + path.sep)).sort((a, b) => b.length - a.length)[0];
  const rel = root ? path.relative(root, full) : path.basename(full);
  return rel.split(/[\\/]+/).some((seg) => seg && res.some((re) => re.test(seg)));
}

// Expand a `*` inside path segments, such as ~/homes/<star>/data, to the paths that exist.
export function expandGlob(p) {
  const parts = p.split(path.sep);
  let found = [parts[0] === '' ? path.sep : parts[0]];
  for (const part of parts.slice(1)) {
    if (!part) continue;
    if (!part.includes('*')) {
      found = found.map((f) => path.join(f, part));
      continue;
    }
    const re = new RegExp(`^${part.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    found = found.flatMap((f) => {
      try {
        return fs.readdirSync(f).filter((n) => re.test(n)).sort().map((n) => path.join(f, n));
      } catch {
        return [];
      }
    });
  }
  return found.filter((f) => fs.existsSync(f));
}

/** A source with `*` in its path becomes one source per match, named after what each `*` matched. */
function expandSources(sources) {
  return sources.flatMap((s) => {
    if (!s.path) return [s];
    const p = expandHome(s.path);
    if (!p.includes('*')) return [{ ...s, path: p }];
    const stars = p.split(path.sep).map((seg, i) => (seg.includes('*') ? i : -1)).filter((i) => i >= 0);
    return expandGlob(p).map((m) => {
      const segs = m.split(path.sep);
      return { ...s, name: `${s.name} ${stars.map((i) => segs[i]).join('/')}`, path: m };
    });
  });
}

export function loadConfig(file = process.env.VOICE_MODE_CONFIG || path.join(CONFIG_DIR, 'config.json')) {
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`${file} is not valid JSON (${err.message})`);
    }
  }
  const config = merge(DEFAULTS, user);
  config.file = file;
  config.keysFile = expandHome(config.keysFile);
  config.logDir = expandHome(config.logDir);
  config.actions.documents = expandHome(config.actions.documents);
  config.actions.notes.folder = expandHome(config.actions.notes.folder);
  config.actions.chooser.keyFile = expandHome(config.actions.chooser.keyFile);
  config.sources = expandSources(config.sources || []);
  config.exclude = (config.exclude || []).map(String).filter(Boolean);
  config.notes.vault = expandHome(config.notes.vault);
  config.notes.rawDir = expandHome(config.notes.rawDir);
  if (config.personaFile) config.persona = fs.readFileSync(expandHome(config.personaFile), 'utf8').trim();
  if (!config.providers[config.provider]) throw new Error(`unknown provider "${config.provider}" (openai, gemini or fake)`);
  return config;
}
