#!/bin/sh
# research-browser - a separate, visible Chrome window that belongs to your agents.
#
# It runs its own profile (never your everyday browser), so sites you sign in to
# there stay signed in for agent research, and your own tabs are never touched.
#
# Usage:
#   research-browser              start the window once (no-op if it is running)
#   research-browser axi <args>   run chrome-devtools-axi against that window
#
# Environment:
#   RESEARCH_BROWSER_PORT      remote-debugging port (default 9333)
#   RESEARCH_BROWSER_PROFILE   profile directory (default ~/.config/research-browser)
#   RESEARCH_BROWSER_CHROME    Chrome or Chromium binary (default: first one found)
#   CHROME_DEVTOOLS_AXI_SESSION  name a session per agent task (default research)
#
# Installed by ai-workstation-setup (agent-clis module).
set -eu

port=${RESEARCH_BROWSER_PORT:-9333}
profile=${RESEARCH_BROWSER_PROFILE:-$HOME/.config/research-browser}
url="http://127.0.0.1:$port"

running() {
  curl -sf "$url/json/version" >/dev/null 2>&1
}

find_chrome() {
  if [ -n "${RESEARCH_BROWSER_CHROME:-}" ]; then
    echo "$RESEARCH_BROWSER_CHROME"
    return
  fi
  for bin in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$bin" >/dev/null 2>&1; then
      command -v "$bin"
      return
    fi
  done
  for app in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$app" ]; then
      echo "$app"
      return
    fi
  done
}

if ! running; then
  chrome=$(find_chrome)
  if [ -z "$chrome" ]; then
    echo "research-browser: no Chrome or Chromium found; set RESEARCH_BROWSER_CHROME" >&2
    exit 1
  fi
  mkdir -p "$profile"
  nohup "$chrome" --remote-debugging-port="$port" --user-data-dir="$profile" \
    --no-first-run --no-default-browser-check about:blank >/dev/null 2>&1 &
  tries=0
  until running; do
    tries=$((tries + 1))
    if [ "$tries" -gt 40 ]; then
      echo "research-browser: Chrome did not open port $port" >&2
      exit 1
    fi
    sleep 0.25
  done
fi

if [ "${1:-}" = axi ]; then
  shift
  CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-research} \
    CHROME_DEVTOOLS_AXI_BROWSER_URL=$url \
    exec chrome-devtools-axi "$@"
fi
echo "research browser running at $url (profile $profile)"
