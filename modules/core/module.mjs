import fs from 'node:fs';
import { Skip } from '../../lib/context.mjs';
import { memoryHint, systemdOn, systemdOnScript, windowsLeaks } from '../../lib/wsl.mjs';
import { versionCheck } from '../agent-clis/tools.mjs';

const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

// Inside WSL: the checks and bridges from docs/windows-wsl.md, each one step with its reason.
async function wslSteps(ctx) {
  const probing = !ctx.platform.simulated;

  if (ctx.platform.wslVersion === 1) {
    ctx.warn(
      'this distribution runs as WSL 1: no systemd, no Linux windows (WSLg) and no Linux Chrome for the browser tools. ' +
        `From Windows: wsl.exe --set-version ${process.env.WSL_DISTRO_NAME || 'Ubuntu'} 2 (needs virtualization on), then re-run`,
    );
  }

  await ctx.step('Windows programs on PATH', () => {
    // WSL appends the Windows PATH; this setup always looks past it, but your shell does not.
    const tools = ['node', 'npm', 'npx', 'git', 'gh', 'jq', 'claude'];
    const found = Object.fromEntries(tools.map((t) => [t, probing ? ctx.capture(`command -v ${t}`) : null]));
    const leaks = windowsLeaks(found);
    if (!leaks.length) return ctx.ok('no Windows program stands in for a Linux tool');
    for (const l of leaks) ctx.warn(`\`${l.tool}\` in your shell is the Windows program ${l.path}; this setup installs the Linux one, and a new shell finds it first`);
    ctx.info('if a Windows program still wins in a new shell, add [interop] appendWindowsPath=false to /etc/wsl.conf (Windows programs then need their full /mnt/c path)');
  });

  await ctx.step('systemd', () => {
    if (probing && ctx.capture('ps -p 1 -o comm=') === 'systemd') return ctx.ok('systemd runs, so user services and timers work');
    const cron = 'scheduled jobs fall back to cron, and without systemd cron starts only with `sudo service cron start` (Windows 11: add command=service cron start under [boot] in /etc/wsl.conf)';
    if (ctx.platform.wslVersion === 1) throw new Skip(`WSL 1 has no systemd; ${cron}`);
    if (probing && systemdOn(read('/etc/wsl.conf'))) {
      ctx.todo('systemd is switched on in /etc/wsl.conf but not running yet: from Windows run `wsl.exe --shutdown`, open Ubuntu again and re-run ./install.sh');
      return;
    }
    if (!ctx.get('WSL_SYSTEMD')) throw new Skip(`systemd stays off (WSL_SYSTEMD=no); ${cron}`);
    ctx.run(`${ctx.sudo()}sh -c '${systemdOnScript('/etc/wsl.conf').replace(/'/g, "'\\''")}'`);
    ctx.todo('systemd is switched on: from Windows run `wsl.exe --shutdown`, open Ubuntu again and re-run ./install.sh so the services and timers start');
  });

  await ctx.step('line endings', () => {
    if (probing && ctx.capture('git config --get core.autocrlf') === 'true') {
      ctx.warn('git converts line endings to CRLF here (core.autocrlf=true), which breaks shell scripts; run: git config --global core.autocrlf input');
    } else ctx.ok('git keeps Linux line endings');
  });

  await ctx.step('open links in Windows', async () => {
    const target = ctx.path('~/.local/bin/open-in-windows');
    await ctx.writeFile(target, ctx.template('wsl/open-in-windows.sh'), { onConflict: 'ask', mode: 0o755 });
    await ctx.addUserPath(ctx.path('~/.local/bin'));
    await ctx.setUserEnv('BROWSER', target);
  });

  await ctx.step('network', () => {
    if (!probing) return ctx.info('would check that github.com resolves inside WSL');
    if (ctx.capture('getent hosts github.com') !== null) return ctx.ok('DNS works inside WSL');
    throw new Error(
      'github.com does not resolve inside WSL (often a VPN). On Windows 11 set dnsTunneling=true (and networkingMode=mirrored) ' +
        'under [wsl2] in %UserProfile%\\.wslconfig, then wsl.exe --shutdown; see https://learn.microsoft.com/windows/wsl/networking',
    );
  });

  await ctx.step('memory and GPU', () => {
    const kb = Number((read('/proc/meminfo').match(/^MemTotal:\s+(\d+)/m) || [])[1]) || null;
    const hint = probing && memoryHint(kb);
    if (hint) ctx.warn(hint);
    if (probing && fs.existsSync('/usr/lib/wsl/lib/nvidia-smi')) ctx.ok('the NVIDIA GPU is reachable through the Windows driver (/usr/lib/wsl/lib)');
    if (probing && ctx.capture("dpkg-query -W -f='${Status}\\n' 'nvidia-driver-*' 2>/dev/null | grep -q 'install ok installed'") !== null) {
      ctx.warn('a Linux NVIDIA driver package is installed inside WSL; WSL uses the Windows driver only, so remove the Linux one (sudo apt remove nvidia-driver-*)');
    }
  });
}

// GitHub CLI Linux routes follow github.com/cli/cli docs/install_linux.md.
function ghLinux(ctx) {
  const s = ctx.sudo();
  const routes = {
    apt: [
      `(type -p wget >/dev/null || (${s}apt update && ${s}apt install wget -y))`,
      `${s}mkdir -p -m 755 /etc/apt/keyrings`,
      'out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg',
      `cat $out | ${s}tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null`,
      `${s}chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg`,
      `${s}mkdir -p -m 755 /etc/apt/sources.list.d`,
      `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | ${s}tee /etc/apt/sources.list.d/github-cli.list > /dev/null`,
      `${s}apt update`,
      `${s}apt install gh -y`,
    ].join(' && '),
    dnf: `${s}dnf install -y dnf5-plugins && ${s}dnf config-manager addrepo --from-repofile=https://cli.github.com/packages/rpm/gh-cli.repo && ${s}dnf install -y gh --repo gh-cli`,
    zypper: `${s}zypper addrepo https://cli.github.com/packages/rpm/gh-cli.repo && ${s}zypper --non-interactive ref && ${s}zypper --non-interactive install gh`,
    pacman: `${s}pacman -S --needed --noconfirm github-cli`,
    apk: `${s}apk add github-cli`,
    brew: 'brew install gh',
  };
  const cmd = routes[ctx.platform.pkg];
  if (!cmd) throw new Skip('no known gh route for this distro; see https://github.com/cli/cli#installation');
  ctx.run(cmd);
}

export default {
  name: 'core',
  title: 'Core prerequisites',
  description: 'git, Node.js, GitHub CLI (signed in) and jq',
  order: 10,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: [],
  default: true,
  questions: [
    {
      key: 'CORE_GH_LOGIN',
      type: 'confirm',
      message: 'Sign in to GitHub with `gh auth login` if you are not signed in yet?',
      default: true,
      when: (ctx) => ctx.interactive,
    },
    {
      key: 'WSL_SYSTEMD',
      type: 'confirm',
      message: 'Inside WSL: switch on systemd in /etc/wsl.conf (needs sudo) so services and timers run?',
      default: true,
      when: (ctx) => ctx.os === 'wsl',
    },
  ],

  async install(ctx) {
    if (ctx.os === 'wsl') await wslSteps(ctx);

    await ctx.step('git', () =>
      ctx.ensureTool({
        name: 'git',
        install: {
          default: { pkg: { apt: 'git', dnf: 'git', pacman: 'git', zypper: 'git', apk: 'git', brew: 'git', winget: 'Git.Git', scoop: 'git', choco: 'git' } },
        },
        check: versionCheck('git'),
      }),
    );

    await ctx.step('Node.js', () => {
      const [major, minor] = process.versions.node.split('.').map(Number);
      ctx.ok(`Node.js ${process.versions.node} (running this installer)`);
      if (major < 22 || (major === 22 && minor < 19)) {
        ctx.warn('quota-axi (used by firstmate) needs Node 22.19+: run `nvm install --lts` (or `winget upgrade OpenJS.NodeJS.LTS`)');
      }
    });

    await ctx.step('GitHub CLI', () =>
      ctx.ensureTool({
        name: 'GitHub CLI',
        bin: 'gh',
        install: { linux: ghLinux, macos: { pkg: { brew: 'gh' } }, windows: { pkg: { winget: 'GitHub.cli', scoop: 'gh', choco: 'gh' } } },
        check: versionCheck('gh'),
      }),
    );

    await ctx.step('jq', () =>
      ctx.ensureTool({
        name: 'jq',
        install: {
          default: { pkg: { apt: 'jq', dnf: 'jq', pacman: 'jq', zypper: 'jq', apk: 'jq', brew: 'jq', winget: 'jqlang.jq', scoop: 'jq', choco: 'jq' } },
        },
        check: { about: 'evaluates an expression', cmd: 'jq -n 1+1', expect: /^2$/ },
      }),
    );

    await ctx.step('GitHub sign-in', () => {
      if (!ctx.dryRun && !ctx.has('gh')) throw new Skip('gh is not on PATH yet; open a new terminal and re-run');
      if (ctx.capture('gh auth status') === null) {
        if (ctx.get('CORE_GH_LOGIN')) ctx.run('gh auth login');
        else return ctx.todo(`gh auth login${ctx.os === 'wsl' ? ' && gh auth setup-git' : ''}`);
      } else ctx.ok('gh is signed in');
      // Inside WSL, git uses gh's sign-in: no Windows credential manager to bridge.
      if (ctx.os === 'wsl' && !ctx.capture('git config --global --get-all credential.https://github.com.helper')) ctx.run('gh auth setup-git');
    });
  },
};
