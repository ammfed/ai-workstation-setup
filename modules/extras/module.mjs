import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { versionCheck, warnPathOrder } from '../agent-clis/tools.mjs';

// Optional desktop and document tools that sit next to an agent setup. Nothing is
// selected unless you pick it.
//   docling: docs "pip install docling" (github.com/docling-project/docling); installed
//     as an isolated CLI with uv or pipx when one is available.
//   OpenWhispr: docs quickstart downloads a release (github.com/OpenWhispr/openwhispr);
//     the same app is packaged as a Homebrew cask and a winget package.
//   llama.cpp: docs/install.md (github.com/ggml-org/llama.cpp): Homebrew or winget.
//   Lavish Library: README "Run it" (github.com/ammfed/lavish-library): clone, npm install,
//     then its web UI and its filesystem companion, run here as two user services.
//   open-guard and fontcache-guard: small Linux desktop fixes written here, no third-party code.

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
  const prefix = ctx.capture('npm prefix -g');
  const lavishBin = prefix && fs.existsSync(path.join(prefix, 'bin', 'lavish-axi')) ? path.join(prefix, 'bin', 'lavish-axi') : null;
  const api = await ctx.writeFile(
    path.join(units, 'lavish-library-api.service'),
    lavishUnit(dir, {
      description: 'Lavish Library filesystem companion (127.0.0.1:4318)',
      exec: `${node} ${unitQuote(path.join(dir, 'scripts', 'local-api.mjs'))}`,
      // Its Open button opens a browser tab, even where agents keep LAVISH_AXI_NO_OPEN set. It
      // also calls lavish-axi by its npm path, so a no-open wrapper earlier on PATH is skipped.
      extra: [...(lavishBin ? [`Environment=${unitQuote(`LAVISH_AXI_BIN=${lavishBin}`)}`] : []), 'UnsetEnvironment=LAVISH_AXI_NO_OPEN'],
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

// Linux user-service check shared by the guards: real systemd, or a reasoned skip.
function needSystemd(ctx, what) {
  if (ctx.capture('systemctl --user show-environment') === null) {
    const hint = ctx.os === 'wsl' ? ' (in WSL, turn on systemd in /etc/wsl.conf)' : '';
    throw new Skip(`no systemd user session found${hint}; ${what}`);
  }
}

// Chrome ships its own, newer fontconfig. On some distributions it leaves links named
// "*-le64.cache-9" in the user font cache that the system fontconfig then misreads, and
// fonts go missing or turn to boxes in other apps. A path unit watches the cache and a
// one-shot service removes those links and rebuilds the cache.
const FONTCACHE_PATH = `[Unit]
Description=Watch the user font cache for links left by Chrome's bundled fontconfig (ai-workstation-setup extras)

[Path]
PathChanged=%h/.cache/fontconfig
Unit=fontcache-guard.service
TriggerLimitIntervalSec=0

[Install]
WantedBy=default.target
`;
const FONTCACHE_SERVICE = `[Unit]
Description=Remove font cache links left by Chrome's bundled fontconfig and rebuild the cache (ai-workstation-setup extras)
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'sleep 3; n=$$(find "%h/.cache/fontconfig" -maxdepth 1 -type l -name "*-le64.cache-9" -print -delete 2>/dev/null | wc -l); if [ "$$n" -gt 0 ]; then fc-cache >/dev/null 2>&1; echo "fontcache-guard: removed $$n links and rebuilt the font cache"; fi'
`;

async function installFontcacheGuard(ctx) {
  if (ctx.os !== 'linux') throw new Skip('a Linux desktop fix; not needed here');
  if (ctx.platform.simulated) return ctx.info('would add fontcache-guard.path and fontcache-guard.service as systemd user units');
  if (!ctx.has('fc-cache')) throw new Skip('fc-cache (fontconfig) is not installed');
  needSystemd(ctx, 'the guard runs as a user service');
  const units = path.join(ctx.home, '.config', 'systemd', 'user');
  const a = await ctx.writeFile(path.join(units, 'fontcache-guard.path'), FONTCACHE_PATH, { onConflict: 'ask' });
  const b = await ctx.writeFile(path.join(units, 'fontcache-guard.service'), FONTCACHE_SERVICE, { onConflict: 'ask' });
  const active = ctx.capture('systemctl --user is-active fontcache-guard.path') === 'active';
  if (a || b || !active) ctx.run('systemctl --user daemon-reload && systemctl --user enable --now fontcache-guard.path');
  else ctx.ok('fontcache-guard.path is enabled and watching');
  ctx.info('logs: journalctl --user -u fontcache-guard; stop it with: systemctl --user disable --now fontcache-guard.path');
}

/** An OpenWhispr AppImage in ~/.local/opt or ~/Applications, the usual homes for one; null when there is none. */
export function findOpenWhisprAppImage(home) {
  for (const dir of [path.join(home, '.local', 'opt'), path.join(home, 'Applications')]) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const hit = names.find((n) => /^open-?whispr.*\.appimage$/i.test(n));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

export function openGuardSeconds(text) {
  const n = Number(String(text ?? '').trim());
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error(`OPEN_GUARD_SECONDS: "${text}" should be a whole number of seconds from 1 to 60`);
  return n;
}

async function installOpenGuard(ctx) {
  if (ctx.os !== 'linux') throw new Skip('wraps the Linux desktop xdg-open; not needed here');
  const seconds = openGuardSeconds(ctx.get('OPEN_GUARD_SECONDS'));
  const target = ctx.path('~/.local/bin/xdg-open');
  await ctx.writeFile(target, ctx.template('desktop/xdg-open.sh', { WINDOW_SECONDS: seconds }), { onConflict: 'ask', mode: 0o755 });
  warnPathOrder(ctx, target, 'xdg-open');
  ctx.info('repeats it dropped are logged in ~/.local/state/xdg-open-guard.log; delete ~/.local/bin/xdg-open to remove it');
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
        const appImage = !ctx.platform.simulated && findOpenWhisprAppImage(ctx.home);
        if (appImage) return ctx.ok(`OpenWhispr already installed (${appImage})`);
        ctx.todo('install OpenWhispr from https://github.com/OpenWhispr/openwhispr/releases/latest (.deb, .rpm, or an .AppImage kept in ~/.local/opt or ~/Applications so a rerun finds it); then turn on its launch-at-login setting if you want it ready at login (it starts hidden in the tray)');
        return;
      }
      ctx.todo('open OpenWhispr once: pick cloud, your own key, or a local model, and allow the microphone; to have it ready at login, turn on its launch-at-login setting (it starts hidden in the tray)');
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
    value: 'open-guard',
    label: 'open-guard - Linux: opens the same link at most once every few seconds, so one click never becomes a pile of duplicate tabs',
    install: installOpenGuard,
  },
  {
    value: 'fontcache-guard',
    label: "fontcache-guard - Linux: repairs the font cache when Chrome's bundled fontconfig leaves links that make fonts vanish in other apps",
    install: installFontcacheGuard,
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
    {
      key: 'OPEN_GUARD_SECONDS',
      type: 'text',
      message: 'Drop repeat opens of the same link within how many seconds',
      default: '5',
      when: (ctx) => ctx.get('EXTRAS').includes('open-guard'),
    },
  ],

  async install(ctx) {
    const chosen = EXTRAS.filter((e) => ctx.get('EXTRAS').includes(e.value));
    if (!chosen.length) throw new Skip('no extras selected');
    for (const e of chosen) await ctx.step(e.value, () => e.install(ctx));
  },
};
