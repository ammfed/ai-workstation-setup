import { Skip } from '../../lib/context.mjs';
import { detectWsl, systemdOnScript, virtualizationProblem } from '../../lib/wsl.mjs';
import { CONFIG_DEFAULTS, installFontWindows, writeConfig } from '../terminal/module.mjs';

// Sets up Linux inside Windows (WSL) and runs the whole setup in it, firstmate included.
// Steps follow Microsoft's docs:
//   https://learn.microsoft.com/en-us/windows/wsl/install         (wsl --install, restart, Ubuntu by default)
//   https://learn.microsoft.com/en-us/windows/wsl/basic-commands  (--no-distribution, -d, --no-launch)
//   https://learn.microsoft.com/en-us/windows/wsl/wsl-config      (/etc/wsl.conf [user] default, [boot] systemd)
//   https://learn.microsoft.com/en-us/windows/wsl/systemd         (systemd on, wsl --update when --version is missing)
//   https://learn.microsoft.com/en-us/windows/wsl/troubleshooting (virtualization, 0x80370102)
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
// While the setup runs inside Linux, sudo needs no password: wsl.exe -u root already gives
// root to this Windows user, so the rule adds no access. It is removed when the run ends.
const SUDOERS = '/etc/sudoers.d/ai-workstation-setup-install';
// Windows Installer's "the user cancelled", returned when nobody approves the administrator prompt.
const CANCELLED = 1223;

// Windows-side apps, each from its publisher's winget package (font: Nerd Fonts' release archive).
export const APPS = [
  { value: 'claude', id: 'Anthropic.Claude', label: 'Claude desktop app' },
  { value: 'chrome', id: 'Google.Chrome', label: 'Google Chrome (Claude in Chrome, your own browsing)' },
  { value: 'obsidian', id: 'Obsidian.Obsidian', label: 'Obsidian (opens the vault that lives inside Ubuntu)' },
  { value: 'wezterm', id: 'wez.wezterm', label: 'WezTerm, opening Ubuntu in each new tab' },
  { value: 'font', label: 'JetBrainsMono Nerd Font (the font WezTerm asks for)' },
  { value: 'openwhispr', id: 'OpenWhispr.OpenWhispr', label: 'OpenWhispr dictation (voice-mode does not run under WSL)' },
];

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

/** A command that asks Windows for an administrator, waits, and exits with the command's code. */
function elevated(file, args) {
  const list = args.map((a) => `'${a}'`).join(',');
  return `try { $p = Start-Process ${file} -ArgumentList ${list} -Verb RunAs -Wait -PassThru } catch { exit ${CANCELLED} }; exit $p.ExitCode`;
}

function runElevated(ctx, file, args, what) {
  try {
    ctx.run(elevated(file, args));
  } catch (err) {
    if (String(err.message).includes(`exit ${CANCELLED}`)) {
      throw new Error(`${what} needs an administrator, and the Windows prompt was declined. Run this again and choose Yes; on a work PC without admin rights, ask IT to run: wsl --install --no-distribution`);
    }
    throw err;
  }
}

function wingetApp(ctx, { id, label }) {
  if (!ctx.dryRun && !ctx.has('winget')) throw new Skip('winget is missing: install App Installer from the Microsoft Store, then run this again');
  if ((ctx.capture(`winget list --id ${id} -e`) || '').includes(id)) return ctx.ok(`${label} already installed`);
  ctx.run(`winget install --id ${id} -e --accept-source-agreements --accept-package-agreements`);
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
  questions: [
    {
      key: 'WSL_WINDOWS_APPS',
      type: 'multi',
      message: 'Windows apps to install next to Ubuntu',
      choices: APPS.map(({ value, label }) => ({ value, label })),
      default: ['claude', 'chrome', 'obsidian', 'wezterm', 'font'],
    },
  ],

  async install(ctx) {
    const probing = !ctx.platform.simulated;
    // A step returns true when it finished, so the next step knows it may go on.
    const passed = (msg) => {
      ctx.ok(msg);
      return true;
    };

    const build = Number(ctx.capture('[Environment]::OSVersion.Version.Build'));
    if (probing && build && build < MIN_BUILD) {
      throw new Error(`WSL needs Windows 10 version 2004 (build ${MIN_BUILD}) or later; this is build ${build}. Update Windows (Settings > Windows Update), or see https://learn.microsoft.com/en-us/windows/wsl/install-manual`);
    }

    // The Windows apps first: they need no restart, so they are ready even if WSL waits for one.
    const apps = ctx.get('WSL_WINDOWS_APPS') || [];
    for (const app of APPS.filter((a) => apps.includes(a.value) && a.id)) await ctx.step(app.label, () => wingetApp(ctx, app));
    if (apps.includes('font')) await ctx.step('JetBrainsMono Nerd Font', () => installFontWindows(ctx));

    const wslWorks = () => ctx.capture('wsl.exe --status') !== null;
    const hasDistro = () => ctx.capture('wsl.exe -e true') !== null;

    const ready = await ctx.step('WSL', () => {
      if (probing && wslWorks()) return passed('WSL is installed');
      const virt = probing && virtualizationProblem({
        hypervisorPresent: { True: true, False: false }[ctx.capture('(Get-CimInstance -ClassName Win32_ComputerSystem).HypervisorPresent')] ?? null,
        firmwareEnabled: { True: true, False: false }[ctx.capture('(Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled')] ?? null,
      });
      if (virt) {
        ctx.todo(`switch on virtualization in the BIOS/UEFI, then run .\\install.ps1 --modules wsl --yes again (in ${ctx.repoRoot})`);
        throw new Error(virt);
      }
      ctx.info('Windows asks once to allow the install (administrator)');
      runElevated(ctx, 'wsl.exe', ['--install', '--no-distribution'], 'Installing WSL');
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

    // An older WSL built into Windows has no --version and no systemd; the Store version has both.
    await ctx.step('WSL update', () => {
      if (probing && ctx.capture('wsl.exe --version') !== null) return ctx.ok('WSL is the current Store version');
      if (ctx.dryRun) return ctx.info('would run wsl --update (as administrator) if wsl --version is missing (the older WSL built into Windows)');
      runElevated(ctx, 'wsl.exe', ['--update'], 'Updating WSL');
    });

    const distro = await ctx.step(DISTRO, () => {
      if (probing && hasDistro()) return passed('a Linux distribution is installed');
      ctx.run(`wsl.exe --install -d ${DISTRO} --no-launch`);
      if (!ctx.dryRun && !hasDistro()) throw new Error(`${DISTRO} did not start; see https://learn.microsoft.com/en-us/windows/wsl/troubleshooting`);
      return passed(`${DISTRO} installed`);
    });
    if (distro === undefined) return;

    const user = linuxUserName(process.env.USERNAME);
    const name = ctx.capture('wsl.exe -e printenv WSL_DISTRO_NAME') || DISTRO;
    const ok = await ctx.step('Linux user', () => {
      const uid = ctx.capture('wsl.exe -e id -u');
      if (probing && uid && uid !== '0') return passed('your Linux user exists');
      // At a terminal, Ubuntu asks for the password now; without one (an AI assistant runs this),
      // the user starts with no password and the person chooses it afterwards.
      const ask = ctx.terminal;
      if (ask) ctx.info(`Ubuntu asks for a password for your Linux user "${user}" (you type it twice; nothing shows while typing)`);
      const add = ask ? `adduser --gecos ${user} ${user}` : `adduser --disabled-password --gecos ${user} ${user}`;
      ctx.run(inLinux(`id -u ${user} >/dev/null 2>&1 || ${add}; usermod -aG sudo ${user} && { grep -q '^default=' /etc/wsl.conf 2>/dev/null || printf '\\n[user]\\ndefault=${user}\\n' >> /etc/wsl.conf; }`, 'root'));
      if (!ask) ctx.todo(`choose your Linux password: wsl.exe -u root passwd ${user}   (in PowerShell; sudo inside Ubuntu asks for it)`);
      ctx.run(`wsl.exe --terminate ${name}`); // the default user takes effect once the distribution restarts
      return passed(`Linux user ${user} is the default`);
    });
    if (ok === undefined) return;

    // WSL 2 runs the services and timers (daily-sync, ledger, vault timers) with systemd.
    await ctx.step('systemd', () => {
      const kernel = ctx.capture('wsl.exe -e cat /proc/version');
      if (probing && detectWsl({ env: {}, procVersion: kernel }).version === 1) {
        ctx.warn(`${name} runs as WSL 1 (no systemd, no Linux windows); scheduled jobs fall back to cron. To switch: wsl.exe --set-version ${name} 2`);
        return;
      }
      if (probing && ctx.capture('wsl.exe -e ps -p 1 -o comm=') === 'systemd') return passed('systemd runs in Linux');
      ctx.run(inLinux(systemdOnScript('/etc/wsl.conf'), 'root'));
      ctx.run(`wsl.exe --terminate ${name}`); // systemd starts with the distribution's next start
      return passed('systemd switched on in /etc/wsl.conf');
    });

    const tools = await ctx.step('git and curl in Linux', () => {
      ctx.run(inLinux('command -v git >/dev/null && command -v curl >/dev/null || { apt-get update && apt-get install -y git curl; }', 'root'));
      return true;
    });
    if (tools === undefined) return;

    const url = cloneUrl(ctx.capture(`git -C ${ps(ctx.repoRoot)} remote get-url origin`));
    await ctx.step('setup inside Linux', () => {
      ctx.run(inLinux(`test -d ${LINUX_CLONE} || git clone ${url} ${LINUX_CLONE}`));
      const linuxUser = ctx.capture('wsl.exe -e id -un') || user;
      ctx.info(`installs everything in ${LINUX_CLONE} with no password asked (sudo is allowed without one until the run ends)`);
      ctx.run(inLinux(`printf '%s ALL=(ALL) NOPASSWD:ALL\\n' ${linuxUser} > ${SUDOERS} && chmod 440 ${SUDOERS}`, 'root'));
      try {
        ctx.run(inLinux(`cd ${LINUX_CLONE} && ./install.sh --yes`));
      } finally {
        ctx.run(inLinux(`rm -f ${SUDOERS}`, 'root'));
      }
      ctx.ok('setup finished inside Linux; open Ubuntu from the Start menu to use it');
    });

    if (apps.includes('wezterm')) {
      // %UserProfile%\.wezterm.lua, the file WezTerm on Windows reads; new tabs open Ubuntu.
      await ctx.step('WezTerm config', () => writeConfig(ctx, { ...CONFIG_DEFAULTS, wsl: name }));
    }
    ctx.info('Linux keeps running while a Linux window is open; services and timers catch up when Ubuntu starts again (docs/windows-wsl.md)');
  },
};
