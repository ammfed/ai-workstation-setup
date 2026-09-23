#!/usr/bin/env node
// Ingest raw files into the vault, one agent run per file.
//
// The design in one line: raw files live outside the vault, under $RAW_DIR, and are never
// copied in and never modified. This script hashes each one, asks your agent CLI to read it
// and write notes about it, and records the result in .ingest/ledger.tsv. The ledger is what
// makes the run repeatable: a file already in it is not read twice.
//
// The agent is yours to choose. Set $AGENT_CLI to the command (for example a coding-agent CLI
// in its non-interactive mode) and $AGENT_CLI_ARGS to its flags. This script does not run a
// local model and does not care which agent you point it at.
//
// Usage:
//   node bin/ingest.mjs --dry-run           list what would be ingested
//   node bin/ingest.mjs --limit 1           ingest one file
//   node bin/ingest.mjs                     ingest everything not yet ledgered
//   node bin/ingest.mjs --file <path>       ingest one named file
//   node bin/ingest.mjs --retry-failed      also retry files whose last row failed
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { vaultRoot } from './lib-vault.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f, fallback) => (argv.indexOf(f) === -1 ? fallback : argv[argv.indexOf(f) + 1]);

const root = vaultRoot([]);
const rawDir = path.resolve(valueOf('--raw-dir', process.env.RAW_DIR || path.join(root, '..', 'raw')));
const ledgerFile = path.join(root, '.ingest', 'ledger.tsv');
const promptFile = path.join(root, 'prompts', 'ingest.md');
const dryRun = has('--dry-run');
const limit = Number(valueOf('--limit', Infinity));
const today = new Date().toISOString().slice(0, 10);

const agentCli = process.env.AGENT_CLI;
const agentArgs = (process.env.AGENT_CLI_ARGS || '').split(' ').filter(Boolean);

const die = (msg) => { console.error(`ingest: ${msg}`); process.exit(2); };

if (!fs.existsSync(rawDir)) die(`$RAW_DIR does not exist: ${rawDir}`);
if (!fs.existsSync(promptFile)) die(`missing prompt: ${promptFile}`);

// ---------------------------------------------------------------- the ledger
// sha256 <TAB> filename <TAB> date <TAB> status <TAB> path-relative-to-RAW_DIR
// Append only. Old rows for a path are kept, never rewritten, so the history of a file
// that changed is still readable.
function readLedger() {
  if (!fs.existsSync(ledgerFile)) return [];
  return fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map((line) => {
    const [sha, filename, date, status, rel] = line.split('\t');
    return { sha, filename, date, status, rel };
  });
}

function appendLedger(row) {
  // Keep the in-memory index in step with the file, so two copies of the same bytes in one
  // batch are still caught as a duplicate rather than both being read.
  latestByPath.set(row.rel, row);
  if (!row.status.startsWith('failed') && !shaToName.has(row.sha)) shaToName.set(row.sha, row.filename);
  if (dryRun) return;
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.appendFileSync(ledgerFile, `${[row.sha, row.filename, row.date, row.status, row.rel].join('\t')}\n`);
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && !e.name.startsWith('.') ? [full] : [];
  });
}

// ---------------------------------------------------------------- what to do with each file
const ledger = readLedger();
const latestByPath = new Map();
for (const row of ledger) latestByPath.set(row.rel, row);
const shaToName = new Map(ledger.filter((r) => !r.status.startsWith('failed')).map((r) => [r.sha, r.filename]));
const retryFailed = has('--retry-failed');

function classify(file) {
  const rel = path.relative(rawDir, file);
  const sha = sha256(file);
  const previous = latestByPath.get(rel);
  if (previous && previous.sha === sha) {
    const failed = previous.status.startsWith('failed');
    if (!failed || !retryFailed) return { action: failed ? 'skip-failed' : 'skip', rel, sha };
    return { action: 'retry', rel, sha };
  }
  if (previous) return { action: 'updated', rel, sha }; // same path, new bytes: a revision
  const twin = shaToName.get(sha);
  if (twin) return { action: 'duplicate', rel, sha, twin };
  return { action: 'new', rel, sha };
}

const WANTED = ['new', 'updated', 'retry', 'duplicate'];
const named = valueOf('--file', null);
const files = named ? [path.resolve(named)] : walk(rawDir).sort();
// Candidates only: each file is classified again just before it is handled, because a file
// ledgered earlier in this same run can change what a later one is.
const candidates = files.filter((f) => WANTED.includes(classify(f).action));

if (!candidates.length) { console.log(`ingest: nothing new in ${rawDir}`); process.exit(0); }

// ---------------------------------------------------------------- the agent hook point
const promptTemplate = fs.readFileSync(promptFile, 'utf8');

function runAgent(item) {
  const prompt = promptTemplate
    .replaceAll('{{FILE}}', path.join(rawDir, item.rel))
    .replaceAll('{{FILENAME}}', path.basename(item.rel))
    .replaceAll('{{SHA256}}', item.sha)
    .replaceAll('{{DATE}}', today)
    .replaceAll('{{VAULT}}', root)
    .replaceAll('{{MODE}}', item.action === 'updated' ? 'revision' : 'new');
  if (!agentCli) die('set $AGENT_CLI to your agent CLI (and $AGENT_CLI_ARGS to its flags)');
  const res = spawnSync(agentCli, agentArgs, { input: prompt, cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
  if (res.status !== 0) console.error(`agent failed on: ${item.rel}`);
  return res.status === 0;
}

let done = 0;
for (const file of candidates) {
  if (done >= limit) break;
  const item = classify(file);
  if (!WANTED.includes(item.action)) continue;
  if (item.action === 'duplicate') {
    console.log(`duplicate  ${item.rel} (same bytes as ${item.twin})`);
    appendLedger({ ...item, filename: path.basename(item.rel), date: today, status: `duplicate-of:${item.twin}` });
    continue;
  }
  if (dryRun) { console.log(`would ingest (${item.action})  ${item.rel}`); done += 1; continue; }
  console.log(`ingest (${item.action})  ${item.rel}`);
  const ok = runAgent(item);
  appendLedger({ ...item, filename: path.basename(item.rel), date: today, status: ok ? (item.action === 'updated' ? 'updated' : 'ingested') : 'failed' });
  done += 1;
}

if (!dryRun && done) {
  const check = spawnSync(process.execPath, [path.join(root, 'bin', 'check.mjs')], { cwd: root, stdio: 'inherit' });
  if (check.status !== 0) console.error('ingest: the vault does not pass bin/check.mjs, fix the notes above before committing');
  spawnSync(process.execPath, [path.join(root, 'bin', 'index.mjs')], { cwd: root, stdio: 'inherit' });
}
console.log(`ingest: ${done} file(s) handled${dryRun ? ' (dry run)' : ''}`);
