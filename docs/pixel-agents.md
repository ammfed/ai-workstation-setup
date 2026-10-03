# Pixel Agents

[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) shows each running Claude Code
agent as a character in a small pixel office in your browser. Pick `pixel-agents` in the
agent-clis module to install it from npm.

## Start it

```sh
pixel-agents
```

Run it in a terminal and open the address it prints (it picks a free port and keeps running
until you stop it). The first time, it asks before adding its hooks to
`~/.claude/settings.json`; say yes so it sees what each session is doing. That consent is
yours to give, so the installer never grants it for you.

## View settings (`PIXEL_AGENTS_SETTINGS`, on by default)

The installer fills in these values in the `standalone` block of
`~/.pixel-agents/config.json`; any value you already set is kept:

| Setting | Value | What it does |
| --- | --- | --- |
| `alwaysShowLabels` | on | Every character shows its name, not only on hover. |
| `watchAllSessions` | on | Sessions from every folder appear, not only the one you started it in. |
| `showAreas` | on | Named areas you paint on the office floor are drawn. |
| `soundEnabled` | off | No sounds. |

## Office names (`PIXEL_AGENTS_NAMES`, off by default)

Pixel Agents names each character after the folder its agent runs in, so a fleet of workers
in one project all read the same. It has no setting for another name, so this choice patches
the installed program:

- Only pixel-agents versions the patch was written for are touched (listed in
  `modules/agent-clis/pixel-agents.mjs`). Any other version, or a file that does not look as
  expected, is refused and left unchanged.
- `dist/cli.js` is backed up next to itself before it is changed.
- The patch reads `~/.pixel-agents/agent-names.json` (`{ "<session id>": "<name>" }`) at most
  every ten seconds and uses a name it finds there in place of the folder name.
- Updating pixel-agents replaces the patched file. Re-run the installer afterwards; if the new
  version is not on the list, the names go back to folder names until the patch is updated.

`pixel-office-names` (in `~/.local/bin`) fills that file from
[herdr](https://github.com/ogulcancelik/herdr): an agent's own name, else its tab label
(without the prefix in `PIXEL_AGENTS_TAB_PREFIX`, `fm-` by default, which is how Firstmate
names task tabs), else its workspace label. Run it once, or keep it running beside Pixel
Agents:

```sh
pixel-office-names --watch
```

Without herdr, write `agent-names.json` yourself in the same shape. To undo the patch, put the
backup `dist/cli.js.bak-<date>` back, or reinstall with `npm install -g pixel-agents`.
