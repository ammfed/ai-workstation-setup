// Tests for the task sync (templates/ledger/bin/sync*.mjs), one block per seam: the mapper, the
// notes section, the link store, the conflict resolver, the drift report, the home writer, the
// TickTick, ClickUp and vault adapters, and the sync pass itself against in-memory places.
// Every outside tool is a stand-in: TickTick is a fake `ticktick-cli`, ClickUp a fake fetch,
// the homes and the vault are throwaway folders. Nothing here reaches a real account or home.
// All names, ids and text are made up.
// Run: node --test test/sync.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  Links,
  bucketOfClickUp,
  bucketOfHome,
  bucketOfTickTick,
  dayIn,
  frontmatter,
  midnightIn,
  notesOf,
  resolve,
  setFrontmatter,
  statusLine,
  syncPass,
  withNotes,
} from '../templates/ledger/bin/sync-core.mjs';
import { clickupPlace, homePlace, ticktickPlace, vaultPlace } from '../templates/ledger/bin/sync-places.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const dir = (name) => {
  const d = path.join(tmp, `${name}-${++n}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const MIN = 60_000;
const T0 = Date.parse('2026-01-05T09:00:00Z');
const SKEW = 2 * MIN;

// ------------------------------------------------------------------ mapper

test('mapper: every known status maps to a bucket, an unknown one to "unknown"', () => {
  assert.equal(bucketOfHome('queued'), 'open');
  assert.equal(bucketOfHome('in_flight'), 'active');
  assert.equal(bucketOfHome('done'), 'done');

  assert.equal(bucketOfTickTick(0), 'open');
  assert.equal(bucketOfTickTick(2), 'done');
  assert.equal(bucketOfTickTick(-1), 'abandoned');
  assert.equal(bucketOfTickTick(7), 'unknown');

  const table = { 'waiting on someone': 'active' };
  const cases = [
    [{ status: 'to do', type: 'open' }, 'open'],
    [{ status: 'in progress', type: 'custom' }, 'active'],
    [{ status: 'in review', type: 'custom' }, 'active'],
    [{ status: 'Waiting On Someone', type: 'custom' }, 'active'],
    [{ status: 'done', type: 'done' }, 'done'],
    [{ status: 'complete', type: 'closed' }, 'done'],
    [{ status: 'shipped', type: 'done' }, 'done'],
    [{ status: 'something new', type: 'custom' }, 'unknown'],
  ];
  for (const [status, want] of cases) assert.equal(bucketOfClickUp(status, table), want, status.status);
});

test('mapper: dates move between a day and a time in a named time zone', () => {
  assert.equal(dayIn(Date.parse('2026-03-09T20:00:00.000+0000'), 'Asia/Dubai'), '2026-03-10');
  assert.equal(dayIn(Date.parse('2026-03-09T20:00:00.000+0000'), 'UTC'), '2026-03-09');
  assert.equal(midnightIn('2026-03-10', 'Asia/Dubai'), '2026-03-10T00:00:00+0400');
  assert.equal(midnightIn('2026-07-01', 'Europe/London'), '2026-07-01T00:00:00+0100');
  assert.equal(midnightIn('2026-01-01', 'UTC'), '2026-01-01T00:00:00+0000');
});

// ------------------------------------------------------------------ notes section

const BODY = ['Intent: paint the fence before the party.', '', 'Brief: two coats.', '', '## Notes', 'buy the green paint', 'due: 2026-02-01'].join('\n');

test('notes: only the ## Notes section is read, with the due line apart', () => {
  assert.deepEqual(notesOf(BODY), { notes: 'buy the green paint', due: '2026-02-01' });
  assert.deepEqual(notesOf('Intent only.'), { notes: '', due: null });
  assert.deepEqual(notesOf('## Notes\nfirst\n\nsecond\n## Later\nnot notes'), { notes: 'first\n\nsecond', due: null });
});

test('notes: a write changes only the ## Notes section', () => {
  const next = withNotes(BODY, { notes: 'buy the blue paint\nand a brush', due: '2026-02-03' });
  assert.ok(next.startsWith('Intent: paint the fence before the party.\n\nBrief: two coats.\n\n## Notes\n'));
  assert.deepEqual(notesOf(next), { notes: 'buy the blue paint\nand a brush', due: '2026-02-03' });
  const added = withNotes('Intent only.', { notes: 'a note', due: null });
  assert.equal(added, 'Intent only.\n\n## Notes\na note');
  assert.equal(withNotes(BODY, { notes: '', due: null }), 'Intent: paint the fence before the party.\n\nBrief: two coats.');
  const middle = withNotes('## Notes\nold\n## Later\nkeep me', { notes: 'new', due: '2026-01-09' });
  assert.equal(middle, '## Notes\nnew\ndue: 2026-01-09\n\n## Later\nkeep me');
});

// ------------------------------------------------------------------ frontmatter (vault)

const NOTE = ['---', 'type: project', 'status: current', 'updated: 2026-01-02', 'task: main/fence-a1', 'task-status: open', '---', '', '# Fence', '', 'Body text.', ''].join('\n');

test('frontmatter: one key changes, every other line stays', () => {
  assert.equal(frontmatter(NOTE)['task-status'], 'open');
  const next = setFrontmatter(NOTE, 'task-status', 'done');
  assert.equal(next, NOTE.replace('task-status: open', 'task-status: done'));
  const added = setFrontmatter('---\ntype: project\n---\nBody\n', 'task-status', 'active');
  assert.equal(added, '---\ntype: project\ntask-status: active\n---\nBody\n');
  assert.throws(() => setFrontmatter('No frontmatter here', 'task-status', 'done'), /frontmatter/);
});

// ------------------------------------------------------------------ link store

test('links: the home id is the key, so a title change keeps the link', () => {
  const links = new Links();
  links.link('main/fence-a1', 'ticktick', 'list1/tt1');
  links.link('main/fence-a1', 'clickup', 'cu1');
  assert.equal(links.find('ticktick', 'list1/tt1'), 'main/fence-a1');
  assert.equal(links.get('main/fence-a1').refs.clickup, 'cu1');
  // a rename touches no key
  const again = new Links(JSON.parse(JSON.stringify(links.toJSON())));
  assert.equal(again.find('clickup', 'cu1'), 'main/fence-a1');
  assert.throws(() => again.link('main/other-b2', 'ticktick', 'list1/tt1'), /already linked/);
  again.unlink('main/fence-a1', 'clickup');
  assert.equal(again.find('clickup', 'cu1'), null);
  again.drop('main/fence-a1');
  assert.deepEqual(again.keys(), []);
});

// ------------------------------------------------------------------ conflict resolver

const side = (place, value, base, time, extra = {}) => ({ place, value, base, time, ...extra });

test('resolver: one side changed, both the same, newest outside the window, a card inside it', () => {
  const r1 = resolve({ sides: [side('home', 'open', 'open', T0), side('ticktick', 'done', 'open', T0 - 60 * MIN)], skewMs: SKEW });
  assert.deepEqual(r1, { kind: 'apply', from: 'ticktick', value: 'done' });

  const r2 = resolve({ sides: [side('home', 'done', 'open', T0), side('ticktick', 'done', 'open', T0)], skewMs: SKEW });
  assert.equal(r2.kind, 'agree');

  const r3 = resolve({ sides: [side('home', 'a', 'x', T0), side('ticktick', 'b', 'x', T0 + 5 * MIN)], skewMs: SKEW });
  assert.deepEqual(r3, { kind: 'apply', from: 'ticktick', value: 'b' });

  const r4 = resolve({ sides: [side('home', 'a', 'x', T0 + 1 * MIN), side('ticktick', 'b', 'x', T0)], skewMs: SKEW });
  assert.equal(r4.kind, 'card');
  assert.match(r4.reason, /within 2 minutes/);

  const r5 = resolve({ sides: [side('home', 'a', 'x', T0), side('clickup', 'b', 'x', T0 + 9 * MIN, { dayOnly: true })], skewMs: SKEW });
  assert.equal(r5.kind, 'card');

  assert.equal(resolve({ sides: [side('home', 'a', 'a', T0), side('ticktick', 'a', 'a', T0)], skewMs: SKEW }).kind, 'same');

  const forced = resolve({ sides: [side('home', 'a', 'x', T0), side('ticktick', 'b', 'x', T0)], skewMs: SKEW, force: 'home' });
  assert.deepEqual(forced, { kind: 'apply', from: 'home', value: 'a' });

  const abandoned = resolve({ sides: [side('home', 'open', 'open', T0), side('ticktick', 'abandoned', 'open', T0)], skewMs: SKEW });
  assert.equal(abandoned.kind, 'card');
});

// ------------------------------------------------------------------ drift report

test('drift report: the one status line counts fixes by direction, cards and failures', () => {
  const journal = [
    { at: T0, kind: 'fix', from: 'ticktick', to: 'home' },
    { at: T0, kind: 'fix', from: 'ticktick', to: 'home' },
    { at: T0, kind: 'fix', from: 'ticktick', to: 'home' },
    { at: T0, kind: 'fix', from: 'home', to: 'clickup' },
    { at: T0, kind: 'card', key: 'main/x:status' },
    { at: T0 - 48 * 60 * MIN, kind: 'fail', place: 'ticktick' },
  ];
  assert.equal(
    statusLine(journal, { since: T0 - 24 * 60 * MIN, label: '07:30', openCards: 1 }),
    'sync 07:30: 4 fixed (3 TickTick→home, 1 home→ClickUp), 1 for you, 0 failed',
  );
  assert.equal(statusLine([], { since: 0, label: '07:30', openCards: 0 }), 'sync 07:30: 0 fixed, 0 for you, 0 failed');
});

// ------------------------------------------------------------------ fake places for the sync pass

function fakePlace(name, fields, entries = [], { failRead = false, gone = {} } = {}) {
  const items = new Map(entries.map((e) => [e.ref, { ...e }]));
  return {
    name,
    fields,
    items,
    writes: [],
    created: [],
    failRead,
    async read() {
      if (this.failRead) throw new Error(`${name} is down`);
      return new Map([...items].map(([k, v]) => [k, { ...v }]));
    },
    async lookup(ref) {
      return items.get(ref) ? { ...items.get(ref) } : { gone: gone[ref] || 'deleted' };
    },
    async apply(ref, changes) {
      this.writes.push({ ref, changes });
      Object.assign(items.get(ref), changes);
      return { ok: true };
    },
    async create(target, values) {
      const ref = `${target}/new${this.created.length + 1}`;
      this.created.push({ target, values });
      items.set(ref, { ref, list: target, ...values, time: T0 });
      return ref;
    },
  };
}

function fakeHome(rows = []) {
  const place = fakePlace(
    'home',
    ['title', 'status', 'due', 'notes'],
    rows.map((r) => ({ ref: r.key, home: r.key.split('/')[0], hold: false, due: null, notes: '', seenAt: T0, ...r })),
  );
  place.notes = [];
  place.note = async (home, text) => place.notes.push({ home, text });
  place.apply = async function (ref, changes) {
    const item = this.items.get(ref);
    if (changes.status === 'done' && item.hold) throw new Error('refusing to close a captain hold');
    this.writes.push({ ref, changes });
    Object.assign(item, changes);
    return { ok: true };
  };
  place.create = async function (home, values) {
    const ref = `${home}/new-${this.created.length + 1}`;
    this.created.push({ home, values });
    this.items.set(ref, { ref, home, hold: false, seenAt: T0, ...values });
    return ref;
  };
  return place;
}

const row = (key, extra = {}) => ({ key, title: 'Paint the fence', status: 'open', ...extra });
const tt = (ref, extra = {}) => ({ ref, list: ref.split('/')[0], title: 'Paint the fence', status: 'open', due: null, notes: '', time: T0 - 60 * MIN, ...extra });

/** A linked pair whose last synced values match what both places hold now. */
function linkedWorld({ homeRow = {}, ticktick = {}, clickup = null, base = {} } = {}) {
  const home = fakeHome([row('main/fence-a1', homeRow)]);
  const tick = fakePlace('ticktick', ['title', 'status', 'due', 'notes'], [tt('list1/tt1', ticktick)]);
  const links = new Links();
  links.link('main/fence-a1', 'ticktick', 'list1/tt1');
  const synced = { title: 'Paint the fence', status: 'open', due: null, notes: '', ...base };
  links.setBase('main/fence-a1', 'home', synced);
  links.setBase('main/fence-a1', 'ticktick', synced);
  const places = { home, ticktick: tick };
  if (clickup) {
    const cu = fakePlace('clickup', ['status', 'due'], [{ ref: 'cu1', list: 'cl1', status: 'open', due: null, time: T0 - 60 * MIN, ...clickup }]);
    links.link('main/fence-a1', 'clickup', 'cu1');
    links.setBase('main/fence-a1', 'clickup', { status: synced.status, due: synced.due });
    places.clickup = cu;
  }
  return { home, tick, links, places, state: { cards: {}, statusMap: {} } };
}

const pass = (w, extra = {}) => syncPass({ places: w.places, pairs: [{ home: 'main', list: 'list1' }], links: w.links, state: w.state, now: T0, skewMs: SKEW, ...extra });

// ------------------------------------------------------------------ the sync pass: settled drift

test('pass: a tick in TickTick closes the unchanged home row and tells that home', async () => {
  const w = linkedWorld({ ticktick: { status: 'done', time: T0 - 30 * MIN, statusTime: T0 - 48 * MIN } });
  const r = await pass(w);
  assert.deepEqual(w.home.writes, [{ ref: 'main/fence-a1', changes: { status: 'done' } }]);
  assert.equal(w.tick.writes.length, 0);
  assert.equal(w.home.notes.length, 1);
  assert.match(w.home.notes[0].text, /fence-a1.*done.*TickTick/);
  assert.deepEqual(r.journal.filter((e) => e.kind === 'fix').map((e) => `${e.from}>${e.to}:${e.field}`), ['ticktick>home:status']);
  assert.equal(w.links.get('main/fence-a1').base.home.status, 'done');
  // a second pass finds nothing to do
  const again = await pass(w);
  assert.equal(again.journal.filter((e) => e.kind === 'fix').length, 0);
});

test('pass: a finished home row completes the open TickTick task', async () => {
  const w = linkedWorld({ homeRow: { status: 'done' } });
  await pass(w);
  assert.deepEqual(w.tick.writes, [{ ref: 'list1/tt1', changes: { status: 'done' } }]);
  assert.equal(w.home.writes.length, 0);
});

test('pass: a due date moved in ClickUp reaches the home row and TickTick', async () => {
  const w = linkedWorld({ clickup: { due: '2026-02-10', time: T0 - 10 * MIN } });
  await pass(w);
  assert.deepEqual(w.home.writes, [{ ref: 'main/fence-a1', changes: { due: '2026-02-10' } }]);
  assert.deepEqual(w.tick.writes, [{ ref: 'list1/tt1', changes: { due: '2026-02-10' } }]);
});

test('pass: notes edited on both sides, the newest dated edit wins outside the window', async () => {
  const w = linkedWorld({ homeRow: { notes: 'home words', seenAt: T0 - 30 * MIN }, ticktick: { notes: 'phone words', time: T0 - 5 * MIN } });
  await pass(w);
  assert.deepEqual(w.home.writes, [{ ref: 'main/fence-a1', changes: { notes: 'phone words' } }]);
  assert.equal(w.tick.writes.length, 0);
});

test('pass: an "active" move in ClickUp does not start home work; it is a note, and it stays quiet', async () => {
  const w = linkedWorld({ clickup: { status: 'active', time: T0 - 10 * MIN } });
  await pass(w);
  assert.equal(w.home.writes.length, 0);
  assert.equal(w.tick.writes.length, 0, 'TickTick has no "active"; open stays open');
  assert.match(w.home.notes[0].text, /active.*ClickUp/);
  const again = await pass(w);
  assert.equal(again.journal.length, 0);
  assert.equal(w.home.notes.length, 1);
});

// ------------------------------------------------------------------ the sync pass: true unknowns

test('pass: a tick and a home status change inside 2 minutes is a card, and nothing is written', async () => {
  const w = linkedWorld({ homeRow: { status: 'active', seenAt: T0 - 47 * MIN }, ticktick: { status: 'done', time: T0 - 48 * MIN, statusTime: T0 - 48 * MIN } });
  const r = await pass(w);
  assert.equal(w.home.writes.length + w.tick.writes.length, 0);
  assert.equal(r.cards.length, 1);
  assert.match(r.cards[0].text, /sync pick main\/fence-a1:status home\|ticktick/);
  assert.equal(w.home.notes.length, 1, 'the card goes to the home once');
  await pass(w);
  assert.equal(w.home.notes.length, 1, 'and is not sent again');
});

test('pass: a picked card applies the chosen side and closes', async () => {
  const w = linkedWorld({ homeRow: { status: 'active', seenAt: T0 - 47 * MIN }, ticktick: { status: 'done', time: T0 - 48 * MIN } });
  await pass(w);
  w.links.force('main/fence-a1', 'status', 'ticktick');
  const r = await pass(w);
  assert.deepEqual(w.home.writes, [{ ref: 'main/fence-a1', changes: { status: 'done' } }]);
  assert.equal(r.cards.length, 0);
  assert.deepEqual(Object.keys(w.state.cards), []);
});

test('pass: a done signal for a captain hold is always a card, whatever the dates', async () => {
  const w = linkedWorld({ homeRow: { hold: true }, ticktick: { status: 'done', time: T0 - 300 * MIN } });
  const r = await pass(w);
  assert.equal(w.home.writes.length, 0);
  assert.equal(r.cards.length, 1);
  assert.match(r.cards[0].text, /captain hold/);
});

test('pass: a linked ClickUp task deleted or archived while the home row is open is a card', async () => {
  for (const gone of ['deleted', 'archived']) {
    const w = linkedWorld({ clickup: {} });
    w.places.clickup.items.delete('cu1');
    w.places.clickup.lookup = async () => ({ gone });
    const r = await pass(w);
    assert.equal(r.cards.length, 1, gone);
    assert.match(r.cards[0].text, new RegExp(gone));
  }
});

test('pass: a new ClickUp status is a card the first time, then the answer is remembered', async () => {
  const w = linkedWorld({ clickup: { status: 'unknown', statusName: 'parked for later', time: T0 - 10 * MIN } });
  const r = await pass(w);
  assert.equal(r.cards.length, 1);
  assert.match(r.cards[0].text, /parked for later/);
  assert.match(r.cards[0].text, /sync map cl1 "parked for later" open\|active\|done/);
  assert.equal(w.home.writes.length, 0);
});

test('pass: a place that cannot be read changes nothing and is counted as failed', async () => {
  const w = linkedWorld({ homeRow: { status: 'done' } });
  w.tick.failRead = true;
  const r = await pass(w);
  assert.equal(w.tick.writes.length + w.home.writes.length, 0);
  assert.equal(r.cards.length, 0, 'an unreadable place never looks deleted');
  assert.deepEqual(r.journal.filter((e) => e.kind === 'fail').map((e) => e.place), ['ticktick']);
});

test('pass: a done home row pruned from the backlog drops its link quietly', async () => {
  const w = linkedWorld({ homeRow: { status: 'done' }, ticktick: { status: 'done' }, base: { status: 'done' } });
  w.home.items.delete('main/fence-a1');
  const r = await pass(w);
  assert.equal(r.cards.length, 0);
  assert.equal(w.links.get('main/fence-a1'), null);
});

test('pass: an item long done on both sides is not fetched again on every pass', async () => {
  const w = linkedWorld({ homeRow: { status: 'done' }, ticktick: { status: 'done' }, base: { status: 'done' } });
  w.tick.items.delete('list1/tt1');
  w.tick.lookup = async () => {
    throw new Error('looked up');
  };
  const r = await pass(w);
  assert.deepEqual(r.journal, []);
  assert.ok(w.links.get('main/fence-a1').refs.ticktick);
});

// ------------------------------------------------------------------ the sync pass: items in one place

test('pass: a new home row in a paired home becomes a TickTick task, linked', async () => {
  const home = fakeHome([row('main/new-row', { notes: 'a note', due: '2026-02-01' }), row('main/old-row', { status: 'done' }), row('other/elsewhere')]);
  const tick = fakePlace('ticktick', ['title', 'status', 'due', 'notes']);
  const w = { home, tick, links: new Links(), places: { home, ticktick: tick }, state: { cards: {}, statusMap: {} } };
  await pass(w);
  assert.deepEqual(tick.created, [{ target: 'list1', values: { title: 'Paint the fence', status: 'open', due: '2026-02-01', notes: 'a note' } }]);
  assert.equal(w.links.find('ticktick', 'list1/new1'), 'main/new-row');
  assert.equal(w.links.get('main/old-row'), null, 'a done row is not sent');
  assert.equal(w.links.get('other/elsewhere'), null, 'an unpaired home is not sent');
});

test('pass: a new TickTick task in a paired list becomes a Queued home row, linked', async () => {
  const home = fakeHome([]);
  const tick = fakePlace('ticktick', ['title', 'status', 'due', 'notes'], [tt('list1/tt9', { title: 'Call the plumber', notes: 'after 10' }), tt('list1/tt8', { status: 'done' }), tt('list2/tt7')]);
  const w = { home, tick, links: new Links(), places: { home, ticktick: tick }, state: { cards: {}, statusMap: {} } };
  await pass(w);
  assert.deepEqual(home.created, [{ home: 'main', values: { title: 'Call the plumber', status: 'open', due: null, notes: 'after 10' } }]);
  assert.equal(w.links.find('ticktick', 'list1/tt9'), 'main/new-1');
  assert.match(home.notes[0].text, /added/);
});

test('pass: an open home row and an open TickTick task with the same title are linked, not duplicated', async () => {
  const home = fakeHome([row('main/fence-a1', { notes: 'home notes' })]);
  const tick = fakePlace('ticktick', ['title', 'status', 'due', 'notes'], [tt('list1/tt1', { title: 'paint the fence ', notes: 'other notes' })]);
  const w = { home, tick, links: new Links(), places: { home, ticktick: tick }, state: { cards: {}, statusMap: {} } };
  await pass(w);
  assert.equal(tick.created.length + home.created.length, 0);
  assert.equal(w.links.find('ticktick', 'list1/tt1'), 'main/fence-a1');
  // the home is the truth when the two first meet
  assert.deepEqual(tick.writes, [{ ref: 'list1/tt1', changes: { title: 'Paint the fence', notes: 'home notes' } }]);
});

test('pass: a vault note that names a home task is linked; the vault writer off writes nothing and stays stable', async () => {
  const w = linkedWorld({ homeRow: { status: 'done' } });
  const vault = fakePlace('vault', ['status'], [{ ref: 'projects/Fence.md', task: 'main/fence-a1', status: 'open', time: T0 - 90 * MIN }]);
  vault.apply = async function (ref, changes) {
    this.writes.push({ ref, changes });
    return { skipped: 'the vault writer is off' };
  };
  w.places.vault = vault;
  await pass(w);
  assert.equal(w.links.find('vault', 'projects/Fence.md'), 'main/fence-a1');
  assert.deepEqual(w.tick.writes, [{ ref: 'list1/tt1', changes: { status: 'done' } }]);
  await pass(w);
  assert.equal(w.tick.writes.length, 1);
  assert.equal(w.home.writes.length, 0, 'the stale vault value never flows back');
});

test('pass: a dry run writes nothing and keeps the links as they were', async () => {
  const w = linkedWorld({ ticktick: { status: 'done' } });
  const before = JSON.stringify(w.links.toJSON());
  const r = await pass(w, { dryRun: true });
  assert.equal(w.home.writes.length, 0);
  assert.equal(JSON.stringify(w.links.toJSON()), before);
  assert.equal(r.journal.filter((e) => e.kind === 'fix').length, 1);
});

// ------------------------------------------------------------------ home writer

/** A stand-in for tasks-axi and fm-inbox.sh: records each call, answers like the real one. */
function recorder(answers = {}) {
  const calls = [];
  const exec = (cmd, args, opts = {}) => {
    const call = { cmd, args, env: opts.env, input: opts.input };
    const bodyFile = args.includes('--body-file') ? args[args.indexOf('--body-file') + 1] : null;
    if (bodyFile) call.body = fs.readFileSync(bodyFile, 'utf8');
    calls.push(call);
    const answer = answers[args[0]];
    return typeof answer === 'function' ? answer(args) : answer || { code: 0, out: '{"ok":true}', err: '' };
  };
  return { calls, exec };
}

const BACKLOG = [
  '# Backlog',
  '',
  '## In flight',
  '- [ ] fence-a1 - Paint the fence (kind: task) (since 2026-01-02)',
  '  Intent: paint it before the party.',
  '',
  '  ## Notes',
  '  buy the green paint',
  '  due: 2026-02-01',
  '- [ ] held-b2 - Pick the colour (since 2026-01-02) (hold: Blue or green?) (hold-kind: captain)',
  '## Queued',
  '- [ ] plain-c3 - Plain row (since 2026-01-03)',
  '## Done',
  '- [x] old-d4 - Old row (done 2026-01-01)',
  '',
].join('\n');

function homeWorld(answers) {
  const h = dir('home');
  write(path.join(h, 'data', 'backlog.md'), BACKLOG);
  const rec = recorder(answers);
  const place = homePlace({ homes: [{ name: 'main', path: h }], tasksAxi: 'tasks-axi', inbox: '/opt/fm/bin/fm-inbox.sh', exec: rec.exec });
  return { h, rec, place, file: path.join(h, 'data', 'backlog.md') };
}

test('home: rows read with their bucket, title, notes, due and captain hold', async () => {
  const { place } = homeWorld();
  const items = await place.read();
  const a = items.get('main/fence-a1');
  assert.equal(a.status, 'active');
  assert.equal(a.title, 'Paint the fence');
  assert.equal(a.notes, 'buy the green paint');
  assert.equal(a.due, '2026-02-01');
  assert.equal(a.hold, false);
  assert.ok(a.seenAt > 0);
  assert.equal(items.get('main/held-b2').hold, true);
  assert.equal(items.get('main/plain-c3').status, 'open');
  assert.equal(items.get('main/old-d4').status, 'done');
});

test('home writer: a notes or due write changes only ## Notes and archives the old body', async () => {
  const { place, rec, file } = homeWorld();
  const items = await place.read();
  await place.apply('main/fence-a1', { notes: 'buy the blue paint', due: '2026-02-05' }, items.get('main/fence-a1'));
  assert.equal(rec.calls.length, 1);
  const c = rec.calls[0];
  assert.equal(c.cmd, 'tasks-axi');
  assert.deepEqual(c.args.filter((a) => !a.includes(path.sep)), ['update', 'fence-a1', '--body-file', '--archive-body', '--file']);
  assert.equal(c.args.at(-1), file);
  assert.equal(c.body, 'Intent: paint it before the party.\n\n## Notes\nbuy the blue paint\ndue: 2026-02-05\n');
});

test('home writer: status and title use tasks-axi, and it never closes a captain hold', async () => {
  const { place, rec, file } = homeWorld();
  const items = await place.read();
  await place.apply('main/plain-c3', { status: 'done' }, items.get('main/plain-c3'));
  await place.apply('main/old-d4', { status: 'open' }, items.get('main/old-d4'));
  await place.apply('main/plain-c3', { title: 'Plain row, renamed' }, items.get('main/plain-c3'));
  assert.deepEqual(
    rec.calls.map((c) => c.args),
    [
      ['done', 'plain-c3', '--file', file],
      ['reopen', 'old-d4', '--file', file],
      ['update', 'plain-c3', '--title', 'Plain row, renamed', '--file', file],
    ],
  );
  await assert.rejects(place.apply('main/held-b2', { status: 'done' }, items.get('main/held-b2')), /captain hold/);
  assert.equal(rec.calls.length, 3);
});

test('home writer: a new row is minted in Queued, and a note goes to that home inbox', async () => {
  const { place, rec, file, h } = homeWorld({ add: () => ({ code: 0, out: JSON.stringify({ ok: true, task: { id: 'call-the-plumber-7k' } }), err: '' }) });
  const key = await place.create('main', { title: 'Call the plumber', status: 'open', due: '2026-02-02', notes: 'after 10' });
  assert.equal(key, 'main/call-the-plumber-7k');
  const c = rec.calls[0];
  assert.deepEqual(c.args.filter((a) => !a.includes(path.sep)), ['add', '--mint', 'Call the plumber', '--queue', '--body-file', '--file', '--json']);
  assert.equal(c.args.at(-2), file);
  assert.equal(c.body, '## Notes\nafter 10\ndue: 2026-02-02\n');
  await place.note('main', 'sync: a note');
  assert.deepEqual(rec.calls[1].args, ['note', '-']);
  assert.equal(rec.calls[1].cmd, '/opt/fm/bin/fm-inbox.sh');
  assert.equal(rec.calls[1].env.FM_HOME, h);
  assert.equal(rec.calls[1].input, 'sync: a note\n');
});

const hasTasksAxi = spawnSync('tasks-axi', ['--version'], { encoding: 'utf8' }).status === 0;

test('home writer against the real tasks-axi in a throwaway home', { skip: !hasTasksAxi && 'tasks-axi is not installed' }, async () => {
  const h = dir('real-home');
  const file = path.join(h, 'data', 'backlog.md');
  const run = (...args) => spawnSync('tasks-axi', [...args, '--file', file], { encoding: 'utf8', cwd: h });
  fs.mkdirSync(path.join(h, 'data'), { recursive: true });
  const body = path.join(h, 'body.md');
  write(body, 'Intent: keep this text.\n\n## Notes\nold note\ndue: 2026-02-01\n');
  assert.equal(run('add', 'fence-a1', 'Paint the fence', '--body-file', body).status, 0);
  const place = homePlace({ homes: [{ name: 'main', path: h }] });
  const items = await place.read();
  assert.deepEqual([items.get('main/fence-a1').notes, items.get('main/fence-a1').due], ['old note', '2026-02-01']);
  await place.apply('main/fence-a1', { notes: 'new note' }, items.get('main/fence-a1'));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /Intent: keep this text\./);
  assert.match(text, /## Notes\n {2}new note\n {2}due: 2026-02-01/);
  const archive = fs.readdirSync(path.join(h, 'data')).find((f) => f !== 'backlog.md');
  assert.ok(archive, 'the old body is archived next to the backlog');
  assert.match(fs.readFileSync(path.join(h, 'data', archive), 'utf8'), /old note/);
  const again = await place.read();
  assert.equal(again.get('main/fence-a1').notes, 'new note');
});

// ------------------------------------------------------------------ TickTick adapter

// Field shapes as TickTick's open API returns them; every value is made up.
const TT_OPEN = {
  project: { id: 'list1', name: 'Example list' },
  tasks: [
    {
      id: 'tt1',
      projectId: 'list1',
      title: 'Paint the fence',
      content: 'buy the green paint\r\n',
      status: 0,
      dueDate: '2026-01-31T20:00:00.000+0000',
      timeZone: 'Asia/Dubai',
      isAllDay: true,
      modifiedTime: '2026-01-05T08:00:00.000+0000',
      etag: 'abc123',
    },
    { id: 'tt2', projectId: 'list1', title: 'No dates', status: 0, etag: 'def456' },
  ],
  columns: [],
};
const TT_DONE = [{ id: 'tt3', projectId: 'list1', title: 'Ticked', status: 2, completedTime: '2026-01-05T08:12:00.000+0000', modifiedTime: '2026-01-05T08:12:01.000+0000' }];

function ticktickWorld(extra = {}) {
  const rec = recorder({
    project: () => ({ code: 0, out: JSON.stringify(TT_OPEN), err: '' }),
    task: (args) => {
      if (args[1] === 'completed') return { code: 0, out: JSON.stringify(TT_DONE), err: '' };
      if (args[1] === 'get') return { code: 1, out: '', err: 'Error: API error 404: task not found' };
      if (args[1] === 'create') return { code: 0, out: JSON.stringify({ id: 'tt9', projectId: 'list1', modifiedTime: '2026-01-05T09:00:00.000+0000' }), err: '' };
      return { code: 0, out: JSON.stringify({ id: args[2], modifiedTime: '2026-01-05T09:00:00.000+0000' }), err: '' };
    },
    ...extra,
  });
  const place = ticktickPlace({ lists: ['list1'], command: 'ticktick-cli', timeZone: 'Asia/Dubai', exec: rec.exec, now: () => T0 });
  return { rec, place };
}

test('ticktick: open and recently ticked tasks read as normalized items', async () => {
  const { place, rec } = ticktickWorld();
  const items = await place.read();
  const a = items.get('list1/tt1');
  assert.deepEqual(
    { title: a.title, status: a.status, due: a.due, notes: a.notes, time: a.time, list: a.list },
    { title: 'Paint the fence', status: 'open', due: '2026-02-01', notes: 'buy the green paint', time: Date.parse('2026-01-05T08:00:00Z'), list: 'list1' },
  );
  assert.equal(items.get('list1/tt2').time, null, 'no modifiedTime: the sync dates it when it first sees it');
  assert.equal(items.get('list1/tt3').status, 'done');
  assert.equal(items.get('list1/tt3').statusTime, Date.parse('2026-01-05T08:12:00Z'));
  assert.deepEqual(rec.calls[0].args, ['project', 'data', 'list1', '--json']);
  assert.equal(rec.calls[1].args.slice(0, 4).join(' '), 'task completed --projects list1');
});

test('ticktick: writes go through the official CLI with the right flags', async () => {
  const { place, rec } = ticktickWorld();
  const item = { ref: 'list1/tt1', list: 'list1', id: 'tt1' };
  await place.apply('list1/tt1', { status: 'done' }, item);
  await place.apply('list1/tt1', { status: 'open' }, item);
  await place.apply('list1/tt1', { title: 'New title', notes: 'new notes', due: '2026-02-03' }, item);
  await place.apply('list1/tt1', { due: null }, item);
  assert.deepEqual(
    rec.calls.map((c) => c.args),
    [
      ['task', 'complete', 'list1', 'tt1'],
      ['task', 'update', 'tt1', '--id', 'tt1', '--project', 'list1', '--status', '0', '--json'],
      ['task', 'update', 'tt1', '--id', 'tt1', '--project', 'list1', '--title', 'New title', '--content', 'new notes', '--due-date', '2026-02-03T00:00:00+0400', '--all-day', '--time-zone', 'Asia/Dubai', '--json'],
      ['task', 'update', 'tt1', '--id', 'tt1', '--project', 'list1', '--due-date', 'null', '--json'],
    ],
  );
  assert.equal(rec.calls[0].cmd, 'ticktick-cli');
  const ref = await place.create('list1', { title: 'Call the plumber', status: 'open', due: null, notes: 'after 10' });
  assert.equal(ref, 'list1/tt9');
  assert.deepEqual(rec.calls.at(-1).args, ['task', 'create', '--title', 'Call the plumber', '--project', 'list1', '--content', 'after 10', '--json']);
});

test('ticktick: a missing task is "deleted" only on a not-found answer; a failed read throws', async () => {
  const { place } = ticktickWorld();
  assert.deepEqual(await place.lookup('list1/gone1'), { gone: 'deleted' });
  const down = ticktickWorld({ project: () => ({ code: 1, out: '', err: 'Not signed in' }), task: () => ({ code: 1, out: '', err: 'fetch failed' }) });
  await assert.rejects(down.place.read(), /Not signed in/);
  await assert.rejects(down.place.lookup('list1/tt1'), /fetch failed/);
});

// ------------------------------------------------------------------ ClickUp adapter

// Field shapes as the ClickUp v2 API returns them; every value is made up.
const CU_LIST = { id: 'cl1', statuses: [{ status: 'to do', type: 'open' }, { status: 'in progress', type: 'custom' }, { status: 'done', type: 'done' }, { status: 'complete', type: 'closed' }] };
const cuTask = (id, extra = {}) => ({ id, name: `Task ${id}`, status: { status: 'to do', type: 'open' }, date_updated: String(T0 - 30 * MIN), date_done: null, date_closed: null, due_date: null, archived: false, ...extra });

function clickupWorld(pages, { lookup } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
    const u = new URL(url);
    const reply = (status, body) => ({ ok: status < 300, status, headers: new Headers({ date: new Date(T0).toUTCString() }), json: async () => body, text: async () => JSON.stringify(body) });
    if (u.pathname === '/api/v2/list/cl1') return reply(200, CU_LIST);
    if (u.pathname === '/api/v2/list/cl1/task') return reply(200, pages[Number(u.searchParams.get('page'))] || { tasks: [], last_page: true });
    if (u.pathname.startsWith('/api/v2/task/') && opts.method === 'PUT') return reply(200, { id: u.pathname.split('/').pop() });
    if (u.pathname.startsWith('/api/v2/task/')) return lookup ? reply(...lookup) : reply(404, { err: 'Task not found', ECODE: 'ITEM_013' });
    return reply(500, {});
  };
  const notes = [];
  const place = clickupPlace({
    lists: [{ id: 'cl1' }],
    token: 'pk_test_token',
    timeZone: 'UTC',
    fetch,
    now: () => T0,
    statusMap: {},
    notify: async (text) => notes.push(text),
  });
  return { calls, notes, place };
}

test('clickup: tasks read over every page, done from date_done before date_closed', async () => {
  const pages = [
    { tasks: [cuTask('cu1', { due_date: String(Date.parse('2026-02-10T12:00:00Z')) }), cuTask('cu2', { status: { status: 'done', type: 'done' }, date_done: String(T0 - 20 * MIN) })], last_page: false },
    { tasks: [cuTask('cu3', { status: { status: 'complete', type: 'closed' }, date_closed: String(T0 - 15 * MIN) }), cuTask('cu4', { status: { status: 'parked for later', type: 'custom' } })], last_page: true },
  ];
  const { place, calls } = clickupWorld(pages);
  const items = await place.read();
  assert.deepEqual([...items.keys()], ['cu1', 'cu2', 'cu3', 'cu4']);
  assert.equal(items.get('cu1').due, '2026-02-10');
  assert.equal(items.get('cu1').status, 'open');
  assert.equal(items.get('cu2').statusTime, T0 - 20 * MIN);
  assert.equal(items.get('cu3').statusTime, T0 - 15 * MIN);
  assert.equal(items.get('cu4').status, 'unknown');
  assert.equal(items.get('cu4').statusName, 'parked for later');
  const read = new URL(calls.find((c) => c.url.includes('/task?')).url);
  assert.equal(read.searchParams.get('include_closed'), 'true');
  assert.equal(read.searchParams.get('subtasks'), 'true');
  assert.equal(read.searchParams.get('archived'), 'false');
  assert.equal(calls[0].auth, 'pk_test_token');
});

test('clickup: a write sets "done" (the done type), the due day, and tells the ClickUp home', async () => {
  const { place, calls, notes } = clickupWorld([]);
  await place.read();
  await place.apply('cu1', { status: 'done', due: '2026-02-10' }, { ref: 'cu1', list: 'cl1', title: 'Task cu1' });
  const put = calls.find((c) => c.method === 'PUT');
  assert.match(put.url, /\/api\/v2\/task\/cu1$/);
  assert.deepEqual(put.body, { status: 'done', due_date: Date.parse('2026-02-10T12:00:00Z'), due_date_time: false });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /cu1/);
});

test('clickup: a missing linked task is archived or deleted by its own answer', async () => {
  assert.deepEqual(await clickupWorld([], { lookup: [200, cuTask('cu9', { archived: true })] }).place.lookup('cu9'), { gone: 'archived' });
  assert.deepEqual(await clickupWorld([]).place.lookup('cu9'), { gone: 'deleted' });
  await assert.rejects(clickupWorld([], { lookup: [500, {}] }).place.lookup('cu9'), /500/);
});

// ------------------------------------------------------------------ vault adapter

function vaultWorld({ write: enabled } = {}) {
  const v = dir('vault');
  const git = (...args) => spawnSync('git', args, { cwd: v, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'user.name', 'sync test');
  write(path.join(v, 'projects', 'Fence.md'), NOTE);
  write(path.join(v, 'projects', 'Board card.md'), '---\ntype: project\ntask: main/card-b2\nboard_list: example\nboard_state: in progress\n---\nCard.\n');
  write(path.join(v, 'projects', 'Unlinked.md'), '---\ntype: project\n---\nNo task.\n');
  write(path.join(v, 'topics', 'Elsewhere.md'), '---\ntype: project\ntask: main/x\n---\n');
  write(path.join(v, 'bin', 'lib-lock.sh'), 'acquire_run_lock() { echo locked > "$VAULT_ROOT/.lock-taken"; }\n');
  write(path.join(v, 'bin', 'lint'), '#!/bin/sh\necho "$@" > "$(dirname "$0")/../.lint-ran"\n');
  fs.chmodSync(path.join(v, 'bin', 'lint'), 0o755);
  write(path.join(v, 'scratch.md'), 'untracked work of the owner\n');
  git('add', 'projects', 'bin');
  git('commit', '-q', '-m', 'start');
  const place = vaultPlace({ path: v, folder: 'projects', write: enabled, statusMap: {} });
  return { v, git, place };
}

test('vault: only linked project notes under projects/ are read, board cards by board_state', { skip: process.platform === 'win32' }, async () => {
  const { place } = vaultWorld();
  const items = await place.read();
  assert.deepEqual([...items.keys()].sort(), ['projects/Board card.md', 'projects/Fence.md']);
  const fence = items.get('projects/Fence.md');
  assert.deepEqual([fence.task, fence.status, fence.field], ['main/fence-a1', 'open', 'task-status']);
  assert.ok(fence.time > 0, 'dated by the commit');
  const card = items.get('projects/Board card.md');
  assert.deepEqual([card.status, card.field], ['active', 'board_state']);
});

test('vault: the writer turned off in config touches nothing', { skip: process.platform === 'win32' }, async () => {
  const { place, v } = vaultWorld({ write: false });
  const r = await place.apply('projects/Fence.md', { status: 'done' }, { ref: 'projects/Fence.md', field: 'task-status' });
  assert.match(r.skipped, /off/);
  assert.equal(fs.readFileSync(path.join(v, 'projects', 'Fence.md'), 'utf8'), NOTE);
});

test('vault: the writer refuses task-status on a board card note and on a note without task:', { skip: process.platform === 'win32' }, async () => {
  const { place, v } = vaultWorld();
  const card = fs.readFileSync(path.join(v, 'projects', 'Board card.md'), 'utf8');
  await assert.rejects(place.apply('projects/Board card.md', { status: 'done' }, { ref: 'projects/Board card.md' }), /board_list/);
  assert.equal(fs.readFileSync(path.join(v, 'projects', 'Board card.md'), 'utf8'), card);
  await assert.rejects(place.apply('projects/Unlinked.md', { status: 'done' }, { ref: 'projects/Unlinked.md' }), /task:/);
  write(path.join(v, 'projects', 'Topic.md'), '---\ntype: topic\ntask: main/fence-a1\n---\n');
  await assert.rejects(place.apply('projects/Topic.md', { status: 'done' }, { ref: 'projects/Topic.md' }), /type: project/);
  await assert.rejects(place.apply('projects/Fence.md', { status: 'abandoned' }, { ref: 'projects/Fence.md' }), /open\|active\|done/);
  assert.ok(!fs.existsSync(path.join(v, '.lock-taken')), 'a refused write never takes the lock');
});

test('vault: the writer (on by default) takes the run lock, changes one key, lints and commits that one file', { skip: process.platform === 'win32' }, async () => {
  const { place, v, git } = vaultWorld();
  write(path.join(v, 'projects', 'Other.md'), 'staged by the owner\n');
  git('add', 'projects/Other.md');
  await place.apply('projects/Fence.md', { status: 'done' }, { ref: 'projects/Fence.md', field: 'task-status' });
  assert.equal(fs.readFileSync(path.join(v, 'projects', 'Fence.md'), 'utf8'), NOTE.replace('task-status: open', 'task-status: done'));
  assert.ok(fs.existsSync(path.join(v, '.lock-taken')));
  assert.match(fs.readFileSync(path.join(v, '.lint-ran'), 'utf8'), /projects\/Fence\.md/);
  const last = git('show', '--name-only', '--format=%s', 'HEAD').stdout.trim().split('\n');
  assert.deepEqual(last.filter(Boolean), ['sync: task-status Fence', 'projects/Fence.md']);
  assert.match(git('status', '--porcelain').stdout, /A {2}projects\/Other\.md/, "the owner's staged file stays staged and uncommitted");
  assert.match(git('status', '--porcelain').stdout, /\?\? scratch\.md/);
});

// ------------------------------------------------------------------ the command line, end to end

/** A stand-in command: a Node script that logs its arguments and answers from a table. */
function standIn(file, log, answers) {
  write(
    file,
    `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');\n` +
      `const answers = ${JSON.stringify(answers)};\nconst key = Object.keys(answers).find((k) => args.join(' ').startsWith(k));\nconst a = key ? answers[key] : '{}';\n` +
      // "@file": print the tasks in it; "+file": add a task to it; ">file": add a Queued row to that backlog.
      `if (a[0] === '@') process.stdout.write(JSON.stringify({ tasks: JSON.parse(fs.readFileSync(a.slice(1), 'utf8')) }));\n` +
      `else if (a[0] === '+') { const all = JSON.parse(fs.readFileSync(a.slice(1), 'utf8')); const t = { id: 'tt' + (all.length + 1), projectId: 'list1', title: args[args.indexOf('--title') + 1], status: 0 }; fs.writeFileSync(a.slice(1), JSON.stringify([...all, t])); process.stdout.write(JSON.stringify(t)); }\n` +
      `else if (a[0] === '>') { const id = 'call-the-plumber-1'; const f = a.slice(1); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('## Queued\\n', '## Queued\\n- [ ] ' + id + ' - ' + args[2] + '\\n')); process.stdout.write(JSON.stringify({ ok: true, task: { id } })); }\n` +
      `else process.stdout.write(a);\n`,
  );
  fs.chmodSync(file, 0o755);
}

test('the command line: a dry run writes nothing, a run links both new items, check prints the one line', { skip: process.platform === 'win32' }, () => {
  const root = dir('cli');
  const h = path.join(root, 'home');
  write(path.join(h, 'data', 'backlog.md'), '# Backlog\n\n## In flight\n## Queued\n- [ ] fence-a1 - Paint the fence (since 2026-01-02)\n## Done\n');
  const logs = { tt: path.join(root, 'tt.log'), axi: path.join(root, 'axi.log'), inbox: path.join(root, 'inbox.log') };
  // TickTick keeps its tasks in a file; tasks-axi adds the minted row to the backlog.
  const tasks = path.join(root, 'tt-tasks.json');
  write(tasks, JSON.stringify([{ id: 'tt1', projectId: 'list1', title: 'Call the plumber', status: 0, modifiedTime: '2026-01-05T08:00:00.000+0000' }]));
  standIn(path.join(root, 'bin', 'ticktick-cli'), logs.tt, {
    'project data list1': `@${tasks}`,
    'task completed': '[]',
    'task create': `+${tasks}`,
  });
  standIn(path.join(root, 'bin', 'tasks-axi'), logs.axi, { add: `>${path.join(h, 'data', 'backlog.md')}` });
  standIn(path.join(root, 'bin', 'fm-inbox.sh'), logs.inbox, {});
  const cfgDir = path.join(root, 'sync');
  const cfg = path.join(cfgDir, 'config.json');
  write(
    cfg,
    JSON.stringify({
      timeZone: 'UTC',
      tasksAxi: path.join(root, 'bin', 'tasks-axi'),
      inbox: path.join(root, 'bin', 'fm-inbox.sh'),
      homes: [{ name: 'main', path: h, ticktick: 'list1' }],
      ticktick: { command: path.join(root, 'bin', 'ticktick-cli') },
    }),
  );
  const sync = (...args) => spawnSync(process.execPath, [path.join(repoRoot, 'templates', 'ledger', 'bin', 'sync.mjs'), ...args, '--config', cfg], { encoding: 'utf8' });

  const dry = sync('run', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would fix.*would add "Paint the fence" to TickTick/s);
  assert.match(dry.stdout, /would add "Call the plumber" to main/);
  assert.ok(!fs.existsSync(path.join(cfgDir, 'links.json')));
  assert.ok(!fs.existsSync(logs.axi), 'a dry run never calls tasks-axi');

  const run = sync('run');
  assert.equal(run.status, 0, run.stderr);
  const links = JSON.parse(fs.readFileSync(path.join(cfgDir, 'links.json'), 'utf8'));
  assert.deepEqual(Object.keys(links.items).sort(), ['main/call-the-plumber-1', 'main/fence-a1']);
  assert.equal(links.items['main/fence-a1'].refs.ticktick, 'list1/tt2');
  assert.match(fs.readFileSync(logs.tt, 'utf8'), /"task","create","--title","Paint the fence"/);
  assert.match(fs.readFileSync(logs.axi, 'utf8'), /"add","--mint","Call the plumber","--queue"/);
  assert.match(fs.readFileSync(logs.inbox, 'utf8'), /"note","-"/);
  assert.equal((fs.statSync(path.join(cfgDir, 'links.json')).mode & 0o777).toString(8), '600');

  const check = sync('check');
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout.trim().split('\n').at(-1), /^sync \d\d:\d\d: 2 fixed \(1 home→TickTick, 1 TickTick→home\), 0 for you, 0 failed$/);
  assert.equal(sync('cards').stdout.trim(), 'no open cards');
});

test('the command line: a TickTick item linked on purpose syncs without pairing its list, and nothing new is created', { skip: process.platform === 'win32' }, () => {
  const root = dir('cli-linked');
  const h = path.join(root, 'home');
  write(path.join(h, 'data', 'backlog.md'), '# Backlog\n\n## In flight\n## Queued\n- [ ] fence-a1 - Paint the fence (since 2026-01-02)\n- [ ] other-b2 - Not linked (since 2026-01-02)\n## Done\n');
  const tasks = path.join(root, 'tt-tasks.json');
  // The linked task was ticked: it is in the completed read only. tt5 is open and linked to nothing.
  write(tasks, JSON.stringify([{ id: 'tt5', projectId: 'list1', title: 'Someone else', status: 0 }]));
  const log = path.join(root, 'tt.log');
  standIn(path.join(root, 'bin', 'ticktick-cli'), log, { 'project data list1': `@${tasks}`, 'task completed': JSON.stringify([{ id: 'tt1', projectId: 'list1', title: 'Paint the fence', status: 2, completedTime: '2026-01-05T08:10:00.000+0000' }]) });
  const cfgDir = path.join(root, 'sync');
  const cfg = path.join(cfgDir, 'config.json');
  write(cfg, JSON.stringify({ timeZone: 'UTC', homes: [{ name: 'main', path: h, ticktick: '' }], ticktick: { command: path.join(root, 'bin', 'ticktick-cli') } }));
  const synced = { title: 'Paint the fence', status: 'open', due: null, notes: '' };
  write(path.join(cfgDir, 'links.json'), JSON.stringify({ version: 1, items: { 'main/fence-a1': { refs: { ticktick: 'list1/tt1' }, base: { home: synced, ticktick: synced }, seen: {}, force: {} } } }));
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'templates', 'ledger', 'bin', 'sync.mjs'), 'run', '--dry-run', '--config', cfg], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would fix\s+TickTick→home main\/fence-a1 status: "done"/);
  assert.doesNotMatch(r.stdout, /would add/, 'an unpaired list never creates items on either side');
  assert.match(fs.readFileSync(log, 'utf8'), /"project","data","list1"/);
});

// ------------------------------------------------------------------ the shipped files

test('sync scripts pass node --check and the CLI prints its usage', () => {
  for (const f of ['sync.mjs', 'sync-core.mjs', 'sync-places.mjs']) {
    const r = spawnSync(process.execPath, ['--check', path.join(repoRoot, 'templates', 'ledger', 'bin', f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const help = spawnSync(process.execPath, [path.join(repoRoot, 'templates', 'ledger', 'bin', 'sync.mjs'), 'help'], { encoding: 'utf8' });
  assert.match(help.stdout, /usage: task-sync/);
});
