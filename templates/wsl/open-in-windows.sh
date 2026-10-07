#!/bin/sh
# open-in-windows - open a link or a file from WSL with its Windows default app (links in the
# Windows browser). Installed by ai-workstation-setup (core module, inside WSL) and set as
# BROWSER, so gh, Python and other tools that honour BROWSER open pages on the Windows side.
# A Linux file is handed over by its \\wsl.localhost path (wslpath -w).
#
# Usage: open-in-windows <url-or-file>
set -eu

if [ $# -lt 1 ]; then
  echo "usage: open-in-windows <url-or-file>" >&2
  exit 2
fi
target=$1
case "$target" in
  *://* | mailto:*) ;;
  *) if [ -e "$target" ]; then target=$(wslpath -w "$target"); fi ;;
esac

explorer=$(command -v explorer.exe 2>/dev/null || echo /mnt/c/Windows/explorer.exe)
# explorer.exe exits 1 even when it opened the target, so its status is not a failure.
"$explorer" "$target" || true
