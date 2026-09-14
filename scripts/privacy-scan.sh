#!/usr/bin/env bash
# privacy-scan.sh - block secrets and private terms from entering this public repo.
#
# Three checks, over the working tree (tracked + untracked, not ignored) and the
# full history of HEAD (patches, file names and commit messages):
#   1. gitleaks, when it is on PATH or runnable through docker; otherwise a notice
#      (CI always runs the official gitleaks action).
#   2. generic secret patterns (API keys, tokens, private keys, email addresses).
#   3. a private denylist: one case-insensitive term per line, read from a LOCAL
#      file that is never committed (default .privacy-denylist.txt, gitignored).
#      Occurrences listed in scripts/privacy-allow.txt are removed first.
#
# Hits are reported by location only - never by content - so a scan log cannot
# leak the thing it found.
#
# Usage: scripts/privacy-scan.sh [--tree-only] [--denylist FILE]
#   PRIVACY_DENYLIST=FILE   same as --denylist
#   PRIVACY_SCAN_DOCKER=0   do not try gitleaks through docker
# Exit status: 0 clean, 1 hits found, 2 usage error.

set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

tree_only=0
denylist=${PRIVACY_DENYLIST:-.privacy-denylist.txt}
while [ $# -gt 0 ]; do
  case "$1" in
    --tree-only) tree_only=1 ;;
    --denylist) denylist=${2:?--denylist needs a file}; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

allowlist=scripts/privacy-allow.txt
hits=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

section() { printf '\n== %s\n' "$1"; }

# Build the scan corpus once: one file for the tree (path:line:text), one for history.
git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  grep -Iq . "$f" 2>/dev/null || continue # skip binaries and empty files
  printf 'path:%s\n' "$f"
  awk -v f="$f" '{ print f ":" FNR ":" $0 }' "$f"
done >"$tmp/tree.txt"

if [ "$tree_only" -eq 0 ] && git rev-parse -q --verify HEAD >/dev/null; then
  git log -p --no-color --no-ext-diff --format='commit %H%n%B' HEAD | awk '
    /^commit [0-9a-f]{40}$/ { c = substr($2, 1, 12); print; next }
    /^\+\+\+ b\// { f = substr($0, 7) }
    { print "commit " c " " f ": " $0 }' >"$tmp/history.txt"
else
  : >"$tmp/history.txt"
fi

# ---------------------------------------------------------------- 1. gitleaks
section "gitleaks"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks dir --no-banner --redact . || hits=1
  [ "$tree_only" -eq 1 ] || gitleaks git --no-banner --redact . || hits=1
elif [ "${PRIVACY_SCAN_DOCKER:-1}" != 0 ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm -v "$root:/repo" ghcr.io/gitleaks/gitleaks:latest dir --no-banner --redact /repo || hits=1
  [ "$tree_only" -eq 1 ] || docker run --rm -v "$root:/repo" ghcr.io/gitleaks/gitleaks:latest git --no-banner --redact /repo || hits=1
else
  echo "gitleaks not available (no binary, no docker): skipped here; CI runs it on every PR."
fi

# Report matching locations without echoing content.
# $1 = label, stdin = corpus lines "location: text"; prints the location part only.
report() {
  local label=$1 found
  found=$(cut -d: -f1-2 | sort -u)
  if [ -n "$found" ]; then
    printf '%s\n' "$found" | sed "s/^/  [$label] /"
    hits=1
  fi
}

# ---------------------------------------------------------------- 2. secret patterns
section "secret patterns"
patterns=(
  'aws-key:AKIA[0-9A-Z]{16}'
  'github-token:(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})'
  'anthropic-key:sk-ant-[A-Za-z0-9_-]{20,}'
  'openai-key:sk-(proj-)?[A-Za-z0-9]{32,}'
  'slack-token:xox[abprs]-[A-Za-z0-9-]{10,}'
  'google-key:AIza[0-9A-Za-z_-]{35}'
  'clickup-token:pk_[0-9]+_[A-Z0-9]{20,}'
  'private-key:-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'
  'bearer-token:[Bb]earer [A-Za-z0-9._~+/-]{24,}'
)
for entry in "${patterns[@]}"; do
  name=${entry%%:*}
  re=${entry#*:}
  report "$name" < <(cat "$tmp/tree.txt" "$tmp/history.txt" | grep -E -- "$re" || true)
done
# Email addresses, except documentation placeholders and GitHub noreply identities.
# The local part must start with a letter or digit, so an "@AGENTS.md" import is not an address.
report email < <(cat "$tmp/tree.txt" "$tmp/history.txt" |
  grep -E '[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' |
  grep -vE '@(example\.(com|org|net)|users\.noreply\.github\.com)' || true)

# ---------------------------------------------------------------- 3. private denylist
section "private denylist"
if [ -f "$denylist" ]; then
  report denylist < <(awk -v allowfile="$allowlist" -v denyfile="$denylist" '
    BEGIN {
      while ((getline t < denyfile) > 0) { gsub(/\r|^[ \t]+|[ \t]+$/, "", t); if (t != "" && t !~ /^#/) terms[++n] = tolower(t) }
      while ((getline a < allowfile) > 0) { gsub(/\r|^[ \t]+|[ \t]+$/, "", a); if (a != "" && a !~ /^#/) allow[++m] = tolower(a) }
    }
    {
      line = tolower($0)
      for (i = 1; i <= m; i++) while ((p = index(line, allow[i])) > 0) line = substr(line, 1, p - 1) substr(line, p + length(allow[i]))
      for (i = 1; i <= n; i++) if (index(line, terms[i])) { print $0; break }
    }' "$tmp/tree.txt" "$tmp/history.txt")
  echo "checked $(grep -cvE '^[[:space:]]*(#|$)' "$denylist") private terms"
else
  echo "no denylist at $denylist: skipped (create it locally; never commit it)."
fi

section "result"
if [ "$hits" -ne 0 ]; then
  echo "FAIL: privacy scan found hits (locations above). Fix them before pushing; rewrite history if a hit was committed."
  exit 1
fi
echo "clean"
