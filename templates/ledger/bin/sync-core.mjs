// sync-core - the pure parts of the task sync (sync.mjs): the field map and status buckets, the
// sync-owned "## Notes" section of a home row, the link store, the conflict resolver, the one
// status line, and the sync pass that ties them to the places (sync-places.mjs).
//
// The home records are the truth. A place is anything that reads normalized items and applies
// changes: the homes, TickTick, ClickUp and the vault. Each linked item keeps, per place, the
// last value the sync saw there ("base"); a field changed in a place when its value differs from
// that place's base. One place changed: it wins. Several changed to different values: the newest
// dated edit wins when the times are more than the skew window apart; otherwise, or when a time
// is only a day, the clash is a card for you. A done signal for a row held for you (a captain
// hold) is always a card. Installed by ai-workstation-setup (ledger module). No dependencies.

export const FIELDS = ['title', 'status', 'due', 'notes'];
export const BUCKETS = ['open', 'active', 'done'];
const LABELS = { home: 'home', ticktick: 'TickTick', clickup: 'ClickUp', vault: 'vault' };
export const label = (place) => LABELS[place] || place;

// ---------------------------------------------------------------- mapper

/** A home row's section: Queued is open, In flight is active, Done is done. */
export const bucketOfHome = (state) => ({ queued: 'open', in_flight: 'active', done: 'done' })[state] || 'unknown';

/** TickTick has only open (0) and done (2); abandoned (-1) has no home state, so it is a card. */
export const bucketOfTickTick = (status) => ({ 0: 'open', 2: 'done', '-1': 'abandoned' })[Number(status)] || 'unknown';

/** TickTick has no "active": an active item is open there. */
export const ticktickValue = (bucket) => (bucket === 'active' ? 'open' : bucket);

// Status names most ClickUp lists use. Your own lists add theirs in config.json (clickup.lists[].statuses),
// and an answer you give to a "new status" card is remembered on top.
export const DEFAULT_STATUS_TABLE = {
  'to do': 'open',
  todo: 'open',
  open: 'open',
  backlog: 'open',
  'in progress': 'active',
  doing: 'active',
  'in review': 'active',
  review: 'active',
  done: 'done',
  complete: 'done',
  completed: 'done',
  closed: 'done',
};

const lowerKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.trim().toLowerCase(), v]));

/**
 * A ClickUp status to a bucket. The done and closed types are done and the open type is open,
 * by ClickUp's own meaning; a custom status needs a table entry, else it is "unknown", never a guess.
 */
export function bucketOfClickUp({ status, type } = {}, table = {}) {
  if (type === 'done' || type === 'closed') return 'done';
  if (type === 'open') return 'open';
  const bucket = { ...DEFAULT_STATUS_TABLE, ...lowerKeys(table) }[String(status || '').trim().toLowerCase()];
  return BUCKETS.includes(bucket) ? bucket : 'unknown';
}

// ---------------------------------------------------------------- dates

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function dayIn(ms, timeZone) {
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/** Minutes a time zone is ahead of UTC at an instant. */
function offsetMinutes(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((local - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant a local wall-clock time on a day happens in a time zone. */
function localInstant(day, hour, timeZone) {
  const guess = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  const first = offsetMinutes(guess, timeZone);
  return guess - offsetMinutes(guess - first * 60_000, timeZone) * 60_000;
}

/** Midnight of a day in a time zone, as TickTick takes a due date: 2026-03-10T00:00:00+0400. */
export function midnightIn(day, timeZone) {
  const off = offsetMinutes(localInstant(day, 0, timeZone), timeZone);
  const abs = Math.abs(off);
  return `${day}T00:00:00${off < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

/** Noon of a day in a time zone, in ms: a date-only due date that reads back as the same day anywhere near. */
export const noonMs = (day, timeZone) => localInstant(day, 12, timeZone);

/** An API time (ISO with +0000, or ms as a number or string) to ms, or null. */
export function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) return Number(v);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

// ---------------------------------------------------------------- the "## Notes" section

const NOTES_HEAD = /^##\s+Notes\s*$/;
const DUE_LINE = /^due:\s*(\d{4}-\d{2}-\d{2})\s*$/;

/** Text compared the same way on every side: LF line ends, no trailing spaces, trimmed. */
export const normText = (s) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();

function splitNotes(body) {
  const lines = normText(body) ? String(body).replace(/\r\n?/g, '\n').split('\n') : [];
  const start = lines.findIndex((l) => NOTES_HEAD.test(l.trim()));
  if (start < 0) return { before: lines, section: null, after: [] };
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l.trim()));
  if (end < 0) end = lines.length;
  return { before: lines.slice(0, start), section: lines.slice(start + 1, end), after: lines.slice(end) };
}

/** The sync-owned part of a home row body: the "## Notes" text and its "due: YYYY-MM-DD" line. */
export function notesOf(body) {
  const { section } = splitNotes(body);
  if (!section) return { notes: '', due: null };
  let due = null;
  const rest = [];
  for (const line of section) {
    const m = DUE_LINE.exec(line.trim());
    if (m && due === null) due = m[1];
    else rest.push(line);
  }
  return { notes: normText(rest.join('\n')), due };
}

const trimTail = (lines) => {
  const out = [...lines];
  while (out.length && !out.at(-1).trim()) out.pop();
  return out;
};

/** The body with only its "## Notes" section replaced (dropped when both are empty). */
export function withNotes(body, { notes, due }) {
  const { before, after } = splitNotes(body);
  const text = normText(notes);
  const block = text || due ? ['## Notes', ...(text ? text.split('\n') : []), ...(due ? [`due: ${due}`] : [])] : [];
  return [trimTail(before), block, trimTail(after)]
    .filter((part) => part.length)
    .map((part) => part.join('\n'))
    .join('\n\n');
}

// ---------------------------------------------------------------- frontmatter (vault notes)

function frontmatterLines(text) {
  const lines = String(text).split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return end < 0 ? null : { lines, end };
}

/** A note's frontmatter as flat key: value pairs, or null when it has none. */
export function frontmatter(text) {
  const fm = frontmatterLines(String(text).replace(/\r\n?/g, '\n'));
  if (!fm) return null;
  const out = {};
  for (const line of fm.lines.slice(1, fm.end)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/** The note with one frontmatter key set; every other line, the body included, is left as it was. */
export function setFrontmatter(text, key, value) {
  const fm = frontmatterLines(text);
  if (!fm) throw new Error('the note has no frontmatter');
  const at = fm.lines.findIndex((l, i) => i > 0 && i < fm.end && new RegExp(`^${key}:`).test(l));
  if (at > 0) fm.lines[at] = `${key}: ${value}`;
  else fm.lines.splice(fm.end, 0, `${key}: ${value}`);
  return fm.lines.join('\n');
}

// ---------------------------------------------------------------- link store

/**
 * Links between a home row and its item in each place, keyed by "<home>/<task id>", so a title
 * change never breaks one. Per place: the item's ref, the last synced value of each field
 * ("base"), when a change was first seen (for places with no edit time), and a one-time winner
 * you picked for a field ("force").
 */
export class Links {
  constructor(data = {}) {
    this.items = data.items ? structuredClone(data.items) : {};
  }

  get(key) {
    return this.items[key] || null;
  }

  keys() {
    return Object.keys(this.items);
  }

  find(place, ref) {
    for (const [key, l] of Object.entries(this.items)) if (l.refs[place] === ref) return key;
    return null;
  }

  ensure(key) {
    this.items[key] ??= { refs: {}, base: {}, seen: {}, force: {} };
    return this.items[key];
  }

  link(key, place, ref) {
    const other = this.find(place, ref);
    if (other && other !== key) throw new Error(`${label(place)} item ${ref} is already linked to ${other}`);
    this.ensure(key).refs[place] = ref;
  }

  unlink(key, place) {
    const l = this.items[key];
    if (!l) return;
    for (const part of ['refs', 'base', 'seen']) delete l[part][place];
    if (!Object.keys(l.refs).length) delete this.items[key];
  }

  drop(key) {
    delete this.items[key];
  }

  setBase(key, place, values) {
    const l = this.ensure(key);
    l.base[place] = { ...(l.base[place] || {}), ...values };
  }

  force(key, field, place) {
    this.ensure(key).force[field] = place;
  }

  toJSON() {
    return { version: 1, items: this.items };
  }
}

// ---------------------------------------------------------------- conflict resolver

const same = (a, b) => (a ?? null) === (b ?? null);

/**
 * sides: [{ place, value, base, time, dayOnly? }] for one field of one linked item.
 * Returns { kind: 'same' } (nothing changed), { kind: 'apply' | 'agree', from, value },
 * or { kind: 'card', reason }.
 */
export function resolve({ sides, skewMs, force }) {
  const changed = sides.filter((s) => !same(s.value, s.base));
  if (!changed.length) return { kind: 'same' };
  const forced = force && sides.find((s) => s.place === force);
  if (forced) return { kind: 'apply', from: forced.place, value: forced.value };
  const odd = changed.find((s) => s.value === 'abandoned' || s.value === 'unknown');
  if (odd) return { kind: 'card', reason: `${label(odd.place)} has it as ${odd.value}, which no other place can hold` };
  const values = [...new Set(changed.map((s) => s.value ?? null))];
  if (values.length === 1) return { kind: changed.length === 1 ? 'apply' : 'agree', from: changed[0].place, value: changed[0].value };
  const who = changed.map((s) => label(s.place)).join(' and ');
  if (changed.some((s) => s.dayOnly)) return { kind: 'card', reason: `changed in ${who}, and one of them has only a day, not a time` };
  const sorted = [...changed].sort((a, b) => b.time - a.time);
  const newest = sorted[0];
  const rival = sorted.find((s) => !same(s.value, newest.value));
  if (newest.time - rival.time <= skewMs) return { kind: 'card', reason: `changed in ${who} within ${Math.round(skewMs / 60_000)} minutes of each other` };
  return { kind: 'apply', from: newest.place, value: newest.value };
}

// ---------------------------------------------------------------- the one status line

/** "sync 07:30: 4 fixed (3 TickTick→home, 1 home→ClickUp), 1 for you, 0 failed" over the journal since a time. */
export function statusLine(journal, { since = 0, label: when, openCards = 0 }) {
  const recent = journal.filter((e) => e.at >= since && !e.dryRun);
  const fixes = recent.filter((e) => e.kind === 'fix');
  const by = new Map();
  for (const f of fixes) {
    const k = `${label(f.from)}→${label(f.to)}`;
    by.set(k, (by.get(k) || 0) + 1);
  }
  const detail = by.size ? ` (${[...by].map(([k, count]) => `${count} ${k}`).join(', ')})` : '';
  const failed = new Set(recent.filter((e) => e.kind === 'fail').map((e) => e.key || e.place)).size;
  return `sync ${when}: ${fixes.length} fixed${detail}, ${openCards} for you, ${failed} failed`;
}

// ---------------------------------------------------------------- the sync pass

const sameTitle = (a, b) => normText(a).replace(/\s+/g, ' ').toLowerCase() === normText(b).replace(/\s+/g, ' ').toLowerCase();
const isEmpty = (v) => v === null || v === undefined || v === '';

function norm(field, v) {
  if (field === 'notes') return normText(v);
  if (field === 'title') return normText(v).replace(/\s+/g, ' ');
  if (field === 'due') return typeof v === 'string' && DAY.test(v) ? v : null;
  return v ?? null;
}

const valuesOf = (item, fields) => Object.fromEntries(fields.map((f) => [f, norm(f, item[f])]));
const clock = (ms) => new Date(ms).toISOString().slice(11, 16);

/**
 * One pass over every place: read them all, link new items of paired lists, settle each linked
 * field, apply the changes (one call per item and place), raise cards for what it cannot settle.
 *
 * places: { home, ticktick?, clickup?, vault? }, each { fields, read(), apply(ref, changes, item),
 * lookup?(ref), create?(target, values) }; the home place also has note(home, text).
 * pairs: [{ home, list }]: a home and the TickTick list paired with it on purpose.
 * state: { cards } kept between passes. A dry run plans and reports but writes nothing anywhere.
 */
export async function syncPass({ places, pairs = [], links: realLinks, state: realState, now = Date.now(), skewMs = 120_000, dryRun = false }) {
  const links = dryRun ? new Links(realLinks.toJSON()) : realLinks;
  const state = dryRun ? structuredClone(realState) : realState;
  state.cards ??= {};
  const journal = [];
  const log = (e) => journal.push({ at: now, ...e, ...(dryRun ? { dryRun: true } : {}) });
  const order = ['home', ...Object.keys(places).filter((p) => p !== 'home' && places[p])];
  const fieldsOf = (place) => places[place].fields || FIELDS;

  const items = {};
  const failed = new Set();
  for (const name of order) {
    try {
      items[name] = await places[name].read();
    } catch (err) {
      failed.add(name);
      log({ kind: 'fail', place: name, key: `read:${name}`, text: `${label(name)}: read failed: ${err.message}` });
    }
  }
  const cards = new Map();
  const settled = new Set();
  const notes = [];
  const fresh = new Set();
  if (failed.has('home')) return finish();
  const home = items.home;
  const homeOf = (key) => key.split('/')[0];

  // A vault note links itself on purpose with its task: field.
  if (items.vault) {
    for (const [ref, item] of items.vault) {
      const was = links.find('vault', ref);
      if (was && was !== item.task) links.unlink(was, 'vault');
      if (!item.task || was === item.task) continue;
      if (!home.has(item.task)) {
        log({ kind: 'warn', place: 'vault', key: `vault:${ref}`, text: `vault: ${ref} names ${item.task}, which no home has` });
        continue;
      }
      if (links.get(item.task)?.refs.vault) links.unlink(item.task, 'vault');
      links.link(item.task, 'vault', ref);
      log({ kind: 'link', key: item.task, place: 'vault', ref });
    }
  }

  // Paired lists: a new open item on either side gets its twin, after a same-title match.
  if (items.ticktick && places.ticktick.create) {
    for (const pair of pairs) {
      const homeRows = [...home.values()].filter((h) => homeOf(h.ref) === pair.home && h.status !== 'done' && !links.get(h.ref)?.refs.ticktick);
      const open = [...items.ticktick.values()].filter((t) => t.list === pair.list && t.status === 'open' && !links.find('ticktick', t.ref));
      for (const h of homeRows) {
        const twin = open.find((t) => sameTitle(t.title, h.title));
        if (twin) {
          open.splice(open.indexOf(twin), 1);
          links.link(h.ref, 'ticktick', twin.ref);
          log({ kind: 'link', key: h.ref, place: 'ticktick', ref: twin.ref });
          continue;
        }
        const values = { ...valuesOf(h, FIELDS), status: 'open' };
        if (dryRun) {
          log({ kind: 'fix', key: h.ref, field: 'new', from: 'home', to: 'ticktick', text: `would add "${values.title}" to TickTick` });
          continue;
        }
        try {
          const ref = await places.ticktick.create(pair.list, values);
          links.link(h.ref, 'ticktick', ref);
          links.setBase(h.ref, 'home', valuesOf(h, FIELDS));
          links.setBase(h.ref, 'ticktick', values);
          fresh.add(h.ref);
          log({ kind: 'fix', key: h.ref, field: 'new', from: 'home', to: 'ticktick', ref });
        } catch (err) {
          log({ kind: 'fail', place: 'ticktick', key: `create:${h.ref}`, text: `TickTick: could not add ${h.ref}: ${err.message}` });
        }
      }
      for (const t of open) {
        const values = { ...valuesOf(t, FIELDS), status: 'open' };
        if (dryRun) {
          log({ kind: 'fix', key: t.ref, field: 'new', from: 'ticktick', to: 'home', text: `would add "${values.title}" to ${pair.home}` });
          continue;
        }
        try {
          const key = await places.home.create(pair.home, values);
          links.link(key, 'ticktick', t.ref);
          links.setBase(key, 'home', values);
          links.setBase(key, 'ticktick', values);
          fresh.add(key);
          log({ kind: 'fix', key, field: 'new', from: 'ticktick', to: 'home', ref: t.ref });
          notes.push({ home: pair.home, text: `sync: added ${key} "${values.title}" from TickTick (Queued)` });
        } catch (err) {
          log({ kind: 'fail', place: 'home', key: `create:${t.ref}`, text: `home ${pair.home}: could not add "${values.title}": ${err.message}` });
        }
      }
    }
  }

  for (const key of links.keys()) {
    if (fresh.has(key)) continue;
    const link = links.get(key);
    const h = home.get(key);
    if (!h) {
      if (!link.base.home || link.base.home.status === 'done') {
        links.drop(key);
        log({ kind: 'unlink', key, text: 'the done home row left the backlog' });
      } else {
        cards.set(`${key}:gone:home`, { link: key, text: `sync: ${key} is gone from its home backlog while it was open. Remove the link with: task-sync unlink ${key}` });
      }
      continue;
    }
    let clean = true;
    const present = { home: h };
    for (const place of order.slice(1)) {
      const ref = link.refs[place];
      if (!ref) continue;
      if (failed.has(place)) {
        clean = false;
        continue;
      }
      let it = items[place].get(ref);
      // Done on both sides and synced: a place that lists only recent ticks no longer shows it.
      if (!it && h.status === 'done' && link.base.home?.status === 'done' && link.base[place]?.status === 'done') continue;
      if (!it && places[place].lookup) {
        try {
          it = await places[place].lookup(ref);
        } catch (err) {
          clean = false;
          log({ kind: 'fail', place, key: `lookup:${place}:${ref}`, text: `${label(place)}: could not read ${ref}: ${err.message}` });
          continue;
        }
      }
      if (!it || it.gone) {
        const gone = it?.gone || 'deleted';
        if (h.status === 'done' || link.base[place]?.status === 'done') {
          links.unlink(key, place);
          log({ kind: 'unlink', key, place, text: `the done ${label(place)} item was ${gone}` });
        } else {
          cards.set(`${key}:gone:${place}`, {
            link: key,
            text: `sync: the ${label(place)} item linked to ${key} was ${gone} while the home row is open. Close or keep the row, then: task-sync unlink ${key} ${place}`,
          });
        }
        continue;
      }
      if (it.status === 'unknown' && it.statusName) {
        cards.set(`status:${it.list}:${it.statusName}`, {
          link: key,
          text: `sync: ${label(place)} list ${it.list} has a new status "${it.statusName}" (on ${key}). Say which bucket it is: task-sync map ${it.list} "${it.statusName}" open|active|done`,
        });
        it = { ...it, status: undefined, skipStatus: true };
      }
      present[place] = it;
    }
    const linked = Object.keys(present);
    if (linked.length < 2) {
      if (clean) settled.add(key);
      continue;
    }

    // A place met for the first time: equal fields are synced; for the rest the done side wins
    // the status (open and active stay as each side has them, so a queued row never pulls an
    // in-progress task back), a value wins over an empty one, and otherwise the home (the truth) wins.
    for (const place of linked.slice(1)) {
      if (link.base[place]) continue;
      const it = present[place];
      const base = {};
      const homeBase = {};
      for (const f of fieldsOf(place)) {
        const hv = norm(f, h[f]);
        const pv = norm(f, it[f]);
        if (f === 'status' && it.skipStatus) continue;
        if (same(hv, pv) || (f === 'status' && hv !== 'done' && pv !== 'done')) {
          base[f] = pv;
          continue;
        }
        const placeWins = f === 'status' ? pv === 'done' : isEmpty(hv);
        if (placeWins) base[f] = hv;
        else {
          base[f] = pv;
          homeBase[f] = pv;
        }
      }
      links.setBase(key, place, base);
      if (Object.keys(homeBase).length) links.setBase(key, 'home', { ...valuesOf(h, FIELDS), ...link.base.home, ...homeBase });
      else if (!link.base.home) links.setBase(key, 'home', valuesOf(h, FIELDS));
    }

    const changes = {};
    const planned = {};
    const homeNotes = [];
    for (const field of FIELDS) {
      const sides = [];
      for (const place of linked) {
        if (!fieldsOf(place).includes(field)) continue;
        const it = present[place];
        if (field === 'status' && it.skipStatus) continue;
        const value = norm(field, it[field]);
        const base = norm(field, link.base[place]?.[field]);
        let time = field === 'status' && value === 'done' && it.statusTime ? it.statusTime : it.time;
        link.seen[place] ??= {};
        if (same(value, base)) delete link.seen[place][field];
        else if (!Number.isFinite(time)) {
          const seen = link.seen[place][field];
          if (seen && same(seen.value, value)) time = seen.at;
          else {
            time = Number.isFinite(it.seenAt) ? it.seenAt : now;
            link.seen[place][field] = { value, at: time };
          }
        }
        sides.push({ place, value, base, time, dayOnly: Boolean(it.dayOnly) });
      }
      if (sides.length < 2) continue;
      const force = link.force[field];
      let r = resolve({ sides, skewMs, force });
      if (force) delete link.force[field];
      const cardKey = `${key}:${field}`;
      if (field === 'status' && (r.kind === 'apply' || r.kind === 'agree') && r.value === 'done' && h.hold && h.status !== 'done') {
        r = { kind: 'card', reason: `${label(r.from)} says it is done, and the home row is a captain hold, which only your own answer closes` };
      }
      if (r.kind === 'same') continue;
      if (r.kind === 'card') {
        cards.set(cardKey, { link: key, text: `sync: ${key} ${field}: ${r.reason}. Pick the side that wins: task-sync pick ${cardKey} ${sides.map((s) => s.place).join('|')}` });
        continue;
      }
      for (const s of sides) {
        let target = r.value;
        if (s.place === 'home' && field === 'status') {
          if (r.value === 'done') target = 'done';
          else if (s.value === 'done') target = 'open';
          else {
            target = s.value;
            if (!same(target, r.value)) homeNotes.push(`sync: ${key} is ${r.value} in ${label(r.from)}; the home row stays ${s.value} (the sync starts no work)`);
          }
        } else if (s.place === 'ticktick' && field === 'status') target = ticktickValue(r.value);
        if (same(target, s.value)) {
          link.base[s.place] = { ...link.base[s.place], [field]: s.value };
          delete link.seen[s.place]?.[field];
          continue;
        }
        (changes[s.place] ??= {})[field] = target;
        (planned[s.place] ??= {})[field] = { from: r.from, value: target };
      }
    }

    for (const [place, fields] of Object.entries(changes)) {
      const it = present[place];
      const describe = (f) => ({ kind: 'fix', key, field: f, from: planned[place][f].from, to: place, value: planned[place][f].value });
      if (dryRun) {
        for (const f of Object.keys(fields)) log(describe(f));
        continue;
      }
      if (it.readOnly) {
        for (const f of Object.keys(fields)) link.base[place] = { ...link.base[place], [f]: norm(f, it[f]) };
        continue;
      }
      let result;
      try {
        result = await places[place].apply(link.refs[place] ?? key, fields, it);
      } catch (err) {
        clean = false;
        log({ kind: 'fail', place, key: `write:${place}:${key}`, text: `${label(place)}: could not update ${key}: ${err.message}` });
        continue;
      }
      if (result?.skipped) {
        for (const f of Object.keys(fields)) link.base[place] = { ...link.base[place], [f]: norm(f, it[f]) };
        log({ kind: 'skip', key, place, text: `${label(place)}: ${result.skipped}` });
        continue;
      }
      for (const f of Object.keys(fields)) {
        link.base[place] = { ...link.base[place], [f]: fields[f] };
        delete link.seen[place]?.[f];
        log(describe(f));
      }
      if (place === 'home' && fields.status) {
        const from = planned.home.status.from;
        const at = present[from]?.statusTime || present[from]?.time;
        homeNotes.push(`sync: ${key} moved to ${fields.status === 'done' ? 'done' : 'Queued'} from ${label(from)}${at ? ` (${clock(at)} UTC)` : ''}`);
      }
    }
    for (const text of homeNotes) notes.push({ home: homeOf(key), text });
    if (clean) settled.add(key);
  }

  return finish();

  async function finish() {
    for (const [k, card] of cards) {
      if (state.cards[k]) continue;
      state.cards[k] = { key: k, link: card.link, text: card.text, at: now };
      log({ kind: 'card', key: k, text: card.text });
      notes.push({ home: homeOf(card.link), text: card.text });
    }
    for (const k of Object.keys(state.cards)) {
      if (cards.has(k)) continue;
      const card = state.cards[k];
      const closes = k.startsWith('status:') ? !failed.has('clickup') && items.clickup : settled.has(card.link) || !links.get(card.link);
      if (closes) {
        delete state.cards[k];
        log({ kind: 'closed', key: k });
      }
    }
    if (!dryRun && places.home?.note) {
      for (const n of notes) {
        try {
          await places.home.note(n.home, n.text);
        } catch (err) {
          log({ kind: 'fail', place: 'home', key: `note:${n.home}`, text: `home ${n.home}: could not leave a note: ${err.message}` });
        }
      }
    }
    return { journal, cards: Object.values(state.cards), failed: [...failed], notes };
  }
}
