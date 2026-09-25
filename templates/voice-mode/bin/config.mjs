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
    openai: { model: 'gpt-realtime', voice: 'marin', transcribeModel: 'gpt-live-transcribe', silenceMs: 500 },
    gemini: { model: 'gemini-3.8-live', voice: 'Puck', silenceMs: 500 },
    fake: { replyDelayMs: 300 },
  },
  persona:
    'You are a voice assistant. Be brief, plain and friendly: one to three short spoken sentences, ' +
    'no lists, no markdown. Answer from the records your tools return and say so when they do not say.',
  personaFile: '',
  // The mic closes after idleCloseSec without speech; the session exits after exitAfterMin
  // with the mic closed.
  listen: { idleCloseSec: 60, exitAfterMin: 15 },
  // duplex: half (mic muted while a reply plays; the hotkey cuts in) or full (talk over a
  // reply; needs echoCancel, or a headset with echoCancel false).
  audio: { duplex: 'half', echoCancel: true, input: '', output: '', earcons: true },
  actions: {
    enabled: true,
    chooser: {
      url: 'https://openrouter.ai/api/alpha/decisions',
      model: 'typesafe/jev-1.13',
      keyName: 'OPENROUTER_API_KEY',
      keyFile: '',
      threshold: 0.9,
      finalThreshold: 0.7,
      timeoutMs: 3000,
    },
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
  // Read-only sources: { name, path, about?, show? } or { name, command: [..., '{query}'], about? }.
  sources: [],
  // Where real work is handed over: argv with the request text appended; env is added.
  queue: { command: [], env: {} },
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
  config.actions.chooser.keyFile = expandHome(config.actions.chooser.keyFile);
  config.sources = expandSources(config.sources || []);
  if (config.personaFile) config.persona = fs.readFileSync(expandHome(config.personaFile), 'utf8').trim();
  if (!config.providers[config.provider]) throw new Error(`unknown provider "${config.provider}" (openai, gemini or fake)`);
  return config;
}
