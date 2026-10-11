import fs from 'node:fs';
import path from 'node:path';
import { Skip, which } from '../../lib/context.mjs';
import { addSessionStartHook, claudeDir } from '../../lib/claude.mjs';
import { TOOLS, warnPathOrder } from './tools.mjs';
import { mergePixelSettings, patchPixelAgents } from './pixel-agents.mjs';

const DEFAULTS = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'tasks-axi', 'quota-axi', 'ctx7', 'no-mistakes', 'treehouse'];

// `cswap auto` (github.com/realiti4/claude-swap, `cswap auto --help`) is a foreground loop that
// switches to another saved account when the active one nears its 5-hour or weekly limit.
// Run here as a user service; it names no account, cswap keeps its own list.
const CSWAP_UNIT = 'cswap-auto';
const CSWAP_LABEL = 'local.ai-workstation-setup.cswap-auto';
const unitQuote = (s) => `"${String(s).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Empty means cswap's own default threshold (no --threshold flag).
export function cswapThreshold(text) {
  if (String(text ?? '').trim() === '') return null;
  const pct = Number(String(text ?? '').trim());
  if (!Number.isFinite(pct) || pct < 50 || pct > 99.9) throw new Error(`CSWAP_AUTO_THRESHOLD: "${text}" should be a percentage from 50 to 99.9`);
  return pct;
}

export function researchBrowserPort(text) {
  const port = Number(String(text ?? '').trim());
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`RESEARCH_BROWSER_PORT: "${text}" should be a port from 1024 to 65535`);
  return port;
}

async function cswapAutoService(ctx) {
  const pct = cswapThreshold(ctx.get('CSWAP_AUTO_THRESHOLD'));
  const args = pct === null ? ['auto'] : ['auto', '--threshold', String(pct)];
  const cmd = `cswap ${args.join(' ')}`;
  if (ctx.os === 'windows') throw new Skip(`no user service on Windows; keep \`${cmd}\` running in a terminal, or use it inside WSL`);
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
  <array>${[bin, ...args].map((a) => `<string>${xml(a)}</string>`).join('')}</array>
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
    ctx.info(`would run \`${cmd}\` as the systemd user service ${CSWAP_UNIT}.service when \`systemctl --user\` works`);
    return;
  }
  if (ctx.capture('systemctl --user show-environment') === null) {
    const hint = ctx.os === 'wsl' ? ' (in WSL, turn on systemd in /etc/wsl.conf)' : '';
    throw new Skip(`no systemd user session found${hint}; keep \`${cmd}\` running yourself`);
  }
  const unit = [
    '[Unit]',
    'Description=Switch Claude Code accounts near a usage limit (ai-workstation-setup agent-clis)',
    '',
    '[Service]',
    `ExecStart=${unitQuote(bin)} ${args.join(' ')}`,
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

// Inside WSL the browser tools drive a Linux Chrome shown through WSLg: everything stays on
// 127.0.0.1 inside Linux, with no debugging port opened across to Windows. The steps are
// Microsoft's (learn.microsoft.com/windows/wsl/tutorials/gui-apps): Google's own .deb with apt.
function linuxChrome(ctx) {
  const found = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((b) => ctx.has(b));
  if (found) return ctx.ok(`${found} is installed`);
  if (ctx.platform.pkg !== 'apt' || process.arch !== 'x64') {
    throw new Skip('Google ships Chrome for Linux as an x86-64 .deb only; install Chrome or Chromium with your package manager');
  }
  const deb = '/tmp/google-chrome-stable_current_amd64.deb';
  ctx.run(`curl -fsSL -o ${deb} https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && ${ctx.sudo()}env DEBIAN_FRONTEND=noninteractive apt-get install -y ${deb}; s=$?; rm -f ${deb}; exit $s`);
  if (ctx.platform.wslVersion === 1) ctx.warn('WSL 1 shows no Linux windows: Chrome runs headless only; WSL 2 shows it through WSLg');
}

function nodeAtLeast([major, minor]) {
  const [m, n] = process.versions.node.split('.').map(Number);
  return m > major || (m === major && n >= minor);
}

// The model no-mistakes reviews with when it runs Claude (docs/model-map.md). Its global
// config takes one model per harness for every repository; it is re-read at each run.
export const NO_MISTAKES_REVIEW = 'claude-opus-5-5 medium';
const REVIEW_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** "<model> [effort]" -> { model, effort? }; empty or "keep" -> null (leave the config alone). */
export function parseReviewModel(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || (words.length === 1 && words[0] === 'keep')) return null;
  if (words.length > 2 || (words[1] && !REVIEW_EFFORTS.includes(words[1]))) {
    throw new Error(`NO_MISTAKES_REVIEW_MODEL: "${text}" should look like "<model> [effort]", with effort one of ${REVIEW_EFFORTS.join(', ')}`);
  }
  return words[1] ? { model: words[0], effort: words[1] } : { model: words[0] };
}

export function noMistakesConfigPath(ctx) {
  return path.join(process.env.NM_HOME || path.join(ctx.home, '.no-mistakes'), 'config.yaml');
}

/**
 * The no-mistakes config text with agent_config.claude set to `pin`, or null when it already
 * has a claude entry (yours is kept) or an agent_config written inline, which this
 * line-based edit does not rewrite. Everything else in the file stays as it was.
 */
export function withClaudeReviewModel(text, pin) {
  const scalar = (v) => (/^[A-Za-z0-9._/-]+$/.test(v) ? v : JSON.stringify(v));
  const entry = (ind) => [`${ind}claude:`, `${ind}${ind}model: ${scalar(pin.model)}`, ...(pin.effort ? [`${ind}${ind}effort: ${pin.effort}`] : [])];
  const lines = String(text ?? '').split('\n');
  const at = lines.findIndex((l) => /^agent_config\s*:/.test(l));
  if (at === -1) {
    const body = String(text ?? '').replace(/\n*$/, '');
    return `${body}${body ? '\n\n' : ''}agent_config:\n${entry('  ').join('\n')}\n`;
  }
  if (lines[at].replace(/^agent_config\s*:/, '').replace(/#.*/, '').trim()) return null;
  let ind = '';
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const m = l.match(/^(\s+)\S/);
    if (!m) break;
    ind ||= m[1];
    if (l.startsWith(ind) && /^["']?claude["']?\s*:/.test(l.slice(ind.length))) return null;
  }
  lines.splice(at + 1, 0, ...entry(ind || '  '));
  return lines.join('\n');
}

async function pinReviewModel(ctx, pin) {
  const file = noMistakesConfigPath(ctx);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = withClaudeReviewModel(current, pin);
  if (next === null) return ctx.ok(`${file} already sets agent_config for claude (or sets agent_config inline); left untouched`);
  await ctx.writeFile(file, next, { onConflict: 'replace' });
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
      key: 'NO_MISTAKES_REVIEW_MODEL',
      type: 'text',
      message: 'Model and effort no-mistakes reviews with when it runs Claude, in every repository (agent_config in its config; empty or "keep" leaves it alone)',
      default: NO_MISTAKES_REVIEW,
      when: (ctx) => ctx.get('AGENT_CLIS').includes('no-mistakes'),
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
      key: 'HERDR_SETTINGS',
      type: 'confirm',
      message: 'Write starter herdr settings (Tokyo Night theme, agents grouped by space with state symbols and names on pane borders, desktop notifications)? An existing herdr config is kept',
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
      key: 'LAVISH_NO_OPEN_WRAPPER',
      type: 'confirm',
      message: 'Also put a small lavish-axi wrapper in ~/.local/bin that always sets LAVISH_AXI_NO_OPEN, for launches that do not read your shell profile?',
      default: false,
      when: (ctx) => ctx.os !== 'windows' && ctx.get('AGENT_CLIS').includes('lavish-axi') && ctx.get('LAVISH_NO_OPEN'),
    },
    {
      key: 'PIXEL_AGENTS_SETTINGS',
      type: 'confirm',
      message: 'Pixel Agents view settings: names always shown, every session watched, areas on, sound off (values you already set are kept)?',
      default: true,
      when: (ctx) => ctx.get('AGENT_CLIS').includes('pixel-agents'),
    },
    {
      key: 'PIXEL_AGENTS_NAMES',
      type: 'confirm',
      message: 'Name office characters after their herdr agent or tab instead of their folder? Patches the installed pixel-agents (known versions only, a backup kept) and adds pixel-office-names',
      default: false,
      when: (ctx) => ctx.os !== 'windows' && ctx.get('AGENT_CLIS').includes('pixel-agents'),
    },
    {
      key: 'PIXEL_AGENTS_TAB_PREFIX',
      type: 'text',
      message: 'Prefix to drop from herdr tab labels in office names (Firstmate names task tabs "fm-<task>"; empty for none)',
      default: 'fm-',
      when: (ctx) => ctx.get('AGENT_CLIS').includes('pixel-agents') && ctx.get('PIXEL_AGENTS_NAMES'),
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
      message: "Switch when the active account reaches what percentage of its 5-hour or weekly limit (50 to 99.9; empty for cswap's own default)",
      default: '90',
      when: (ctx) => ctx.get('AGENT_CLIS').includes('claude-swap') && ctx.get('CSWAP_AUTO'),
    },
    {
      key: 'WSL_LINUX_CHROME',
      type: 'confirm',
      message: 'Inside WSL: install Google Chrome for Linux, so chrome-devtools-axi and research-browser have a browser (it opens as a window through WSLg)?',
      default: true,
      when: (ctx) => ctx.os === 'wsl' && ctx.get('AGENT_CLIS').includes('chrome-devtools-axi'),
    },
    {
      key: 'RESEARCH_BROWSER',
      type: 'confirm',
      message: "Install `research-browser`: a visible Chrome window with its own profile for agent research, separate from your browser?",
      default: true,
      when: (ctx) => ctx.os !== 'windows' && ctx.get('AGENT_CLIS').includes('chrome-devtools-axi'),
    },
    {
      key: 'RESEARCH_BROWSER_PORT',
      type: 'text',
      message: 'Remote-debugging port for research-browser (agents and voice mode reach it at http://127.0.0.1:<port>)',
      default: '9333',
      when: (ctx) => ctx.os !== 'windows' && ctx.get('AGENT_CLIS').includes('chrome-devtools-axi') && ctx.get('RESEARCH_BROWSER'),
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

    if (chosen.includes('herdr') && ctx.get('HERDR_SETTINGS')) {
      // herdr reads ~/.config/herdr/config.toml (Windows: %APPDATA%\herdr\config.toml), per its configuration docs.
      await ctx.step('herdr settings', async () => {
        const dir = ctx.os === 'windows' ? path.join(process.env.APPDATA || path.join(ctx.home, 'AppData', 'Roaming'), 'herdr') : path.join(ctx.home, '.config', 'herdr');
        const file = path.join(dir, 'config.toml');
        if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== ctx.template('herdr/config.toml')) {
          return ctx.ok(`${file} exists; your herdr settings are kept (the starter values are in templates/herdr/config.toml)`);
        }
        if ((await ctx.writeFile(file, ctx.template('herdr/config.toml'))) && ctx.has('herdr')) ctx.run('herdr config check');
      });
    }

    if (chosen.includes('lavish-axi') && ctx.get('LAVISH_NO_OPEN')) {
      await ctx.step('LAVISH_AXI_NO_OPEN', () => ctx.setUserEnv('LAVISH_AXI_NO_OPEN', '1'));
      if (ctx.os !== 'windows' && ctx.get('LAVISH_NO_OPEN_WRAPPER')) {
        await ctx.step('lavish-axi no-open wrapper', async () => {
          const target = ctx.path('~/.local/bin/lavish-axi');
          await ctx.writeFile(target, ctx.template('lavish/lavish-axi.sh'), { onConflict: 'ask', mode: 0o755 });
          warnPathOrder(ctx, target, 'lavish-axi');
        });
      }
    }

    if (chosen.includes('pixel-agents')) {
      if (ctx.get('PIXEL_AGENTS_SETTINGS')) {
        await ctx.step('pixel-agents settings', () => ctx.updateJson('~/.pixel-agents/config.json', mergePixelSettings, 'Pixel Agents view settings'));
      }
      if (ctx.os !== 'windows' && ctx.get('PIXEL_AGENTS_NAMES')) {
        await ctx.step('pixel-agents office names', () => patchPixelAgents(ctx));
        await ctx.step('pixel-office-names', () => {
          const prefix = String(ctx.get('PIXEL_AGENTS_TAB_PREFIX') ?? '').trim();
          if (!/^[\w.-]*$/.test(prefix)) throw new Error('PIXEL_AGENTS_TAB_PREFIX may hold only letters, digits, dot, dash and underscore');
          return ctx.writeFile('~/.local/bin/pixel-office-names', ctx.template('pixel-agents/bin/pixel-office-names.mjs', { TAB_PREFIX: prefix }), {
            onConflict: 'ask',
            mode: 0o755,
          });
        });
        ctx.info('office names: run `pixel-office-names --watch` next to Pixel Agents (it needs herdr); see docs/pixel-agents.md');
      }
      ctx.info('start Pixel Agents with `pixel-agents` and open the address it prints; see docs/pixel-agents.md');
    }

    if (chosen.includes('claude-swap') && ctx.get('CSWAP_AUTO')) {
      await ctx.step('cswap auto service', () => cswapAutoService(ctx));
      ctx.info('cswap auto switches only between accounts you saved with `cswap add`; it needs two or more');
    }

    if (chosen.includes('chrome-devtools-axi') && ctx.get('WSL_LINUX_CHROME')) {
      await ctx.step('Google Chrome for Linux', () => linuxChrome(ctx));
    }

    if (chosen.includes('chrome-devtools-axi') && ctx.get('RESEARCH_BROWSER')) {
      await ctx.step('research-browser', async () => {
        const target = ctx.path('~/.local/bin/research-browser');
        const port = researchBrowserPort(ctx.get('RESEARCH_BROWSER_PORT'));
        const written = await ctx.writeFile(target, ctx.template('research-browser/research-browser.sh', { PORT: port }), { onConflict: 'ask', mode: 0o755 });
        await ctx.addUserPath(path.dirname(target));
        if (written) ctx.todo('research-browser   (opens its window; sign in there to the sites your agents research)');
      });
    }

    if (chosen.includes('gh-axi') && !ctx.has('gh')) ctx.info('gh-axi needs the GitHub CLI signed in (core module)');
    if (chosen.includes('no-mistakes')) {
      const pin = parseReviewModel(ctx.get('NO_MISTAKES_REVIEW_MODEL'));
      if (pin) await ctx.step('no-mistakes review model', () => pinReviewModel(ctx, pin));
      ctx.info('per repository: `no-mistakes init` (also installs its /no-mistakes skill)');
    }
  },
};
