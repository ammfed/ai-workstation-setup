#!/bin/sh
# lavish-axi wrapper: review pages never open a browser tab by themselves, even when the
# caller did not inherit LAVISH_AXI_NO_OPEN (a desktop launcher, a service, a fresh shell).
# Links are shared in chat instead.
#
# It forwards every argument to the real lavish-axi: the next one on PATH after this
# file, so a Node upgrade that moves the npm bin folder does not break it. Put the folder
# holding this file before the npm bin folder on PATH.
#
# Installed by ai-workstation-setup (agent-clis module, LAVISH_NO_OPEN_WRAPPER).
LAVISH_AXI_NO_OPEN=1
export LAVISH_AXI_NO_OPEN
self=$(readlink -f "$0" 2>/dev/null || echo "$0")
old_ifs=$IFS
IFS=:
for dir in ${PATH:-} ${NVM_BIN:-}; do
  [ -n "$dir" ] || continue
  cand="$dir/lavish-axi"
  if [ -x "$cand" ] && [ "$(readlink -f "$cand" 2>/dev/null || echo "$cand")" != "$self" ]; then
    IFS=$old_ifs
    exec "$cand" "$@"
  fi
done
IFS=$old_ifs
echo "lavish-axi: the real lavish-axi is not on PATH (npm install -g lavish-axi)" >&2
exit 127
