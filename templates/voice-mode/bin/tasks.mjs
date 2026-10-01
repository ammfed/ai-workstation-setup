// `voice-mode tasks`: today's and overdue tasks, read only when the voice is asked (a command
// record source). It runs the configured read command (by default the TickTick CLI the
// daily-sync module also uses, `ticktick --format json tasks due 1`), never through a shell,
// and prints titles grouped as overdue and due today. A failed read is said plainly.
// The titles go to the realtime voice provider only when the voice reads this source.

import { spawnSync } from 'node:child_process';

/** Local calendar day of a date, as YYYY-MM-DD. */
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A due date as the CLI prints it ("2026-01-05T20:00:00.000+0000" or an ISO date), or null. */
export function parseDue(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * The read command's JSON (a list of tasks, or `{ tasks: [...] }`) split into overdue and due
 * today by the local calendar day; anything later, undated or untitled is left out.
 */
export function dueToday(data, now = new Date()) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : null;
  if (!list) throw new Error('the read command did not print a list of tasks');
  const today = day(now);
  const overdue = [];
  const todayList = [];
  for (const t of list) {
    const due = parseDue(t?.dueDate);
    const title = String(t?.title || '').replace(/\s+/g, ' ').trim();
    if (!due || !title) continue;
    const d = day(due);
    if (d < today) overdue.push({ title, due: d, priority: t.priority || '' });
    else if (d === today) todayList.push({ title, due: d, priority: t.priority || '' });
  }
  overdue.sort((a, b) => a.due.localeCompare(b.due));
  return { overdue, today: todayList };
}

/** The two lists as plain lines for the voice. */
export function tasksSummary({ overdue, today }) {
  if (!overdue.length && !today.length) return 'Nothing is overdue and nothing is due today.';
  const names = (xs) => xs.map((t) => `${t.title}${t.priority === 'high' ? ' (high priority)' : ''}`).join('; ');
  const out = [];
  out.push(overdue.length ? `Overdue (${overdue.length}): ${names(overdue)}.` : 'Nothing is overdue.');
  out.push(today.length ? `Due today (${today.length}): ${names(today)}.` : 'Nothing else is due today.');
  return out.join('\n');
}

/** Run the configured read command and summarise it; a failure becomes one plain sentence. */
export function readTasks(config, { run = spawnSync, now = new Date() } = {}) {
  const argv = config.tasks?.command || [];
  if (!argv.length) return { ok: false, text: 'Tasks are not set up: no read command is configured.' };
  let r;
  try {
    r = run(argv[0], argv.slice(1), { encoding: 'utf8', timeout: (config.tasks.timeoutSec || 5) * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    r = { error: err };
  }
  if (r.error || r.status !== 0) {
    const why = r.error?.code === 'ETIMEDOUT' ? 'it took too long' : r.error?.code === 'ENOENT' ? `${argv[0]} is not installed` : String(r.stderr || r.stdout || '').trim().split('\n').pop() || `exit ${r.status}`;
    return { ok: false, text: `The task list could not be read just now (${why.slice(0, 160)}).` };
  }
  try {
    return { ok: true, text: tasksSummary(dueToday(JSON.parse(r.stdout), now)) };
  } catch (err) {
    return { ok: false, text: `The task list could not be read just now (${err.message}).` };
  }
}
