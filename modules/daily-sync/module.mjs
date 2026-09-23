import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { addSessionStartHook } from '../../lib/claude.mjs';

// One scheduled pass a day that keeps what you depend on current: fast-forward clean repos,
// report watched repos that are behind, run the vault's own ingest on new raw files (and fail
// loudly when the raw folder is missing or empty), run a tool-update check, and read (never
// write) ClickUp and TickTick to compare them with what you expect. All of that is plain
// scripting in templates/daily-sync/bin/daily-sync.mjs; a model is asked only to explain a new
// drift item, so a quiet day makes no model call. The schedule is the simplest one the system
// has that survives a reboot: a systemd user timer (Persistent=true catches a missed run),
// launchd on macOS, else cron; on Windows the Task Scheduler command is printed for you.
// See docs/daily-sync.md.

const NAME = 'daily-sync';
const TAG = 'ai-workstation-setup daily-sync';
const LAUNCHD_LABEL = 'local.ai-workstation-setup.daily-sync';
const dir = (ctx) => path.join(ctx.home, '.config', 'ai-workstation-setup', NAME);

// A small model, no tools, no settings or MCP servers, and a one-line system prompt: about a
// thousand tokens per drift item explained.
const DEFAULT_MODEL =
  'claude -p --model haiku --tools "" --strict-mcp-config --no-session-persistence --setting-sources "" ' +
  '--system-prompt "Answer in at most three short lines of plain text, from the evidence given only."';

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function parseTime(value) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value).trim());
  if (!m) throw new Error(`DAILY_SYNC_TIME must be HH:MM (24-hour), got "${value}"`);
  return { hour: Number(m[1]), minute: Number(m[2]), text: `${m[1].padStart(2, '0')}:${m[2]}` };
}

function buildConfig(ctx, base) {
  const surfaces = ctx.get('DAILY_SYNC_SURFACES') || [];
  const config = {
    staleHours: 26,
    keepReports: 30,
    remindDays: 7,
    notify: ctx.get('DAILY_SYNC_NOTIFY'),
    model: { command: ctx.get('DAILY_SYNC_MODEL'), maxCalls: 3, timeoutSec: 180 },
    pull: list(ctx.get('DAILY_SYNC_PULL')).map((p) => ctx.path(p)),
    watch: list(ctx.get('DAILY_SYNC_WATCH')).map((p) => ctx.path(p)),
  };
  if (ctx.get('DAILY_SYNC_VAULT')) {
    config.vault = {
      path: ctx.get('DAILY_SYNC_VAULT_PATH'),
      rawDir: ctx.get('DAILY_SYNC_RAW_DIR'),
      dryRun: 'node bin/ingest.mjs --dry-run',
      run: 'node bin/ingest.mjs --limit {limit}',
      limit: Number(ctx.get('DAILY_SYNC_INGEST_LIMIT')) || 3,
      requireClean: true,
      ignoreDirty: ['.obsidian/'],
      timeoutMin: 120,
    };
  }
  if (surfaces.includes('tool-updates')) {
    // Firstmate's own check, read-only; its "reported once" record is kept here, not in firstmate.
    config.commands = [
      {
        name: 'tool updates',
        run: 'bin/fm-tool-update-check.sh check',
        cwd: ctx.get('DAILY_SYNC_FIRSTMATE_DIR'),
        env: {
          FM_STATE_OVERRIDE: path.join(base, 'firstmate-state'),
          FM_TOOL_UPDATE_PROBE_SECS: '20',
          FM_TOOL_UPDATE_BUDGET_SECS: '90',
          FM_CHECK_TIMEOUT: '120',
        },
        timeoutSec: 180,
      },
    ];
  }
  if (surfaces.includes('clickup')) {
    config.clickup = {
      workspace: ctx.get('DAILY_SYNC_CLICKUP_WORKSPACE'),
      space: ctx.get('DAILY_SYNC_CLICKUP_SPACE'),
      lists: list(ctx.get('DAILY_SYNC_CLICKUP_LISTS')),
    };
  }
  if (surfaces.includes('ticktick')) {
    config.ticktick = { command: ctx.get('DAILY_SYNC_TICKTICK_COMMAND'), lists: list(ctx.get('DAILY_SYNC_TICKTICK_LISTS')) };
  }
  config.versions = [];
  return config;
}

// ------------------------------------------------------------------ schedulers

const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const unitQuote = (s) => `"${String(s).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function systemdTimer(ctx, script, time) {
  const unitDir = path.join(ctx.home, '.config', 'systemd', 'user');
  const service = [
    '[Unit]',
    `Description=Daily alignment pass (${TAG})`,
    '',
    '[Service]',
    'Type=oneshot',
    'Nice=10',
    'TimeoutStartSec=3h',
    `Environment=${unitQuote(`PATH=${process.env.PATH}`)}`,
    `ExecStart=${unitQuote(process.execPath)} ${unitQuote(script)}`,
    '',
  ].join('\n');
  const timer = [
    '[Unit]',
    `Description=Run daily-sync every day at ${time.text} (${TAG})`,
    '',
    '[Timer]',
    `OnCalendar=*-*-* ${time.text}:00`,
    'Persistent=true',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
  const wroteService = await ctx.writeFile(path.join(unitDir, `${NAME}.service`), service, { onConflict: 'ask' });
  const wroteTimer = await ctx.writeFile(path.join(unitDir, `${NAME}.timer`), timer, { onConflict: 'ask' });
  const enabled = ctx.capture(`systemctl --user is-enabled ${NAME}.timer`) === 'enabled';
  if (wroteService || wroteTimer || !enabled) ctx.run(`systemctl --user daemon-reload && systemctl --user enable --now ${NAME}.timer`);
  else ctx.ok(`${NAME}.timer is enabled`);
  if (ctx.capture('loginctl show-user "$USER" --property=Linger --value') === 'no') {
    ctx.info('the timer runs while you are logged in and catches up on a missed run at your next login; `loginctl enable-linger` makes it run while you are logged out too');
  }
  ctx.info(`disable it with: systemctl --user disable --now ${NAME}.timer`);
}

function cronLine(ctx, script, time) {
  const line = `${time.minute} ${time.hour} * * * PATH=${sq(process.env.PATH)} ${sq(process.execPath)} ${sq(script)} >/dev/null 2>&1 # ${TAG}`;
  const current = ctx.capture('crontab -l 2>/dev/null') || '';
  if (current.split('\n').includes(line)) return ctx.ok('daily-sync is already in your crontab');
  const kept = current.split('\n').filter((l) => l && !l.includes(`# ${TAG}`));
  ctx.run('crontab -', { input: `${[...kept, line].join('\n')}\n` });
  ctx.info('cron does not catch up on a missed run; the next run reports it as FAILED (no successful run for over a day)');
  ctx.info(`disable it by removing the line marked "# ${TAG}" with: crontab -e`);
}

async function launchdAgent(ctx, script, time) {
  const plist = path.join(ctx.home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(script)}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(process.env.PATH)}</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${time.hour}</integer><key>Minute</key><integer>${time.minute}</integer></dict>
</dict>
</plist>
`;
  if (await ctx.writeFile(plist, content, { onConflict: 'ask' })) {
    ctx.run(`launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} 2>/dev/null; launchctl bootstrap gui/$(id -u) "${plist}"`);
  }
  ctx.info('launchd runs a missed time when the Mac wakes from sleep; a run missed while it was off is reported as FAILED by the next one');
  ctx.info(`disable it with: launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} (and delete ${plist})`);
}

async function schedule(ctx, script, time) {
  if (ctx.os === 'windows') {
    ctx.todo(
      `schedule it with Task Scheduler: schtasks /Create /SC DAILY /ST ${time.text} /TN "${NAME}" /TR "\\"${process.execPath}\\" \\"${script}\\"" /F` +
        ' (a missed run is reported as FAILED by the next one)',
    );
    return;
  }
  if (ctx.os === 'macos') return launchdAgent(ctx, script, time);
  if (ctx.platform.simulated) {
    ctx.info(`would use a systemd user timer at ${time.text} when \`systemctl --user\` works, else a crontab line`);
    return;
  }
  if (ctx.capture('systemctl --user show-environment') !== null) return systemdTimer(ctx, script, time);
  if (ctx.has('crontab')) return cronLine(ctx, script, time);
  const hint = ctx.os === 'wsl' ? ' (in WSL, turn on systemd in /etc/wsl.conf, or install and start cron)' : '';
  throw new Skip(`no systemd user session and no crontab found${hint}; run \`node "${script}"\` once a day yourself`);
}

// ------------------------------------------------------------------ module

export default {
  name: NAME,
  title: 'Daily sync (one daily alignment pass)',
  description: 'Opt-in: a daily job that pulls clean repos, ingests new raw files, checks tool updates and reads task surfaces for drift, reporting loudly',
  order: 90,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: false,
  questions: [
    { key: 'DAILY_SYNC_TIME', type: 'text', message: 'Time of day to run it (24-hour HH:MM)', default: '07:30' },
    {
      key: 'DAILY_SYNC_SCHEDULE',
      type: 'choice',
      message: 'Schedule it',
      default: 'auto',
      choices: [
        { value: 'auto', label: 'auto - systemd user timer, launchd on macOS, else cron (Windows: the Task Scheduler command is printed)' },
        { value: 'none', label: 'none - only when you run it' },
      ],
    },
    { key: 'DAILY_SYNC_PULL', type: 'text', message: 'Repos to fast-forward when clean and behind, comma-separated folders (never forced, stashed or reset)', default: '' },
    {
      key: 'DAILY_SYNC_WATCH',
      type: 'text',
      message: 'Repos another tool updates: only reported when behind, never touched (comma-separated folders)',
      default: '',
    },
    { key: 'DAILY_SYNC_VAULT', type: 'confirm', message: 'Run the vault ingest on new raw files, failing loudly when the raw folder is missing or empty?', default: (ctx) => 'VAULT_PATH' in ctx.values },
    {
      key: 'DAILY_SYNC_VAULT_PATH',
      type: 'text',
      path: true,
      message: 'Vault folder',
      default: (ctx) => ctx.values.VAULT_PATH || '~/second-brain',
      when: (ctx) => ctx.get('DAILY_SYNC_VAULT'),
    },
    {
      key: 'DAILY_SYNC_RAW_DIR',
      type: 'text',
      path: true,
      message: 'Raw source folder the ingest reads',
      default: (ctx) => ctx.values.VAULT_RAW_DIR || '~/raw-sources',
      when: (ctx) => ctx.get('DAILY_SYNC_VAULT'),
    },
    { key: 'DAILY_SYNC_INGEST_LIMIT', type: 'text', message: 'At most this many raw files ingested per run (each one is an agent run)', default: '3', when: (ctx) => ctx.get('DAILY_SYNC_VAULT') },
    {
      key: 'DAILY_SYNC_SURFACES',
      type: 'multi',
      message: 'What else to check (all read-only)',
      default: (ctx) => ('FIRSTMATE_DIR' in ctx.values ? ['tool-updates'] : []),
      choices: [
        { value: 'tool-updates', label: "tool-updates - firstmate's watched-tools update check (reports, never installs)" },
        { value: 'clickup', label: 'clickup - the lists you expect in a ClickUp space, read with clickup-axi' },
        { value: 'ticktick', label: 'ticktick - the lists you expect in TickTick, read with a command you give' },
      ],
    },
    {
      key: 'DAILY_SYNC_FIRSTMATE_DIR',
      type: 'text',
      path: true,
      message: 'Firstmate clone that holds bin/fm-tool-update-check.sh',
      default: (ctx) => ctx.values.FIRSTMATE_DIR || '~/firstmate',
      when: (ctx) => ctx.get('DAILY_SYNC_SURFACES').includes('tool-updates'),
    },
    {
      key: 'DAILY_SYNC_CLICKUP_WORKSPACE',
      type: 'text',
      message: 'ClickUp workspace id, needed when your token sees more than one (a schedule does not read your shell profile)',
      default: '',
      when: (ctx) => ctx.get('DAILY_SYNC_SURFACES').includes('clickup'),
    },
    { key: 'DAILY_SYNC_CLICKUP_SPACE', type: 'text', message: 'ClickUp space to check (name or id)', default: '', when: (ctx) => ctx.get('DAILY_SYNC_SURFACES').includes('clickup') },
    {
      key: 'DAILY_SYNC_CLICKUP_LISTS',
      type: 'text',
      message: 'ClickUp list ids you expect in that space, comma-separated',
      default: '',
      when: (ctx) => ctx.get('DAILY_SYNC_SURFACES').includes('clickup'),
    },
    {
      key: 'DAILY_SYNC_TICKTICK_LISTS',
      type: 'text',
      message: 'TickTick lists you expect, comma-separated',
      default: (ctx) => list(ctx.values.VAULT_PILLARS).map(titleCase).join(','),
      when: (ctx) => ctx.get('DAILY_SYNC_SURFACES').includes('ticktick'),
    },
    {
      key: 'DAILY_SYNC_TICKTICK_COMMAND',
      type: 'text',
      message: 'A read-only command that prints your TickTick lists as JSON (a list of objects with a "name"), signed in beforehand',
      default: 'ticktick --format json projects list',
      when: (ctx) => ctx.get('DAILY_SYNC_SURFACES').includes('ticktick'),
    },
    {
      key: 'DAILY_SYNC_NOTIFY',
      type: 'text',
      message: 'Command that receives the report on stdin when something changed, needs you or failed (empty: report file only)',
      default: (ctx) => (ctx.values.FIRSTMATE_DIR ? `"${path.join(ctx.values.FIRSTMATE_DIR, 'bin', 'fm-inbox.sh')}" note -` : ''),
    },
    { key: 'DAILY_SYNC_MODEL', type: 'text', message: 'Command for one short model call per new drift item it cannot settle (empty: never call a model)', default: DEFAULT_MODEL },
    {
      key: 'DAILY_SYNC_SESSION_HOOK',
      type: 'confirm',
      message: 'Add a Claude Code session-start check that speaks up only when a run failed or none succeeded for a day?',
      default: true,
    },
  ],

  async install(ctx) {
    const time = parseTime(ctx.get('DAILY_SYNC_TIME'));
    const base = dir(ctx);
    const script = path.join(base, 'daily-sync.mjs');
    const configFile = path.join(base, 'config.json');
    const surfaces = ctx.get('DAILY_SYNC_SURFACES') || [];

    await ctx.step('script and config', async () => {
      await ctx.writeFile(script, ctx.template('daily-sync/bin/daily-sync.mjs'), { onConflict: 'ask', mode: 0o755 });
      await ctx.writeFile(configFile, `${JSON.stringify(buildConfig(ctx, base), null, 2)}\n`, { onConflict: 'ask' });
    });

    if (surfaces.includes('clickup')) {
      await ctx.step('clickup', () => {
        if (!ctx.dryRun && !ctx.has('clickup-axi')) throw new Skip('clickup-axi is not installed; pick the clickup module, then re-run');
        if (!ctx.get('DAILY_SYNC_CLICKUP_SPACE') || !list(ctx.get('DAILY_SYNC_CLICKUP_LISTS')).length) {
          ctx.todo(`set clickup.space and clickup.lists in ${configFile}; until then every run reports the check as failed`);
        }
      });
    }
    if (surfaces.includes('ticktick')) {
      await ctx.step('ticktick', () => {
        const bin = ctx.get('DAILY_SYNC_TICKTICK_COMMAND').split(/\s+/)[0];
        if (!ctx.dryRun && bin && !ctx.has(bin)) ctx.todo(`install and sign in to \`${bin}\`, or change ticktick.command in ${configFile}; until then every run reports the check as failed`);
      });
    }

    if (ctx.get('DAILY_SYNC_SCHEDULE') === 'auto') await ctx.step('schedule', () => schedule(ctx, script, time));
    if (ctx.get('DAILY_SYNC_SESSION_HOOK')) await ctx.step('session check', () => addSessionStartHook(ctx, `node "${script}" --status`));

    ctx.todo(`see what a run would do, changing nothing: node "${script}" --dry-run`);
    ctx.info(`reports go to ${path.join(base, 'reports')}; pause it by creating ${path.join(base, 'off')}; more checks (such as recorded versions) are described in docs/daily-sync.md`);
  },
};
