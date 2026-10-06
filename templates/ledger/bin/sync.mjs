#!/usr/bin/env node
// sync - keeps one record of each linked work item the same across your trackers: the home
// records (each Firstmate home's data/backlog.md, the truth), TickTick, ClickUp and the vault.
// A change in any of them flows to the others; see sync-core.mjs for the rule that settles a
// clash and sync-places.mjs for what each place reads and writes.
//
// Only linked items sync. A home and a TickTick list are paired on purpose in config.json (new
// open items flow both ways between them); a ClickUp task is linked to a home row on purpose
// (`sync link`); a vault project note links itself with `task: <home>/<task id>`. Settled drift
// is fixed and journaled; what the sync cannot settle becomes a card, one note in that home's
// inbox, closed by `sync pick`, `sync map` or by making the two sides agree.
//
// Usage:
//   node sync.mjs serve                     the service: home changes within seconds, the other places every pollSeconds
//   node sync.mjs run [--dry-run]           one pass (--dry-run: what it would change, writing nothing)
//   node sync.mjs check [--dry-run]         a full pass, then only the one status line for the last day (the daily check;
//                                           --verbose also lists each change)
//   node sync.mjs status                    that status line, from the journal only
//   node sync.mjs cards                     the open cards
//   node sync.mjs pick <card> <place>       the side that wins a clash card (home, ticktick, clickup, vault)
//   node sync.mjs map <list> "<status>" open|active|done    the bucket of a ClickUp status, remembered
//   node sync.mjs link <home>/<task id> clickup <task id> | ticktick <list id>/<task id>
//   node sync.mjs unlink <home>/<task id> [place]
//   --config F                              another config file (default: ~/.config/ai-workstation-setup/sync/config.json)
//
// Your list ids, links, journal and cards live next to config.json, never in a repo.
// Installed by ai-workstation-setup (ledger module). No dependencies.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BUCKETS, Links, label, statusLine, syncPass } from './sync-core.mjs';
import { clickupPlace, defaultExec, homePlace, ticktickPlace, vaultPlace } from './sync-places.mjs';

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--config');

const expandHome = (p) => path.resolve(String(p).replace(/^~(?=$|[\\/])/, os.homedir()));
const DAY_MS = 86_400_000;
const LOCK_WAIT_MS = 60_000;
const JOURNAL_CAP = 4 * 1024 * 1024;

function die(code, message) {
  console.error(`task-sync: ${message}`);
  process.exit(code);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- config and files

const configFile = expandHome(option('--config', '~/.config/ai-workstation-setup/sync/config.json'));
const BASE = path.dirname(configFile);
const FILES = {
  links: path.join(BASE, 'links.json'),
  state: path.join(BASE, 'state.json'),
  journal: path.join(BASE, 'journal.jsonl'),
  lock: path.join(BASE, 'sync.lock'),
};

function loadConfig() {
  const raw = readJson(configFile, null);
  if (!raw) die(2, `cannot read ${configFile}; it is written by the ledger module of ai-workstation-setup`);
  const homes = (raw.homes || []).filter((h) => h?.name && h?.path);
  if (!homes.length) die(2, `${configFile}: no homes; add at least one { "name", "path" }`);
  return {
    timeZone: raw.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    skewMs: (Number(raw.skewSeconds) || 120) * 1000,
    pollMs: Math.max(30, Number(raw.pollSeconds) || 120) * 1000,
    debounceMs: Number.isFinite(raw.debounceMs) ? raw.debounceMs : 2000,
    rescanMs: Math.max(2, Number(raw.rescanSeconds) || 20) * 1000,
    tasksAxi: raw.tasksAxi || 'tasks-axi',
    inbox: raw.inbox || null,
    homes,
    ticktick: raw.ticktick || {},
    clickup: raw.clickup || {},
    vault: raw.vault || {},
  };
}

function clickupToken(c) {
  if (process.env.CLICKUP_TOKEN) return process.env.CLICKUP_TOKEN.trim();
  if (!c.tokenFile) return null;
  try {
    return fs.readFileSync(expandHome(c.tokenFile), 'utf8').trim();
  } catch {
    return null;
  }
}

/** The places this config turns on, and the home-to-TickTick pairs. */
function placesFor(cfg, state) {
  const home = homePlace({ homes: cfg.homes, tasksAxi: cfg.tasksAxi, inbox: cfg.inbox });
  const places = { home };
  const pairs = cfg.homes.filter((h) => h.ticktick).map((h) => ({ home: h.name, list: String(h.ticktick) }));
  if (pairs.length) {
    places.ticktick = ticktickPlace({ lists: [...new Set(pairs.map((p) => p.list))], command: cfg.ticktick.command || 'ticktick-cli', timeZone: cfg.timeZone });
  }
  if ((cfg.clickup.lists || []).length) {
    const notifyHome = cfg.clickup.notifyHome ? expandHome(cfg.clickup.notifyHome) : null;
    const notify =
      notifyHome && cfg.inbox
        ? async (text) => {
            const r = defaultExec(expandHome(cfg.inbox), ['note', '-'], { env: { FM_HOME: notifyHome }, input: `${text}\n` });
            if (r.code !== 0) throw new Error(`could not tell the ClickUp home: ${r.err.trim() || `exit ${r.code}`}`);
          }
        : null;
    places.clickup = clickupPlace({ lists: cfg.clickup.lists, token: clickupToken(cfg.clickup), timeZone: cfg.timeZone, statusMap: state.statusMap, notify });
  }
  if (cfg.vault.path) {
    places.vault = vaultPlace({
      path: cfg.vault.path,
      folder: cfg.vault.folder || 'projects',
      write: cfg.vault.write !== false,
      statusMap: cfg.vault.statuses || {},
      lockHelper: cfg.vault.lockHelper || 'bin/lib-lock.sh',
      lint: cfg.vault.lint || 'bin/lint',
    });
  }
  return { places, pairs };
}

function loadState() {
  const state = readJson(FILES.state, {});
  state.cards ??= {};
  state.statusMap ??= {};
  return state;
}

function saveAll(links, state, journal) {
  fs.mkdirSync(BASE, { recursive: true, mode: 0o700 });
  writeAtomic(FILES.links, `${JSON.stringify(links.toJSON(), null, 2)}\n`);
  writeAtomic(FILES.state, `${JSON.stringify(state, null, 2)}\n`);
  if (journal.length) {
    fs.appendFileSync(FILES.journal, journal.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
    const size = fs.statSync(FILES.journal).size;
    if (size > JOURNAL_CAP) {
      const text = fs.readFileSync(FILES.journal, 'utf8');
      writeAtomic(FILES.journal, text.slice(text.indexOf('\n', text.length - JOURNAL_CAP / 2) + 1));
    }
  }
}

function readJournal() {
  let text = '';
  try {
    text = fs.readFileSync(FILES.journal, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- one pass at a time

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

async function withLock(fn) {
  fs.mkdirSync(BASE, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.writeFileSync(FILES.lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const pid = Number(fs.readFileSync(FILES.lock, 'utf8'));
      if (!pid || !alive(pid)) {
        fs.rmSync(FILES.lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) die(1, `another pass (pid ${pid}) has held ${FILES.lock} for a minute`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(FILES.lock, { force: true });
  }
}

const describe = (e) => {
  if (e.text) return e.text;
  if (e.kind === 'fix') return `${label(e.from)}→${label(e.to)} ${e.key} ${e.field}${e.value === undefined ? '' : `: ${JSON.stringify(e.value)}`}`;
  return `${e.key || ''}${e.place ? ` (${label(e.place)})` : ''}`;
};

async function pass({ dryRun = false, quiet = false } = {}) {
  const cfg = loadConfig();
  return withLock(async () => {
    const links = new Links(readJson(FILES.links, {}));
    const state = loadState();
    const { places, pairs } = placesFor(cfg, state);
    const result = await syncPass({ places, pairs, links, state, now: Date.now(), skewMs: cfg.skewMs, dryRun });
    if (!dryRun) saveAll(links, state, result.journal);
    if (!quiet) for (const e of result.journal) console.log(`${dryRun ? 'would ' : ''}${e.kind.padEnd(6)} ${describe(e)}`);
    return { ...result, state };
  });
}

// ---------------------------------------------------------------- commands

async function cmdRun() {
  const r = await pass({ dryRun: flag('--dry-run') });
  if (!r.journal.length) console.log('in step: nothing to change');
  process.exitCode = r.failed.includes('home') ? 1 : 0;
}

const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

async function cmdCheck() {
  const now = Date.now();
  const dryRun = flag('--dry-run');
  const r = await pass({ dryRun, quiet: !flag('--verbose') });
  const journal = [...readJournal(), ...(dryRun ? r.journal.map((e) => ({ ...e, dryRun: false })) : [])];
  console.log(statusLine(journal, { since: now - DAY_MS, label: hhmm(now), openCards: r.cards.length }));
  process.exitCode = r.failed.includes('home') ? 1 : 0;
}

function cmdStatus() {
  const now = Date.now();
  console.log(statusLine(readJournal(), { since: now - DAY_MS, label: hhmm(now), openCards: Object.keys(loadState().cards).length }));
}

function cmdCards() {
  const cards = Object.values(loadState().cards);
  if (!cards.length) return console.log('no open cards');
  for (const c of cards) console.log(`${c.key}\n  ${c.text}`);
}

async function editState(fn) {
  loadConfig();
  await withLock(async () => {
    const links = new Links(readJson(FILES.links, {}));
    const state = loadState();
    const entry = fn(links, state);
    saveAll(links, state, entry ? [{ at: Date.now(), ...entry }] : []);
  });
}

async function cmdPick() {
  const [card, place] = positional;
  if (!card || !place) die(2, 'usage: task-sync pick <card> <place>');
  const at = card.lastIndexOf(':');
  const key = card.slice(0, at);
  const field = card.slice(at + 1);
  if (at < 0 || card.includes(':gone:') || card.startsWith('status:')) die(2, `${card} is not a clash card; see \`sync cards\` for what closes it`);
  await editState((links, state) => {
    const link = links.get(key);
    if (!link) die(2, `no link ${key}`);
    if (place !== 'home' && !link.refs[place]) die(2, `${key} has no ${place} item; pick one of: home, ${Object.keys(link.refs).join(', ')}`);
    links.force(key, field, place);
    delete state.cards[card];
    return { kind: 'pick', key: card, place };
  });
  console.log(`ok: ${label(place)} wins ${card} on the next pass`);
}

async function cmdMap() {
  const [list, status, bucket] = positional;
  if (!list || !status || !BUCKETS.includes(bucket)) die(2, 'usage: task-sync map <list> "<status>" open|active|done');
  await editState((links, state) => {
    (state.statusMap[list] ??= {})[status.toLowerCase()] = bucket;
    delete state.cards[`status:${list}:${status}`];
    return { kind: 'map', key: `${list}:${status}`, value: bucket };
  });
  console.log(`ok: "${status}" on list ${list} is ${bucket} from now on`);
}

async function cmdLink() {
  const [key, place, ref] = positional;
  if (!key?.includes('/') || !['ticktick', 'clickup'].includes(place) || !ref) die(2, 'usage: task-sync link <home>/<task id> clickup <task id> | ticktick <list id>/<task id>');
  if (place === 'ticktick' && !ref.includes('/')) die(2, 'a TickTick item is <list id>/<task id>');
  await editState((links) => {
    try {
      links.link(key, place, ref);
    } catch (err) {
      die(2, err.message);
    }
    return { kind: 'link', key, place, ref };
  });
  console.log(`ok: ${key} is linked to ${label(place)} ${ref}; the next pass meets them (a value wins over an empty one, else the home wins)`);
}

async function cmdUnlink() {
  const [key, place] = positional;
  if (!key) die(2, 'usage: task-sync unlink <home>/<task id> [place]');
  await editState((links, state) => {
    if (place) links.unlink(key, place);
    else links.drop(key);
    for (const k of Object.keys(state.cards)) if (state.cards[k].link === key && (!place || k.endsWith(`:gone:${place}`))) delete state.cards[k];
    return { kind: 'unlink', key, place };
  });
  console.log(`ok: ${key} ${place ? `no longer linked to ${label(place)}` : 'unlinked everywhere'}`);
}

/** The service: a pass soon after a backlog changes, and one every pollSeconds for the other places. */
async function cmdServe() {
  const cfg = loadConfig();
  const backlogs = cfg.homes.map((h) => path.join(expandHome(h.path), 'data', 'backlog.md'));
  const mtimes = () => backlogs.map((f) => fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs || 0).join(',');
  let seen = '';
  let running = false;
  let again = false;
  let timer = null;

  const run = async (why) => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      seen = mtimes();
      const r = await pass();
      if (r.journal.length) console.log(`pass (${why}): ${r.journal.length} entr${r.journal.length === 1 ? 'y' : 'ies'}, ${r.cards.length} open card(s)`);
    } catch (err) {
      console.error(`task-sync: pass failed: ${err.message}`);
    } finally {
      running = false;
      if (again) {
        again = false;
        setImmediate(() => run('queued'));
      }
    }
  };
  const soon = (why) => {
    clearTimeout(timer);
    timer = setTimeout(() => run(why), cfg.debounceMs);
  };

  for (const file of backlogs) {
    try {
      fs.watch(path.dirname(file), (event, name) => {
        if (!name || name === path.basename(file)) soon('backlog changed');
      });
    } catch (err) {
      console.error(`task-sync: cannot watch ${path.dirname(file)} (${err.message}); the rescan still sees changes`);
    }
  }
  setInterval(() => {
    if (mtimes() !== seen) soon('rescan');
  }, cfg.rescanMs);
  setInterval(() => run('poll'), cfg.pollMs);
  console.log(`sync: serving ${cfg.homes.length} home(s); polling every ${cfg.pollMs / 1000}s`);
  await run('start');
}

function help() {
  console.log(
    [
      'task-sync - keeps linked work items the same across your homes, TickTick, ClickUp and the vault',
      '',
      'usage: task-sync serve | run [--dry-run] | check [--dry-run] | status | cards |',
      '       pick <card> <place> | map <list> "<status>" open|active|done |',
      '       link <home>/<id> clickup <task id> | link <home>/<id> ticktick <list id>/<task id> | unlink <home>/<id> [place]',
      '       (all take --config F)',
    ].join('\n'),
  );
}

const COMMANDS = { serve: cmdServe, run: cmdRun, check: cmdCheck, status: cmdStatus, cards: cmdCards, pick: cmdPick, map: cmdMap, link: cmdLink, unlink: cmdUnlink };
if (command === 'help' || flag('--help') || flag('-h')) help();
else if (!COMMANDS[command]) {
  help();
  process.exitCode = 2;
} else {
  await COMMANDS[command]();
}
