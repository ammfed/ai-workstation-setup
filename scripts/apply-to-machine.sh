#!/usr/bin/env bash
# apply-to-machine.sh - bring this computer's Claude Code setup up to this template,
# without a full reinstall. Run it yourself, for example when your Claude settings file is
# protected from agent edits. It
#   1. copies the shipped hooks, status line and reader subagent into your Claude folder
#      (a file you edited is replaced only when you say yes),
#   2. merges the hook registrations into ~/.claude/settings.json: the context reminder on
#      UserPromptSubmit, PostToolUse and SessionStart, and the update reminder,
#   3. sets the status line, the default model and effort, and the effort per model only
#      where you have not set them
#      (your own status line is replaced only when you say yes),
#   4. asks y/N before it installs each missing default tool or the diagram-design plugin.
# Every other key in settings.json stays as it is. Before it changes a file it copies it into
# one backup set (~/.config/ai-workstation-setup/apply-backups/<time>/). Running it again
# changes nothing. --undo puts back the files of the latest backup set (installed tools stay).
#
# Usage: scripts/apply-to-machine.sh [--dry-run | --undo]
#   --dry-run           print every change, ask nothing, write nothing
#   CLAUDE_CONFIG_DIR   your Claude folder, if it is not $HOME/.claude
# Exit status: 0 ok, 1 a step failed or no backup to undo, 2 usage error.

set -euo pipefail

case "${1:-}" in
  -h | --help)
    sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

command -v node >/dev/null || {
  echo 'node is not on PATH; ./install.sh sets it up' >&2
  exit 1
}
here=$(cd "$(dirname "$0")" && pwd)
exec node "$here/apply-to-machine.mjs" "$@"
