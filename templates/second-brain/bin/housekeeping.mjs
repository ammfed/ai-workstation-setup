#!/usr/bin/env node
// The unattended pass: validate the vault, then regenerate MAP.md.
//
// This is the pattern, not a scheduler. Point whatever you already use at it, a systemd user
// timer, a launchd agent, Task Scheduler, or cron, every few hours, or run it by hand after a
// batch of edits. It is deliberately boring: it reads and validates, it writes exactly one
// generated file, it makes no network calls and needs no credentials, so it is safe to leave
// running without supervision.
//
// It does NOT ingest. Reading new raw material costs money and deserves a person nearby, so
// bin/ingest.mjs stays a thing you run on purpose.
//
// Usage: node bin/housekeeping.mjs [--quiet]
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { vaultRoot } from './lib-vault.mjs';

const root = vaultRoot([]);
const quiet = process.argv.includes('--quiet');
const stdio = quiet ? 'pipe' : 'inherit';
const run = (script) => spawnSync(process.execPath, [path.join(root, 'bin', script)], { cwd: root, stdio });

const check = run('check.mjs');
const index = run('index.mjs');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

if (check.status !== 0 && quiet) process.stdout.write(check.stdout?.toString() || '');
console.log(`housekeeping ${stamp}: contract ${check.status === 0 ? 'ok' : 'FAILING'}, map ${index.status === 0 ? 'regenerated' : 'FAILED'}`);

// A failing contract is worth a non-zero exit so a timer can surface it, but it never stops
// the reindex above: a vault with one bad note still deserves a current map.
process.exit(check.status === 0 && index.status === 0 ? 0 : 1);
