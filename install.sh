#!/usr/bin/env bash
# install.sh - entry point on Linux, macOS and WSL.
#
# The installer itself is lib/installer.mjs and needs Node.js 20+. This script
# only makes sure Node exists (offering to install it per-user with nvm, so no
# sudo and no root-owned npm globals), then hands every argument over.
# Run ./install.sh --help for the options.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
node_min=20
nvm_version=v0.40.7

dry_run=0
assume_yes=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    -y | --yes | --non-interactive) assume_yes=1 ;;
  esac
done

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  return 0
}

if [ "$(node_major)" -lt "$node_min" ]; then
  load_nvm
fi

if [ "$(node_major)" -lt "$node_min" ]; then
  echo "The installer needs Node.js ${node_min}+ (found: $(node --version 2>/dev/null || echo none))."
  install_cmd="curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/${nvm_version}/install.sh | bash && nvm install --lts"
  if [ "$dry_run" -eq 1 ]; then
    echo "  ~ would run: $install_cmd"
    echo "The rest of the plan needs Node.js. Install it (or run without --dry-run) and try again."
    exit 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is needed to install Node.js. Install curl with your package manager, or install Node.js ${node_min}+ yourself, then re-run." >&2
    exit 1
  fi
  if [ "$assume_yes" -eq 0 ]; then
    if [ ! -t 0 ]; then
      echo "No terminal to ask on. Re-run with --yes to install Node.js with nvm, or install Node.js ${node_min}+ first." >&2
      exit 1
    fi
    read -r -p "Install Node.js LTS for your user with nvm (https://github.com/nvm-sh/nvm)? [Y/n] " reply
    case "$reply" in [nN]*) echo "Install Node.js ${node_min}+ and re-run."; exit 1 ;; esac
  fi
  curl -o- "https://raw.githubusercontent.com/nvm-sh/nvm/${nvm_version}/install.sh" | bash
  load_nvm
  nvm install --lts
  if [ "$(node_major)" -lt "$node_min" ]; then
    echo "Node.js is still not available. Open a new terminal and re-run ./install.sh." >&2
    exit 1
  fi
fi

exec node "$here/lib/installer.mjs" "$@"
