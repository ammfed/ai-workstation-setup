# Getting updates without losing your setup

Your clone holds two kinds of things:

- **The template**: the installer, its modules, templates and docs. Everyone shares it, and
  it improves over time upstream.
- **Your own material**: your answers (`answers.env`), anything in `local/`, and any other
  gitignored file. It never goes upstream, and updates never touch it.

Everything the installer sets up for you (tools, settings, your vault, your rules file)
lives outside the clone, in your home folder. The installer refuses a folder answer that
points inside the clone, so none of it can be caught up in an update.

## Update

```sh
./update.sh --dry-run    # see what would change, change nothing
./update.sh              # take the update
./install.sh             # apply it
```

On Windows: `powershell -ExecutionPolicy Bypass -File .\update.ps1` (add `--dry-run` to
look first), then `.\install.ps1`.

`update` only ever moves your clone forward to the template's latest version. When that is
not possible it stops, says why, and changes nothing. It never forces, never merges, never
rebases, never stashes and never throws anything away.

Running the installer again reuses your saved answers: it asks only questions that are new
since your last run, drops answers to questions that no longer exist, and never asks again
or resets something you already answered. To change an answer, edit that line in
`answers.env` (or delete it to be asked again). A new module is not switched on for you;
the installer lists modules you have not selected, and you add one by putting its name in
`MODULES` in `answers.env`.

## If you forked the template

A fork's `origin` is your fork, not the template. The first time you run `update` it offers
to add the template as a second remote called `upstream` and asks before doing it. Say yes
and every later update comes from there. You can also add it yourself:

```sh
git remote add upstream https://github.com/ammfed/ai-workstation-setup
```

## When update says no

| It says | What happened | What to do |
| --- | --- | --- |
| local changes | You edited a tracked file or added an untracked one | Commit it, or move your own files into `local/` (gitignored), then run update again |
| diverged | You have commits the template does not, and it has commits you do not | Your choice, done by you: `git merge upstream/main` (or `origin/main`) to combine them, `git rebase` to replay yours on top, or propose yours to the template as a pull request |
| on branch "…" | You are on another branch | `git switch main`, then run update again |
| already exist here | The update adds a file with the same name as one of your own | Rename or move your file, then run update again |
| no upstream | A fork without the template as a remote | Say yes when asked, or pass `--add-upstream` |

Run `./update.sh --help` for every option.
