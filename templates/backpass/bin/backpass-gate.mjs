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
// A session that starts between the local check and the run is not covered, so the
// scheduled mode only runs while you are not actively working in that project.
//
// Usage:
//   node backpass-gate.mjs                      every allowed project, one after another
//   node backpass-gate.mjs --project <path>     one allowed project
//   node backpass-gate.mjs --scheduled          the allowed project that is most overdue
//   add --dry-run to do every check without calling a model
//
// Logs one line per run to runs.log next to this script (counts only, never content).
// Installed by ai-workstation-setup (backpass module). No dependencies.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag('--dry-run');

// cron starts with a bare PATH; make sure npx next to this node is found.
process.env.PATH = [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter);

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

function runProject(project, config, pattern) {
  if (!fs.existsSync(project)) return log(project, 'skipped: folder not found');
  const checked = gate(project, pattern);
  if (!checked.ok) return log(project, `skipped: ${checked.why}`);
  if (dryRun) return log(project, `gate passed: ${checked.count} sessions clean`);
  const r = backpass(project, [
    '--host', 'none',
    '--analysis-agent', config.agent, '--analysis-model', config.model,
    '--synthesis-agent', config.agent, '--synthesis-model', config.model,
    '--quiet',
  ]);
  const state = readJson(FILES.state, {});
  state[project] = { lastRun: Date.now() };
  fs.writeFileSync(FILES.state, JSON.stringify(state, null, 2));
  if (r.status !== 0) return log(project, `failed: backpass exited ${r.status}`);
  const proposals = /(\d+)\s+proposals?/i.exec(r.stdout + r.stderr)?.[1] ?? '?';
  log(project, `done: ${proposals} proposals from ${checked.count} sessions; review them with \`backpass apply\` in that project`);
}

function main() {
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
    const cooldown = (Number(config.cooldownDays) || 7) * 24 * 60 * 60 * 1000;
    const due = projects.filter((p) => Date.now() - (state[p]?.lastRun || 0) >= cooldown);
    if (!due.length) return log(null, 'skipped: every project ran recently');
    due.sort((a, b) => (state[a]?.lastRun || 0) - (state[b]?.lastRun || 0));
    targets = [due[0]];
  }

  if (!lock()) return log(null, 'skipped: another run is in progress');
  try {
    for (const project of targets) runProject(project, config, pattern);
  } finally {
    fs.rmSync(FILES.lock, { force: true });
  }
}

main();
