import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';

// Speech-to-speech voice mode for your assistant: talk, hear it answer in real time from its
// own records (read-only), hand real work to its inbox, and open apps, sites, folders and
// records by voice while you are still talking. The realtime provider (OpenAI Realtime or
// Gemini Live) is one line in the config. Everything runs from the Node scripts in
// templates/voice-mode/bin, with the system's own audio tools. See docs/voice-mode.md.

const NAME = 'voice-mode';
const SCRIPTS = ['voice-mode.mjs', 'config.mjs', 'providers.mjs', 'records.mjs', 'desk.mjs', 'audio.mjs'];
const DESKTOP_FILE = 'voice-mode-toggle.desktop';
const dir = (ctx) => path.join(ctx.home, '.config', 'ai-workstation-setup', 'voice');
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/** Split a command line into words, honouring quotes; leading NAME=value words become env. */
export function parseCommand(line) {
  const words = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(line || '')))) words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
  const env = {};
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const w = words.shift();
    env[w.slice(0, w.indexOf('='))] = w.slice(w.indexOf('=') + 1);
  }
  return { command: words, env };
}

// Qt key codes, as kglobalaccel takes them over D-Bus.
const MODS = { meta: 0x10000000, super: 0x10000000, ctrl: 0x04000000, control: 0x04000000, alt: 0x08000000, shift: 0x02000000 };
export function qtKey(combo) {
  let code = 0;
  let key = null;
  for (const part of String(combo).split('+').map((s) => s.trim())) {
    const lower = part.toLowerCase();
    if (lower in MODS) code |= MODS[lower];
    else if (lower === 'space') key = 0x20;
    else if (/^f([1-9]|1[0-2])$/.test(lower)) key = 0x01000030 + Number(lower.slice(1)) - 1;
    else if (/^[a-z0-9]$/.test(lower)) key = part.toUpperCase().charCodeAt(0);
    else throw new Error(`VOICE_HOTKEY: cannot read "${part}" in "${combo}" (use e.g. Meta+Shift+Space)`);
  }
  if (key === null || !code) throw new Error(`VOICE_HOTKEY: "${combo}" needs at least one modifier and one key`);
  return code | key;
}

function buildConfig(ctx) {
  const sources = list(ctx.get('VOICE_SOURCES')).map((p) => {
    const full = ctx.path(p);
    return { name: path.basename(full).replace(/^\./, '') || full, path: full, show: true };
  });
  if (ctx.get('VOICE_VAULT_SEARCH')) {
    sources.push({ name: 'second brain', about: 'the notes vault, searched by keyword', command: ['obsidian-axi', 'search', '{regex}', '--regex', '--limit', '12'] });
  }
  const queue = parseCommand(ctx.get('VOICE_QUEUE_COMMAND'));
  return {
    provider: ctx.get('VOICE_PROVIDER'),
    keysFile: path.join(dir(ctx), '.env'),
    ...(ctx.get('VOICE_PERSONA_FILE') ? { personaFile: ctx.get('VOICE_PERSONA_FILE') } : {}),
    sources,
    queue,
    actions: {
      enabled: ctx.get('VOICE_ACTIONS'),
      documents: ctx.get('VOICE_DOCUMENTS'),
      chooser: { keyFile: ctx.get('VOICE_ACTIONS_KEY_FILE') },
    },
  };
}

async function hotkey(ctx, node, script) {
  const combo = ctx.get('VOICE_HOTKEY');
  if (!combo) return ctx.ok('no hotkey requested');
  const key = qtKey(combo);
  const toggle = `"${node}" "${script}" toggle`;
  const desktop = /KDE/i.test(process.env.XDG_CURRENT_DESKTOP || '');
  if (ctx.os === 'macos' || ctx.os === 'windows' || (!desktop && !ctx.platform.simulated)) {
    ctx.todo(`bind ${combo} to this command in your desktop's keyboard shortcut settings: ${toggle}`);
    return;
  }
  // KDE Plasma: the same kind of entry System Settings > Shortcuts > Add Command makes, a
  // .desktop file with X-KDE-Shortcuts, registered with kglobalaccel so it works at once.
  const file = path.join(ctx.home, '.local', 'share', 'applications', DESKTOP_FILE);
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Voice mode',
    'Comment=Talk to your assistant: open the mic, close it, or cut in on a reply',
    `Exec=${toggle}`,
    'Icon=audio-input-microphone',
    'NoDisplay=true',
    'StartupNotify=false',
    `X-KDE-Shortcuts=${combo}`,
    '',
  ].join('\n');
  await ctx.writeFile(file, content, { onConflict: 'ask' });
  if (ctx.platform.simulated) return ctx.info(`would register ${combo} with kglobalaccel (KDE Plasma)`);
  const id = `"['${DESKTOP_FILE}','_launch','Voice mode','Voice mode']"`;
  const call = (method, args) => `gdbus call --session --dest org.kde.kglobalaccel --object-path /kglobalaccel --method org.kde.KGlobalAccel.${method} ${args}`;
  const current = ctx.capture(call('shortcut', id));
  if (current && current.includes(`[${key}]`)) return ctx.ok(`${combo} already starts voice mode`);
  const free = ctx.capture(call('isGlobalShortcutAvailable', `${key} ${DESKTOP_FILE}`));
  if (free && free.includes('false')) throw new Error(`${combo} is already taken by another shortcut; pick another VOICE_HOTKEY`);
  ctx.run(`(kbuildsycoca6 || kbuildsycoca5) >/dev/null 2>&1; ${call('doRegister', id)} && ${call('setShortcut', `${id} "[${key}]" 4`)}`);
  ctx.info(`remove it with: ${call('unregister', `${DESKTOP_FILE} _launch`)}; rm "${file}"`);
}

export default {
  name: NAME,
  title: 'Voice mode (talk with your assistant)',
  description: 'Opt-in: speech-to-speech with OpenAI Realtime or Gemini Live, answers from your records, queues work, opens apps by voice; hotkey',
  order: 95,
  platforms: ['linux', 'macos'],
  unsupported: {
    wsl: 'needs the desktop microphone and speaker; run it on a Linux or macOS desktop',
    windows: 'the microphone and speaker path uses PulseAudio/PipeWire or sox; Windows is not supported yet',
  },
  requires: ['core'],
  default: false,
  questions: [
    {
      key: 'VOICE_PROVIDER',
      type: 'choice',
      message: 'Realtime voice provider (one line in the config switches it later)',
      default: 'openai',
      choices: [
        { value: 'openai', label: 'openai - OpenAI Realtime (key OPENAI_API_KEY)' },
        { value: 'gemini', label: 'gemini - Gemini Live (key GEMINI_API_KEY)' },
      ],
    },
    {
      key: 'VOICE_SOURCES',
      type: 'text',
      message: 'Files and folders it may read to answer you (comma-separated; read-only)',
      // Firstmate keeps its records in <home>/data; its home is the clone unless FM_HOME says otherwise.
      default: (ctx) => (ctx.values.FIRSTMATE_DIR ? path.join(ctx.values.FIRSTMATE_DIR, 'data') : ''),
    },
    { key: 'VOICE_VAULT_SEARCH', type: 'confirm', message: 'Also search your notes vault with obsidian-axi?', default: (ctx) => 'VAULT_PATH' in ctx.values },
    {
      key: 'VOICE_QUEUE_COMMAND',
      type: 'text',
      message: 'Command that queues real work for your assistant; the request is added as its last argument (empty: it says it cannot queue)',
      default: (ctx) => (ctx.values.FIRSTMATE_DIR ? `"${path.join(ctx.values.FIRSTMATE_DIR, 'bin', 'fm-inbox.sh')}" note` : ''),
    },
    { key: 'VOICE_ACTIONS', type: 'confirm', message: 'Open apps, sites, folders and records by voice (a fast decision model picks from a fixed list)?', default: true },
    {
      key: 'VOICE_ACTIONS_KEY_FILE',
      type: 'text',
      path: true,
      message: 'Env file that holds OPENROUTER_API_KEY for the decision model (read at run time, never copied; empty: from the environment)',
      default: '',
      when: (ctx) => ctx.get('VOICE_ACTIONS'),
    },
    { key: 'VOICE_DOCUMENTS', type: 'text', path: true, message: 'Documents folder whose folders it may open', default: '~/Documents', when: (ctx) => ctx.get('VOICE_ACTIONS') },
    { key: 'VOICE_PERSONA_FILE', type: 'text', path: true, message: 'A text file with your own persona for the voice (empty: a neutral default)', default: '' },
    { key: 'VOICE_HOTKEY', type: 'text', message: 'Global hotkey that toggles the mic (KDE Plasma sets it for you; elsewhere you are told the command to bind)', default: 'Meta+Shift+Space' },
  ],

  async install(ctx) {
    const base = dir(ctx);
    const binDir = path.join(base, 'bin');
    const script = path.join(binDir, 'voice-mode.mjs');
    const node = process.execPath;

    await ctx.step('audio tools', () =>
      ctx.ensureTool({
        name: ctx.os === 'macos' ? 'sox' : 'parecord',
        bin: ctx.os === 'macos' ? 'rec' : 'parecord',
        install: { linux: { pkg: { apt: 'pulseaudio-utils', dnf: 'pulseaudio-utils', pacman: 'libpulse', zypper: 'pulseaudio-utils' } }, macos: { pkg: { brew: 'sox' } } },
      }),
    );

    await ctx.step('scripts', async () => {
      for (const f of SCRIPTS) await ctx.writeFile(path.join(binDir, f), ctx.template(`voice-mode/bin/${f}`), { onConflict: 'ask', mode: f === 'voice-mode.mjs' ? 0o755 : undefined });
      const launcher = path.join(ctx.home, '.local', 'bin', 'voice-mode');
      await ctx.writeFile(launcher, `#!/bin/sh\nexec "${node}" "${script}" "$@"\n`, { onConflict: 'ask', mode: 0o755 });
      if (!ctx.platform.simulated && !(process.env.PATH || '').split(path.delimiter).includes(path.dirname(launcher))) {
        ctx.todo(`add ${path.dirname(launcher)} to PATH, or run ${launcher} directly`);
      }
    });

    await ctx.step('config', async () => {
      await ctx.writeFile(path.join(base, 'config.json'), `${JSON.stringify(buildConfig(ctx), null, 2)}\n`, { onConflict: 'ask' });
      // The keys file is yours: created empty once, never read or rewritten by the installer.
      const keys = path.join(base, '.env');
      if (fs.existsSync(keys)) return ctx.ok(`${keys} exists; left as it is`);
      await ctx.writeFile(keys, 'OPENAI_API_KEY=\nGEMINI_API_KEY=\n', { mode: 0o600 });
      ctx.todo(`put your key for the chosen provider in ${keys} (mode 600; never commit it or paste it in chat)`);
    });

    if (ctx.get('VOICE_VAULT_SEARCH')) {
      await ctx.step('vault search', () => {
        if (!ctx.dryRun && !ctx.has('obsidian-axi')) throw new Skip('obsidian-axi is not installed; pick it in second-brain, or remove the "second brain" source from the config');
        ctx.ok('obsidian-axi found');
      });
    }

    await ctx.step('hotkey', () => hotkey(ctx, node, script));

    ctx.todo(`check what is set up and what is missing: voice-mode check; then talk: voice-mode start --listen (or press ${ctx.get('VOICE_HOTKEY') || 'your hotkey'})`);
    ctx.info('see docs/voice-mode.md for the config file, latency and barge-in');
  },
};
