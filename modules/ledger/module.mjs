import path from 'node:path';
import { Skip } from '../../lib/context.mjs';

// One append-only record of what you say and decide and of the work under way, captured the
// moment it happens, and a live "Now" page rebuilt from it within seconds. The capture and the
// page are one plain Node script, templates/ledger/bin/ledger.mjs, run as a small always-on
// user service (systemd user unit, launchd agent on macOS). It only reads Firstmate homes and
// Claude Code session transcripts; the ledger itself lives in your data folder, outside this
// clone, readable by you alone. See docs/ledger.md.

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
  };
}

// ------------------------------------------------------------------ service

const unitQuote = (s) => `"${String(s).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function systemdService(ctx, script) {
  const file = path.join(ctx.home, '.config', 'systemd', 'user', `${UNIT}.service`);
  const unit = [
    '[Unit]',
    `Description=Ledger capture and live Now page (${TAG})`,
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
  const wrote = await ctx.writeFile(file, unit, { onConflict: 'ask' });
  const enabled = ctx.capture(`systemctl --user is-enabled ${UNIT}.service`) === 'enabled';
  const active = ctx.capture(`systemctl --user is-active ${UNIT}.service`) === 'active';
  if (wrote || !enabled || !active) ctx.run(`systemctl --user daemon-reload && systemctl --user enable ${UNIT}.service && systemctl --user restart ${UNIT}.service`);
  else ctx.ok(`${UNIT}.service is enabled and running`);
  if (ctx.capture('loginctl show-user "$USER" --property=Linger --value') === 'no') {
    ctx.info('the service runs while you are logged in; `loginctl enable-linger` keeps it running while you are logged out too');
  }
  ctx.info(`logs: journalctl --user -u ${UNIT}; stop it with: systemctl --user disable --now ${UNIT}.service`);
}

async function launchdAgent(ctx, script) {
  const plist = path.join(ctx.home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const logFile = path.join(ctx.home, 'Library', 'Logs', 'ai-workstation-setup-ledger.log');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
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
    ctx.run(`launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} 2>/dev/null; launchctl bootstrap gui/$(id -u) "${plist}"`);
  }
  ctx.info(`logs: ${logFile}; stop it with: launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} (and delete ${plist})`);
}

async function service(ctx, script) {
  if (ctx.os === 'macos') return launchdAgent(ctx, script);
  if (ctx.platform.simulated) {
    ctx.info(`would run \`${path.basename(script)} serve\` as the systemd user service ${UNIT}.service when \`systemctl --user\` works`);
    return;
  }
  if (ctx.capture('systemctl --user show-environment') !== null) return systemdService(ctx, script);
  const hint = ctx.os === 'wsl' ? ' (in WSL, turn on systemd in /etc/wsl.conf)' : '';
  throw new Skip(`no systemd user session found${hint}; keep \`node "${script}" serve\` running yourself`);
}

// ------------------------------------------------------------------ module

export default {
  name: NAME,
  title: 'Ledger (one running record and a live Now page)',
  description: 'Opt-in: an always-on service that records what you say and decide and each status line, with a Now page rebuilt within seconds',
  order: 91,
  platforms: ['linux', 'macos', 'wsl'],
  unsupported: { windows: 'it reads Firstmate homes, and Firstmate runs on Linux, macOS or WSL; install this module inside WSL' },
  requires: ['core'],
  default: false,
  questions: [
    {
      key: 'LEDGER_HOME',
      type: 'text',
      path: true,
      message: 'Your main Firstmate home (the folder holding state/ and data/; FM_HOME when you set one)',
      default: (ctx) => process.env.FM_HOME || ctx.values.FIRSTMATE_DIR || '~/firstmate',
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
  ],

  async install(ctx) {
    const base = dir(ctx);
    const script = path.join(base, 'ledger.mjs');
    const configFile = path.join(base, 'config.json');
    const home = ctx.get('LEDGER_HOME');

    await ctx.step('script and config', async () => {
      const config = buildConfig(ctx);
      await ctx.writeFile(script, ctx.template('ledger/bin/ledger.mjs'), { onConflict: 'ask', mode: 0o755 });
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

    if (ctx.get('LEDGER_SERVICE') === 'auto') await ctx.step('service', () => service(ctx, script));

    ctx.todo('prove it runs and the Now page is fresh: ledger check (then read it: ledger now)');
    ctx.info(`the ledger and now.md live in ${ctx.get('LEDGER_DATA_DIR')}; other tools append with: ledger add --source <tool> "<text>"`);
  },
};
