#!/usr/bin/env node
// daily-sync - one daily alignment pass over the tools, notes and task surfaces you depend on.
//
// Every step is plain scripting: fast-forward clean repos, report watched repos that are
// behind, run the vault's own ingest on new raw files, run a tool-update check, compare
// recorded versions with the folder or repo that holds them, and read (never write) ClickUp
// and TickTick to compare them with what you expect. A model is called only to explain a NEW
// drift item a step could not settle itself (at most model.maxCalls per run), so a quiet day
// makes no model call at all. Every model call is counted in the log and the report.
//
// Each run writes one short report to reports/ next to config.json: a quiet run is one line.
// When something changed, needs you, or failed, the report is also piped to your notify
// command. A failed step, a previous run that never finished, or no successful run for
// staleHours makes the report start with FAILED, so the job cannot go quiet unnoticed.
// `--status` prints that FAILED line and nothing otherwise, for a session-start hook, which
// also catches a schedule that stopped running altogether.
//
// Usage:
//   node daily-sync.mjs              the scheduled run
//   node daily-sync.mjs --dry-run    no fetch, pull, ingest, command, model call, notify or state change
//   node daily-sync.mjs --status     one FAILED line when the job needs you, else nothing
//   node daily-sync.mjs --config F   use another config file (default: config.json next to this script)
// Pause it by creating a file named "off" next to config.json; delete it to resume.
//
// Installed by ai-workstation-setup (daily-sync module). No dependencies.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag('--dry-run');

const expandHome = (p) => path.resolve(String(p).replace(/^~(?=$|[\\/])/, os.homedir()));
const tilde = (p) => {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
};

const configFile = expandHome(option('--config') || path.join(HERE, 'config.json'));
const BASE = path.dirname(configFile);
const FILES = {
  off: path.join(BASE, 'off'),
  lock: path.join(BASE, 'run.lock'),
  state: path.join(BASE, 'state.json'),
  log: path.join(BASE, 'daily-sync.log'),
  reports: path.join(BASE, 'reports'),
};
const HOUR = 3_600_000;
const LOG_CAP = 512 * 1024;
const EVIDENCE_CAP = 4000;
const LOCK_STALE_HOURS = 6;

// A timer or cron starts with a bare PATH; make sure the node running this is found first.
process.env.PATH = [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter);
// A repo must never stop to ask for credentials; an unauthenticated fetch fails instead.
process.env.GIT_TERMINAL_PROMPT = '0';

// ---------------------------------------------------------------- small helpers

const pad = (n) => String(n).padStart(2, '0');
function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const lines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const lastLine = (s) => lines(s).at(-1) || '';
const clip = (s, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sample = (list) => `${list.slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;
const exitText = (r) => (r.code === 'timeout' ? 'timed out' : `exit ${r.code}`);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

let logOpened = false;
function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  if (dryRun) return;
  if (!logOpened) {
    logOpened = true;
    try {
      if (fs.statSync(FILES.log).size > LOG_CAP) fs.renameSync(FILES.log, `${FILES.log}.1`);
    } catch {
      // no log yet
    }
  }
  fs.appendFileSync(FILES.log, `${text}\n`);
}

/** Run a shell command. `code` is the exit status, 'timeout', or the spawn error code. */
function sh(cmd, { cwd, env, timeoutSec = 300, input } = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    timeout: timeoutSec * 1000,
    killSignal: 'SIGKILL',
    maxBuffer: 32 * 1024 * 1024,
  });
  const code = r.error ? (r.error.code === 'ETIMEDOUT' ? 'timeout' : r.error.code) : r.status;
  return { code, out: r.stdout || '', err: r.stderr || '' };
}

function git(repo, gitArgs, timeoutSec = 60) {
  const r = spawnSync('git', ['-C', repo, ...gitArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutSec * 1000,
    killSignal: 'SIGKILL',
  });
  const code = r.error ? (r.error.code === 'ETIMEDOUT' ? 'timeout' : r.error.code) : r.status;
  return { code, out: r.stdout || '', err: r.stderr || '' };
}

// A network read gets one more try after a pause, so a blip (DNS, Wi-Fi coming back after
// sleep, a run caught up right after login) is not reported as a failure.
let retryWaitMs = 20_000;
function retry(fn) {
  const first = fn();
  if (first.code === 0) return first;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryWaitMs);
  return fn();
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// ---------------------------------------------------------------- findings

// changed: something this run did. attention: drift it could not settle, reported until it
// clears. failed: a step that could not do its job. Only failed makes the run FAILED.
const items = [];
const add = (level, key, text, extra = {}) => items.push({ level, key, text, ...extra });
const modelCalls = { explain: 0, ingest: 0 };
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
  } catch (err) {
    add('failed', `${name}:error`, `${name}: ${err.message}`);
  }
}

// ---------------------------------------------------------------- repositories

function repoEntry(entry) {
  const e = typeof entry === 'string' ? { path: entry } : entry;
  return { remote: 'origin', ignoreDirty: [], ...e, path: expandHome(e.path) };
}

const isRepo = (p) => fs.existsSync(p) && git(p, ['rev-parse', '--is-inside-work-tree']).out.trim() === 'true';

/** Changed paths, minus those under an ignored prefix (such as an editor's settings folder). */
function dirtyPaths(p, ignore, untracked) {
  const r = git(p, ['status', '--porcelain', `--untracked-files=${untracked ? 'normal' : 'no'}`]);
  if (r.code !== 0) throw new Error(`git status failed in ${tilde(p)}: ${lastLine(r.err)}`);
  return r.out
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => l.slice(3).split(' -> '))
    .map((f) => f.replace(/^"|"$/g, ''))
    .filter((f) => !ignore.some((prefix) => f.startsWith(prefix)));
}

function defaultBranch(p, remote) {
  const head = git(p, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]).out.trim();
  if (head.startsWith(`${remote}/`)) return head.slice(remote.length + 1);
  for (const b of ['main', 'master']) {
    if (git(p, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${b}`]).code === 0) return b;
  }
  return null;
}

const localRef = (p, branch) => (git(p, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0 ? branch : 'HEAD');

function divergence(p, upstream) {
  const mine = git(p, ['log', '--oneline', '-n', '10', `${upstream}..HEAD`]).out.trim();
  const theirs = git(p, ['log', '--oneline', '-n', '10', `HEAD..${upstream}`]).out.trim();
  return `Local commits not upstream:\n${mine}\n\nUpstream commits not local:\n${theirs}`;
}

// Fast-forward only: a clean default branch that is strictly behind. Anything else is
// reported and left exactly as it is: never a force, stash, reset, merge commit or rebase.
function pull(entry) {
  const { path: p, remote, ignoreDirty } = repoEntry(entry);
  const label = `repo ${tilde(p)}`;
  const key = `pull:${p}`;
  if (!isRepo(p)) return add('failed', `${key}:missing`, `${label}: not a git repository`);
  if (!dryRun) {
    const f = retry(() => git(p, ['fetch', '--quiet', remote], 120));
    if (f.code !== 0) return add('failed', `${key}:fetch`, `${label}: fetch from ${remote} failed (${exitText(f)}): ${clip(lastLine(f.err))}`);
  }
  const def = defaultBranch(p, remote);
  if (!def) return add('attention', `${key}:default`, `${label}: cannot tell ${remote}'s default branch; run \`git remote set-head ${remote} --auto\` in it`);
  const upstream = `${remote}/${def}`;
  const counts = git(p, ['rev-list', '--left-right', '--count', `${localRef(p, def)}...${upstream}`]);
  if (counts.code !== 0) throw new Error(`cannot compare ${tilde(p)} with ${upstream}: ${lastLine(counts.err)}`);
  const [ahead, behind] = counts.out.trim().split(/\s+/).map(Number);
  if (!behind) return log(`ok   ${label}: up to date with ${upstream}`);
  const branch = git(p, ['symbolic-ref', '--quiet', '--short', 'HEAD']).out.trim();
  if (branch !== def) {
    return add('attention', `${key}:branch`, `${label}: ${upstream} has ${behind} new commit(s), but it is on ${branch || 'a detached HEAD'}, not ${def}; not pulled`);
  }
  if (ahead) {
    return add('attention', `${key}:diverged`, `${label}: diverged from ${upstream} (${ahead} local, ${behind} upstream commit(s)); not pulled`, {
      explain: true,
      evidence: divergence(p, upstream),
    });
  }
  const dirty = dirtyPaths(p, ignoreDirty, false);
  if (dirty.length) {
    return add('attention', `${key}:dirty`, `${label}: ${behind} upstream commit(s) waiting, but it has uncommitted changes (${sample(dirty)}); not pulled`);
  }
  if (dryRun) return add('changed', `${key}:pulled`, `${label}: would fast-forward ${behind} commit(s) from ${upstream}`);
  const m = git(p, ['merge', '--ff-only', '--quiet', upstream], 120);
  if (m.code !== 0) return add('failed', `${key}:merge`, `${label}: fast-forward failed: ${clip(lastLine(m.err))}`);
  add('changed', `${key}:pulled`, `${label}: fast-forwarded ${behind} commit(s) from ${upstream}`);
}

// Watched only: read-only probes (ls-remote, rev-parse, cat-file, merge-base), no fetch, so
// a repo another tool owns is never changed. It is reported when its remote has moved on.
function watch(entry) {
  const { path: p, remote } = repoEntry(entry);
  const label = `repo ${tilde(p)}`;
  const key = `watch:${p}`;
  if (!isRepo(p)) return add('failed', `${key}:missing`, `${label}: not a git repository`);
  const branch = defaultBranch(p, remote) || git(p, ['symbolic-ref', '--quiet', '--short', 'HEAD']).out.trim();
  if (!branch) return add('attention', `${key}:branch`, `${label}: no default branch known; cannot tell whether it is behind`);
  const r = retry(() => git(p, ['ls-remote', remote, `refs/heads/${branch}`], 60));
  if (r.code !== 0) return add('failed', `${key}:remote`, `${label}: ${remote} did not answer (${exitText(r)}): ${clip(lastLine(r.err))}`);
  const sha = r.out.trim().split(/\s+/)[0];
  if (!sha) return add('attention', `${key}:no-branch`, `${label}: ${remote} has no branch ${branch}`);
  const ref = localRef(p, branch);
  const local = git(p, ['rev-parse', ref]).out.trim();
  const has = sha === local || (git(p, ['cat-file', '-e', `${sha}^{commit}`]).code === 0 && git(p, ['merge-base', '--is-ancestor', sha, ref]).code === 0);
  if (has) return log(`ok   ${label}: current with ${remote}/${branch}`);
  add('attention', `${key}:behind`, `${label}: behind ${remote}/${branch} (now at ${sha.slice(0, 7)}); watched only, so update it with its own tool`);
}

// ---------------------------------------------------------------- the vault

function countFiles(dir, cap = 100_000) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (n >= cap || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.isFile()) n += 1;
    }
  };
  walk(dir);
  return n;
}

// The vault's own ingest, with RAW_DIR passed explicitly so the schedule never depends on a
// shell profile. A raw folder that is missing or empty is a failure, never a quiet "nothing
// new": an ingest pointed at the wrong folder reads nothing and says so politely.
function vault(v) {
  const vp = expandHome(v.path);
  if (!fs.existsSync(vp)) return add('failed', 'vault:missing', `vault: ${tilde(vp)} does not exist`);
  if (!v.dryRun || !v.run) return add('failed', 'vault:config', 'vault: needs both a dryRun and a run command');
  if (!v.rawDir) return add('failed', 'vault:raw-unset', 'vault: rawDir is not set, so there is no raw folder to check ingest against');
  const raw = expandHome(v.rawDir);
  let files;
  try {
    files = countFiles(raw);
  } catch {
    return add('failed', 'vault:raw-missing', `vault: raw folder ${tilde(raw)} does not exist, so ingest would read nothing`);
  }
  if (!files) return add('failed', 'vault:raw-empty', `vault: raw folder ${tilde(raw)} has no files, so ingest would read nothing (wrong folder?)`);

  const env = { RAW_DIR: raw, VAULT_PATH: vp, ...expandEnv(v.env) };
  const limit = Number(v.limit) || 3;
  const d = sh(v.dryRun, { cwd: vp, env, timeoutSec: 600 });
  const text = d.out + d.err;
  if (d.code !== 0 && /holds the lock/i.test(text)) return add('attention', 'vault:busy', 'vault: another vault job holds its lock; ingest is checked again next run');
  if (d.code !== 0) return add('failed', 'vault:dry-run', `vault: ingest dry run failed (${exitText(d)}): ${clip(lastLine(text))}`);
  const pending = (text.match(/^would (?:ingest|update|retry)\b/gm) || []).length;
  if (!pending) return log(`ok   vault: ${files} raw file(s) in ${tilde(raw)}, nothing new to ingest`);

  const batch = Math.min(pending, limit);
  const more = pending > batch ? `; ${pending - batch} more wait for the next run` : '';
  if (dryRun) return add('changed', 'vault:ingest', `vault: would ingest ${batch} of ${pending} new raw file(s)${more}`);
  if (v.requireClean !== false && isRepo(vp)) {
    const dirty = dirtyPaths(vp, v.ignoreDirty || [], true);
    if (dirty.length) {
      return add('attention', 'vault:dirty', `vault: ${pending} new raw file(s) waiting, but the vault has uncommitted changes (${sample(dirty)}); ingest runs once they are committed or discarded`);
    }
  }
  const r = sh(String(v.run).split('{limit}').join(String(limit)), { cwd: vp, env, timeoutSec: (Number(v.timeoutMin) || 120) * 60 });
  const out = r.out + r.err;
  const runs = (out.match(/^ingest(?:ing:| \()/gm) || []).length;
  modelCalls.ingest += runs;
  if (r.code !== 0) return add('failed', 'vault:ingest', `vault: ingest failed (${exitText(r)}): ${clip(lastLine(out))}`);
  add('changed', 'vault:ingest', `vault: ingested ${runs} new raw file(s) with the vault's own agent${more}`);
  for (const m of out.matchAll(/^\S+ failed on:\s*(.+)$/gm)) {
    add('attention', `vault:ingest-failed:${m[1].trim()}`, `vault: ingest could not process ${m[1].trim()}; it is ledgered as failed (retry with --retry-failed)`);
  }
}

function expandEnv(env = {}) {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, /^~[\\/]/.test(String(v)) ? expandHome(v) : String(v)]));
}

// ---------------------------------------------------------------- commands and versions

// A command that prints nothing when all is well and one line per finding when not, such as
// a tool-update check. Its output is reported again only when it changes.
function command(c) {
  if (dryRun) return log(`dry  ${c.name}: would run ${c.run}`);
  const r = sh(c.run, { cwd: c.cwd ? expandHome(c.cwd) : undefined, env: expandEnv(c.env), timeoutSec: Number(c.timeoutSec) || 300 });
  if (r.code !== 0) return add('failed', `cmd:${c.name}:failed`, `${c.name}: ${exitText(r)}: ${clip(lastLine(r.err || r.out))}`);
  const prefix = `${c.name}:`.toLowerCase();
  const out = lines(r.out)
    .map((l) => (l.toLowerCase().startsWith(prefix) ? l.slice(prefix.length).trim() : l))
    .join('; ');
  if (!out) return log(`ok   ${c.name}: nothing to report`);
  add('attention', `cmd:${c.name}`, `${c.name}: ${clip(out, 600)}`, { track: 'text' });
}

function readVersions(src) {
  if (!src?.pattern) throw new Error('each version source needs a pattern');
  let text;
  if (src.file) text = fs.readFileSync(expandHome(src.file), 'utf8');
  else if (src.dir) text = fs.readdirSync(expandHome(src.dir)).join('\n');
  else if (src.command) {
    const r = sh(src.command, { timeoutSec: 60 });
    if (r.code !== 0) throw new Error(`\`${src.command}\` ${exitText(r)}`);
    text = r.out;
  } else throw new Error('each version source needs a file, dir or command');
  return [...text.matchAll(new RegExp(src.pattern, 'gm'))].map((m) => m[1] ?? m[0]);
}

function cmpVersion(a, b) {
  const pa = a.split(/\D+/).filter(Boolean).map(Number);
  const pb = b.split(/\D+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

const where = (src) => (src.file || src.dir ? tilde(expandHome(src.file || src.dir)) : `\`${src.command}\``);

function head(file) {
  try {
    return clip(fs.readFileSync(expandHome(file), 'utf8'), EVIDENCE_CAP);
  } catch {
    return undefined;
  }
}

// The version you have on record (a note, a lock file, a README) against the folder or repo
// that holds the thing itself. The highest version each side mentions is compared.
function version(v) {
  const rec = readVersions(v.recorded).sort(cmpVersion).at(-1);
  const act = readVersions(v.actual).sort(cmpVersion).at(-1);
  if (!rec) return add('failed', `version:${v.name}:recorded`, `${v.name}: no version matching /${v.recorded.pattern}/ in ${where(v.recorded)}`);
  if (!act) return add('failed', `version:${v.name}:actual`, `${v.name}: no version matching /${v.actual.pattern}/ in ${where(v.actual)}`);
  if (cmpVersion(rec, act) === 0) return log(`ok   ${v.name}: ${rec} on record and in ${where(v.actual)}`);
  add('attention', `version:${v.name}:${rec}:${act}`, `${v.name}: ${rec} on record in ${where(v.recorded)}, but ${where(v.actual)} holds ${act}`, {
    explain: true,
    evidence: v.evidence ? head(v.evidence) : undefined,
  });
}

// ---------------------------------------------------------------- task surfaces (read only)

function expectedLists(spec) {
  if (Array.isArray(spec)) return spec.map((x) => (typeof x === 'object' ? { id: String(x.id), name: x.name } : { id: String(x) }));
  if (!spec?.file) throw new Error('clickup.lists must be a list of ids or { "file": ..., "key": ... }');
  const data = JSON.parse(fs.readFileSync(expandHome(spec.file), 'utf8'));
  const node = spec.key ? spec.key.split('.').reduce((o, k) => o?.[k], data) : data;
  if (!node || typeof node !== 'object') throw new Error(`${tilde(expandHome(spec.file))} has no "${spec.key}"`);
  return (Array.isArray(node) ? node : Object.values(node)).map((x) => (typeof x === 'object' ? { id: String(x.id), name: x.name } : { id: String(x) }));
}

// clickup-axi prints `lists[N]{id,name,folder}:` followed by one indented row per list.
function parseClickupLists(out) {
  const live = new Map();
  let inTable = false;
  for (const line of out.split(/\r?\n/)) {
    if (/^lists\[\d+\]/.test(line)) inTable = true;
    else if (!/^\s/.test(line)) inTable = false;
    else if (inTable) {
      const m = line.match(/^\s+"?(\d+)"?,(.*),([^,]*)$/);
      if (m) live.set(m[1], `${m[3] === '(folderless)' ? '' : `${m[3].replace(/^"|"$/g, '')} / `}${m[2].replace(/^"|"$/g, '')}`);
    }
  }
  return live;
}

function clickup(c) {
  const expected = expectedLists(c.lists);
  // A scheduled run does not see your shell profile, so the workspace is passed explicitly.
  const env = c.workspace ? { CLICKUP_AXI_WORKSPACE: String(c.workspace) } : {};
  const r = retry(() => sh(`${c.command || 'clickup-axi'} lists --space "${c.space}"`, { env, timeoutSec: 120 }));
  if (r.code !== 0) return add('failed', 'clickup:read', `clickup: could not read the lists of space ${c.space} (${exitText(r)}): ${clip(lastLine(r.err || r.out))}`);
  const live = parseClickupLists(r.out);
  if (!live.size) return add('failed', 'clickup:parse', `clickup: read no list from space ${c.space}; is the space right, and did clickup-axi's output change?`);
  const source = c.lists.file ? ` in ${tilde(expandHome(c.lists.file))}` : '';
  const evidence = `Expected lists${source}:\n${expected.map((e) => `${e.id} ${e.name || ''}`).join('\n')}\n\nActive lists now:\n${[...live].map(([id, n]) => `${id} ${n}`).join('\n')}`;
  const missing = expected.filter((e) => !live.has(e.id));
  const extra = [...live.keys()].filter((id) => !expected.some((e) => e.id === id));
  for (const e of missing) {
    add('attention', `clickup:missing:${e.id}`, `clickup: expected list ${e.id}${e.name ? ` (${e.name})` : ''} is no longer active in space ${c.space}`, { explain: true, evidence });
  }
  for (const id of extra) {
    add('attention', `clickup:extra:${id}`, `clickup: list ${id} (${live.get(id)}) is active in space ${c.space} but not expected${source}`, { explain: true, evidence });
  }
  if (!missing.length && !extra.length) log(`ok   clickup: the ${expected.length} expected list(s) are the active lists of space ${c.space}`);
}

function ticktick(t) {
  if (!t.command) return add('failed', 'ticktick:config', 'ticktick: no read command configured (ticktick.command)');
  if (t.authCommand) {
    const a = retry(() => sh(t.authCommand, { timeoutSec: 60 }));
    if (a.code !== 0 || /not authenticated|unauthenticated|expired/i.test(a.out)) {
      return add('attention', 'ticktick:auth', `ticktick: not signed in (\`${t.authCommand}\`: ${clip(lastLine(a.out + a.err))}); sign in once and it is read without prompts again`);
    }
    const secs = Number((a.out.match(/expires\s+(?:in\s+)?(\d+)\s*s/i) || [])[1]);
    if (secs && secs < 14 * 86_400) add('attention', 'ticktick:expiring', `ticktick: the sign-in expires in ${Math.floor(secs / 86_400)} day(s); renew it before then`);
  }
  const r = retry(() => sh(t.command, { timeoutSec: 120 }));
  if (r.code !== 0) return add('failed', 'ticktick:read', `ticktick: read failed (${exitText(r)}): ${clip(lastLine(r.err || r.out))}`);
  let names;
  try {
    const data = JSON.parse(r.out);
    names = (Array.isArray(data) ? data : data.projects || []).map((p) => p.name).filter(Boolean);
  } catch {
    return add('failed', 'ticktick:parse', 'ticktick: the read command did not print a JSON list of objects with a "name"');
  }
  const want = (t.lists || []).map(String);
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const evidence = `Expected lists:\n${want.join('\n')}\n\nLists now:\n${names.join('\n')}`;
  const missing = want.filter((w) => !names.some((n) => same(n, w)));
  const extra = names.filter((n) => !want.some((w) => same(w, n)));
  for (const w of missing) add('attention', `ticktick:missing:${w.toLowerCase()}`, `ticktick: expected list "${w}" is missing`, { explain: true, evidence });
  for (const n of extra) add('attention', `ticktick:extra:${n.toLowerCase()}`, `ticktick: list "${n}" is not one you expect`, { explain: true, evidence });
  if (!missing.length && !extra.length) log(`ok   ticktick: the ${want.length} expected list(s) are all there`);
}

// ---------------------------------------------------------------- the one bounded model call

function explain(model, item) {
  const prompt = [
    'A daily alignment check found one item it could not settle mechanically.',
    'In at most three short lines of plain text (no markdown), say what most likely happened and the one next step for the owner.',
    'Use only the evidence below; if it is not enough, say what to look at.',
    '',
    `Item: ${item.text}`,
    '',
    'Evidence:',
    clip(item.evidence || '(none)', EVIDENCE_CAP),
  ].join('\n');
  modelCalls.explain += 1;
  const r = sh(model.command, { input: prompt, timeoutSec: Number(model.timeoutSec) || 180 });
  if (r.code !== 0) return `(model call failed: ${exitText(r)})`;
  return lines(r.out.replace(/\*\*|__|^#+\s*/gm, '')).slice(0, 3).join(' / ') || '(model gave no answer)';
}

// ---------------------------------------------------------------- report and delivery

function report(startedAt) {
  const by = (level) => items.filter((i) => i.level === level);
  const [failed, changed, attention] = [by('failed'), by('changed'), by('attention')];
  const calls = modelCalls.explain + modelCalls.ingest;
  const callText = calls
    ? `model calls: ${[modelCalls.explain && `${modelCalls.explain} to explain drift`, modelCalls.ingest && `${modelCalls.ingest} by the vault ingest`].filter(Boolean).join(', ')}`
    : 'no model calls';
  const when = stamp(startedAt);
  if (!items.length) return `daily-sync ${when}: all quiet (${checks} check(s), ${callText})`;
  const counts = [failed.length && `${failed.length} failed`, changed.length && `${changed.length} changed`, attention.length && `${attention.length} need you`];
  const section = (title, list) =>
    list.length ? [`${title}:`, ...list.map((i) => `- ${i.still ? '(still) ' : ''}${i.text}${i.model ? `\n  model: ${i.model}` : ''}`)] : [];
  return [
    `${failed.length ? 'FAILED ' : ''}daily-sync ${when}: ${counts.filter(Boolean).join(', ')} (${callText})`,
    ...section('Failed', failed),
    ...section('Changed', changed),
    ...section('Needs you', attention),
    `Log: ${tilde(FILES.log)}`,
  ].join('\n');
}

function saveReport(text, startedAt, keep) {
  fs.mkdirSync(FILES.reports, { recursive: true });
  const d = new Date(startedAt);
  const file = path.join(FILES.reports, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`);
  fs.writeFileSync(file, `${text}\n`);
  fs.writeFileSync(path.join(FILES.reports, 'latest.md'), `${text}\n`);
  const old = fs.readdirSync(FILES.reports).filter((f) => /^\d{4}-\d\d-\d\d-\d{4}\.md$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep))) fs.rmSync(path.join(FILES.reports, f), { force: true });
  return file;
}

// ---------------------------------------------------------------- the run

function takeLock() {
  try {
    fs.writeFileSync(FILES.lock, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx' });
    return { taken: true };
  } catch {
    const held = readJson(FILES.lock, {});
    const age = Date.now() - (held.startedAt || fs.statSync(FILES.lock).mtimeMs);
    if (held.pid && alive(held.pid) && age < LOCK_STALE_HOURS * HOUR) return { taken: false, held };
    fs.rmSync(FILES.lock, { force: true });
    const again = takeLock();
    return { ...again, unfinished: held };
  }
}

function run() {
  const startedAt = Date.now();
  const config = readJson(configFile, null);
  const state = readJson(FILES.state, {});
  if (!config) {
    log(`FAILED daily-sync: ${tilde(configFile)} is missing or not valid JSON`);
    if (!dryRun && fs.existsSync(BASE)) writeJson(FILES.state, { ...state, lastRun: { at: startedAt, failed: 1, error: 'config unreadable' } });
    return 2;
  }
  if (fs.existsSync(FILES.off)) {
    log('skipped: paused (an "off" file is next to config.json)');
    if (!dryRun) writeJson(FILES.state, { ...state, paused: true });
    return 0;
  }

  let lock = { taken: true };
  if (!dryRun) {
    lock = takeLock();
    if (!lock.taken) {
      log(`skipped: another run is in progress (pid ${lock.held.pid})`);
      return 0;
    }
  }
  log(`start${dryRun ? ' (dry run)' : ''}: ${tilde(configFile)}`);

  if (config.retryWaitSec !== undefined) retryWaitMs = Number(config.retryWaitSec) * 1000;

  // The runs before this one: never finished, or none succeeded for too long.
  const staleHours = Number(config.staleHours) || 26;
  if (lock.unfinished) {
    const since = lock.unfinished.startedAt ? stamp(lock.unfinished.startedAt) : 'at an unknown time';
    add('failed', 'run:unfinished', `the previous run (started ${since}) never finished; see ${tilde(FILES.log)}`, { run: true });
  }
  if (state.lastSuccess && !state.paused && startedAt - state.lastSuccess > staleHours * HOUR) {
    const hours = Math.round((startedAt - state.lastSuccess) / HOUR);
    add('failed', 'run:stale', `no successful run since ${stamp(state.lastSuccess)} (${hours}h ago): the schedule missed runs (machine off, timer stopped) or they failed`, { run: true });
  }

  for (const r of config.pull || []) check('pull', () => pull(r));
  for (const r of config.watch || []) check('watch', () => watch(r));
  if (config.vault) check('vault', () => vault(config.vault));
  for (const c of config.commands || []) check(c.name || 'command', () => command(c));
  for (const v of config.versions || []) check(v.name || 'version', () => version(v));
  if (config.clickup) check('clickup', () => clickup(config.clickup));
  if (config.ticktick) check('ticktick', () => ticktick(config.ticktick));

  // Drift reported before is "still"; only new drift can reach a model, and only a few items.
  const previous = state.attention || {};
  const model = config.model || {};
  let budget = model.command ? Number(model.maxCalls ?? 3) : 0;
  for (const i of items.filter((x) => x.level === 'attention')) {
    const before = previous[i.key];
    i.still = Boolean(before) && (i.track !== 'text' || before.text === i.text);
    if (i.still || !i.explain || budget <= 0) continue;
    if (dryRun) {
      log(`dry  would ask the model about: ${i.text}`);
      continue;
    }
    budget -= 1;
    i.model = explain(model, i);
  }

  const text = report(startedAt);
  const failed = items.filter((i) => i.level === 'failed');
  const attention = items.filter((i) => i.level === 'attention');
  const remindMs = (Number(config.remindDays) || 7) * 24 * HOUR;
  const due = attention.some((i) => i.still && startedAt - (previous[i.key]?.notified || 0) >= remindMs);
  const notify = failed.length > 0 || items.some((i) => i.level === 'changed') || attention.some((i) => !i.still) || due;
  log(`model calls: ${modelCalls.explain} to explain drift, ${modelCalls.ingest} by the vault ingest`);

  if (dryRun) {
    console.log(`\n${text}\n\n(dry run: ${notify ? 'this report would be sent' : 'nothing would be sent'}; no state was changed)`);
    return failed.length ? 1 : 0;
  }

  const reportFile = saveReport(text, startedAt, Number(config.keepReports) || 30);
  let notifyError = null;
  if (notify && config.notify) {
    const r = sh(config.notify, { input: `${text}\n`, timeoutSec: 60 });
    if (r.code !== 0) {
      notifyError = `\`${config.notify}\` ${exitText(r)}: ${clip(lastLine(r.err || r.out))}`;
      fs.appendFileSync(reportFile, `\nFAILED to deliver this report: ${notifyError}\n`);
    }
    log(notifyError ? `FAILED to deliver the report: ${notifyError}` : 'report delivered');
  } else {
    log(notify ? 'report written (no notify command configured)' : 'quiet: nothing to deliver');
  }

  const attentionState = {};
  for (const i of attention) {
    const before = previous[i.key];
    const notified = notify && !notifyError ? startedAt : before?.notified || 0;
    attentionState[i.key] = { text: i.text, since: before?.since || startedAt, notified };
  }
  const ownFailures = failed.filter((i) => !i.run).length;
  writeJson(FILES.state, {
    lastRun: { at: startedAt, finishedAt: Date.now(), failed: failed.length, report: reportFile, notifyError },
    lastSuccess: ownFailures ? state.lastSuccess : startedAt,
    attention: attentionState,
    paused: false,
  });
  fs.rmSync(FILES.lock, { force: true });
  log(`end: ${text.split('\n')[0]}`);
  return failed.length || notifyError ? 1 : 0;
}

// For a session-start hook: silent unless the job needs you.
function status() {
  if (fs.existsSync(FILES.off)) return 0;
  const config = readJson(configFile, {});
  const state = readJson(FILES.state, null);
  const staleMs = (Number(config.staleHours) || 26) * HOUR;
  const say = (line) => console.log(`FAILED daily-sync: ${line}`);
  if (!state?.lastRun) {
    let age = 0;
    try {
      age = Date.now() - fs.statSync(configFile).mtimeMs;
    } catch {
      return 0;
    }
    if (age > staleMs) say(`it has never run, though it was set up ${Math.round(age / HOUR)}h ago; check its schedule`);
    return 0;
  }
  const readIt = state.lastRun.report ? `; read ${tilde(state.lastRun.report)}` : '';
  if (state.lastRun.failed) say(`the last run (${stamp(state.lastRun.at)}) had ${state.lastRun.failed} failed step(s)${readIt}`);
  else if (state.lastRun.notifyError) say(`the last report could not be delivered (${state.lastRun.notifyError})${readIt}`);
  else if (Date.now() - (state.lastSuccess || 0) > staleMs) say(`no successful run since ${stamp(state.lastSuccess || state.lastRun.at)}; check its schedule`);
  return 0;
}

let code;
try {
  code = flag('--status') ? status() : run();
} catch (err) {
  // Something this script did not expect: still loud, still in the log and the state.
  const line = `FAILED daily-sync: ${err.stack || err.message}`;
  console.error(line);
  if (!dryRun && !flag('--status')) {
    try {
      fs.appendFileSync(FILES.log, `${new Date().toISOString()} ${line}\n`);
      const state = readJson(FILES.state, {});
      writeJson(FILES.state, { ...state, lastRun: { at: Date.now(), failed: 1, error: err.message } });
      const config = readJson(configFile, {});
      if (config.notify) sh(config.notify, { input: `FAILED daily-sync ${stamp(Date.now())}: ${err.message}\n`, timeoutSec: 60 });
      fs.rmSync(FILES.lock, { force: true });
    } catch {
      // nothing more can be done; the lock left behind is reported by the next run
    }
  }
  code = 1;
}
process.exitCode = code;
