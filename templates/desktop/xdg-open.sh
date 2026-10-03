#!/bin/sh
# xdg-open guard: opens a given link at most once every {{WINDOW_SECONDS}} seconds. Some
# tools fire the same "open this URL" many times for one click, which leaves a pile of
# duplicate browser tabs; the repeats are dropped and logged.
#
# Then it hands off to the real xdg-open: the next one on PATH after this file. Put the
# folder holding this file before /usr/bin on PATH (~/.local/bin usually is).
# Log: ~/.local/state/xdg-open-guard.log
#
# Installed by ai-workstation-setup (extras module, open-guard).
window='{{WINDOW_SECONDS}}'
case "$window" in '' | *[!0-9]*) window=5 ;; esac
state="${XDG_STATE_HOME:-$HOME/.local/state}"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/xdg-open-guard"
log="$state/xdg-open-guard.log"
mkdir -p "$state" "$cache"

self=$(readlink -f "$0" 2>/dev/null || echo "$0")
real=""
old_ifs=$IFS
IFS=:
for dir in ${PATH:-}; do
  cand="$dir/xdg-open"
  if [ -x "$cand" ] && [ "$(readlink -f "$cand" 2>/dev/null || echo "$cand")" != "$self" ]; then
    real=$cand
    break
  fi
done
IFS=$old_ifs
if [ -z "$real" ]; then
  echo "xdg-open guard: the real xdg-open is not on PATH" >&2
  exit 127
fi

target="${1:-}"
if [ -n "$target" ] && command -v flock >/dev/null 2>&1; then
  key="$cache/$(printf '%s' "$target" | cksum | cut -d' ' -f1)"
  exec 9>"$key.lock"
  flock 9
  now=$(date +%s)
  last=$(cat "$key" 2>/dev/null || echo 0)
  case "$last" in '' | *[!0-9]*) last=0 ;; esac
  if [ $((now - last)) -lt "$window" ]; then
    echo "$(date '+%F %T') skipped a repeat of $target" >>"$log"
    exit 0
  fi
  echo "$now" >"$key"
  echo "$(date '+%F %T') open $target" >>"$log"
  exec 9>&-
fi
exec "$real" "$@"
