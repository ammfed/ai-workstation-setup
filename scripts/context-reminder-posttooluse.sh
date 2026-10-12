#!/usr/bin/env bash
# context-reminder-posttooluse.sh - let the context reminder speak during long tool runs.
#
# The installer (claude-code module) does this on its own. This script is for a setup whose
# Claude Code settings file is protected from agent edits: you run it yourself. It
#   1. copies the shipped context-reminder hook into your Claude hooks folder, and
#   2. registers that hook on PostToolUse in your Claude settings file, with the same
#      command it already has on UserPromptSubmit. Nothing else in the file changes.
# Before it changes a file it keeps a copy next to it (<file>.bak-posttooluse-<time>).
# Running it again changes nothing. --undo puts back the files from the latest backup.
#
# Usage: scripts/context-reminder-posttooluse.sh [--dry-run | --undo]
#   CLAUDE_CONFIG_DIR   your Claude folder, if it is not $HOME/.claude
# Exit status: 0 ok, 1 nothing to do it with (no reminder installed, no backup), 2 usage error.

set -euo pipefail

mode=apply
case "${1:-}" in
  '') ;;
  --dry-run) mode=dry-run ;;
  --undo) mode=undo ;;
  -h | --help)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "unknown option: $1 (use --dry-run or --undo)" >&2
    exit 2
    ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
source_hook="$here/../templates/claude-code/bin/context-reminder.mjs"
claude=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
hook="$claude/hooks/context-reminder.mjs"
settings="$claude/settings.json"
tag=bak-posttooluse

if [ "$mode" = undo ]; then
  latest=$(find "$claude" "$claude/hooks" -maxdepth 1 -name "*.$tag-*" 2>/dev/null | sed "s/.*\.$tag-//" | sort | tail -n 1)
  if [ -z "$latest" ]; then
    echo "no backup made by this script was found in $claude" >&2
    exit 1
  fi
  for file in "$settings" "$hook"; do
    if [ -f "$file.$tag-$latest" ]; then
      cp -p "$file.$tag-$latest" "$file"
      echo "restored $file from $(basename "$file").$tag-$latest"
    fi
  done
  exit 0
fi

command -v node >/dev/null || {
  echo 'node is not on PATH; the installer sets it up' >&2
  exit 1
}

# Prints the settings file with the PostToolUse entry added, or nothing when it is there.
# Exits 3 when no context-reminder hook is registered on UserPromptSubmit.
new_settings=$(
  node - "$settings" <<'EOF'
const fs = require('node:fs');
const file = process.argv[2];
let s;
try {
  s = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(3);
}
const ours = (h) => String(h?.command || '').includes('context-reminder.mjs');
const command = (s.hooks?.UserPromptSubmit || []).flatMap((m) => m?.hooks || []).find(ours)?.command;
if (!command) process.exit(3);
const post = s.hooks.PostToolUse || [];
if (post.some((m) => (m?.hooks || []).some((h) => h?.command === command))) process.exit(0);
// The same rule as the installer: one context-reminder entry per event, the newest command.
s.hooks.PostToolUse = post.map((m) => ({ ...m, hooks: (m?.hooks || []).filter((h) => !ours(h)) })).filter((m) => m.hooks.length);
s.hooks.PostToolUse.push({ hooks: [{ type: 'command', command }] });
process.stdout.write(`${JSON.stringify(s, null, 2)}\n`);
EOF
) || {
  echo "no context-reminder hook on UserPromptSubmit in $settings; run the installer with CLAUDE_CONTEXT_REMINDER=yes first" >&2
  exit 1
}

copy_hook=0
cmp -s "$source_hook" "$hook" || copy_hook=1
if [ "$copy_hook" = 0 ] && [ -z "$new_settings" ]; then
  echo 'nothing to change: the hook is current and registered on PostToolUse'
  exit 0
fi

stamp=$(date +%Y%m%d-%H%M%S)
if [ "$mode" = dry-run ]; then
  [ "$copy_hook" = 0 ] || echo "would copy the shipped hook to $hook (backup $(basename "$hook").$tag-$stamp)"
  [ -z "$new_settings" ] || echo "would register the hook on PostToolUse in $settings (backup $(basename "$settings").$tag-$stamp)"
  exit 0
fi

if [ "$copy_hook" = 1 ]; then
  mkdir -p "$(dirname "$hook")"
  [ ! -f "$hook" ] || cp -p "$hook" "$hook.$tag-$stamp"
  cp "$source_hook" "$hook"
  echo "copied the shipped hook to $hook"
fi
if [ -n "$new_settings" ]; then
  cp -p "$settings" "$settings.$tag-$stamp"
  printf '%s\n' "$new_settings" >"$settings"
  echo "registered the hook on PostToolUse in $settings"
fi
echo "backups end in .$tag-$stamp; undo with: $0 --undo"
