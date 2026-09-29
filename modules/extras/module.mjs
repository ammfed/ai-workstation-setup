import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { versionCheck } from '../agent-clis/tools.mjs';

// Optional desktop and document tools that sit next to an agent setup. Nothing is
// selected unless you pick it.
//   docling: docs "pip install docling" (github.com/docling-project/docling); installed
//     as an isolated CLI with uv or pipx when one is available.
//   OpenWhispr: docs quickstart downloads a release (github.com/OpenWhispr/openwhispr);
//     the same app is packaged as a Homebrew cask and a winget package.
//   llama.cpp: docs/install.md (github.com/ggml-org/llama.cpp): Homebrew or winget.
//   Lavish Library: README "Run it" (github.com/ammfed/lavish-library): clone, npm install,
//     then its web UI and its filesystem companion, run here as two user services.

const LAVISH_LIBRARY_REPO = 'https://github.com/ammfed/lavish-library';
const unitQuote = (s) => `"${String(s).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function lavishUnit(dir, { description, exec, extra = [], requires }) {
  return [
    '[Unit]',
    `Description=${description} (ai-workstation-setup extras)`,
    ...(requires ? [`Requires=${requires}`, `After=${requires}`] : []),
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${unitQuote(dir)}`,
    `Environment=${unitQuote(`PATH=${process.env.PATH}`)}`,
    'Environment=NODE_ENV=production',
    ...extra,
    `ExecStart=${exec}`,
    'Restart=on-failure',
    'RestartSec=3',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

async function installLavishLibrary(ctx) {
  const dir = ctx.get('LAVISH_LIBRARY_DIR');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Skip(`needs Node 22.13+ (running ${process.versions.node}); run \`nvm install --lts\` and re-run`);
  if (!ctx.dryRun && !ctx.has('lavish-axi')) throw new Skip('needs lavish-axi; pick it in agent-clis first');
  if (fs.existsSync(path.join(dir, '.git'))) ctx.ok(`${dir} is already a clone`);
  else if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} exists and is not a git clone; choose another LAVISH_LIBRARY_DIR`);
  else ctx.run(`git clone ${LAVISH_LIBRARY_REPO} "${dir}"`);
  if (!fs.existsSync(path.join(dir, 'node_modules')) || !fs.existsSync(path.join(dir, 'dist'))) ctx.run(`cd "${dir}" && npm install && npm run build`);
  else ctx.ok('dependencies installed and built (to update: git pull, npm install, npm run build)');

  if (ctx.os === 'macos') return ctx.todo(`start Lavish Library: cd "${dir}" && npm run start   (then open http://localhost:3000)`);
  if (ctx.platform.simulated) return ctx.info('would run the library UI and its companion as systemd user services when `systemctl --user` works');
  if (ctx.capture('systemctl --user show-environment') === null) {
    const hint = ctx.os === 'wsl' ? ' (in WSL, turn on systemd in /etc/wsl.conf)' : '';
    throw new Skip(`no systemd user session found${hint}; start it yourself: cd "${dir}" && npm run start`);
  }
  const units = path.join(ctx.home, '.config', 'systemd', 'user');
  const node = unitQuote(process.execPath);
  const api = await ctx.writeFile(
    path.join(units, 'lavish-library-api.service'),
    lavishUnit(dir, {
      description: 'Lavish Library filesystem companion (127.0.0.1:4318)',
      exec: `${node} ${unitQuote(path.join(dir, 'scripts', 'local-api.mjs'))}`,
      // Its Open button opens a browser tab, even where agents keep LAVISH_AXI_NO_OPEN set.
      extra: ['UnsetEnvironment=LAVISH_AXI_NO_OPEN'],
    }),
    { onConflict: 'ask' },
  );
  const ui = await ctx.writeFile(
    path.join(units, 'lavish-library.service'),
    lavishUnit(dir, {
      description: 'Lavish Library web UI (127.0.0.1:3000)',
      exec: `${node} ${unitQuote(path.join(dir, 'node_modules', '.bin', 'vinext'))} start -H 127.0.0.1 -p 3000`,
      requires: 'lavish-library-api.service',
    }),
    { onConflict: 'ask' },
  );
  const running = ctx.capture('systemctl --user is-active lavish-library.service') === 'active';
  if (api || ui || !running) ctx.run('systemctl --user daemon-reload && systemctl --user enable --now lavish-library-api.service lavish-library.service');
  else ctx.ok('lavish-library.service is enabled and running');
  ctx.info('Lavish Library: http://127.0.0.1:3000');
}

const EXTRAS = [
  {
    value: 'docling',
    label: 'docling - turns PDFs, Word, PowerPoint and HTML files into clean markdown agents can read',
    async install(ctx) {
      return ctx.ensureTool({
        name: 'docling',
        install: {
          default: (c) => {
            if (c.dryRun && c.platform.simulated) return c.run('uv tool install docling   (or pipx install docling)');
            if (c.has('uv')) return c.run('uv tool install docling');
            if (c.has('pipx')) return c.run('pipx install docling');
            throw new Skip('needs uv or pipx for an isolated install; or run `pip install docling` yourself');
          },
        },
        pathHints: ['~/.local/bin'],
        // The first run after install compiles docling's whole dependency tree: about 19s cold, 8.5s warm.
        check: { ...versionCheck('docling'), timeoutMs: 180_000 },
      });
    },
  },
  {
    value: 'openwhispr',
    label: 'openwhispr - desktop voice dictation: speak, and the text appears where your cursor is',
    // No check: see the list next to versionCheck in modules/agent-clis/tools.mjs.
    async install(ctx) {
      if (ctx.os === 'wsl') throw new Skip('a desktop app; install it on the Windows side (winget install --id OpenWhispr.OpenWhispr -e)');
      if (ctx.os === 'macos') {
        if (fs.existsSync('/Applications/OpenWhispr.app')) return ctx.ok('OpenWhispr already installed');
        if (!ctx.dryRun && !ctx.has('brew')) throw new Skip('needs Homebrew; or download it from https://github.com/OpenWhispr/openwhispr/releases/latest');
        ctx.run('brew install --cask openwhispr');
      } else if (ctx.os === 'windows') {
        if ((ctx.capture('winget list --id OpenWhispr.OpenWhispr -e') || '').includes('OpenWhispr')) return ctx.ok('OpenWhispr already installed');
        ctx.run('winget install --id OpenWhispr.OpenWhispr -e --accept-source-agreements --accept-package-agreements');
      } else {
        if (ctx.has('openwhispr')) return ctx.ok('OpenWhispr already installed');
        ctx.todo('install OpenWhispr from https://github.com/OpenWhispr/openwhispr/releases/latest (.deb, .rpm or .AppImage)');
        return;
      }
      ctx.todo('open OpenWhispr once: pick cloud, your own key, or a local model, and allow the microphone');
    },
  },
  {
    value: 'llama-cpp',
    label: 'llama-cpp - run open models locally (llama-cli, llama-server); Homebrew on macOS and Linux, winget on Windows',
    // github.com/ggml-org/llama.cpp docs/install.md: Homebrew (macOS, Linux), winget (Windows).
    install(ctx) {
      return ctx.ensureTool({
        name: 'llama.cpp',
        bin: 'llama-cli',
        install: {
          windows: 'winget install llama.cpp --accept-source-agreements --accept-package-agreements',
          default: (c) => {
            if (!c.dryRun && !c.has('brew')) throw new Skip('needs Homebrew (brew.sh); or take a prebuilt release from https://github.com/ggml-org/llama.cpp/releases');
            c.run('brew install llama.cpp');
          },
        },
        check: { about: 'reports its version', cmd: 'llama-cli --version', expect: /version: \S+/ },
      });
    },
  },
  {
    value: 'lavish-library',
    label: 'lavish-library - a local library to find and reopen every Lavish review page, on 127.0.0.1:3000 (Linux, macOS)',
    install(ctx) {
      if (ctx.os === 'windows') throw new Skip('runs on Linux and macOS; install it inside WSL');
      return installLavishLibrary(ctx);
    },
  },
];

export default {
  name: 'extras',
  title: 'Extra tools',
  description: 'Optional: docling document converter, OpenWhispr voice dictation, llama.cpp local models, Lavish Library',
  order: 90,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: false,
  questions: [
    {
      key: 'EXTRAS',
      type: 'multi',
      message: 'Extra tools to install',
      default: [],
      choices: EXTRAS,
    },
    {
      key: 'LAVISH_LIBRARY_DIR',
      type: 'text',
      path: true,
      message: 'Where to clone Lavish Library',
      default: '~/apps/lavish-library',
      when: (ctx) => ctx.get('EXTRAS').includes('lavish-library'),
    },
  ],

  async install(ctx) {
    const chosen = EXTRAS.filter((e) => ctx.get('EXTRAS').includes(e.value));
    if (!chosen.length) throw new Skip('no extras selected');
    for (const e of chosen) await ctx.step(e.value, () => e.install(ctx));
  },
};
