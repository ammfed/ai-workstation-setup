# Windows through WSL

On Windows the full setup runs inside WSL (Linux inside Windows), with a few apps on the
Windows side. This page is the map of what runs where, how the two sides work together, and
what the installer does about each known WSL problem.

The short version: run `.\install.ps1` in PowerShell, press Enter for **Linux inside
Windows**, press Enter again to keep the recommended Windows apps, and approve the one
administrator prompt. Restart if Windows asks; the setup carries on by itself after you sign
in. Ubuntu asks you to choose a Linux password once. An AI assistant can run all of this for
you: [install-with-ai.md](install-with-ai.md).

Facts here come from Microsoft's WSL documentation (learn.microsoft.com/windows/wsl:
*install*, *wsl-config*, *systemd*, *filesystems*, *networking*, *tutorials/gui-apps*,
*tutorials/gpu-compute*, *tutorials/wsl-git*), the tool vendors' own docs, and the winget
packages their publishers ship.

## What runs where

| Module | Runs | Notes |
| --- | --- | --- |
| `core` | inside WSL | git, gh, jq in Linux, plus the WSL checks below |
| `claude-code` | both, with a bridge | Claude Code runs in WSL; the Claude desktop app runs on Windows (`wsl` module) |
| `agent-clis` | inside WSL | review pages and the live board open in the Windows browser over localhost; the research browser is Linux Chrome through WSLg |
| `mcp-servers` | inside WSL | registered with the Claude Code in WSL |
| `skills` | inside WSL | `~/.claude/skills` in WSL |
| `backpass` | inside WSL | its schedule uses cron in WSL |
| `firstmate` | inside WSL | Firstmate needs Linux |
| `preferences` | inside WSL | the rules file sits with Claude Code and Firstmate |
| `second-brain` | both, with a bridge | the vault lives in Linux; Obsidian on Windows opens it by its `\\wsl.localhost` path |
| `clickup` | inside WSL | clickup-axi and its token stay in WSL |
| `extras` | both, with a bridge | docling, llama.cpp and Lavish Library in WSL; OpenWhispr on Windows (`wsl` module) |
| `daily-sync` | inside WSL | systemd user timer, cron when systemd stays off |
| `voice-mode` | not under WSL | see [Voice and audio](#voice-and-audio) |
| `ledger` | inside WSL | systemd user service, cron `@reboot` when systemd stays off |
| `news-digest` | inside WSL | systemd user timer, cron when systemd stays off |
| `openrouter` | inside WSL | the key file stays in WSL |
| `wsl` | Windows side | installs WSL, Ubuntu and the Windows apps, then runs this setup inside Ubuntu |
| `terminal` | Windows side | WezTerm and its font are Windows apps; the `wsl` module installs them and writes `%UserProfile%\.wezterm.lua` |

`lib/wsl.mjs` holds the same map (`WSL_SIDES`), and `test/wsl.test.mjs` checks that this
table, the code and each module's declared platforms agree. Run inside WSL, the installer's
summary lists the pieces that belong on the Windows side.

## What the Windows side does (`.\install.ps1`, choice 1)

The `wsl` module, in order. Each step that cannot go on prints its reason and what to do.

1. **Windows version.** WSL needs Windows 10 version 2004 (build 19041) or later. An older
   build stops with "update Windows".
2. **Windows apps** (`WSL_WINDOWS_APPS`, asked once): the Claude desktop app
   (`Anthropic.Claude`), Google Chrome (`Google.Chrome`), Obsidian (`Obsidian.Obsidian`),
   WezTerm (`wez.wezterm`) with winget, and JetBrainsMono Nerd Font from the Nerd Fonts
   release, installed for your user only (no administrator). OpenWhispr
   (`OpenWhispr.OpenWhispr`) is offered, not chosen by default. These come first because
   they need no restart. No winget: install App Installer from the Microsoft Store.
3. **Virtualization.** WSL 2 needs it on in the BIOS/UEFI. When Windows reports it off (and
   no hypervisor runs yet), the step stops with the firmware step: restart into the BIOS/UEFI
   setup, turn on Intel VT-x / Virtualization Technology or AMD-V / SVM Mode, save, run again.
4. **WSL** with `wsl --install --no-distribution`. Windows asks for an administrator once.
   Declining the prompt (or no admin rights) stops with that reason; a work PC may need IT to
   run `wsl --install --no-distribution`. When Windows needs a restart, a one-time sign-in
   entry (RunOnce) resumes the setup after you sign in again.
5. **WSL update.** The older WSL built into Windows has no `wsl --version` and no systemd;
   then `wsl --update` runs (administrator).
6. **Ubuntu** with `wsl --install -d Ubuntu --no-launch`, then **your Linux user** (named
   after your Windows user) as the default user. At a terminal you choose its password
   there; when an AI assistant runs the setup (no terminal), the user starts without one and
   a to-do says how to set it: `wsl.exe -u root passwd <user>`.
7. **systemd** on in `/etc/wsl.conf` (`[boot]` `systemd=true`), then the distribution
   restarts (`wsl --terminate`). Ubuntu from `wsl --install` already has it on.
8. **git and curl** in Ubuntu, **this template cloned to `~/ai-workstation-setup`** inside
   Linux, and **`./install.sh --yes`** there (the default modules, Firstmate included).
   While it runs, sudo needs no password: a rule in
   `/etc/sudoers.d/ai-workstation-setup-install` allows it and is removed when the run ends
   (`wsl.exe -u root` already gives your Windows user root, so it adds no access). If a run
   was killed midway, the next run removes it, or delete it with
   `wsl.exe -u root rm /etc/sudoers.d/ai-workstation-setup-install`.
9. **WezTerm config** in `%UserProfile%\.wezterm.lua`: new tabs open Ubuntu (WezTerm's WSL
   domain; Docker Desktop's own distributions are never picked).

Run `./install.sh` again inside Ubuntu at any time to add modules or change answers.

## Checks inside WSL (the `core` module)

| Problem | Detection | What happens |
| --- | --- | --- |
| Clone on a Windows drive (`/mnt/c/...`) | the clone's path | `install.sh` and the installer stop with the `git clone ... ~/ai-workstation-setup` line. Files on `/mnt` are slow, lose Linux permissions and can get CRLF line endings. |
| Windows programs on PATH | `command -v` of node, npm, npx, git, gh, jq, claude | WSL appends the Windows PATH. The installer never takes a tool under `/mnt/<drive>` for the Linux one, and `install.sh` never runs a Windows `node.exe`. A leak is named with its path. If one still wins in a new shell, add `[interop]` `appendWindowsPath=false` to `/etc/wsl.conf` (Windows programs then need their full `/mnt/c/...` path). |
| systemd off | PID 1, `/etc/wsl.conf` | Asks once (`WSL_SYSTEMD`, default yes), sets `systemd=true` with sudo, and tells you to run `wsl.exe --shutdown` from Windows and re-run. Answered no, or WSL 1: the timers and the ledger use cron instead (below). |
| Line endings | `git config core.autocrlf` | `true` breaks shell scripts: `git config --global core.autocrlf input`. This repository's `.gitattributes` keeps its own files LF either way. |
| DNS or VPN | `getent hosts github.com` | Fails with the fix: on Windows 11, `dnsTunneling=true` (the default on 22H2 and later) and `networkingMode=mirrored` under `[wsl2]` in `%UserProfile%\.wslconfig`, then `wsl.exe --shutdown`. |
| Memory | `MemTotal` below about 4 GB | WSL 2 gives Linux half of Windows' memory by default. The hint: `memory=8GB` under `[wsl2]` in `.wslconfig` (or the WSL Settings app), then `wsl.exe --shutdown`. |
| GPU | `/usr/lib/wsl/lib/nvidia-smi`, `dpkg` | CUDA in WSL uses the Windows NVIDIA driver only. A Linux `nvidia-driver-*` package inside WSL is flagged for removal; the installer never installs one. |
| WSL 1 | `/proc/version` | Named with the switch: `wsl.exe --set-version Ubuntu 2`. WSL 1 has no systemd and no Linux windows. |

### systemd and the cron fallback

daily-sync, news-digest, the vault timers, the ledger and the task sync run as systemd user
units. Microsoft documents systemd for WSL 2 (WSL 0.67.6 or later), turned on by
`[boot]` `systemd=true` in `/etc/wsl.conf` and a `wsl.exe --shutdown`.

When systemd stays off, the same jobs go into your crontab (timers as times, the ledger as
`@reboot`). Without systemd, cron itself does not start on its own: run
`sudo service cron start` after Ubuntu starts, or on Windows 11 add
`command=service cron start` under `[boot]` in `/etc/wsl.conf`.

WSL also stops Linux a little while after the last Linux program ends, and systemd services
do not keep it running. So timers fire while Ubuntu runs, and `Persistent=true` timers
(daily-sync, the vault timers) catch up on a missed run when it next starts. Keep a WezTerm
tab or Ubuntu window open for the ledger to stay live.

### Clock after sleep

The Linux clock can lag after Windows sleeps, which shows as failed TLS or git operations and
odd timestamps. `wsl.exe --shutdown` from Windows restarts Linux with the right time, and a
current WSL (`wsl --update`) has fewer such lags. The installer does not check this: no check
is cheap and exact enough.

## Bridges between the two sides

| Need | Choice | Why |
| --- | --- | --- |
| Open links and review pages | `~/.local/bin/open-in-windows`, set as `BROWSER` | Hands a link (or a Linux file, by its `\\wsl.localhost` path) to `explorer.exe`, which opens the Windows default browser. Needs nothing installed. `wslu`/`wslview` is archived upstream, so it is not used. |
| Windows browser to servers in WSL (review pages, live board) | WSL's localhost forwarding | On by default (`localhostForwarding`): a server on 127.0.0.1 in WSL 2 opens at `http://127.0.0.1:<port>` in the Windows browser. Nothing to set. |
| Browser tools (chrome-devtools-axi, research-browser) | Linux Chrome through WSLg (`WSL_LINUX_CHROME`) | Google's `.deb`, as Microsoft's GUI apps tutorial installs it. The browser, its debugging port and the tools all stay on 127.0.0.1 inside Linux. Driving Windows Chrome instead needs its debugging port reachable from WSL, which NAT networking does not give. WSL 1 has no WSLg: Chrome runs headless there. |
| Git credentials | `gh auth login` and `gh auth setup-git` inside WSL | gh is already part of the setup. Git Credential Manager from Git for Windows also works, but needs Git for Windows and keeps WSL tied to it. |
| Clipboard | nothing to install | WSLg shares the clipboard with Linux windows; in a terminal, pipe to `clip.exe` to copy. |
| Notifications from Claude Code | the terminal and Claude Code's phone push | WezTerm shows the terminal bell; `CLAUDE_PUSH_NOTIFICATIONS=on` sends pushes to your phone with Remote Control. No Windows toast bridge is installed. |
| VS Code | Windows `code` from WSL | `code .` in WSL opens a WSL window; it is the one Windows program the PATH check expects. |

## The second brain vault

The vault lives in the Linux file system (`~/second-brain`, the default). Agents, git and
the vault timers read it at Linux speed, and the timers' file watching works. Obsidian on
Windows opens it as a folder vault at `\\wsl.localhost\Ubuntu\home\<you>\second-brain`; the
installer prints the exact path.

The trade-off: a vault on the Windows drive (`/mnt/c/Users/<you>/second-brain`) is faster
for Obsidian, but every agent read, git command and search crosses into Windows and is much
slower, and Linux file permissions are lost. Agents use the vault more than you do, so Linux
is the default. Choose `VAULT_PATH=/mnt/c/...` if you prefer the other side.

## Voice and audio

voice-mode does not run under WSL. WSLg passes sound (PulseAudio), but voice-mode also needs
a global desktop hotkey, window control and typing into other apps (ydotool), and those do
not exist inside WSL. For dictation, OpenWhispr runs on the Windows side (offered by the
`wsl` module and by `extras` on native Windows). ydotool is never installed inside WSL.

## GPU and local models

Local models with CUDA inside WSL need only the NVIDIA driver on Windows; WSL exposes it at
`/usr/lib/wsl/lib`. Never install a Linux NVIDIA driver inside WSL (Microsoft's GPU compute
tutorial; NVIDIA's CUDA on WSL user guide).

## Resources and network

- **Memory and processors:** `%UserProfile%\.wslconfig`, `[wsl2]`, `memory=` and
  `processors=` (or the WSL Settings app), then `wsl.exe --shutdown`.
- **DNS and VPN:** `dnsTunneling=true`, `autoProxy=true` and `networkingMode=mirrored`
  under `[wsl2]` (Windows 11 22H2 or later). On Windows 10, set `generateResolvConf=false`
  under `[network]` in `/etc/wsl.conf` and write your own `/etc/resolv.conf`.
- **Changes take effect** after `wsl.exe --shutdown` (or about 8 seconds after the last
  Linux window closes).

## What stays untested

CI runs the Linux installer for real inside WSL on a Windows runner and dry-runs every
platform. A real PC still covers what a hosted runner cannot: the administrator prompt, the
restart and RunOnce resume, firmware virtualization, winget app installs, WezTerm's WSL
domain and the font, WSLg windows, and Obsidian opening a `\\wsl.localhost` vault.
