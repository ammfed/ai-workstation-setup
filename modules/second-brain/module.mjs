import fs from 'node:fs';
import path from 'node:path';
import { cronCommand, ensureCronLine, shellQuote } from '../../lib/cron.mjs';
import { Skip } from '../../lib/context.mjs';
import { windowsPathOf } from '../../lib/wsl.mjs';
import { addSessionStartHook, setClaudeEnv } from '../../lib/claude.mjs';
import { versionCheck } from '../agent-clis/tools.mjs';

// A second brain: plain markdown notes with a frontmatter contract agents can rely on, plus
// the scripts that keep that contract true. Two kinds of folder hold notes. Life-area folders
// hold topic notes and are the user's to name. Entity folders hold one fixed note type each
// and ship empty. There is no numbering scheme and no search index: a generated MAP.md plus
// grep is how the vault is read.
//
// Raw source files stay outside the vault and are never copied in or modified, so the vault is
// a layer of notes over an archive it does not own. Existing vault files are never modified.

// One fixed note type each, and what belongs in them.
const ENTITY_FOLDERS = {
  people: 'One note per person. What they do, how they relate to you, and what you have agreed.',
  projects: 'One note per initiative, carrying `stage: idea|active|on-hold|done` and its next action.',
  decisions: 'One note per decision made: what was decided, why, and what it affects.',
  meetings: 'One note per meeting. The filename starts `YYYY-MM-DD`, so `ls` reads as a timeline.',
  journal: 'One note per day, filename `YYYY-MM-DD.md`. Transient: capture here, then sweep it into real notes.',
  reviews: 'Weekly or monthly reviews. The per-life-area sweep, and where a project stage changes on purpose.',
  sources: 'One note per raw file ingested. The bridge to the original document, which never enters this vault.',
};

const NOTE_TYPES = ['source', 'topic', 'person', 'project', 'decision', 'meeting', 'daily', 'review'];
const SCRIPTS = ['lib-vault.mjs', 'index.mjs', 'check.mjs', 'ingest.mjs', 'housekeeping.mjs'];

// Optional tools on top of the core scripts. Each needs only Node; garden is the one model step,
// and it runs only through the agent command you give it ($AGENT_CLI), never a default.
const TOOLS = [
  { value: 'search', file: 'search.mjs', label: 'search - ranked full-text search over your notes (no index, no model)' },
  { value: 'capture', file: 'capture.mjs', label: 'capture - add one fact to today\'s journal, a note, or a new note, with its provenance, checked and committed' },
  { value: 'garden', file: 'garden.mjs', label: 'garden - one small reversible tidy-up of a few notes by your agent CLI, checked, committed, undone if anything is off' },
  { value: 'bookmarks', file: 'bookmarks.mjs', label: 'bookmarks - turn a browser bookmark export into markdown for ingestion' },
];
const TIMERS = {
  housekeeping: { hours: 3, about: 'check the vault and regenerate MAP.md' },
  garden: { hours: 6, about: 'one garden pass over the next slice of notes' },
};
const TIMER_TAG = 'ai-workstation-setup second-brain';
const unitQuote = (v) => `"${String(v).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const xml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "my-agent --print --flag" -> { AGENT_CLI: 'my-agent', AGENT_CLI_ARGS: '--print --flag' } */
export function agentEnv(command) {
  const [cli, ...args] = String(command || '').trim().split(/\s+/).filter(Boolean);
  return cli ? { AGENT_CLI: cli, AGENT_CLI_ARGS: args.join(' ') } : null;
}

/** Run `node bin/<script>` every few hours: a systemd user timer, or a launchd agent on macOS. */
async function scheduleVaultJob(ctx, vault, name, script, env = {}) {
  const { hours, about } = TIMERS[name];
  const unit = `second-brain-${name}`;
  const all = { PATH: process.env.PATH, VAULT_PATH: vault, ...env };
  if (ctx.os === 'windows') {
    return ctx.todo(`schedule \`node "${script}"\` every ${hours} hours in Task Scheduler (${about})${env.AGENT_CLI ? ', with AGENT_CLI and AGENT_CLI_ARGS set' : ''}`);
  }
  if (ctx.os === 'macos') {
    const label = `local.ai-workstation-setup.${unit}`;
    const plist = path.join(ctx.home, 'Library', 'LaunchAgents', `${label}.plist`);
    const log = path.join(ctx.home, 'Library', 'Logs', `ai-workstation-setup-${unit}.log`);
    const vars = Object.entries(all).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(script)}</string></array>
  <key>WorkingDirectory</key><string>${xml(vault)}</string>
  <key>EnvironmentVariables</key>
  <dict>${vars}</dict>
  <key>StartInterval</key><integer>${hours * 3600}</integer>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
    if (await ctx.writeFile(plist, content, { onConflict: 'ask' })) {
      ctx.run(`launchctl bootout gui/$(id -u)/${label} 2>/dev/null; launchctl bootstrap gui/$(id -u) "${plist}"`);
    }
    return ctx.info(`${unit}: ${about} every ${hours} hours; logs: ${log}`);
  }
  if (ctx.platform.simulated) return ctx.info(`would run ${path.basename(script)} every ${hours} hours as the systemd user timer ${unit}.timer`);
  if (ctx.capture('systemctl --user show-environment') === null) {
    const hint = ctx.os === 'wsl' ? ' (in WSL, turn on systemd in /etc/wsl.conf)' : '';
    if (!ctx.has('crontab')) throw new Skip(`no systemd user session and no crontab found${hint}; schedule \`node "${script}"\` yourself`);
    const command = `cd ${shellQuote(vault)} && ${cronCommand(script, [], { VAULT_PATH: vault, ...env })}`;
    ensureCronLine(ctx, `17 */${hours} * * *`, command, `${TIMER_TAG} ${name}`);
    return ctx.info(`${unit}: ${about} every ${hours} hours from cron, as no systemd user session runs${hint}`);
  }
  const dir = path.join(ctx.home, '.config', 'systemd', 'user');
  const service = [
    '[Unit]',
    `Description=Second brain: ${about} (${TIMER_TAG})`,
    '',
    '[Service]',
    'Type=oneshot',
    'Nice=15',
    'IOSchedulingClass=idle',
    `WorkingDirectory=${unitQuote(vault)}`,
    ...Object.entries(all).map(([k, v]) => `Environment=${unitQuote(`${k}=${v}`)}`),
    `ExecStart=${unitQuote(process.execPath)} ${unitQuote(script)}`,
    '',
  ].join('\n');
  const timer = [
    '[Unit]',
    `Description=Second brain: ${about} every ${hours} hours (${TIMER_TAG})`,
    '',
    '[Timer]',
    'OnBootSec=15min',
    `OnUnitActiveSec=${hours}h`,
    'Persistent=true',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
  const a = await ctx.writeFile(path.join(dir, `${unit}.service`), service, { onConflict: 'ask' });
  const b = await ctx.writeFile(path.join(dir, `${unit}.timer`), timer, { onConflict: 'ask' });
  const active = ctx.capture(`systemctl --user is-active ${unit}.timer`) === 'active';
  if (a || b || !active) ctx.run(`systemctl --user daemon-reload && systemctl --user enable --now ${unit}.timer`);
  else ctx.ok(`${unit}.timer is enabled`);
  ctx.info(`${unit}: logs with journalctl --user -u ${unit}; stop it with: systemctl --user disable --now ${unit}.timer`);
}

const list = (s) => [...new Set(String(s).split(',').map((x) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))];

export default {
  name: 'second-brain',
  title: 'Second brain (Obsidian vault)',
  description: 'Markdown vault with a note contract, provenance rules, note templates and the scripts that keep them true',
  order: 70,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: true,
  questions: [
    { key: 'VAULT_PATH', type: 'text', path: true, message: 'Vault folder (created if missing; existing notes are never touched)', default: '~/second-brain' },
    { key: 'VAULT_PILLARS', type: 'text', message: 'Life areas, one folder each, comma-separated (an example set; edit it to match your life)', default: 'professional,personal,growth,health,finance' },
    { key: 'VAULT_RAW_DIR', type: 'text', path: true, message: 'Where raw source files live, OUTSIDE the vault (never copied in, never modified)', default: '~/raw-sources' },
    { key: 'VAULT_LANGS', type: 'text', message: 'Languages notes are written in, comma-separated codes', default: 'en' },
    { key: 'VAULT_SCRIPTS', type: 'confirm', message: 'Install the vault scripts (map generator, contract checker, ingestion driver, housekeeping pass)?', default: true },
    {
      key: 'VAULT_TOOLS',
      type: 'multi',
      message: 'Optional vault tools',
      default: [],
      choices: TOOLS,
      when: (ctx) => ctx.get('VAULT_SCRIPTS'),
    },
    {
      key: 'VAULT_TIMERS',
      type: 'multi',
      message: 'Run on a timer (systemd user timer on Linux and WSL, launchd on macOS, a to-do on Windows)',
      default: [],
      choices: [
        { value: 'housekeeping', label: `housekeeping - ${TIMERS.housekeeping.about}, every ${TIMERS.housekeeping.hours} hours (no model, no network)` },
        { value: 'garden', label: `garden - ${TIMERS.garden.about}, every ${TIMERS.garden.hours} hours (needs the garden tool and an agent command)` },
      ],
      when: (ctx) => ctx.get('VAULT_SCRIPTS'),
    },
    {
      key: 'VAULT_AGENT_CMD',
      type: 'text',
      message: 'Agent command for the scheduled garden pass: your agent CLI and its non-interactive flags; it reads the prompt on stdin (no default)',
      default: '',
      when: (ctx) => ctx.get('VAULT_SCRIPTS') && ctx.get('VAULT_TIMERS').includes('garden'),
    },
    { key: 'VAULT_GIT', type: 'confirm', message: 'Track the vault with git?', default: true },
    { key: 'VAULT_AGENT_ACCESS', type: 'confirm', message: 'Give agents access (obsidian-axi, OBSIDIAN_VAULT, a Claude Code session hook)?', default: true },
    { key: 'VAULT_APP', type: 'confirm', message: 'Install the Obsidian app?', default: false },
  ],

  async install(ctx) {
    const vault = ctx.get('VAULT_PATH');
    const pillars = list(ctx.get('VAULT_PILLARS'));
    const langs = list(ctx.get('VAULT_LANGS'));
    const rawDir = ctx.get('VAULT_RAW_DIR');
    const scripts = ctx.get('VAULT_SCRIPTS');
    if (!pillars.length || pillars.length > 9) throw new Error(`give 1 to 9 life areas, got ${pillars.length}`);
    const today = new Date().toISOString().slice(0, 10);
    const vars = {
      PILLAR_BULLETS: pillars.map((p) => `- \`${p}/\``).join('\n'),
      PILLAR_PROMPTS: pillars.map((p) => `- ${p}:`).join('\n'),
      PILLARS_INLINE: pillars.join('|'),
      ALL_PILLARS_LIST: pillars.join(', '),
      DEFAULT_PILLAR: pillars[0],
      LANGS: [...langs, 'mixed'].join('|'),
      DEFAULT_LANG: langs[0] || 'en',
      RAW_DIR: rawDir,
      TODAY: today,
    };
    const folders = [...pillars, ...Object.keys(ENTITY_FOLDERS)];

    await ctx.step('folders', () => {
      const created = [...folders, 'templates', 'prompts'].filter((f) => ctx.mkdir(path.join(vault, f)));
      if (created.length === 0) ctx.ok(`all ${folders.length + 2} folders exist in ${vault}`);
      else if (!ctx.dryRun) ctx.ok(`created ${created.length} folder(s) in ${vault}`);
    });

    await ctx.step('vault contract', async () => {
      await ctx.writeFile(path.join(vault, 'AGENTS.md'), ctx.template('second-brain/AGENTS.md', vars));
      await ctx.writeFile(path.join(vault, 'CLAUDE.md'), ctx.template('second-brain/CLAUDE.md', vars));
      await ctx.writeFile(path.join(vault, 'START-HERE.md'), ctx.template('second-brain/START-HERE.md', vars));
      await ctx.writeFile(path.join(vault, '.gitignore'), ctx.template('second-brain/gitignore', vars));
      await ctx.writeFile(path.join(vault, '.obsidian', 'templates.json'), `${JSON.stringify({ folder: 'templates' }, null, 2)}\n`);
    });

    // Every folder ships empty apart from a README that says what belongs in it, which also
    // keeps the folder present in a fresh clone.
    await ctx.step('folder readmes', async () => {
      for (const folder of folders) {
        const blurb = ENTITY_FOLDERS[folder]
          ?? `A life area. Topic notes about ${folder}, one note per topic. Rename or drop this folder if it is not one of yours.`;
        await ctx.writeFile(path.join(vault, folder, 'README.md'), ctx.template('second-brain/folder-readme.md', { ...vars, FOLDER: folder, BLURB: blurb }));
      }
    });

    await ctx.step('note templates', async () => {
      for (const type of NOTE_TYPES) {
        await ctx.writeFile(path.join(vault, 'templates', `${type}.md`), ctx.template(`second-brain/note-templates/${type}.md`, vars));
      }
    });

    if (scripts) {
      await ctx.step('vault scripts', async () => {
        for (const file of SCRIPTS) {
          await ctx.writeFile(path.join(vault, 'bin', file), ctx.template(`second-brain/bin/${file}`, vars), { mode: 0o755 });
        }
        await ctx.writeFile(path.join(vault, 'prompts', 'ingest.md'), ctx.template('second-brain/prompts/ingest.md', vars));
      });

      const tools = TOOLS.filter((t) => ctx.get('VAULT_TOOLS').includes(t.value));
      if (tools.length) {
        await ctx.step('vault tools', async () => {
          for (const t of tools) await ctx.writeFile(path.join(vault, 'bin', t.file), ctx.template(`second-brain/bin/${t.file}`, vars), { mode: 0o755 });
          if (tools.some((t) => t.value === 'garden')) await ctx.writeFile(path.join(vault, 'prompts', 'garden.md'), ctx.template('second-brain/prompts/garden.md', vars));
        });
      }
      if (ctx.get('VAULT_TOOLS').includes('garden') && !ctx.get('VAULT_GIT')) ctx.warn('garden needs the vault tracked with git; it refuses to run otherwise');

      // MAP.md is generated, never hand-written, so generate the first one here. An existing
      // one is left alone like every other existing file: it is the vault's, not ours.
      await ctx.step('initial map', () => {
        if (fs.existsSync(path.join(vault, 'MAP.md'))) return ctx.ok('MAP.md exists; regenerate it with bin/index.mjs');
        return ctx.run(`node "${path.join(vault, 'bin', 'index.mjs')}" "${vault}"`);
      });

      const timers = ctx.get('VAULT_TIMERS');
      if (timers.includes('housekeeping')) {
        await ctx.step('housekeeping timer', () => scheduleVaultJob(ctx, vault, 'housekeeping', path.join(vault, 'bin', 'housekeeping.mjs')));
      }
      if (timers.includes('garden')) {
        await ctx.step('garden timer', () => {
          if (!ctx.get('VAULT_TOOLS').includes('garden')) throw new Skip('pick the garden tool too');
          const env = agentEnv(ctx.get('VAULT_AGENT_CMD'));
          if (!env) throw new Skip('no agent command given (VAULT_AGENT_CMD); the garden pass needs one');
          return scheduleVaultJob(ctx, vault, 'garden', path.join(vault, 'bin', 'garden.mjs'), env);
        });
      }

      if (!timers.includes('housekeeping')) ctx.todo(`run \`node ${path.join(vault, 'bin', 'housekeeping.mjs')}\` on a timer every few hours (systemd --user, launchd, Task Scheduler or cron): it validates the vault and regenerates MAP.md, needs no credentials and makes no network calls`);
      ctx.todo(`set AGENT_CLI (and AGENT_CLI_ARGS) to the agent CLI that should read raw files, then drop files in ${rawDir} and run \`node ${path.join(vault, 'bin', 'ingest.mjs')} --dry-run\``);
    }

    await ctx.step('raw source folder', () => {
      if (!ctx.mkdir(rawDir)) return ctx.ok(`${rawDir} already exists`);
      if (!ctx.dryRun) ctx.ok(`created ${rawDir}; raw files live here, outside the vault, and are never modified`);
    });

    if (ctx.get('VAULT_GIT')) {
      await ctx.step('git', () => {
        if (fs.existsSync(path.join(vault, '.git'))) return ctx.ok('vault is already a git repository');
        ctx.run(`git init -b main "${vault}"`);
      });
    }

    if (ctx.get('VAULT_AGENT_ACCESS')) {
      // obsidian-axi resolves the vault from OBSIDIAN_VAULT, then defaultVault in ~/.config/obsidian-axi/config.json.
      await ctx.step('obsidian-axi', () => ctx.ensureTool({ name: 'obsidian-axi', install: { default: { npm: '@andershoffmann/obsidian-axi' } }, check: versionCheck('obsidian-axi') }));
      await ctx.step('defaultVault', () =>
        ctx.updateJson(path.join(ctx.home, '.config', 'obsidian-axi', 'config.json'), (cfg) => {
          cfg.defaultVault = vault;
        }, 'obsidian-axi defaultVault'),
      );
      await ctx.step('OBSIDIAN_VAULT', () => ctx.setUserEnv('OBSIDIAN_VAULT', vault));
      await ctx.step('VAULT_PATH', () => ctx.setUserEnv('VAULT_PATH', vault));
      await ctx.step('RAW_DIR', () => ctx.setUserEnv('RAW_DIR', rawDir));
      await ctx.step('Claude Code env', () => setClaudeEnv(ctx, 'OBSIDIAN_VAULT', vault));
      await ctx.step('Claude Code hook', () => addSessionStartHook(ctx, 'obsidian-axi'));
    }

    if (ctx.get('VAULT_APP')) {
      await ctx.step('Obsidian app', () => {
        if (ctx.os === 'linux') {
          if (!ctx.has('flatpak') && !ctx.platform.simulated) throw new Skip('flatpak is not installed; download Obsidian from https://obsidian.md/download');
          if (ctx.capture('flatpak info md.obsidian.Obsidian') !== null) return ctx.ok('Obsidian (flatpak) already installed');
          return ctx.run('flatpak install -y flathub md.obsidian.Obsidian');
        }
        if (ctx.os === 'wsl') return ctx.todo('install Obsidian on the Windows side: .\\install.ps1 --modules wsl offers it, or https://obsidian.md/download');
        ctx.todo('install Obsidian from https://obsidian.md/download');
      });
    }
    // Obsidian on Windows reaches a vault inside WSL through its \\wsl.localhost path.
    const shown = ctx.os === 'wsl' ? windowsPathOf(vault, process.env.WSL_DISTRO_NAME || 'Ubuntu') : vault;
    ctx.info(`open ${shown} in Obsidian with "Open folder as vault"; people start at ${path.join(vault, 'START-HERE.md')}, agents at ${path.join(vault, 'AGENTS.md')}`);
  },
};
