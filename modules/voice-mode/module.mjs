import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { keyFile as openrouterKeyFile } from '../openrouter/module.mjs';

// Speech-to-speech voice mode for your assistant: talk, hear it answer in real time from its
// own records (read-only), hand real work to its inbox, and open apps, sites, folders and
// records by voice while you are still talking. The realtime provider (OpenAI Realtime or
// Gemini Live) is one line in the config. Everything runs from the Node scripts in
// templates/voice-mode/bin, with the system's own audio tools. See docs/voice-mode.md.

const NAME = 'voice-mode';
const SCRIPTS = ['voice-mode.mjs', 'config.mjs', 'providers.mjs', 'records.mjs', 'desk.mjs', 'audio.mjs', 'orb.mjs', 'orb.qml', 'briefing.mjs', 'handoff.mjs', 'browser.mjs', 'lookout.mjs', 'notes.mjs', 'pc.mjs', 'tasks.mjs'];
// The orb runs on Qt 6's own `qml` tool with KDE's layer-shell module (overlay above every window).
const ORB_PKGS = { apt: 'qml-qt6 qml6-module-qtquick-window qml6-module-qtquick-shapes qml6-module-org-kde-layershell', pacman: 'qt6-declarative layer-shell-qt' };
const ORB_RUNNERS = ['/usr/lib/qt6/bin/qml', 'qml6', 'qml-qt6'];
const DESKTOP_FILE = 'voice-mode-toggle.desktop';
const dir = (ctx) => path.join(ctx.home, '.config', 'ai-workstation-setup', 'voice');
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// The "type" action runs `ydotool type`, which needs the ydotoold daemon and write access to
// /dev/uinput. Debian, Ubuntu and Arch ship ydotoold as the systemd user unit ydotool.service.
const UINPUT_RULE = 'KERNEL=="uinput", GROUP="input", MODE="0660", TAG+="uaccess"';
async function typing(ctx) {
  await ctx.ensureTool({ name: 'ydotool', install: { linux: { pkg: { apt: 'ydotool', dnf: 'ydotool', pacman: 'ydotool', zypper: 'ydotool' } } } });
  if (ctx.platform.simulated) return ctx.info('would start the ydotool.service user unit (ydotoold) when `systemctl --user` works');
  let writable = true;
  try {
    fs.accessSync('/dev/uinput', fs.constants.W_OK);
  } catch {
    writable = false;
    ctx.todo(
      `let your user reach /dev/uinput, which ydotoold needs, then log out and in: echo '${UINPUT_RULE}' | sudo tee /etc/udev/rules.d/70-uinput.rules && sudo usermod -aG input "$USER"`,
    );
  }
  if (ctx.capture('systemctl --user show-environment') === null) return ctx.todo('keep `ydotoold` running in the background (no systemd user session found)');
  if (ctx.capture('systemctl --user cat ydotool.service') === null) {
    return ctx.todo('keep `ydotoold` running in the background (your ydotool package ships no ydotool.service user unit)');
  }
  if (ctx.capture('systemctl --user is-active ydotool.service') === 'active') return ctx.ok('ydotool.service (ydotoold) is running');
  if (!writable) return ctx.run('systemctl --user enable ydotool.service');
  ctx.run('systemctl --user enable --now ydotool.service');
}

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
    else throw new Error(`VOICE_HOTKEY: cannot read "${part}" in "${combo}" (use e.g. Ctrl+2 or Meta+Shift+Space)`);
  }
  if (key === null || !code) throw new Error(`VOICE_HOTKEY: "${combo}" needs at least one modifier and one key`);
  return code | key;
}

function buildConfig(ctx) {
  const sources = list(ctx.get('VOICE_SOURCES')).map((p) => {
    const full = ctx.path(p);
    return { name: path.basename(full).replace(/^\./, '') || full, path: full, show: true };
  });
  // Read-only command sources, read only when the voice asks them; through the launcher, by full path.
  const launcher = path.join(ctx.home, '.local', 'bin', 'voice-mode');
  if (ctx.get('VOICE_PC')) {
    sources.push({ name: 'computer', about: "this computer's status now: battery, disk, memory, how busy it is, network, the busiest apps, uptime", command: [launcher, 'pc'] });
  }
  const tasks = parseCommand(ctx.get('VOICE_TASKS_COMMAND')).command;
  if (tasks.length) sources.push({ name: 'tasks', about: "today's and overdue tasks, with their titles", command: [launcher, 'tasks'], timeoutSec: 8 });
  const queue = parseCommand(ctx.get('VOICE_QUEUE_COMMAND'));
  const transcript = ctx.get('VOICE_BRIEFING_TRANSCRIPT');
  return {
    provider: ctx.get('VOICE_PROVIDER'),
    keysFile: path.join(dir(ctx), '.env'),
    ...(ctx.get('VOICE_PERSONA_FILE') ? { personaFile: ctx.get('VOICE_PERSONA_FILE') } : {}),
    sources,
    queue,
    // Answers to hand-offs come back through the launcher, by full path.
    handoff: { replyCommand: `${path.join(ctx.home, '.local', 'bin', 'voice-mode')} reply` },
    ...(transcript ? { briefing: { parts: [{ name: 'Recent conversation', transcript: ctx.path(transcript) }] } } : {}),
    ...(ctx.get('VOICE_ORB') === false ? { orb: { enabled: false } } : {}),
    actions: {
      enabled: ctx.get('VOICE_ACTIONS'),
      documents: ctx.get('VOICE_DOCUMENTS'),
      // The openrouter module, when picked, sets the decision model (its OPENROUTER_MODEL).
      chooser: {
        keyFile: ctx.get('VOICE_ACTIONS_KEY_FILE'),
        ...((ctx.values.MODULES || []).includes('openrouter') && ctx.get('OPENROUTER_MODEL') ? { model: ctx.get('OPENROUTER_MODEL') } : {}),
      },
    },
    ...(ctx.get('VOICE_ACTIONS') && ctx.get('VOICE_BROWSER') ? { browser: { enabled: true, endpoint: ctx.get('VOICE_BROWSER') } } : {}),
    ...(tasks.length ? { tasks: { command: tasks } } : {}),
    // The ledger's board, else its one-shot command by full path (a hotkey's PATH may lack ~/.local/bin).
    ...(ctx.get('VOICE_LOOKOUT') ? { lookout: { enabled: true, command: [path.join(ctx.home, '.local', 'bin', 'ledger'), 'board', '--json'] } } : {}),
    ...(ctx.get('VOICE_NOTES') ? { notes: { enabled: true, vault: ctx.get('VOICE_NOTES_VAULT'), rawDir: ctx.get('VOICE_NOTES_RAW_DIR') } } : {}),
    // Name patterns of files and folders never to be read, offered or opened: yours to fill in, here only.
    exclude: [],
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
    'Comment=Talk to your assistant: start a conversation, or end it',
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
    wsl: 'needs a desktop hotkey, window control and typing into other apps, which WSL does not give (WSLg passes sound, not the desktop); use OpenWhispr on the Windows side for dictation, or run it on a Linux or macOS desktop',
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
      default: (ctx) => {
        const home = ctx.values.FIRSTMATE_HOME || ctx.values.FIRSTMATE_DIR;
        return home ? path.join(home, 'data') : '';
      },
    },
    {
      key: 'VOICE_NOTES',
      type: 'confirm',
      message: 'Answer questions about your notes vault by asking agy, which reads it and answers in a few sentences (the voice never reads the vault itself)?',
      default: (ctx) => 'VAULT_PATH' in ctx.values && (ctx.values.AGENT_CLIS || []).includes('agy'),
    },
    { key: 'VOICE_NOTES_VAULT', type: 'text', path: true, message: 'The vault folder agy answers from (a git repository)', default: (ctx) => ctx.values.VAULT_PATH || '~/second-brain', when: (ctx) => ctx.get('VOICE_NOTES') },
    {
      key: 'VOICE_NOTES_RAW_DIR',
      type: 'text',
      path: true,
      message: 'Raw material folder agy is told never to read for these answers (empty: none)',
      default: (ctx) => ctx.values.VAULT_RAW_DIR || '',
      when: (ctx) => ctx.get('VOICE_NOTES'),
    },
    {
      key: 'VOICE_LOOKOUT',
      type: 'confirm',
      message: "While a conversation runs, speak up when something new waits on you or a worker stopped or failed (reads the ledger module's board)?",
      default: (ctx) => (ctx.values.MODULES || []).includes('ledger'),
    },
    { key: 'VOICE_PC', type: 'confirm', message: "Answer questions about this computer's status (battery, disk, memory, network, busiest apps) when asked?", default: true },
    {
      key: 'VOICE_TASKS_COMMAND',
      type: 'text',
      message: "Command that prints your tasks as JSON, for today's and overdue tasks when asked (TickTick: ticktick-cli task filter --status 0 --json; empty: none)",
      default: (ctx) => (ctx.values.DAILY_SYNC_TICKTICK_COMMAND ? 'ticktick-cli task filter --status 0 --json' : ''),
    },
    {
      key: 'VOICE_QUEUE_COMMAND',
      type: 'text',
      message: 'Command that hands questions and work to your assistant; the note is added as its last argument (empty: no hand-off)',
      default: (ctx) => (ctx.values.FIRSTMATE_DIR ? `"${path.join(ctx.values.FIRSTMATE_DIR, 'bin', 'fm-inbox.sh')}" note` : ''),
    },
    { key: 'VOICE_ACTIONS', type: 'confirm', message: 'Open apps, sites, folders and records by voice (a fast decision model picks from a fixed list)?', default: true },
    {
      key: 'VOICE_ACTIONS_KEY_FILE',
      type: 'text',
      path: true,
      message: 'Env file that holds OPENROUTER_API_KEY for the decision model (read at run time, never copied; empty: from the environment)',
      default: (ctx) => ((ctx.values.MODULES || []).includes('openrouter') ? openrouterKeyFile(ctx) : ''),
      when: (ctx) => ctx.get('VOICE_ACTIONS'),
    },
    { key: 'VOICE_DOCUMENTS', type: 'text', path: true, message: 'Documents folder whose folders it may open', default: '~/Documents', when: (ctx) => ctx.get('VOICE_ACTIONS') },
    {
      key: 'VOICE_BROWSER',
      type: 'text',
      message: "DevTools address of a Chrome you started for the assistant with its own profile and --remote-debugging-port, whose current page the voice may click, type into and scroll (loopback only; empty: off)",
      default: '',
      when: (ctx) => ctx.get('VOICE_ACTIONS'),
    },
    {
      key: 'VOICE_BRIEFING_TRANSCRIPT',
      type: 'text',
      path: true,
      message: "A Claude Code project folder (~/.claude/projects/<project>) whose latest conversation briefs the voice, redacted (empty: none)",
      default: '',
    },
    { key: 'VOICE_PERSONA_FILE', type: 'text', path: true, message: 'A text file with your own persona for the voice (empty: a neutral default)', default: '' },
    { key: 'VOICE_HOTKEY', type: 'text', message: 'Global hotkey that starts a conversation and ends it (KDE Plasma sets it for you; elsewhere you are told the command to bind)', default: 'Ctrl+2' },
    {
      key: 'VOICE_TYPING',
      type: 'confirm',
      message: 'Let voice mode type your words into the window in front (Linux: installs ydotool and starts its ydotoold user service)?',
      default: true,
      when: (ctx) => ctx.os === 'linux',
    },
    { key: 'VOICE_ORB', type: 'confirm', message: 'Show a floating orb that moves with the conversation while it runs (Linux, Qt 6)?', default: true, when: (ctx) => ctx.os === 'linux' },
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
      await ctx.addUserPath(path.dirname(launcher));
    });

    await ctx.step('config', async () => {
      await ctx.writeFile(path.join(base, 'config.json'), `${JSON.stringify(buildConfig(ctx), null, 2)}\n`, { onConflict: 'ask' });
      // The keys file is yours: created empty once, never read or rewritten by the installer.
      const keys = path.join(base, '.env');
      if (fs.existsSync(keys)) return ctx.ok(`${keys} exists; left as it is`);
      await ctx.writeFile(keys, 'OPENAI_API_KEY=\nGEMINI_API_KEY=\n', { mode: 0o600 });
      ctx.todo(`put your key for the chosen provider in ${keys} (mode 600; never commit it or paste it in chat)`);
    });

    if (ctx.get('VOICE_NOTES')) {
      await ctx.step('notes through agy', () => {
        if (!ctx.dryRun && !ctx.has('agy')) throw new Skip('agy is not installed; pick it in agent-clis, or set "notes": { "enabled": false } in the config');
        ctx.ok(`agy answers notes questions from ${ctx.get('VOICE_NOTES_VAULT')}`);
      });
    }

    if (ctx.get('VOICE_LOOKOUT')) {
      await ctx.step('lookout', () => {
        if (!(ctx.values.MODULES || []).includes('ledger') && !ctx.dryRun && !ctx.has('ledger')) throw new Skip('the lookout reads the ledger module\'s board; install the ledger module first');
        ctx.ok('the lookout reads the ledger board while a conversation runs');
      });
    }

    if (ctx.os === 'linux' && ctx.get('VOICE_ORB') !== false) {
      await ctx.step('orb', () => {
        const found = ORB_RUNNERS.find((r) => (r.startsWith('/') ? fs.existsSync(r) : ctx.has(r)));
        if (found && !ctx.platform.simulated) return ctx.ok(`Qt 6 qml tool found (${found})`);
        ctx.pkgInstall(ORB_PKGS);
      });
    }

    if (ctx.os === 'linux' && ctx.get('VOICE_TYPING')) await ctx.step('typing (ydotool)', () => typing(ctx));

    await ctx.step('hotkey', () => hotkey(ctx, node, script));

    ctx.todo(`check what is set up and what is missing: voice-mode check; then press ${ctx.get('VOICE_HOTKEY') || 'your hotkey'} and talk`);
    ctx.info('see docs/voice-mode.md for the config file, latency and barge-in');
  },
};
