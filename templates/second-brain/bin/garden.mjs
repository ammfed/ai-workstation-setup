#!/usr/bin/env node
// One small, reversible tidy-up pass by your agent CLI: a handful of notes (one "slice", taken
// round-robin so the whole vault is covered over many passes) are rewritten for clearer
// structure and prose, under prompts/garden.md.
//
// The agent is yours to choose, as for bin/ingest.mjs: $AGENT_CLI is the command and
// $AGENT_CLI_ARGS its flags; the prompt arrives on stdin. Nothing here names a provider.
//
// What keeps a pass safe to leave on a timer:
// - The vault must be a git repository. A slice holding a note you have uncommitted changes in
//   is skipped, so the agent never edits work you are in the middle of.
// - Only the slice's notes may change. Anything else the agent touched is put back: a tracked
//   file is restored from git, your own uncommitted files are restored to how they were before
//   the pass, and a new stray file is moved to a removed-files folder outside the vault
//   ($VAULT_REMOVED_DIR, default ~/.local/state/second-brain/removed), never deleted.
// - The changed notes must pass bin/check.mjs, or the whole pass is discarded.
// - A good pass is committed on its own (the notes and MAP.md), never with anything else.
// - One pass at a time: .ingest/lock holds the running pass and doubles as its heartbeat.
//
// Usage:
//   node bin/garden.mjs                 one pass over the next slice
//   node bin/garden.mjs --dry-run       show the next slice and the prompt; change nothing
//   node bin/garden.mjs --status        idle, working (and on what), or stuck
//   Options: --size N (notes per slice, default 8), --timeout MIN (agent time limit, default 20)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { noteDirs, notesIn, vaultRoot } from './lib-vault.mjs';

/** Each note folder's notes in groups of `size`, so a slice never spans two folders. */
export function slices(root, size) {
  return noteDirs(root).flatMap((dir) => {
    const notes = notesIn(root, dir).map((rel) => rel.split(path.sep).join('/'));
    const out = [];
    for (let i = 0; i < notes.length; i += size) out.push({ name: `${dir}/${i / size + 1}`, notes: notes.slice(i, i + size) });
    return out;
  });
}

/** `git status --porcelain -z` as a list of paths (both sides of a rename). */
export function parseStatus(z) {
  const parts = z.split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    out.push(entry.slice(3));
    if (/^[RC]/.test(entry)) out.push(parts[(i += 1)]);
  }
  return out;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

function main() {
  const argv = process.argv.slice(2);
  const valueOf = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
  const size = Number(valueOf('--size', 8));
  const timeoutMin = Number(valueOf('--timeout', 20));
  const root = vaultRoot([]);
  const ingest = path.join(root, '.ingest');
  const lockFile = path.join(ingest, 'lock');
  const cursorFile = path.join(ingest, 'garden-cursor');
  const logFile = path.join(ingest, 'garden-log.tsv');
  const date = new Date().toISOString().slice(0, 10);
  const say = (msg) => console.log(`garden: ${msg}`);
  const die = (msg, code = 2) => { console.error(`garden: ${msg}`); process.exit(code); };
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const readLock = () => { try { return JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { return null; } };

  if (argv.includes('--status')) {
    const run = readLock();
    if (!run) return say('idle: no pass is running');
    if (alive(run.pid)) return say(`working: ${run.script} on ${run.item}, since ${run.started_at}`);
    die(`stuck: ${lockFile} names pid ${run.pid} (${run.script}, ${run.item}) but it is not running; delete the file once you have checked`, 1);
  }
  if (!Number.isInteger(size) || size < 1) die('--size must be a whole number of notes');
  if (git('rev-parse', '--is-inside-work-tree').stdout?.trim() !== 'true') die('the vault must be a git repository, so a pass can always be undone');
  const all = slices(root, size);
  if (!all.length) return say('no notes yet; nothing to do');
  let cursor = 0;
  try { cursor = Number.parseInt(fs.readFileSync(cursorFile, 'utf8'), 10) || 0; } catch { /* first pass */ }
  const slice = all[cursor % all.length];
  const promptFile = path.join(root, 'prompts', 'garden.md');
  if (!fs.existsSync(promptFile)) die(`missing prompt: ${promptFile}`);
  const prompt = fs.readFileSync(promptFile, 'utf8')
    .replaceAll('{{SLICE}}', slice.name)
    .replaceAll('{{NOTES}}', slice.notes.map((n) => `- \`${n}\``).join('\n'))
    .replaceAll('{{VAULT}}', root)
    .replaceAll('{{DATE}}', date);
  if (argv.includes('--dry-run')) {
    say(`next slice ${slice.name} (${slice.notes.length} note(s), ${cursor % all.length + 1} of ${all.length})`);
    console.log(`\n${prompt}`);
    return;
  }
  const agentCli = process.env.AGENT_CLI;
  const agentArgs = (process.env.AGENT_CLI_ARGS || '').split(' ').filter(Boolean);
  if (!agentCli) die('set $AGENT_CLI to your agent CLI (and $AGENT_CLI_ARGS to its flags)');

  fs.mkdirSync(ingest, { recursive: true });
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, script: 'garden', item: slice.name, started_at: new Date().toISOString() }), { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const run = readLock();
    if (run && alive(run.pid)) return say(`another pass is running (${run.script}, ${run.item}); skipped`);
    die(`a stale lock is left from pid ${run?.pid}; check \`node bin/garden.mjs --status\`, then delete ${lockFile}`, 1);
  }

  let result = 'ok';
  let changed = [];
  try {
    const before = new Set(parseStatus(git('status', '--porcelain=v1', '-z', '--untracked-files=all').stdout || ''));
    if (slice.notes.some((n) => before.has(n))) {
      result = 'skipped: you have uncommitted changes in this slice';
      return say(`${result} (${slice.name}); it is tried again next time`);
    }
    // Your own uncommitted files, as they are now, so anything the agent does to them is undone.
    const saved = new Map([...before].map((p) => {
      const f = path.join(root, p);
      return [p, fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f) : null];
    }));
    const head = git('rev-parse', 'HEAD').stdout?.trim();

    say(`pass on ${slice.name}: ${slice.notes.length} note(s)`);
    const res = spawnSync(agentCli, agentArgs, { input: prompt, cwd: root, stdio: ['pipe', 'inherit', 'inherit'], timeout: timeoutMin * 60_000, killSignal: 'SIGKILL' });
    if (git('rev-parse', 'HEAD').stdout?.trim() !== head) {
      result = 'agent-committed';
      return say('the agent made a commit of its own; nothing else was done, review `git log` by hand');
    }

    const removedDir = path.join(process.env.VAULT_REMOVED_DIR || path.join(os.homedir(), '.local', 'state', 'second-brain', 'removed'), new Date().toISOString().replace(/[:.]/g, '-'));
    for (const p of parseStatus(git('status', '--porcelain=v1', '-z', '--untracked-files=all').stdout || '')) {
      if (p.startsWith('.ingest/') || p === 'MAP.md') continue;
      if (slice.notes.includes(p)) {
        if (fs.existsSync(path.join(root, p))) changed.push(p);
        else git('restore', '--source=HEAD', '--staged', '--worktree', '--', p); // a note in the slice is never deleted
        continue;
      }
      const f = path.join(root, p);
      if (saved.has(p)) {
        const was = saved.get(p);
        const now = fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f) : null;
        if (was && (!now || !now.equals(was))) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, was); console.error(`garden: put back your ${p}`); }
        continue;
      }
      if (git('cat-file', '-e', `HEAD:${p}`).status === 0) {
        git('restore', '--source=HEAD', '--staged', '--worktree', '--', p);
        console.error(`garden: restored ${p} (outside this slice)`);
      } else if (fs.existsSync(f)) {
        fs.mkdirSync(path.dirname(path.join(removedDir, p)), { recursive: true });
        fs.renameSync(f, path.join(removedDir, p));
        console.error(`garden: moved stray ${p} to ${removedDir}`);
      }
    }

    if (res.status !== 0) result = res.error?.code === 'ETIMEDOUT' ? 'agent-timeout' : 'agent-failed';
    else if (changed.length && spawnSync(process.execPath, [path.join(root, 'bin', 'check.mjs'), ...changed.map((n) => path.join(root, n))], { cwd: root, stdio: 'inherit' }).status !== 0) result = 'check-failed';
    if (result !== 'ok') {
      for (const n of changed) git('restore', '--source=HEAD', '--staged', '--worktree', '--', n);
      changed = [];
      return say(`${result} on ${slice.name}; this pass's edits were discarded`);
    }
    if (!changed.length) return say(`${slice.name}: nothing needed changing`);
    spawnSync(process.execPath, [path.join(root, 'bin', 'index.mjs')], { cwd: root, stdio: 'ignore' });
    const files = [...changed, ...(fs.existsSync(path.join(root, 'MAP.md')) ? ['MAP.md'] : [])];
    git('add', '--', ...files);
    const c = git('commit', '-q', '-m', `garden: ${slice.name} ${date}`, '--only', '--', ...files);
    if (c.status !== 0) result = `commit-failed: ${(c.stderr || '').trim()}`;
    say(`${slice.name}: ${changed.length} note(s) tidied${result === 'ok' ? ' and committed' : `, but ${result}`}`);
  } finally {
    if (!result.startsWith('skipped')) fs.writeFileSync(cursorFile, `${(cursor + 1) % all.length}\n`);
    fs.appendFileSync(logFile, `${date}\t${slice.name}\t${changed.join(',') || '-'}\t${result}\n`);
    fs.rmSync(lockFile, { force: true });
  }
}


// Run directly, not imported by a test. Real paths on both sides: a symlinked folder (such as
// macOS's /var -> /private/var) would otherwise make the two differ and the script do nothing.
function runAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runAsScript()) main();
