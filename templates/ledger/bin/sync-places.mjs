// sync-places - the places the task sync (sync.mjs) keeps in line: the homes (the truth),
// TickTick, ClickUp and the vault. Each place reads normalized items and applies changes:
//
//   fields                     the fields it holds (title, status, due, notes)
//   read()                     Map ref -> { ref, title?, status?, due?, notes?, time?, statusTime?, seenAt? }
//                              status is a bucket (open, active, done); time is the place's own
//                              edit time in ms, or absent when it has none (then the sync dates a
//                              change by when it first saw it, seenAt when the place knows better)
//   lookup(ref)                one item that read() did not return: the item, or { gone: 'deleted' | 'archived' }
//   apply(ref, changes, item)  write the changes; { skipped: why } when the place takes no writes
//   create(target, values)     a new item, returns its ref (homes and TickTick only)
//
// The outside tools are injected (exec for commands, fetch for HTTP), so the tests run every
// place against stand-ins. Installed by ai-workstation-setup (ledger module). No dependencies.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { backlogRows } from './ledger.mjs';
import {
  BUCKETS,
  FIELDS,
  bucketOfClickUp,
  bucketOfHome,
  bucketOfTickTick,
  dayIn,
  frontmatter,
  midnightIn,
  noonMs,
  normText,
  notesOf,
  parseTime,
  withNotes,
} from './sync-core.mjs';

const CORE = fileURLToPath(new URL('./sync-core.mjs', import.meta.url));
const expandHome = (p) => path.resolve(String(p).replace(/^~(?=$|[\\/])/, os.homedir()));
const lastLine = (s) => String(s || '').trim().split('\n').filter(Boolean).at(-1) || '';
const SKEW_MIN_MS = 30_000;

/** Run a command without a shell: { code, out, err }. */
export function defaultExec(cmd, args, { env, input, cwd, timeoutMs = 120_000 } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, cwd, env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: -1, out: '', err: r.error.message };
  return { code: r.status ?? -1, out: r.stdout || '', err: r.stderr || '' };
}

function withBodyFile(text, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-body-'));
  const file = path.join(dir, 'body.md');
  try {
    fs.writeFileSync(file, text, { mode: 0o600 });
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- homes

/**
 * The homes: each home's data/backlog.md, read with the ledger's own backlog reader, written
 * only through tasks-axi. The sync owns one part of a row's body, the "## Notes" section (with
 * its "due:" line); every other line is copied unchanged and the old body is archived on each
 * write (tasks-axi --archive-body), so an overwrite can be undone. It never closes a captain hold.
 */
export function homePlace({ homes, tasksAxi = 'tasks-axi', inbox = null, exec = defaultExec }) {
  const byName = new Map(homes.map((h) => [h.name, { ...h, path: expandHome(h.path) }]));
  const backlog = (h) => path.join(h.path, 'data', 'backlog.md');
  const home = (name) => {
    const h = byName.get(name);
    if (!h) throw new Error(`no home named ${name} in the sync config`);
    return h;
  };
  const run = (h, args) => {
    const r = exec(tasksAxi, args, { cwd: h.path });
    if (r.code !== 0) throw new Error(`${tasksAxi} ${args[0]}: ${lastLine(r.err || r.out) || `exit ${r.code}`}`);
    return r.out;
  };

  return {
    name: 'home',
    fields: FIELDS,
    async read() {
      const items = new Map();
      for (const h of byName.values()) {
        const file = backlog(h);
        let text;
        let mtime;
        try {
          text = fs.readFileSync(file, 'utf8');
          mtime = fs.statSync(file).mtimeMs;
        } catch (err) {
          throw new Error(`home ${h.name}: cannot read ${file} (${err.code || err.message})`);
        }
        for (const r of backlogRows(text)) {
          const ref = `${h.name}/${r.id}`;
          if (items.has(ref)) continue;
          items.set(ref, {
            ref,
            home: h.name,
            id: r.id,
            title: r.title,
            status: bucketOfHome(r.state),
            ...notesOf(r.text),
            hold: r.holdKind === 'captain' && r.holdReason !== null && r.state !== 'done',
            body: r.text,
            seenAt: mtime,
          });
        }
      }
      return items;
    },
    async apply(ref, changes, item) {
      const h = home(item.home || ref.split('/')[0]);
      const id = item.id || ref.slice(ref.indexOf('/') + 1);
      if (changes.status === 'done' && item.hold) throw new Error(`${ref} is a captain hold; the sync never closes one`);
      const file = backlog(h);
      if ('title' in changes) run(h, ['update', id, '--title', changes.title, '--file', file]);
      if ('notes' in changes || 'due' in changes) {
        const body = withNotes(item.body, { notes: 'notes' in changes ? changes.notes : item.notes, due: 'due' in changes ? changes.due : item.due });
        withBodyFile(`${body}\n`, (bodyFile) => run(h, ['update', id, '--body-file', bodyFile, '--archive-body', '--file', file]));
      }
      if (changes.status === 'done' && item.status !== 'done') run(h, ['done', id, '--file', file]);
      else if (changes.status && changes.status !== 'done' && item.status === 'done') run(h, ['reopen', id, '--file', file]);
      return { ok: true };
    },
    async create(name, values) {
      const h = home(name);
      const body = withNotes('', values);
      const args = ['add', '--mint', values.title || '(untitled)', '--queue'];
      const out = body
        ? withBodyFile(`${body}\n`, (bodyFile) => run(h, [...args, '--body-file', bodyFile, '--file', backlog(h), '--json']))
        : run(h, [...args, '--file', backlog(h), '--json']);
      const id = JSON.parse(out).task?.id;
      if (!id) throw new Error('tasks-axi add printed no task id');
      return `${name}/${id}`;
    },
    /** One note in a home's inbox (fm-inbox.sh note), which that home's firstmate reads. */
    async note(name, text) {
      if (!inbox) return;
      const h = home(name);
      const r = exec(expandHome(inbox), ['note', '-'], { env: { FM_HOME: h.path }, input: `${text}\n` });
      if (r.code !== 0) throw new Error(lastLine(r.err || r.out) || `exit ${r.code}`);
    },
  };
}

// ---------------------------------------------------------------- TickTick

const ttTime = (ms) => `${new Date(ms).toISOString().slice(0, 19)}+0000`;

/**
 * TickTick through its official CLI (@ticktick/ticktick-cli), called as `ticktick-cli` so it
 * never meets the unofficial package's `ticktick` command. One small wrapper: a switch to direct
 * Open API calls changes only this function. Reads each paired list (open tasks) and the tasks
 * completed in the last two days; a linked task in neither is fetched on its own, and only a
 * not-found answer makes it "deleted".
 */
export function ticktickPlace({ lists, command = 'ticktick-cli', timeZone, exec = defaultExec, now = Date.now }) {
  let offset = 0;
  const corrected = (ms) => (ms === null ? null : ms - offset);
  const run = (args) => {
    const r = exec(command, args, {});
    if (r.code !== 0) {
      const err = new Error(`${command} ${args.slice(0, 2).join(' ')}: ${lastLine(r.err || r.out) || `exit ${r.code}`}`);
      err.notFound = /\b404\b|not\s*found/i.test(`${r.err}\n${r.out}`);
      throw err;
    }
    return r.out;
  };
  const json = (args) => JSON.parse(run(args) || 'null');
  const learnClock = (task, before) => {
    const t = parseTime(task?.modifiedTime);
    if (t === null) return;
    const seen = t - (before + now()) / 2;
    offset = Math.abs(seen) > SKEW_MIN_MS ? seen : 0;
  };
  // TickTick keeps a note as markdown and escapes punctuation such as ( ) . * with a backslash;
  // a home row is plain text, so a backslash before ASCII punctuation is dropped on read.
  const plain = (s) => s.replace(/\\([!-\/:-@[-`{-~])/g, '$1');
  const item = (t, list) => ({
    ref: `${list}/${t.id}`,
    list,
    id: t.id,
    title: t.title || '',
    status: bucketOfTickTick(t.status),
    due: t.dueDate ? dayIn(parseTime(t.dueDate), t.timeZone || timeZone) : null,
    notes: plain(normText(t.content)),
    time: corrected(parseTime(t.modifiedTime)),
    statusTime: corrected(parseTime(t.completedTime)),
    repeat: Boolean(t.repeatFlag),
  });
  const dueArgs = (due) => (due ? ['--due-date', midnightIn(due, timeZone), '--all-day', '--time-zone', timeZone] : ['--due-date', 'null']);
  const split = (ref) => [ref.slice(0, ref.indexOf('/')), ref.slice(ref.indexOf('/') + 1)];

  return {
    name: 'ticktick',
    fields: FIELDS,
    async read() {
      const items = new Map();
      for (const list of lists) {
        const t = now();
        const open = json(['project', 'data', list, '--json'])?.tasks || [];
        const done = json(['task', 'completed', '--projects', list, '--start-date', ttTime(t - 2 * 86_400_000), '--end-date', ttTime(t + 3_600_000), '--json']) || [];
        for (const task of open) items.set(`${list}/${task.id}`, item(task, list));
        // A repeating task stays open when ticked (its due date moves): the open copy wins.
        for (const task of done) if (!items.has(`${list}/${task.id}`)) items.set(`${list}/${task.id}`, item(task, list));
      }
      return items;
    },
    async lookup(ref) {
      const [list, id] = split(ref);
      try {
        return item(json(['task', 'get', list, id, '--json']), list);
      } catch (err) {
        if (err.notFound) return { gone: 'deleted' };
        throw err;
      }
    },
    async apply(ref, changes) {
      const [list, id] = split(ref);
      if (changes.status === 'done') run(['task', 'complete', list, id]);
      const args = [];
      if (changes.status && changes.status !== 'done') args.push('--status', '0');
      if ('title' in changes) args.push('--title', changes.title);
      if ('notes' in changes) args.push('--content', changes.notes);
      if ('due' in changes) args.push(...dueArgs(changes.due));
      if (args.length) {
        const before = now();
        learnClock(json(['task', 'update', id, '--id', id, '--project', list, ...args, '--json']), before);
      }
      return { ok: true };
    },
    async create(list, values) {
      const args = ['task', 'create', '--title', values.title || '(untitled)', '--project', list];
      if (values.notes) args.push('--content', values.notes);
      if (values.due) args.push(...dueArgs(values.due));
      const before = now();
      const task = json([...args, '--json']);
      if (!task?.id) throw new Error(`${command} task create printed no task id`);
      learnClock(task, before);
      return `${list}/${task.id}`;
    },
  };
}

// ---------------------------------------------------------------- ClickUp

/**
 * ClickUp through its v2 API with your token. Only the lists in config are read, with closed
 * tasks and subtasks and without archived ones. Only status and due date sync; names and
 * descriptions are stakeholder text and stay out. A status maps to a bucket by the list's table
 * (done and closed types are done); a status nobody mapped is "unknown" and becomes a card.
 * Done is dated by date_done, then date_closed; other fields by date_updated, corrected by the
 * server clock. After each write the ClickUp home gets a note (notify), so it can draft the
 * stakeholder update.
 */
export function clickupPlace({ lists, token, timeZone, fetch = globalThis.fetch, now = Date.now, statusMap = {}, notify = null, base = 'https://api.clickup.com/api/v2' }) {
  let offset = 0;
  const statuses = new Map();
  const config = new Map(lists.map((l) => [String(l.id), l]));
  const corrected = (ms) => (ms === null ? null : ms - offset);
  const tableOf = (list) => ({ ...(config.get(String(list))?.statuses || {}), ...(statusMap[list] || {}) });

  async function req(method, route, body) {
    if (!token) throw new Error('no ClickUp token (CLICKUP_TOKEN, or clickup.tokenFile in the sync config)');
    const before = now();
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const server = Date.parse(res.headers?.get?.('date') || '');
    if (Number.isFinite(server)) {
      const seen = server - (before + now()) / 2;
      offset = Math.abs(seen) > SKEW_MIN_MS ? seen : 0;
    }
    if (!res.ok) {
      const err = new Error(`ClickUp ${method} ${route.split('?')[0]}: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const item = (t, list) => {
    const status = bucketOfClickUp(t.status, tableOf(list));
    return {
      ref: t.id,
      list,
      title: t.name || '',
      status,
      statusName: t.status?.status || null,
      due: t.due_date ? dayIn(Number(t.due_date), timeZone) : null,
      time: corrected(parseTime(t.date_updated)),
      statusTime: status === 'done' ? corrected(parseTime(t.date_done) ?? parseTime(t.date_closed)) : null,
    };
  };

  async function statusName(list, bucket) {
    const named = config.get(String(list))?.write?.[bucket];
    if (named) return named;
    if (!statuses.has(list)) statuses.set(list, (await req('GET', `/list/${list}`)).statuses || []);
    const all = statuses.get(list);
    const pick =
      bucket === 'done'
        ? all.find((s) => s.type === 'done') || all.find((s) => s.type === 'closed')
        : bucket === 'open'
          ? all.find((s) => s.type === 'open')
          : all.find((s) => s.type === 'custom' && bucketOfClickUp(s, tableOf(list)) === 'active');
    if (!pick) throw new Error(`list ${list} has no status for "${bucket}"; name one in clickup.lists[].write`);
    return pick.status;
  }

  return {
    name: 'clickup',
    fields: ['status', 'due'],
    async read() {
      const items = new Map();
      for (const { id } of lists) {
        statuses.set(String(id), (await req('GET', `/list/${id}`)).statuses || []);
        for (let page = 0; page < 100; page++) {
          const q = new URLSearchParams({ include_closed: 'true', subtasks: 'true', archived: 'false', page: String(page) });
          const data = await req('GET', `/list/${id}/task?${q}`);
          for (const t of data.tasks || []) items.set(t.id, item(t, String(id)));
          if (data.last_page !== false || !(data.tasks || []).length) break;
        }
      }
      return items;
    },
    async lookup(ref) {
      try {
        const t = await req('GET', `/task/${ref}`);
        return t.archived ? { gone: 'archived' } : item(t, String(t.list?.id || ''));
      } catch (err) {
        if (err.status === 404) return { gone: 'deleted' };
        throw err;
      }
    },
    async apply(ref, changes, it) {
      const body = {};
      if (changes.status) body.status = await statusName(it.list, changes.status);
      if ('due' in changes) Object.assign(body, { due_date: changes.due ? noonMs(changes.due, timeZone) : null, due_date_time: false });
      await req('PUT', `/task/${ref}`, body);
      if (notify) {
        const what = [body.status && `status is now "${body.status}"`, 'due' in changes && `due date is now ${changes.due || 'none'}`].filter(Boolean).join(', ');
        await notify(`sync: ClickUp task ${ref} "${it.title || ''}": ${what}. Draft the stakeholder update if one is needed.`);
      }
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------- vault

const VAULT_WRITE = `
set -e
cd "$1"
VAULT_ROOT="$1"; export VAULT_ROOT
. "./$2"
acquire_run_lock
"$3" --input-type=module -e '
  import fs from "node:fs";
  import { pathToFileURL } from "node:url";
  const [core, file, value] = process.argv.slice(1);
  const { setFrontmatter } = await import(pathToFileURL(core).href);
  fs.writeFileSync(file, setFrontmatter(fs.readFileSync(file, "utf8"), "task-status", value));
' "$4" "$5" "$6"
if ! "./$7" "$5"; then git checkout -q -- "$5"; echo "the vault lint refused the change" >&2; exit 3; fi
git add -- "$5"
git commit -q --only -m "sync: task-status $8" -- "$5"
`;

/**
 * The vault: project notes under one folder (projects/) that name a home task in their
 * frontmatter (task: <home>/<task id>). Only task-status (open, active or done) syncs, two-way.
 * A board card note (board_list) keeps its ClickUp board_state: it is read, never written. Each
 * write takes the vault's own run lock (its lockHelper's acquire_run_lock), changes that one
 * line, runs the vault lint on the file, and commits only that file. A note with uncommitted
 * changes is never written. Dated by the note's last commit (its file time while uncommitted).
 */
export function vaultPlace({ path: vaultPath, folder = 'projects', write = true, statusMap = {}, lockHelper = 'bin/lib-lock.sh', lint = 'bin/lint', exec = defaultExec }) {
  const root = expandHome(vaultPath);
  const git = (args) => exec('git', args, { cwd: root });
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');

  function notes(dir, out = []) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) notes(p, out);
      else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
  }

  function timeOf(file) {
    const name = rel(file);
    const dirty = git(['status', '--porcelain', '--', name]);
    const log = git(['log', '-1', '--format=%ct', '--', name]);
    const committed = Number(log.out.trim()) * 1000;
    if (dirty.code === 0 && !dirty.out.trim() && log.code === 0 && committed > 0) return committed;
    return fs.statSync(file).mtimeMs;
  }

  return {
    name: 'vault',
    fields: ['status'],
    async read() {
      if (!fs.existsSync(path.join(root, folder))) throw new Error(`vault: ${path.join(root, folder)} does not exist`);
      const items = new Map();
      for (const file of notes(path.join(root, folder))) {
        const fm = frontmatter(fs.readFileSync(file, 'utf8'));
        if (!fm || fm.type !== 'project' || !fm.task) continue;
        const board = 'board_list' in fm;
        const raw = board ? fm.board_state : fm['task-status'];
        const status = board ? bucketOfClickUp({ status: raw }, statusMap) : BUCKETS.includes(raw) ? raw : raw ? 'unknown' : null;
        items.set(rel(file), {
          ref: rel(file),
          task: fm.task,
          status,
          field: board ? 'board_state' : 'task-status',
          time: timeOf(file),
          ...(board ? { readOnly: 'a board card note keeps its ClickUp board_state' } : {}),
        });
      }
      return items;
    },
    async lookup() {
      return { gone: 'deleted' };
    },
    async apply(ref, changes) {
      if (!write) return { skipped: 'the vault writer is off (vault.write in the sync config)' };
      const file = path.join(root, ref);
      if (!rel(file).startsWith(`${folder}/`)) throw new Error(`${ref} is outside ${folder}/`);
      const fm = frontmatter(fs.readFileSync(file, 'utf8'));
      if (!fm || fm.type !== 'project') throw new Error(`${ref}: only notes with type: project carry task-status`);
      if ('board_list' in fm) throw new Error(`${ref}: a board card note (board_list) keeps board_state; task-status is refused there`);
      if (!fm.task) throw new Error(`${ref}: task-status needs task: in the same note`);
      if (!BUCKETS.includes(changes.status)) throw new Error(`${ref}: task-status takes open|active|done, not ${changes.status}`);
      if (git(['status', '--porcelain', '--', ref]).out.trim()) throw new Error(`${ref} has uncommitted changes; it is left alone`);
      const name = path.basename(ref, '.md');
      const r = exec('bash', ['-c', VAULT_WRITE, 'sync-vault', root, lockHelper, process.execPath, CORE, ref, changes.status, lint, name], { cwd: root });
      if (r.code !== 0) throw new Error(`vault write of ${ref}: ${lastLine(r.err || r.out) || `exit ${r.code}`}`);
      return { ok: true };
    },
  };
}
