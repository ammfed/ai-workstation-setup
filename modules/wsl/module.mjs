import { Skip } from '../../lib/context.mjs';

// Sets up Linux inside Windows (WSL) and runs the whole setup in it, firstmate included.
// Steps follow Microsoft's docs:
//   https://learn.microsoft.com/en-us/windows/wsl/install         (wsl --install, restart, Ubuntu by default)
//   https://learn.microsoft.com/en-us/windows/wsl/basic-commands  (--no-distribution, -d, --no-launch)
//   https://learn.microsoft.com/en-us/windows/wsl/wsl-config      (/etc/wsl.conf [user] default)
//   https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys
// Every command is a single-quoted PowerShell string with no double quotes inside, so
// Windows PowerShell 5.1 passes it to wsl.exe unchanged.

const TEMPLATE = 'https://github.com/ammfed/ai-workstation-setup';
const DISTRO = 'Ubuntu';
const LINUX_CLONE = '~/ai-workstation-setup';
const MIN_BUILD = 19041;
const RUNONCE = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce';
// "!" keeps the entry until the command has run, so a failed start is tried again.
const RUNONCE_NAME = '!ai-workstation-setup';
const RUNONCE_MAX = 260;

/** A Linux user name from the Windows one: lowercase letters, digits, - and _, starting with a letter. */
export function linuxUserName(windowsName) {
  const name = String(windowsName || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[^a-z]+/, '').slice(0, 32);
  return name || 'user';
}

/** The command a one-time sign-in entry runs to carry on after a restart; null if Windows would not accept it. */
export function resumeCommand(repoRoot) {
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "${repoRoot}\\install.ps1" --modules wsl --yes`;
  return cmd.length <= RUNONCE_MAX ? cmd : null;
}

/** The clone to copy into Linux: this clone's origin when it is a URL, else the template. */
export function cloneUrl(origin) {
  return /^(https:\/\/|git@)[\w.@:/~-]+$/.test(origin || '') ? origin : TEMPLATE;
}

const ps = (s) => `'${s.replace(/'/g, "''")}'`;
const inLinux = (script, user) => `wsl.exe${user ? ` -u ${user}` : ''} -e bash -lc ${ps(script)}`;

export default {
  name: 'wsl',
  title: 'Linux inside Windows (WSL)',
  description: 'Installs WSL with Ubuntu, then runs the whole setup inside it, firstmate included',
  order: 100,
  platforms: ['windows'],
  unsupported: {
    linux: 'this is already Linux',
    macos: 'WSL is part of Windows',
    wsl: 'this is already inside WSL',
  },
  default: false,

  async install(ctx) {
    const probing = !ctx.platform.simulated;
    // A step returns true when it finished, so the next step knows it may go on.
    const passed = (msg) => {
      ctx.ok(msg);
      return true;
    };

    const build = Number(ctx.capture('[Environment]::OSVersion.Version.Build'));
    if (probing && build && build < MIN_BUILD) {
      throw new Error(`WSL needs Windows 10 version 2004 (build ${MIN_BUILD}) or later; this is build ${build}. See https://learn.microsoft.com/en-us/windows/wsl/install-manual`);
    }

    const wslWorks = () => ctx.capture('wsl.exe --status') !== null;
    const hasDistro = () => ctx.capture('wsl.exe -e true') !== null;

    const ready = await ctx.step('WSL', () => {
      if (probing && wslWorks()) return passed('WSL is installed');
      ctx.info('Windows asks once to allow the install (administrator)');
      ctx.run("$p = Start-Process wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait -PassThru; exit $p.ExitCode");
      if (ctx.dryRun || wslWorks()) return passed('WSL installed');
      const resume = resumeCommand(ctx.repoRoot);
      if (resume) {
        ctx.run(`New-ItemProperty -Path ${ps(RUNONCE)} -Name ${ps(RUNONCE_NAME)} -Value ${ps(resume)} -PropertyType String -Force | Out-Null`);
        ctx.todo('restart Windows when you are ready; the setup carries on by itself after you sign in');
      } else {
        ctx.todo(`restart Windows, then run: .\\install.ps1 --modules wsl --yes   (in ${ctx.repoRoot})`);
      }
      throw new Skip('Windows needs a restart to finish installing WSL');
    });
    if (ready === undefined) return;
    if (ctx.dryRun) ctx.info(`if Windows needs a restart, it adds a one-time sign-in entry that runs: ${resumeCommand(ctx.repoRoot) || '(path too long: prints the command instead)'}`);

    const distro = await ctx.step(DISTRO, () => {
      if (probing && hasDistro()) return passed('a Linux distribution is installed');
      ctx.run(`wsl.exe --install -d ${DISTRO} --no-launch`);
      if (!ctx.dryRun && !hasDistro()) throw new Error(`${DISTRO} did not start; see https://learn.microsoft.com/en-us/windows/wsl/troubleshooting`);
      return passed(`${DISTRO} installed`);
    });
    if (distro === undefined) return;

    const user = linuxUserName(process.env.USERNAME);
    const ok = await ctx.step('Linux user', () => {
      const uid = ctx.capture('wsl.exe -e id -u');
      if (probing && uid && uid !== '0') return passed('your Linux user exists');
      ctx.info(`Ubuntu asks for a password for your Linux user "${user}" (you type it twice; nothing shows while typing)`);
      ctx.run(inLinux(`id -u ${user} >/dev/null 2>&1 || adduser --gecos ${user} ${user}; usermod -aG sudo ${user} && { grep -q '^default=' /etc/wsl.conf 2>/dev/null || printf '\\n[user]\\ndefault=${user}\\n' >> /etc/wsl.conf; }`, 'root'));
      // The default user takes effect once the distribution restarts.
      ctx.run(`wsl.exe --terminate ${ctx.capture('wsl.exe -e printenv WSL_DISTRO_NAME') || DISTRO}`);
      return passed(`Linux user ${user} is the default`);
    });
    if (ok === undefined) return;

    const tools = await ctx.step('git and curl in Linux', () => {
      ctx.run(inLinux('command -v git >/dev/null && command -v curl >/dev/null || { apt-get update && apt-get install -y git curl; }', 'root'));
      return true;
    });
    if (tools === undefined) return;

    const url = cloneUrl(ctx.capture(`git -C ${ps(ctx.repoRoot)} remote get-url origin`));
    await ctx.step('setup inside Linux', () => {
      ctx.run(inLinux(`test -d ${LINUX_CLONE} || git clone ${url} ${LINUX_CLONE}`));
      ctx.info(`Linux asks for your Linux password once (sudo), then installs everything in ${LINUX_CLONE}`);
      // sudo -v unlocks sudo once; the loop keeps it unlocked while the install runs, then stops.
      ctx.run(inLinux(`cd ${LINUX_CLONE} && sudo -v && { (while sleep 50; do sudo -n -v || exit; done) & k=$!; ./install.sh --yes; s=$?; kill $k; exit $s; }`));
      ctx.ok('setup finished inside Linux; open Ubuntu from the Start menu to use it');
    });
  },
};
