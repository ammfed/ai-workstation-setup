# Installing with an AI assistant

This page is written for an AI assistant (Claude Code, the Claude desktop app's Code tab, or
any agent with a shell) that sets this template up for the person it works with. A person
installing by hand follows the README instead.

The person pastes something like this to their assistant:

> Set up this computer with https://github.com/ammfed/ai-workstation-setup. Follow
> docs/install-with-ai.md in that repository: show me the plan before you change anything,
> and tell me exactly when I need to click, restart, type a password or sign in.

## Rules for the assistant

- Your shell has no terminal, so never start the installer without `--yes`: it would wait
  for answers no one can type. `install.ps1` with no options stops and names the commands.
- Always run with `--dry-run` first, show the person the plan in a few lines (what gets
  installed, which steps need them), and wait for their go-ahead before the real run.
- Defaults are the recommended setup. To change answers, copy `answers.example.env` to
  `answers.env` (gitignored, next to `install.sh`), edit it, and the installer reads it.
  Ask the person only about what they mention or what the plan shows as unusual.
- Secrets (`CLICKUP_TOKEN`, `CONTEXT7_API_KEY`, `OPENROUTER_API_KEY`) come only from the
  environment. Never write them to a file and never ask the person to paste them to you.
- Exit status: 0 done, 1 a step failed (the summary names it), 2 a usage or config error.
  Every run is safe to repeat: finished steps are skipped.
- Read the end of the output: **Summary**, **Failed**, **Left for you to do**. Relay the
  "Left for you to do" lines to the person as a short numbered list. Fix what you can
  (a missing package, a wrong answer) and run again; do not retry the same failure twice.

## Windows

1. **Get the template.** With git: `git clone https://github.com/ammfed/ai-workstation-setup`
   in the person's home folder. Without git, in PowerShell:

   ```powershell
   Invoke-WebRequest -UseBasicParsing https://github.com/ammfed/ai-workstation-setup/archive/refs/heads/main.zip -OutFile $env:TEMP\aws.zip
   Expand-Archive $env:TEMP\aws.zip $HOME -Force; Rename-Item $HOME\ai-workstation-setup-main ai-workstation-setup
   ```

2. **Plan.** From that folder, in PowerShell (from Git Bash, prefix
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 --modules wsl --yes --dry-run
   ```

   This is the recommended route: Linux inside Windows (WSL) with Ubuntu, the whole setup
   inside it, and the Windows apps next to it (the Claude desktop app, Chrome, Obsidian,
   WezTerm and its font; set `WSL_WINDOWS_APPS` in `answers.env` to change the list). If
   Node.js is missing, the dry run stops early and says so; the real run installs it.

3. **Before the real run, tell the person:** "Windows will show an administrator prompt;
   click Yes. If Windows asks for a restart, restart: the setup continues by itself in a
   window after you sign in."

4. **Run it:** the same command without `--dry-run`. It takes 10 to 30 minutes.
   - It may stop with "virtualization is switched off": relay the BIOS/UEFI step it prints.
   - It may stop with "Windows needs a restart": tell the person to restart. After the
     restart, a PowerShell window finishes the setup on its own. If they start you again,
     run the same command once more; it picks up where it stopped.
   - Inside Ubuntu, sudo needs no password while the setup runs (a temporary rule that the
     run removes at its end), so nothing waits for typing. If the run is cut off, the rule
     still goes: the next run removes it first, and so does the next start of Ubuntu (a
     `[boot]` command in `/etc/wsl.conf`). Never add such a rule yourself.

5. **Hand over.** The Linux user has no password yet. Relay the to-do lines, typically:
   - choose a Linux password: `wsl.exe -u root passwd <user>` (in PowerShell);
   - open WezTerm (or Ubuntu from the Start menu) and run `claude` once to sign in;
   - `gh auth login && gh auth setup-git` for GitHub;
   - open the Claude desktop app once and sign in.

   From then on the person's Claude Code lives inside Ubuntu. Later changes run there:
   `cd ~/ai-workstation-setup && ./install.sh --dry-run --yes`.

"Windows only" (no WSL, no Firstmate) is `.\install.ps1 --yes`; offer it only if the
person asks for it.

## Linux, macOS, or inside WSL

1. `git clone https://github.com/ammfed/ai-workstation-setup ~/ai-workstation-setup`, then
   work in that folder. Inside WSL it must be in the Linux home, never under `/mnt/c`.
2. `./install.sh --dry-run --yes` and show the plan. If Node.js 20+ is missing, the dry run
   stops early; the real run installs it per user with nvm.
3. `./install.sh --yes`.
4. Package installs on Linux need sudo, and your shell cannot type its password, so those
   steps fail with a sudo error. Then ask the person to open a terminal and run
   `cd ~/ai-workstation-setup && ./install.sh --yes` once themselves: it asks for their
   password and does only what is left. Run the dry run again afterwards to confirm.
5. Relay "Left for you to do" (sign-ins: `claude`, `gh auth login`).

## What only the person can do

| Moment | What they do |
| --- | --- |
| Windows administrator prompt | click Yes |
| Firmware virtualization off | turn it on in the BIOS/UEFI, as printed |
| Restart | restart and sign in again |
| Linux password | `wsl.exe -u root passwd <user>` (Windows) or type it when sudo asks (Linux) |
| Sign-ins | `claude`, `gh auth login`, the Claude desktop app, any token the plan asks for |

Details of what runs where on Windows: [windows-wsl.md](windows-wsl.md).
