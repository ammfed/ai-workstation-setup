// What the installer knows about Linux inside Windows (WSL): how to tell it runs there, the
// checks it makes there, and, per module, whether the module runs inside WSL, on the Windows
// side, or on both with a bridge. docs/windows-wsl.md states the same map for people.
// Facts follow Microsoft's WSL docs (learn.microsoft.com/windows/wsl): wsl-config (wsl.conf,
// .wslconfig), systemd, filesystems, networking, and tutorials/gui-apps.

import fs from 'node:fs';

const TEMPLATE = 'https://github.com/ammfed/ai-workstation-setup';

/** WSL 2 kernels say "microsoft-standard-WSL2"; WSL 1 says "Microsoft" with no WSL2. */
export function detectWsl({ env = process.env, procVersion = null } = {}) {
  const fromKernel = /microsoft/i.test(procVersion || '');
  const wsl = Boolean(env.WSL_DISTRO_NAME) || fromKernel;
  let version = null;
  if (fromKernel) version = /WSL2|microsoft-standard/i.test(procVersion) ? 2 : 1;
  return { wsl, version };
}

/** A Windows drive as WSL mounts it (/mnt/c, /mnt/d/...). /mnt/wslg is Linux. */
export function isWindowsMount(p) {
  return /^\/mnt\/[a-z](\/|$)/i.test(String(p || ''));
}

export function cloneLocationProblem(repoRoot) {
  if (!isWindowsMount(repoRoot)) return null;
  return (
    `this clone is on a Windows drive (${repoRoot}). Inside WSL it must live in the Linux file system: ` +
    'files on /mnt are slow, lose Linux permissions and can get Windows line endings. ' +
    `Clone it again inside Linux and run it there: git clone ${TEMPLATE} ~/ai-workstation-setup && cd ~/ai-workstation-setup && ./install.sh`
  );
}

// Windows programs that are meant to be called from WSL (VS Code's `code` opens a WSL window).
const BRIDGES = new Set(['code', 'explorer.exe', 'clip.exe', 'powershell.exe', 'cmd.exe', 'wsl.exe']);

/** Tools whose PATH match inside WSL is a Windows program, given { tool: path | null }. */
export function windowsLeaks(found) {
  return Object.entries(found)
    .filter(([tool, p]) => p && !BRIDGES.has(tool) && (isWindowsMount(p) || /\.(exe|cmd|bat)$/i.test(p)))
    .map(([tool, p]) => ({ tool, path: p }));
}

/** Is systemd=true set under [boot] in this wsl.conf text? */
export function systemdOn(text) {
  let section = '';
  let on = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = line.match(/^\[(.+)\]$/);
    if (head) section = head[1].trim().toLowerCase();
    else if (section === 'boot') {
      const kv = line.match(/^systemd\s*=\s*(\S+)/i);
      if (kv) on = kv[1].toLowerCase() === 'true';
    }
  }
  return on;
}

/**
 * A POSIX sh script, run as root, that sets systemd=true under [boot] in `file` and keeps
 * every other line. One line with no double quotes, so Windows PowerShell 5.1 hands it to wsl.exe intact.
 */
export function systemdOnScript(file = '/etc/wsl.conf') {
  return [
    `f=${file}`,
    'touch $f',
    "if grep -Eq '^[[:space:]]*systemd[[:space:]]*=' $f; then sed -i -E 's/^[[:space:]]*systemd[[:space:]]*=.*/systemd=true/' $f",
    "elif grep -Eq '^[[:space:]]*\\[boot\\]' $f; then sed -i -E '/^[[:space:]]*\\[boot\\]/a systemd=true' $f",
    "else printf '\\n[boot]\\nsystemd=true\\n' >> $f",
    'fi',
  ].join('; ');
}

/**
 * While the Windows side runs the setup inside Linux, this rule lets sudo work without a
 * password (wsl.exe -u root already gives root, so it adds no access). The run removes it at
 * its end; a run cut off (crash, restart, killed) is covered twice: every later run removes a
 * leftover first, and the next start of the distribution removes it (bootCleanupScript).
 */
export const TEMP_SUDOERS = '/etc/sudoers.d/ai-workstation-setup-install';
/** Set by the Windows side for the setup run it gives the rule to, so that run keeps it. */
export const TEMP_SUDO_ENV = 'AI_WORKSTATION_SETUP_TEMP_SUDO';

/** The command that removes a leftover rule at the start of a run inside WSL, or null. */
export function leftoverSudoCleanup({ file = TEMP_SUDOERS, env = process.env, exists = (f) => fs.existsSync(f) } = {}) {
  if (env[TEMP_SUDO_ENV] === '1' || !exists(file)) return null;
  // A leftover rule still lets this user run sudo without a password, so -n succeeds.
  return `sudo -n rm -f ${file}`;
}

/**
 * A POSIX sh script, run as root, that makes the distribution remove the rule each time it
 * starts: [boot] command in `file` (WSL runs it as root through /bin/sh -c). An existing boot
 * command is kept and the removal is chained after it. One line, no double quotes.
 */
export function bootCleanupScript(file = '/etc/wsl.conf') {
  const rm = `rm -f ${TEMP_SUDOERS}`;
  return [
    `f=${file}`,
    'touch $f',
    `if grep -Fq '${rm}' $f; then :`,
    `elif grep -Eq '^[[:space:]]*command[[:space:]]*=' $f; then sed -i -E 's|^([[:space:]]*command[[:space:]]*=.*[^[:space:]])[[:space:]]*$|\\1; ${rm}|' $f`,
    `elif grep -Eq '^[[:space:]]*\\[boot\\]' $f; then sed -i -E '/^[[:space:]]*\\[boot\\]/a command=${rm}' $f`,
    `else printf '\\n[boot]\\ncommand=${rm}\\n' >> $f`,
    'fi',
  ].join('; ');
}

/** The path a Windows app (Obsidian, Explorer) uses for a file inside WSL. */
export function windowsPathOf(linuxPath, distro) {
  const m = String(linuxPath).match(/^\/mnt\/([a-z])(\/.*)?$/i);
  if (m) return `${m[1].toUpperCase()}:\\${(m[2] || '').slice(1).split('/').join('\\')}`;
  return `\\\\wsl.localhost\\${distro}${String(linuxPath).split('/').join('\\')}`;
}

/**
 * WSL 2 needs hardware virtualization. Once Hyper-V runs, Windows reports the firmware flag as
 * off, so a running hypervisor is enough; an unknown answer is not a reason to stop.
 */
export function virtualizationProblem({ hypervisorPresent, firmwareEnabled }) {
  if (hypervisorPresent === true || firmwareEnabled !== false) return null;
  return (
    'virtualization is switched off in this PC\'s firmware, and WSL 2 cannot start without it. ' +
    'Restart into the BIOS/UEFI setup (often F2, F10, F12 or Del at power-on), turn on Intel VT-x, ' +
    'Intel Virtualization Technology, AMD-V or SVM Mode, save, start Windows and run this again. ' +
    'See https://support.microsoft.com/windows/enable-virtualization-on-windows-c5578302-6e43-4b4b-a449-8ced115f58e1'
  );
}

/** WSL 2 gives Linux half of Windows' memory by default; below 4 GB agents and builds struggle. */
export function memoryHint(memTotalKb) {
  if (!memTotalKb || memTotalKb >= 3.8 * 1024 * 1024) return null;
  const gb = (memTotalKb / 1024 / 1024).toFixed(1);
  return (
    `Linux has ${gb} GB of memory. If Windows has more to spare, give WSL more in %UserProfile%\\.wslconfig ` +
    '(under [wsl2] add memory=8GB, or use the WSL Settings app), then run wsl.exe --shutdown from Windows'
  );
}

export const SIDES = ['linux', 'windows', 'both', 'skip'];

/**
 * Per module: `linux` runs inside WSL, `windows` runs on the Windows side (install.ps1),
 * `both` runs inside WSL with a Windows-side piece and a bridge, `skip` does not run under WSL.
 */
export const WSL_SIDES = {
  core: { side: 'linux', note: 'git, gh, jq inside Linux, plus the WSL checks: clone location, Windows programs on PATH, systemd, line endings, links, DNS, memory, GPU' },
  'claude-code': { side: 'both', note: 'Claude Code runs inside WSL; the Claude desktop app runs on Windows (install.ps1 --modules wsl offers it)' },
  'agent-clis': { side: 'linux', note: 'all inside WSL; review pages and the live board on 127.0.0.1 open in the Windows browser through localhost forwarding; the research browser is Linux Chrome shown through WSLg' },
  'mcp-servers': { side: 'linux', note: 'MCP servers are registered with the Claude Code inside WSL' },
  skills: { side: 'linux', note: 'skills live in ~/.claude inside WSL' },
  backpass: { side: 'linux', note: 'runs inside WSL; its schedule uses cron there' },
  firstmate: { side: 'linux', note: 'Firstmate needs Linux, so it runs inside WSL only' },
  preferences: { side: 'linux', note: 'the rules file lives with Claude Code and Firstmate inside WSL' },
  'second-brain': { side: 'both', note: 'the vault lives in the Linux file system; Obsidian on Windows opens it at \\\\wsl.localhost\\<distro>\\home\\<you>\\second-brain' },
  clickup: { side: 'linux', note: 'clickup-axi and its token stay inside WSL' },
  extras: { side: 'both', note: 'docling, llama.cpp and Lavish Library run inside WSL; OpenWhispr is a Windows app (install.ps1 --modules wsl offers it)' },
  'daily-sync': { side: 'linux', note: 'a systemd user timer inside WSL (cron when systemd stays off); it runs while WSL runs and catches up at the next start' },
  'voice-mode': { side: 'skip', note: 'needs a desktop hotkey, window control and typing into other apps, which WSL does not give; use OpenWhispr on Windows for dictation' },
  ledger: { side: 'linux', note: 'a systemd user service inside WSL (cron @reboot when systemd stays off); the board opens in the Windows browser' },
  'news-digest': { side: 'linux', note: 'a systemd user timer inside WSL, cron when systemd stays off' },
  openrouter: { side: 'linux', note: 'the key file lives inside WSL' },
  wsl: { side: 'windows', note: 'run from Windows: installs WSL and Ubuntu, the Windows apps, then this setup inside Ubuntu' },
  terminal: { side: 'windows', note: 'WezTerm and its font are Windows apps; install.ps1 --modules wsl installs them and writes %UserProfile%\\.wezterm.lua opening Ubuntu' },
};
