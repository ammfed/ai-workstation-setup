import fs from 'node:fs';
import path from 'node:path';
import { Skip, which } from '../../lib/context.mjs';
import { addSessionStartHook, claudeDir } from '../../lib/claude.mjs';
import { TOOLS } from './tools.mjs';

const DEFAULTS = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'tasks-axi', 'quota-axi', 'ctx7', 'no-mistakes', 'treehouse'];

// `cswap auto` (github.com/realiti4/claude-swap, `cswap auto --help`) is a foreground loop that
// switches to another saved account when the active one nears its 5-hour or weekly limit.
// Run here as a user service; it names no account, cswap keeps its own list.
const CSWAP_UNIT = 'cswap-auto';
const CSWAP_LABEL = 'local.ai-workstation-setup.cswap-auto';
const unitQuote = (s) => `"${String(s).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function cswapThreshold(text) {
  const pct = Number(String(text ?? '').trim());
  if (!Number.isFinite(pct) || pct < 50 || pct > 99.9) throw new Error(`CSWAP_AUTO_THRESHOLD: "${text}" should be a percentage from 50 to 99.9`);
  return pct;
}

async function cswapAutoService(ctx) {
  const pct = cswapThreshold(ctx.get('CSWAP_AUTO_THRESHOLD'));
  if (ctx.os === 'windows') throw new Skip(`no user service on Windows; keep \`cswap auto --threshold ${pct}\` running in a terminal, or use it inside WSL`);
  const bin = (!ctx.platform.simulated && which('cswap')) || ctx.path('~/.local/bin/cswap');
  if (ctx.os === 'macos') {
    const plist = path.join(ctx.home, 'Library', 'LaunchAgents', `${CSWAP_LABEL}.plist`);
    const logFile = path.join(ctx.home, 'Library', 'Logs', 'ai-workstation-setup-cswap-auto.log');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${CSWAP_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(bin)}</string><string>auto</string><string>--threshold</string><string>${pct}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`;
    if (await ctx.writeFile(plist, content, { onConflict: 'ask' })) {
      ctx.run(`launchctl bootout gui/$(id -u)/${CSWAP_LABEL} 2>/dev/null; launchctl bootstrap gui/$(id -u) "${plist}"`);
    }
    ctx.info(`logs: ${logFile}; stop it with: launchctl bootout gui/$(id -u)/${CSWAP_LABEL} (and delete ${plist})`);
    return;
  }
  if (ctx.platform.simulated) {
    ctx.info(`would run \`cswap auto --threshold ${pct}\` as the systemd user service ${CSWAP_UNIT}.service when \`systemctl --user\` works`);
    return;
  }
  if (ctx.capture('systemctl --user show-environment') === null) {
    const hint = ctx.os === 'wsl' ? ' (in WSL, turn on systemd in /etc/wsl.conf)' : '';
    throw new Skip(`no systemd user session found${hint}; keep \`cswap auto --threshold ${pct}\` running yourself`);
  }
  const unit = [
    '[Unit]',
    'Description=Switch Claude Code accounts near a usage limit (ai-workstation-setup agent-clis)',
    '',
    '[Service]',
    `ExecStart=${unitQuote(bin)} auto --threshold ${pct}`,
    'Restart=always',
    'RestartSec=30',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
  const wrote = await ctx.writeFile(path.join(ctx.home, '.config', 'systemd', 'user', `${CSWAP_UNIT}.service`), unit, { onConflict: 'ask' });
  const active = ctx.capture(`systemctl --user is-active ${CSWAP_UNIT}.service`) === 'active';
  if (wrote || !active) ctx.run(`systemctl --user daemon-reload && systemctl --user enable ${CSWAP_UNIT}.service && systemctl --user restart ${CSWAP_UNIT}.service`);
  else ctx.ok(`${CSWAP_UNIT}.service is enabled and running`);
  ctx.info(`logs: journalctl --user -u ${CSWAP_UNIT}; stop it with: systemctl --user disable --now ${CSWAP_UNIT}.service`);
}

function nodeAtLeast([major, minor]) {
  const [m, n] = process.versions.node.split('.').map(Number);
  return m > major || (m === major && n >= minor);
}

export default {
  name: 'agent-clis',
  title: 'Agent CLIs',
  description: 'Agent-ergonomic CLIs (gh-axi, chrome-devtools-axi, ctx7, no-mistakes, treehouse, ...)',
  order: 30,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: true,
  questions: [
    {
      key: 'AGENT_CLIS',
      type: 'multi',
      message: 'CLIs to install',
      default: DEFAULTS,
      choices: Object.entries(TOOLS).map(([value, t]) => ({ value, label: `${value.padEnd(20)} ${t.about}` })),
    },
    {
      key: 'AXI_HOOKS',
      type: 'choice',
      message: 'Session-start hooks for gh-axi, chrome-devtools-axi and lavish-axi',
      default: 'claude',
      choices: [
        { value: 'claude', label: 'claude - one SessionStart hook per tool in Claude Code only' },
        { value: 'upstream', label: 'upstream - each tool\'s own `setup hooks` (writes to every agent it detects, including Codex)' },
        { value: 'none', label: 'none' },
      ],
      when: (ctx) => ctx.get('AGENT_CLIS').some((t) => TOOLS[t].hook),
    },
    {
      key: 'CTX7_SETUP',
      type: 'confirm',
      message: 'Run `ctx7 setup --claude --cli` now (browser sign-in; installs the find-docs skill and a docs rule)?',
      default: true,
      when: (ctx) => ctx.interactive && ctx.get('AGENT_CLIS').includes('ctx7'),
    },
    {
      key: 'HERDR_CLAUDE_INTEGRATION',
      type: 'confirm',
      message: 'Install herdr\'s Claude Code integration (lets herdr show agent state)?',
      default: true,
      when: (ctx) => ctx.get('AGENT_CLIS').includes('herdr'),
    },
    {
      key: 'LAVISH_NO_OPEN',
      type: 'confirm',
      message: 'Stop lavish-axi opening a browser tab on every page open (sets LAVISH_AXI_NO_OPEN=1; links are shared in chat)?',
      default: true,
      when: (ctx) => ctx.get('AGENT_CLIS').includes('lavish-axi'),
    },
    {
      key: 'CSWAP_AUTO',
      type: 'confirm',
      message: 'Run `cswap auto` as a background service, so Claude Code switches to another saved account when the active one nears its limit?',
      default: false,
      when: (ctx) => ctx.get('AGENT_CLIS').includes('claude-swap'),
    },
    {
      key: 'CSWAP_AUTO_THRESHOLD',
      type: 'text',
      message: 'Switch when the active account reaches what percentage of its 5-hour or weekly limit (50 to 99.9)',
      default: '90',
      when: (ctx) => ctx.get('AGENT_CLIS').includes('claude-swap') && ctx.get('CSWAP_AUTO'),
    },
    {
      key: 'RESEARCH_BROWSER',
      type: 'confirm',
      message: "Install `research-browser`: a visible Chrome window with its own profile for agent research, separate from your browser?",
      default: true,
      when: (ctx) => ctx.os !== 'windows' && ctx.get('AGENT_CLIS').includes('chrome-devtools-axi'),
    },
  ],

  async install(ctx) {
    const chosen = ctx.get('AGENT_CLIS');
    for (const key of chosen) {
      const tool = TOOLS[key];
      const state = await ctx.step(key, () => {
        if (tool.minNode && !nodeAtLeast(tool.minNode)) {
          throw new Skip(`needs Node ${tool.minNode.join('.')}+ (running ${process.versions.node}); run \`nvm install --lts\` and re-run`);
        }
        return ctx.ensureTool(tool);
      });
      if (state === 'installed' && tool.signIn) ctx.todo(tool.signIn);
    }

    const hookTools = chosen.filter((t) => TOOLS[t].hook);
    const hooks = ctx.get('AXI_HOOKS');
    for (const t of hookTools) {
      if (hooks === 'claude') await ctx.step(`${t} hook`, () => addSessionStartHook(ctx, t));
      if (hooks === 'upstream') await ctx.step(`${t} hook`, () => ctx.run(`${t} setup hooks`));
    }

    if (chosen.includes('ctx7')) {
      await ctx.step('ctx7 setup', () => {
        if (fs.existsSync(path.join(claudeDir(ctx), 'skills', 'find-docs'))) return ctx.ok('Context7 is already set up for Claude Code');
        if (ctx.get('CTX7_SETUP')) ctx.run('ctx7 setup --claude --cli -y');
        else ctx.todo('ctx7 setup --claude --cli   (signs in with your browser)');
      });
    }

    if (chosen.includes('herdr') && ctx.get('HERDR_CLAUDE_INTEGRATION')) {
      // herdr manages this hook file itself; reinstalling just refreshes it.
      await ctx.step('herdr integration', () => ctx.run('herdr integration install claude'));
    }

    if (chosen.includes('lavish-axi') && ctx.get('LAVISH_NO_OPEN')) {
      await ctx.step('LAVISH_AXI_NO_OPEN', () => ctx.setUserEnv('LAVISH_AXI_NO_OPEN', '1'));
    }

    if (chosen.includes('claude-swap') && ctx.get('CSWAP_AUTO')) {
      await ctx.step('cswap auto service', () => cswapAutoService(ctx));
      ctx.info('cswap auto switches only between accounts you saved with `cswap add`; it needs two or more');
    }

    if (chosen.includes('chrome-devtools-axi') && ctx.get('RESEARCH_BROWSER')) {
      await ctx.step('research-browser', async () => {
        const target = ctx.path('~/.local/bin/research-browser');
        const written = await ctx.writeFile(target, ctx.template('research-browser/research-browser.sh'), { onConflict: 'ask', mode: 0o755 });
        const onPath = (process.env.PATH || '').split(path.delimiter).includes(path.dirname(target));
        if (!onPath && !ctx.platform.simulated) ctx.warn(`${path.dirname(target)} is not on PATH; add it to use research-browser`);
        if (written) ctx.todo('research-browser   (opens its window; sign in there to the sites your agents research)');
      });
    }

    if (chosen.includes('gh-axi') && !ctx.has('gh')) ctx.info('gh-axi needs the GitHub CLI signed in (core module)');
    if (chosen.includes('no-mistakes')) ctx.info('per repository: `no-mistakes init` (also installs its /no-mistakes skill)');
  },
};
