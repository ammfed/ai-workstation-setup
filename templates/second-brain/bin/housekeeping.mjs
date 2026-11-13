#!/usr/bin/env node
// The unattended pass: validate the vault and report what is wrong. It writes nothing.
//
// This is the pattern, not a scheduler. Point whatever you already use at it, a systemd user
// timer, a launchd agent, Task Scheduler, or cron, every few hours, or run it by hand after a
// batch of edits. It is deliberately boring: it only reads, it makes no network calls and needs
// no credentials, so it is safe to leave running without supervision. It never touches MAP.md
// or any other file: a write here would leave the vault dirty for whatever runs next, so
// bin/index.mjs stays the one writer of the map and runs when you or your own jobs run it.
//
// Which checker runs: when the vault has its own executable bin/lint (a vault whose owner keeps
// a stricter or newer contract than this template's), housekeeping runs that and reports its
// result as it is. Otherwise it runs the check.mjs next to this script. That checker accepts a
// project with no stage, because a vault may keep notes that carry none (a log note, a card, a
// redirect); a stage that is present and wrong still fails. Either way a contract problem exits
// non-zero so a timer can surface it.
//
// It does NOT ingest. Reading new raw material costs money and deserves a person nearby, so
// bin/ingest.mjs stays a thing you run on purpose.
//
// Usage: node bin/housekeeping.mjs [--quiet]
// The vault is $VAULT_PATH, else the folder above this script's bin/. The fallback checker is
// the check.mjs next to this script, so a copy kept outside the vault works the same way.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { vaultRoot } from './lib-vault.mjs';

const root = vaultRoot([]);
const quiet = process.argv.includes('--quiet');
const here = path.dirname(fileURLToPath(import.meta.url));

// The vault's own linter, when it has one that can run directly. A file that is present but not
// executable (or any file on Windows, which has no execute bit) is not used.
function vaultLint() {
  const file = path.join(root, 'bin', 'lint');
  try {
    if (process.platform === 'win32' || !fs.statSync(file).isFile()) return null;
    fs.accessSync(file, fs.constants.X_OK);
    return file;
  } catch {
    return null;
  }
}

const own = vaultLint();
const env = { ...process.env, VAULT_PATH: root };
const check = own
  ? spawnSync(own, [], { cwd: root, env, encoding: 'utf8' })
  : spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--allow-no-stage'], { cwd: root, env, encoding: 'utf8' });
const out = check.stdout || '';
if (!quiet || check.status !== 0) process.stdout.write(out);
if (check.stderr) process.stderr.write(check.stderr);
if (check.error) console.error(`housekeeping: could not run ${own || 'check.mjs'}: ${check.error.message}`);
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const ok = check.status === 0;
console.log(`housekeeping ${stamp}: contract ${ok ? 'ok' : 'FAILING'} (${own ? 'bin/lint' : 'check.mjs'})`);
process.exit(ok ? 0 : 1);
