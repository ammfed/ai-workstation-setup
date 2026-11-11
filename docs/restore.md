# Restoring on a new machine

This page brings a workstation back after the old one is lost or replaced. It starts from a
blank Linux, macOS or WSL machine. A clean install brings back the tools and their
settings. Your own records (the notes vault, Firstmate's records, Claude Code memory, your
installer answers and any timers you made by hand) come back only from your own copies, so
this page says where each one goes.

Placeholders used below:

| Placeholder | Meaning |
| --- | --- |
| `<your-github-user>` | your GitHub account |
| `<vault-repo>` | your private notes vault repository, if you keep one |
| `<records-backup-repo>` | your private repository with a copy of Firstmate's records and Claude Code memory, if you keep one |

This repository does not make or define that records backup. The steps that use it assume
a plain copy of the folders named below. If your backup is laid out differently, map each
folder to the place this page names.

On Windows, the usual Windows route runs the whole setup inside Ubuntu in one go, and that
creates an empty vault before you can clone yours. So install WSL with Ubuntu first, the way
Microsoft documents it (`wsl --install`, then restart), and do the steps below inside Ubuntu.
Afterwards, run `.\install.ps1 --modules wsl` from a Windows copy of this repository to add the
Windows apps. It runs the setup inside Ubuntu again, which is safe to repeat.

## 1. Sign in to GitHub

Install git and the GitHub CLI from your system's packages if they are missing, then:

```sh
gh auth login
gh auth setup-git
```

Private repositories (your vault, your records backup, your projects) need this before
they can be cloned.

## 2. Clone your vault first

Clone the vault to the path you will give the installer as `VAULT_PATH` (default
`~/second-brain`) **before** the install:

```sh
git clone https://github.com/<your-github-user>/<vault-repo> ~/second-brain
```

When the vault folder is already a git repository with commits, the second-brain module
leaves your files alone and skips its starter files (unless you answer `VAULT_REFRESH=yes`).
It still adds the vault contract files that are missing
([An existing vault](second-brain.md#an-existing-vault)). If you install first and clone
later, the clone fails because the folder is no longer empty.

The raw sources folder (`VAULT_RAW_DIR`, default `~/raw-sources`) sits outside the vault and
outside git. Put it back from your own copy now, if you keep one.

## 3. Clone this setup

```sh
git clone https://github.com/<your-github-user>/ai-workstation-setup ~/ai-workstation-setup
cd ~/ai-workstation-setup
```

Use your fork if you have one, or the upstream template. Inside WSL, keep the clone in the
Linux home, never under `/mnt/c`.

## 4. Recreate your installer answers

Your answers live in `answers.env`, which is gitignored, so a fresh clone has none. Pick one:

- You kept a private copy of `answers.env`: put it back next to `install.sh`.
- You did not: copy `answers.example.env` to `answers.env` and set the keys that matter,
  at least the paths, to the same values as before: `VAULT_PATH`, `VAULT_RAW_DIR`,
  `FIRSTMATE_DIR`, `FIRSTMATE_HOME`, and the `DAILY_SYNC_*` paths if you use the daily sync.
- Or skip the file and let the installer ask (type `c` at the first screen to choose).

Matching paths matter: Firstmate's records and Claude Code memory folders refer to them.

## 5. Set the keys

Secrets never go in `answers.env`. Export the ones your modules use in the shell that runs
the installer, or paste them on the installer's last screen at a terminal:

```sh
export CLICKUP_TOKEN=...
export CONTEXT7_API_KEY=...
export OPENROUTER_API_KEY=...
```

## 6. Run the installer

```sh
./install.sh --dry-run   # read the plan, nothing changes
./install.sh             # install
```

An agent without a terminal adds `--yes` to both and follows
[install-with-ai.md](install-with-ai.md). Read the summary at the end. The timers and
services the installer owns (for example vault housekeeping and garden, daily sync, ledger,
news digest and the backpass schedule) come back with this run when your answers switch
them on.

## 7. Sign in to each tool

The install lists every sign-in under "Left for you to do". Typically: run `claude` once,
open the Claude desktop app once, and sign in to any other tool the list names (ClickUp,
Composio, Google Workspace, an agent CLI). Restart Claude Code afterwards so new skills and
settings load.

## 8. Restore Firstmate records and Claude Code memory

Stop here if you keep no records backup. Otherwise clone it **outside** every target
folder:

```sh
git clone https://github.com/<your-github-user>/<records-backup-repo> ~/restore-source
```

Copy each folder to its place. Look at what a target folder holds before you copy into
it, and move aside anything you mean to replace.

| From the backup | To |
| --- | --- |
| the main home's `data/` | `data/` in the Firstmate home (your `FIRSTMATE_HOME` answer, or the `FIRSTMATE_DIR` clone when that is empty) |
| the main home's `projects/`, if you backed it up | `projects/` in the same home |
| each second mate's `data/` | `data/` inside that second mate's home |
| each Claude Code memory folder | `~/.claude/projects/<project-folder>/memory/` |

The install in step 6 already wrote `data/captain.md` and, when you have private rules,
`data/captain-shared.md` into the main home. Your backup copies of these files are your own
edits, so let them replace the fresh ones.

Notes:

- Copy with `cp -a <from>/. <to>/` (or `rsync -a`) so file times and hidden files come along.
- Second-mate homes are listed in the main home's `data/secondmates.md`. If a home folder
  is gone, let Firstmate create it again with its own `bin/fm-home-seed.sh` before you copy
  its data in.
- After the copy, always rerun `./install.sh --modules firstmate`. The module finds the
  second mates in `data/secondmates.md`, which did not exist during step 6, so only this
  rerun gives each home its `FM_HOME` pin ([Firstmate notes](firstmate.md#second-mates)).
- Claude Code names each project folder after the project's full path, with the
  separators and dots turned into `-`. When your user name or project paths changed, the folder names change
  too: copy each memory folder under the new name.
- Do not restore `state/` from an old machine. It describes workers and sessions that no
  longer run.

## 9. Recreate your own timers and Firstmate config

The installer writes the Firstmate config files it owns from your answers. Anything you
added to `config/` by hand, and any timer or cron job you made by hand, comes back only from
your own copy or notes:

- systemd user timers: put the `.service` and `.timer` files back in
  `~/.config/systemd/user/`, then `systemctl --user daemon-reload` and
  `systemctl --user enable --now <name>.timer`. To let them run while you are logged out,
  also run `loginctl enable-linger`.
- cron: `crontab -e` and add the lines back.
- macOS: put the agent `.plist` files back in `~/Library/LaunchAgents/` and load them with
  `launchctl bootstrap gui/$(id -u) <file>`.

Before you switch a timer on, check that every path it names exists on this machine.

## 10. Clone your project repositories

Clone each project to the same path it had before, so the project memory folders from step
8 match. Firstmate's own projects live under its home's `projects/` folder:

```sh
git clone https://github.com/<your-github-user>/<project> ~/<path>/<project>
```

## Check the result

- `./install.sh --dry-run` shows the plan with no errors, and a real rerun ends with nothing failed.
- Open Claude Code in one project and ask what it remembers about it. It answers from the
  restored memory folder.
- Start Firstmate. It finds its home, its second mates and its records.
- `systemctl --user list-timers` (Linux, WSL) or `launchctl list` (macOS) shows your timers.

Do a test restore into a spare user account or a virtual machine once, before you need it
for real.
