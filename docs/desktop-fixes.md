# Desktop fixes

Small, optional fixes for problems that show up once agents open pages and browsers for you.
Each is off until you pick it and is easy to remove.

| Choice | Module | Where | What it fixes |
| --- | --- | --- | --- |
| `open-guard` in `EXTRAS` | extras | Linux | One click sometimes reaches the browser many times in a second, leaving a pile of duplicate tabs. A small `~/.local/bin/xdg-open` opens the same link at most once every `OPEN_GUARD_SECONDS` (default 5), logs dropped repeats to `~/.local/state/xdg-open-guard.log`, and hands everything else to the real `xdg-open`. Remove: delete `~/.local/bin/xdg-open`. |
| `fontcache-guard` in `EXTRAS` | extras | Linux with systemd | Chrome ships its own newer fontconfig, which can leave `*-le64.cache-9` links in `~/.cache/fontconfig` that make fonts vanish or turn to boxes in other apps. A path unit watches that folder; a one-shot service deletes those links and rebuilds the cache. Remove: `systemctl --user disable --now fontcache-guard.path`. |
| `LAVISH_NO_OPEN_WRAPPER` | agent-clis | Linux, macOS, WSL | `LAVISH_AXI_NO_OPEN=1` only reaches programs started from your shell. A `~/.local/bin/lavish-axi` wrapper sets it every time and runs the real lavish-axi, so review pages never open tabs on their own. Lavish Library's own service is unaffected. Remove: delete `~/.local/bin/lavish-axi`. |
| `TERMINAL_INSTALL_FONT` | terminal | macOS, Linux (Windows by hand) | Installs JetBrainsMono Nerd Font, the first font in the WezTerm config, from Nerd Fonts' own release (Homebrew cask on macOS, the release archive into `~/.local/share/fonts` on Linux). |

Both wrappers only work when `~/.local/bin` comes before the real program on `PATH`; the
installer warns when it does not.

OpenWhispr can start at login, hidden in the tray: turn on its own launch-at-login setting
after the first start. The installer does not write that entry itself, so the app's switch
stays the one place to change it.
