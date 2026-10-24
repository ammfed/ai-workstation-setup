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
// A project note with no stage yet is a warning, not a failure: it is ordinary while a note is
// new. Every other contract problem exits non-zero so a timer can surface it.
//
// It does NOT ingest. Reading new raw material costs money and deserves a person nearby, so
// bin/ingest.mjs stays a thing you run on purpose.
//
// Usage: node bin/housekeeping.mjs [--quiet]
// The vault is $VAULT_PATH, else the folder above this script's bin/. The checker is the
// check.mjs next to this script, so a copy kept outside the vault works the same way.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { vaultRoot } from './lib-vault.mjs';

const root = vaultRoot([]);
const quiet = process.argv.includes('--quiet');
const here = path.dirname(fileURLToPath(import.meta.url));

const check = spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--stage-warnings'], {
  cwd: root,
  env: { ...process.env, VAULT_PATH: root },
  encoding: 'utf8',
});
const out = check.stdout || '';
const warnings = out.split('\n').filter((l) => l.includes(': warning: ')).length;
if (!quiet || check.status !== 0 || warnings) process.stdout.write(out);
if (check.stderr) process.stderr.write(check.stderr);
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const state = check.status === 0 ? 'ok' : 'FAILING';
console.log(`housekeeping ${stamp}: contract ${state}${warnings ? `, ${warnings} warning(s)` : ''}`);
process.exit(check.status === 0 ? 0 : 1);
