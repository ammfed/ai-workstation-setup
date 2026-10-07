#!/usr/bin/env node
// update-check - a Claude Code SessionStart hook that says when the ai-workstation-setup
// template has a newer version than your clone.
//
// At most once in 24 hours it fetches the template's default branch (from the `upstream`
// remote when the clone has one, as a fork does, otherwise from `origin`) with a short
// timeout and counts the commits your HEAD does not have yet. When there are any, it shows
// one line with the commands to update. It prints nothing when the clone is up to date,
// when the last check was less than 24 hours ago, and on any failure (offline, a missing
// clone, a timeout), and it always exits 0, so it never holds up a session.
//
// Usage, as the hook command:  node update-check.mjs <path to your clone>
// Set AI_WORKSTATION_SETUP_NO_UPDATE_CHECK=1 to silence it.
// The time and result of the last check are kept in
// ~/.config/ai-workstation-setup/update-check.json.
// Installed by ai-workstation-setup (claude-code module). No dependencies.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DAY = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 5000;

const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=5',
};

function git(clone, args, timeout = 5000) {
  const r = spawnSync('git', ['-C', clone, ...args], { encoding: 'utf8', env, timeout, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Commits the clone's HEAD is behind the template, or null when that cannot be told. */
function behind(clone) {
  if (git(clone, ['rev-parse', '--show-prefix']) !== '') return null; // not the top of a clone
  const remotes = (git(clone, ['remote']) || '').split('\n');
  const remote = remotes.includes('upstream') ? 'upstream' : remotes.includes('origin') ? 'origin' : null;
  if (!remote) return null;
  const head = git(clone, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]);
  const branch = head ? head.slice(remote.length + 1) : 'main';
  if (git(clone, ['fetch', '--quiet', '--no-tags', remote, branch], FETCH_TIMEOUT) === null) return null;
  const count = git(clone, ['rev-list', '--count', `HEAD..refs/remotes/${remote}/${branch}`]);
  return count === null ? null : Number(count);
}

function main() {
  if (process.env.AI_WORKSTATION_SETUP_NO_UPDATE_CHECK) return;
  const clone = process.argv[2];
  if (!clone || !fs.existsSync(clone)) return;
  const file = path.join(os.homedir(), '.config', 'ai-workstation-setup', 'update-check.json');
  const last = readState(file);
  if (Number.isFinite(last.checkedAt) && Date.now() - last.checkedAt < DAY) return;

  const count = behind(clone);
  // A failed check is recorded too, so an offline machine pays the timeout once a day, not every session.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ checkedAt: Date.now(), behind: count })}\n`);
  if (!count) return;

  const home = os.homedir();
  const where = clone === home || clone.startsWith(home + path.sep) ? `~${clone.slice(home.length)}` : clone;
  const [update, install] = process.platform === 'win32' ? ['.\\update.ps1', '.\\install.ps1'] : ['./update.sh', './install.sh'];
  const line = `ai-workstation-setup: ${count} update${count === 1 ? '' : 's'} available. Run ${update}, then ${install} (in ${where}).`;
  process.stdout.write(
    JSON.stringify({ systemMessage: line, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line } }),
  );
}

try {
  main();
} catch {
  // Never block or disturb a session.
}
process.exit(0);
