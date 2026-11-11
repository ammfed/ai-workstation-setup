#!/usr/bin/env node
// backpass-gate - runs backpass (github.com/kunchenguid/backpass) behind a privacy gate.
//
// backpass reads your past agent sessions for a project and proposes fixes to that
// project's instruction files. Its analysis sends session content to an AI model, so
// this wrapper only lets a run through when:
//   - the project is on your allowlist (config.json "projects");
//   - the kill switch file ("off", next to this script) does not exist;
//   - no other run holds the lock;
//   - your denylist file has at least one word, and none of the sessions backpass would
//     read mentions any of them (checked locally with `backpass scan`, before any model
//     call; a project with any hit is skipped whole, since backpass has no per-session
//     exclude);
//   - one agent and one model are pinned for both passes (config.json "agent", "model").
// It never runs `backpass apply`: proposals wait for you to review and apply yourself.
// backpass only finds a session when it ran in the project folder, in one of its git
// worktrees, or in another clone of the same repository that sits next to it. Clones kept
// anywhere else are named in config.json "cloneRoots" (a clone, or a folder of clones;
// `~` and `*` allowed). The gate lists them in backpass's own user config before it looks
// for sessions, so the check and the run see the same sessions. backpass takes a clone
// from there only when it shares a git remote with the project.
// A session that starts between the local check and the run is not covered, so the
// scheduled mode only runs while you are not actively working in that project.
//
// Usage:
//   node backpass-gate.mjs                      every allowed project, one after another
//   node backpass-gate.mjs --project <path>     one allowed project
//   node backpass-gate.mjs --scheduled          the most overdue allowed project that passes the
//                                               checks, so a project that is always skipped
//                                               does not hold up the others; a project
//                                               whose last run failed is due again after a day
//   add --dry-run to do every check without calling a model
//   (a dry run still lists the clone folders, or its result would differ from a real run)
//
// Logs one line per run to runs.log next to this script (counts only, never content).
// Installed by ai-workstation-setup (backpass module). No dependencies.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = {
  config: path.join(HERE, 'config.json'),
  off: path.join(HERE, 'off'),
  lock: path.join(HERE, 'run.lock'),
  log: path.join(HERE, 'runs.log'),
  state: path.join(HERE, 'state.json'),
};
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const BUSY_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag('--dry-run');

function log(project, outcome) {
  const line = `${new Date().toISOString()}\t${project ? path.basename(project) : '-'}\t${outcome}${dryRun ? '\t(dry run)' : ''}\n`;
  fs.appendFileSync(FILES.log, line);
  process.stdout.write(line);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function expandHome(p) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.resolve(String(p).replace(/^~(?=$|[\\/])/, home));
}

// The folders that the "cloneRoots" patterns name and that exist now. `*` stands for any
// run of characters inside one folder name.
export function cloneRootDirs(patterns) {
  const found = new Set();
  for (const pattern of patterns) {
    const full = expandHome(pattern);
    const { root } = path.parse(full);
    let dirs = [root];
    for (const part of full.slice(root.length).split(path.sep).filter(Boolean)) {
      if (!part.includes('*')) {
        dirs = dirs.map((d) => path.join(d, part));
        continue;
      }
      const name = new RegExp(`^${part.split('*').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      dirs = dirs.flatMap((d) => {
        try {
          return fs.readdirSync(d).filter((n) => name.test(n)).map((n) => path.join(d, n));
        } catch {
          return [];
        }
      });
    }
    for (const d of dirs) if (fs.statSync(d, { throwIfNoEntry: false })?.isDirectory()) found.add(d);
  }
  return [...found].sort();
}

// backpass reads its clone roots only from its user config (it has no flag for them).
export function backpassUserConfig() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'backpass', 'config.json');
}

// Adds the folders to discovery.cloneRoots in backpass's user config and keeps everything
// else in that file. A file that is not readable JSON is left alone.
export function listCloneRoots(file, dirs) {
  if (!dirs.length) return;
  let config = {};
  if (fs.existsSync(file)) {
    config = readJson(file, null);
    if (!config || typeof config !== 'object' || Array.isArray(config)) return;
  }
  const listed = Array.isArray(config.discovery?.cloneRoots) ? config.discovery.cloneRoots : [];
  const missing = dirs.filter((d) => !listed.includes(d));
  if (!missing.length) return;
  config.discovery = { ...config.discovery, cloneRoots: [...listed, ...missing] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

function backpass(cwd, extra) {
  const r = spawnSync('npx', ['--yes', 'backpass', ...extra], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function lock() {
  try {
    fs.writeFileSync(FILES.lock, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    const age = Date.now() - fs.statSync(FILES.lock).mtimeMs;
    if (age < LOCK_STALE_MS) return false;
    fs.rmSync(FILES.lock, { force: true });
    return lock();
  }
}

function fileMentions(file, pattern) {
  try {
    return pattern.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return true; // unreadable means unchecked, and unchecked is treated as a hit
  }
}

function gate(project, pattern) {
  const scan = backpass(project, ['scan', '--json', '--host', 'none']);
  if (scan.status !== 0) return { ok: false, why: `backpass scan exited ${scan.status}` };
  let transcripts;
  try {
    transcripts = JSON.parse(scan.stdout).transcripts || [];
  } catch {
    return { ok: false, why: 'backpass scan output was not readable' };
  }
  const paths = transcripts.map((t) => t.path).filter(Boolean);
  if (paths.length !== transcripts.length) return { ok: false, why: 'a session has no local file to check' };
  if (!paths.length) return { ok: false, why: 'no sessions to analyze' };
  const hits = paths.filter((p) => fileMentions(p, pattern)).length;
  if (hits) return { ok: false, why: `${hits} of ${paths.length} sessions mention a denylisted word` };
  const newest = Math.max(...paths.map((p) => fs.statSync(p).mtimeMs));
  if (flag('--scheduled') && Date.now() - newest < BUSY_MS) return { ok: false, why: 'a session in this project is still active' };
  return { ok: true, count: paths.length };
}

// Returns true when the project passed the checks (and ran, unless this is a dry run).
function runProject(project, config, pattern) {
  if (!fs.existsSync(project)) {
    log(project, 'skipped: folder not found');
    return false;
  }
  const checked = gate(project, pattern);
  if (!checked.ok) {
    log(project, `skipped: ${checked.why}`);
    return false;
  }
  if (dryRun) {
    log(project, `gate passed: ${checked.count} sessions clean`);
    return true;
  }
  const started = Date.now();
  const r = backpass(project, [
    '--host', 'none',
    '--analysis-agent', config.agent, '--analysis-model', config.model,
    '--synthesis-agent', config.agent, '--synthesis-model', config.model,
    '--quiet',
  ]);
  const state = readJson(FILES.state, {});
  // A failed run (offline, a model outage) is retried after a day, not after the full cooldown.
  state[project] = r.status === 0 ? { lastRun: Date.now() } : { lastRun: Date.now(), failed: true };
  fs.writeFileSync(FILES.state, JSON.stringify(state, null, 2));
  if (r.status !== 0) {
    log(project, `failed: backpass exited ${r.status}`);
    return true;
  }
  // backpass prints no count; its proposal file is rewritten only when a run produces one.
  const proposal = readJson(path.join(project, '.backpass', 'proposal.json'), null);
  const edits = proposal && Date.parse(proposal.generatedAt) >= started ? (proposal.edits || []).length : 0;
  log(project, `done: ${edits} proposed edits from ${checked.count} sessions; review them with \`backpass apply\` in that project`);
  return true;
}

function main() {
  // cron starts with a bare PATH; make sure npx next to this node is found.
  process.env.PATH = [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter);
  if (fs.existsSync(FILES.off)) return log(null, 'skipped: kill switch present');
  const config = readJson(FILES.config, null);
  if (!config) return log(null, 'skipped: config.json missing or unreadable');
  const projects = (config.projects || []).map(expandHome);
  if (!projects.length) return log(null, 'skipped: no projects on the allowlist');
  if (!config.agent || !config.model) return log(null, 'skipped: agent and model must both be pinned');

  const words = fs.existsSync(expandHome(config.denylist || ''))
    ? fs.readFileSync(expandHome(config.denylist), 'utf8').split(/\r?\n/).map((w) => w.trim()).filter((w) => w && !w.startsWith('#'))
    : [];
  if (!words.length) return log(null, 'skipped: the denylist is empty, so nothing could be checked');
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

  let targets = projects;
  const one = option('--project');
  if (one) {
    const wanted = expandHome(one);
    if (!projects.includes(wanted)) return log(wanted, 'skipped: not on the allowlist');
    targets = [wanted];
  } else if (flag('--scheduled')) {
    const state = readJson(FILES.state, {});
    const cooldown = (Number(config.cooldownDays) || 7) * DAY_MS;
    const wait = (p) => (state[p]?.failed ? Math.min(DAY_MS, cooldown) : cooldown);
    const due = projects.filter((p) => Date.now() - (state[p]?.lastRun || 0) >= wait(p));
    if (!due.length) return log(null, 'skipped: every project ran recently');
    targets = due.sort((a, b) => (state[a]?.lastRun || 0) - (state[b]?.lastRun || 0));
  }

  if (!lock()) return log(null, 'skipped: another run is in progress');
  try {
    try {
      listCloneRoots(backpassUserConfig(), cloneRootDirs(Array.isArray(config.cloneRoots) ? config.cloneRoots : []));
    } catch {
      log(null, 'the clone folders could not be listed in the backpass config, so sessions in them are not found');
    }
    for (const project of targets) {
      if (runProject(project, config, pattern) && flag('--scheduled')) break;
    }
  } finally {
    fs.rmSync(FILES.lock, { force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
