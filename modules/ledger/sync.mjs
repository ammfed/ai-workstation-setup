import path from 'node:path';
import { versionCheck } from '../agent-clis/tools.mjs';

// The task sync, an optional piece of the ledger module: templates/ledger/bin/sync.mjs keeps
// linked work items the same across the homes, TickTick, ClickUp and the vault, run as its own
// small service next to the ledger and sharing its backlog reader. This file holds its
// questions, its private config skeleton and the official TickTick CLI it writes TickTick with.
// See docs/ledger.md#the-task-sync.

export const SYNC_UNIT = 'workstation-sync';
export const SYNC_LABEL = 'local.ai-workstation-setup.sync';
const SCRIPTS = ['sync.mjs', 'sync-core.mjs', 'sync-places.mjs'];
const TICKTICK_PKG = '@ticktick/ticktick-cli';

// The official TickTick CLI (npm @ticktick/ticktick-cli, by TickTeam) installs two commands,
// `ticktick` and its alias `ticktick-cli`; the sync only ever calls `ticktick-cli`. The
// unofficial `ticktick-cli` npm package also installs a `ticktick` command, so npm refuses the
// official one beside it. Then the official CLI goes into its own folder and only
// `ticktick-cli` is linked into ~/.local/bin: nothing that calls `ticktick` changes.
function installTickTickCli(ctx) {
  if (!ctx.has('ticktick')) return ctx.npmGlobal(TICKTICK_PKG);
  const prefix = path.join(ctx.home, '.local', 'share', 'ai-workstation-setup', 'ticktick-cli');
  const bin = path.join(ctx.home, '.local', 'bin');
  ctx.npmGlobal(TICKTICK_PKG, { prefix });
  ctx.run(`mkdir -p "${bin}" && ln -sfn "${path.join(prefix, 'bin', 'ticktick-cli')}" "${path.join(bin, 'ticktick-cli')}"`);
  ctx.info('another package (the unofficial TickTick CLI) owns the `ticktick` command: the official CLI goes into its own folder, only `ticktick-cli` is linked, and `ticktick` stays as it is. Remove that package once nothing calls `ticktick`');
}

export const TICKTICK_CLI = {
  name: 'ticktick-cli',
  install: { default: installTickTickCli },
  pathHints: ['~/.local/bin'],
  check: versionCheck('ticktick-cli'),
};

const on = (ctx) => ctx.get('LEDGER_SYNC');

export const SYNC_QUESTIONS = [
  {
    key: 'LEDGER_SYNC',
    type: 'confirm',
    message: 'Also run the task sync: linked items stay the same across your homes, TickTick, ClickUp and the vault, both ways (you pair lists and link items yourself)?',
    default: false,
  },
  { key: 'LEDGER_SYNC_TICKTICK', type: 'confirm', message: 'Install the official TickTick CLI (ticktick-cli), which the sync reads and writes TickTick with?', default: true, when: on },
  {
    key: 'LEDGER_SYNC_INBOX',
    type: 'text',
    path: true,
    message: "Firstmate's inbox command, for the sync's notes and cards to a home (bin/fm-inbox.sh; empty: none)",
    default: (ctx) => (ctx.values.FIRSTMATE_DIR ? path.join(ctx.values.FIRSTMATE_DIR, 'bin', 'fm-inbox.sh') : ''),
    when: on,
  },
  {
    key: 'LEDGER_SYNC_SERVICE',
    type: 'choice',
    message: 'Run the task sync as a service',
    default: 'auto',
    choices: [
      { value: 'auto', label: 'auto - a systemd user service, a launchd agent on macOS' },
      { value: 'none', label: 'none - only when you run `task-sync run` or `task-sync check`' },
    ],
    when: on,
  },
];

/** The private config: your homes, with no list paired and no ClickUp list or vault until you add them. */
function syncConfig(ctx, homes) {
  return {
    timeZone: '',
    skewSeconds: 120,
    pollSeconds: 120,
    debounceMs: 2000,
    rescanSeconds: 20,
    tasksAxi: 'tasks-axi',
    inbox: ctx.get('LEDGER_SYNC_INBOX') || null,
    homes: homes.map((h) => ({ ...h, ticktick: '' })),
    ticktick: { command: 'ticktick-cli' },
    clickup: { tokenFile: '', notifyHome: '', lists: [] },
    vault: { path: '', folder: 'projects', write: true, lockHelper: 'bin/lib-lock.sh', lint: 'bin/lint' },
  };
}

/** Scripts next to ledger.mjs, the config in ~/.config/ai-workstation-setup/sync/, the CLI, the command and the service. */
export async function installSync(ctx, { base, homes, service }) {
  const configFile = path.join(ctx.home, '.config', 'ai-workstation-setup', 'sync', 'config.json');
  const script = path.join(base, 'sync.mjs');

  await ctx.step('task sync: scripts and config', async () => {
    for (const f of SCRIPTS) await ctx.writeFile(path.join(base, f), ctx.template(`ledger/bin/${f}`), { onConflict: 'ask', mode: f === 'sync.mjs' ? 0o755 : undefined });
    await ctx.writeFile(configFile, `${JSON.stringify(syncConfig(ctx, homes), null, 2)}\n`, { onConflict: 'keep', mode: 0o600 });
  });

  if (ctx.get('LEDGER_SYNC_TICKTICK')) await ctx.step('ticktick-cli', () => ctx.ensureTool(TICKTICK_CLI));

  if (ctx.get('LEDGER_COMMAND')) {
    await ctx.step('task-sync command', () =>
      ctx.writeFile(path.join(ctx.home, '.local', 'bin', 'task-sync'), `#!/bin/sh\n# ai-workstation-setup task sync\nexec "${process.execPath}" "${script}" "$@"\n`, { onConflict: 'keep', mode: 0o755 }),
    );
  }

  if (ctx.get('LEDGER_SYNC_SERVICE') === 'auto') {
    await ctx.step('task sync service', () => service(ctx, { unit: SYNC_UNIT, label: SYNC_LABEL, script, what: 'Task sync', log: 'ai-workstation-setup-sync.log' }));
  }

  ctx.todo(`pair each home with a TickTick list (ticktick-cli project list --json), and add ClickUp lists and the vault, in ${configFile}; then check the plan: task-sync run --dry-run`);
  if (ctx.get('LEDGER_SYNC_TICKTICK')) ctx.todo('sign in to TickTick once: ticktick-cli auth login (or, without a browser: ticktick-cli auth token <token>)');
}
