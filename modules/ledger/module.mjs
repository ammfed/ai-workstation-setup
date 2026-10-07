import path from 'node:path';
import { cronCommand, ensureCronLine, shellQuote } from '../../lib/cron.mjs';
import { Skip } from '../../lib/context.mjs';
import { SYNC_QUESTIONS, installSync } from './sync.mjs';

// One append-only record of what you say and decide and of the work under way, captured the
// moment it happens, and a live "Now" page rebuilt from it within seconds. The capture and the
// page are one plain Node script, templates/ledger/bin/ledger.mjs, run as a small always-on
// user service (systemd user unit, launchd agent on macOS). It only reads Firstmate homes and
// Claude Code session transcripts; the ledger itself lives in your data folder, outside this
// clone, readable by you alone. The optional task sync (sync.mjs, ./sync.mjs here) runs as a
// second service next to it. See docs/ledger.md.

const NAME = 'ledger';
const UNIT = 'workstation-ledger';
const TAG = 'ai-workstation-setup ledger';
const LAUNCHD_LABEL = 'local.ai-workstation-setup.ledger';
const dir = (ctx) => path.join(ctx.home, '.config', 'ai-workstation-setup', NAME);

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function folders(ctx, key) {
  return list(ctx.get(key)).map((p) => {
    const abs = path.resolve(ctx.path(p));
    const rel = path.relative(ctx.repoRoot, abs);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error(`${key}: ${abs} is inside this clone; choose a folder outside it`);
    return abs;
  });
}

function buildConfig(ctx) {
  const hours = Number(ctx.get('LEDGER_BACKFILL_HOURS') || 0);
  if (!Number.isFinite(hours) || hours < 0) throw new Error(`LEDGER_BACKFILL_HOURS must be a number of hours, got "${ctx.get('LEDGER_BACKFILL_HOURS')}"`);
  return {
    dataDir: ctx.get('LEDGER_DATA_DIR'),
    mainHome: ctx.get('LEDGER_HOME'),
    mainHomeName: 'main',
    mainSessions: folders(ctx, 'LEDGER_SESSIONS'),
    discoverSecondmates: ctx.get('LEDGER_SECONDMATES'),
    extraHomes: folders(ctx, 'LEDGER_EXTRA_HOMES'),
    transcripts: ctx.get('LEDGER_TRANSCRIPTS'),
    claudeProjects: path.join(ctx.home, '.claude', 'projects'),
    backfillHours: hours,
    rescanSeconds: 20,
    debounceMs: 150,
    replyChars: 2000,
    now: { messages: 15, statuses: 25 },
    redact: [],
    holdAgeDays: 14,
    board: {
      enabled: ctx.get('LEDGER_BOARD'),
      port: boardPort(ctx),
      theme: (ctx.get('LEDGER_BOARD') && ctx.get('LEDGER_BOARD_THEME')) || null,
      pollSeconds: 2.5,
    },
  };
}

function boardPort(ctx) {
  if (!ctx.get('LEDGER_BOARD')) return 4391;
  const port = Number(ctx.get('LEDGER_BOARD_PORT'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`LEDGER_BOARD_PORT must be a port number from 1024 to 65535, got "${ctx.get('LEDGER_BOARD_PORT')}"`);
  return port;
}

// ------------------------------------------------------------------ service

const unitQuote = (s) => `"${String(s).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const LEDGER_SERVICE = { unit: UNIT, label: LAUNCHD_LABEL, what: 'Ledger capture and live Now page', log: 'ai-workstation-setup-ledger.log' };

async function systemdService(ctx, { unit, what, script }) {
  const file = path.join(ctx.home, '.config', 'systemd', 'user', `${unit}.service`);
  const text = [
    '[Unit]',
    `Description=${what} (${TAG})`,
    '',
    '[Service]',
    'Type=simple',
    'Nice=10',
    'Restart=always',
    'RestartSec=5',
    `Environment=${unitQuote(`PATH=${process.env.PATH}`)}`,
    `ExecStart=${unitQuote(process.execPath)} ${unitQuote(script)} serve`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
  const wrote = await ctx.writeFile(file, text, { onConflict: 'ask' });
  const enabled = ctx.capture(`systemctl --user is-enabled ${unit}.service`) === 'enabled';
  const active = ctx.capture(`systemctl --user is-active ${unit}.service`) === 'active';
  if (wrote || !enabled || !active) ctx.run(`systemctl --user daemon-reload && systemctl --user enable ${unit}.service && systemctl --user restart ${unit}.service`);
  else ctx.ok(`${unit}.service is enabled and running`);
  if (ctx.capture('loginctl show-user "$USER" --property=Linger --value') === 'no') {
    ctx.info('the service runs while you are logged in; `loginctl enable-linger` keeps it running while you are logged out too');
  }
  ctx.info(`logs: journalctl --user -u ${unit}; stop it with: systemctl --user disable --now ${unit}.service`);
}

async function launchdAgent(ctx, { label, script, log }) {
  const plist = path.join(ctx.home, 'Library', 'LaunchAgents', `${label}.plist`);
  const logFile = path.join(ctx.home, 'Library', 'Logs', log);
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(script)}</string><string>serve</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(process.env.PATH)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`;
  if (await ctx.writeFile(plist, content, { onConflict: 'ask' })) {
    ctx.run(`launchctl bootout gui/$(id -u)/${label} 2>/dev/null; launchctl bootstrap gui/$(id -u) "${plist}"`);
  }
  ctx.info(`logs: ${logFile}; stop it with: launchctl bootout gui/$(id -u)/${label} (and delete ${plist})`);
}

/** Run `<script> serve` always: a systemd user service, or a launchd agent on macOS. */
async function service(ctx, spec) {
  const { script } = spec;
  if (ctx.os === 'macos') return launchdAgent(ctx, spec);
  if (ctx.platform.simulated) {
    ctx.info(`would run \`${path.basename(script)} serve\` as the systemd user service ${spec.unit}.service when \`systemctl --user\` works`);
    return;
  }
  if (ctx.capture('systemctl --user show-environment') !== null) return systemdService(ctx, spec);
  const hint = ctx.os === 'wsl' ? ' (in WSL, turn on systemd in /etc/wsl.conf)' : '';
  if (!ctx.has('crontab')) throw new Skip(`no systemd user session and no crontab found${hint}; keep \`node "${script}" serve\` running yourself`);
  // No systemd: cron starts it with cron itself (@reboot), and it is started now.
  ensureCronLine(ctx, '@reboot', cronCommand(script, ['serve']), `${TAG} ${spec.unit}`);
  if (ctx.capture(`pgrep -f ${shellQuote(`${script} serve`)}`) === null) ctx.run(`nohup env ${cronCommand(script, ['serve'])} >/dev/null 2>&1 &`);
  else ctx.ok(`${spec.unit} is running`);
  ctx.info(`no systemd user session found${hint}: cron starts it when cron starts; nothing restarts it if it stops`);
}

// ------------------------------------------------------------------ module

export default {
  name: NAME,
  title: 'Ledger (one running record and a live Now page)',
  description: 'Opt-in: an always-on service that records what you say and decide and each status line, with a Now page rebuilt within seconds and an optional live board on 127.0.0.1',
  order: 91,
  platforms: ['linux', 'macos', 'wsl'],
  unsupported: { windows: 'it reads Firstmate homes, and Firstmate runs on Linux, macOS or WSL; set up WSL with .\\install.ps1 --modules wsl and add this module there' },
  requires: ['core'],
  default: false,
  questions: [
    {
      key: 'LEDGER_HOME',
      type: 'text',
      path: true,
      message: 'Your main Firstmate home (the folder holding state/ and data/; FM_HOME when you set one)',
      default: (ctx) => ctx.values.FIRSTMATE_HOME || process.env.FM_HOME || ctx.values.FIRSTMATE_DIR || '~/firstmate',
    },
    {
      key: 'LEDGER_SESSIONS',
      type: 'text',
      message: 'Other folders you run the main Firstmate session from, comma-separated (usually the Firstmate clone)',
      default: (ctx) => {
        const clone = ctx.values.FIRSTMATE_DIR || '~/firstmate';
        return ctx.path(clone) === ctx.values.LEDGER_HOME ? '' : clone;
      },
    },
    { key: 'LEDGER_SECONDMATES', type: 'confirm', message: "Also read the second mates' homes listed in the main home's data/secondmates.md?", default: true },
    { key: 'LEDGER_EXTRA_HOMES', type: 'text', message: 'Any other Firstmate homes to read, comma-separated folders', default: '' },
    {
      key: 'LEDGER_TRANSCRIPTS',
      type: 'confirm',
      message: "Record your own typed messages and the agent's final replies from those homes' Claude Code sessions?",
      default: true,
    },
    {
      key: 'LEDGER_DATA_DIR',
      type: 'text',
      path: true,
      message: 'Folder for the ledger and the Now page (private to you, never inside this clone)',
      default: '~/.local/share/ai-workstation-setup/ledger',
    },
    { key: 'LEDGER_BACKFILL_HOURS', type: 'text', message: 'On the first start, also record this many past hours (0: start from now)', default: '0' },
    {
      key: 'LEDGER_SERVICE',
      type: 'choice',
      message: 'Run it as a service',
      default: 'auto',
      choices: [
        { value: 'auto', label: 'auto - a systemd user service, a launchd agent on macOS' },
        { value: 'none', label: 'none - only when you run `ledger serve` or `ledger scan`' },
      ],
    },
    { key: 'LEDGER_COMMAND', type: 'confirm', message: 'Add a `ledger` command to ~/.local/bin?', default: true },
    {
      key: 'LEDGER_BOARD',
      type: 'confirm',
      message: 'Also serve the live board, a read-only page on this machine only (127.0.0.1) showing what needs you, who is working and what landed?',
      default: false,
    },
    { key: 'LEDGER_BOARD_PORT', type: 'text', message: 'Port for the board on 127.0.0.1', default: '4391', when: (ctx) => ctx.get('LEDGER_BOARD') },
    {
      key: 'LEDGER_BOARD_THEME',
      type: 'text',
      path: true,
      message: 'A CSS file that restyles the board (your own look; files next to it, such as fonts, are served too), or empty for the default',
      default: '',
      when: (ctx) => ctx.get('LEDGER_BOARD'),
    },
    ...SYNC_QUESTIONS,
  ],

  async install(ctx) {
    const base = dir(ctx);
    const script = path.join(base, 'ledger.mjs');
    const configFile = path.join(base, 'config.json');
    const home = ctx.get('LEDGER_HOME');

    await ctx.step('script and config', async () => {
      const config = buildConfig(ctx);
      await ctx.writeFile(script, ctx.template('ledger/bin/ledger.mjs'), { onConflict: 'ask', mode: 0o755 });
      await ctx.writeFile(path.join(base, 'board.html'), ctx.template('ledger/bin/board.html'), { onConflict: 'ask' });
      await ctx.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, { onConflict: 'ask' });
    });

    await ctx.step('firstmate home', () => {
      if (ctx.dryRun || ctx.platform.simulated) return;
      if (!ctx.capture(`test -d "${path.join(home, 'state')}" && echo yes`)) {
        ctx.todo(`${home} has no state/ folder yet; point home in ${configFile} at your Firstmate home (FM_HOME) once it exists`);
      }
    });

    if (ctx.get('LEDGER_COMMAND')) {
      await ctx.step('ledger command', async () => {
        const bin = path.join(ctx.home, '.local', 'bin', 'ledger');
        await ctx.writeFile(bin, `#!/bin/sh\n# ${TAG}\nexec "${process.execPath}" "${script}" "$@"\n`, { onConflict: 'keep', mode: 0o755 });
        if (!String(process.env.PATH || '').split(path.delimiter).includes(path.dirname(bin))) {
          ctx.info(`${path.dirname(bin)} is not on your PATH; add it, or run node "${script}" directly`);
        }
      });
    }

    if (ctx.get('LEDGER_SERVICE') === 'auto') await ctx.step('service', () => service(ctx, { ...LEDGER_SERVICE, script }));

    if (ctx.get('LEDGER_SYNC')) {
      const homes = [{ name: 'main', path: home }, ...folders(ctx, 'LEDGER_EXTRA_HOMES').map((p) => ({ name: path.basename(p).replace(/^\./, ''), path: p }))];
      await installSync(ctx, { base, homes, service });
    }

    ctx.todo('prove it runs and the Now page is fresh: ledger check (then read it: ledger now)');
    if (ctx.get('LEDGER_BOARD')) ctx.info(`the live board: http://127.0.0.1:${ctx.get('LEDGER_BOARD_PORT')}/ (served by the ledger service; \`ledger board\` serves it on its own)`);
    ctx.info(`the ledger and now.md live in ${ctx.get('LEDGER_DATA_DIR')}; other tools append with: ledger add --source <tool> "<text>"`);
  },
};
