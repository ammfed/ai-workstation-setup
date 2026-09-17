#!/usr/bin/env node
// statusline-gauges - a Claude Code status line with usage-limit gauges.
//
//   Opus · high  ·  $4.10 · 1h12m  ·  my-app ⎇ main*   ctx ▰▰▱▱▱ 18%   5h ▰▰▰▱▱ 52% · 2h10m   wk ▰▰▰▰▱ 71% · 3d4h
//
// Identity and session on the left, then three gauges: context, the 5-hour limit and
// the weekly limit, each limit with the time until it resets. A field with nothing to
// say is not drawn (a clean tree, zero cost, a limit that does not report). The line
// fits the terminal width Claude Code passes in COLUMNS: one row when it fits, two rows
// when it does not, and below 66 columns the bars drop and only percentages remain.
// Colour marks how full a gauge is, and the percentage always carries the same meaning
// in text, so nothing depends on colour alone.
//
// Input: the status line JSON on stdin (https://code.claude.com/docs/en/statusline).
// Installed by ai-workstation-setup (claude-code module). No dependencies; runs
// wherever Node does. It never throws: a bad payload prints an empty line.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const color = !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const ink = {
  accent: paint('38;5;180'),
  text: paint('38;5;254'),
  muted: paint('38;5;246'),
  faint: paint('38;5;243'),
  track: paint('38;5;237'),
  ok: paint('38;5;110'),
  warn: paint('38;5;179'),
  hot: paint('38;5;174'),
};

const visible = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length;

function readStdin() {
  const chunks = [];
  return new Promise((resolve) => {
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 800 }).trim();
  } catch {
    return '';
  }
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d${h}h`;
  return h ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

function tone(pct) {
  if (pct >= 85) return ink.hot;
  if (pct >= 60) return ink.warn;
  return ink.ok;
}

function bar(pct, cells = 5) {
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return tone(pct)('▰'.repeat(filled)) + ink.track('▱'.repeat(cells - filled));
}

function gauge(label, pct, resetsAt, { bars }) {
  if (typeof pct !== 'number' || Number.isNaN(pct)) return '';
  const p = Math.round(pct);
  let out = `${ink.faint(label)} ${bars ? `${bar(p)} ` : ''}${tone(p)(`${String(p).padStart(bars ? 3 : 1)}%`)}`;
  if (bars && resetsAt !== undefined) {
    const left = typeof resetsAt === 'number' ? duration(resetsAt * 1000 - Date.now()) : '';
    out += ` ${ink.faint('·')} ${ink.muted(left || '—')}`;
  }
  return out;
}

function render(data, columns) {
  const cwd = data.workspace?.current_dir || data.cwd || process.cwd();
  const sep = `  ${ink.faint('·')}  `;

  const who = [data.model?.display_name, data.effort?.level].filter(Boolean).map((s, i) => (i ? ink.muted(s) : ink.text(s))).join(ink.faint(' · '));
  const cost = data.cost?.total_cost_usd;
  const session = [cost > 0 ? `$${cost.toFixed(2)}` : '', duration(data.cost?.total_duration_ms || 0)].filter(Boolean).map(ink.muted).join(ink.faint(' · '));
  const branch = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']) || git(cwd, ['rev-parse', '--short', 'HEAD']);
  const dirty = branch && git(cwd, ['status', '--porcelain', '--untracked-files=no']) ? '*' : '';
  const where = ink.accent(path.basename(data.workspace?.project_dir || cwd)) + (branch ? ` ${ink.faint('⎇')} ${ink.muted(branch + dirty)}` : '');
  let left = [who, session, where].filter(Boolean).join(sep);
  // Narrow window: drop the session part first, then cut the branch name short.
  if (columns && visible(left) > columns) left = [who, where].filter(Boolean).join(sep);
  if (columns && visible(left) > columns && branch) {
    const name = ink.accent(path.basename(data.workspace?.project_dir || cwd));
    const room = Math.max(4, columns - visible([who, name].filter(Boolean).join(sep)) - 3 - dirty.length);
    const short = [...branch].length > room ? `${[...branch].slice(0, room - 1).join('')}…` : branch;
    left = [who, `${name} ${ink.faint('⎇')} ${ink.muted(short + dirty)}`].filter(Boolean).join(sep);
  }

  const limits = data.rate_limits || {};
  const gauges = (bars) =>
    [
      gauge('ctx', data.context_window?.used_percentage, undefined, { bars }),
      gauge('5h', limits.five_hour?.used_percentage, limits.five_hour?.resets_at ?? null, { bars }),
      gauge('wk', limits.seven_day?.used_percentage, limits.seven_day?.resets_at ?? null, { bars }),
    ]
      .filter(Boolean)
      .join('   ');

  const full = gauges(true);
  if (!columns || columns >= 66) {
    const one = full ? `${left}   ${full}` : left;
    if (!columns || visible(one) <= columns) return one;
    if (visible(full) <= columns) return `${left}\n${full}`;
  }
  const micro = gauges(false);
  return micro ? `${left}\n${micro}` : left;
}

try {
  const data = JSON.parse((await readStdin()) || '{}');
  process.stdout.write(`${render(data, Number(process.env.COLUMNS) || 0)}\n`);
} catch {
  process.stdout.write('\n');
}
