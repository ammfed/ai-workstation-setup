#!/usr/bin/env bash
# update.sh - get the template's latest version on Linux, macOS and WSL.
#
# The updater itself is lib/update.mjs: a fast-forward only update that never
# touches your answers or other gitignored files and refuses (explaining why)
# when the clone has local changes or has diverged. It needs Node.js, which
# ./install.sh set up. Run ./update.sh --help for the options.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "The updater needs Node.js. Run ./install.sh once to set it up, then re-run ./update.sh." >&2
  exit 2
fi

exec node "$here/lib/update.mjs" "$@"
