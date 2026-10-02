#!/usr/bin/env node
// Capture one piece of knowledge straight into the vault, without a raw source file: a fact
// from a conversation, a decision just made, a line for today's journal.
//
// Every captured line carries its provenance, `(captured by <who>, <date>)`, as AGENTS.md asks.
// The note is checked with bin/check.mjs before anything is kept: a capture that would break the
// contract is undone and nothing changes. When the vault is a git repository, the note and the
// regenerated MAP.md are committed on their own, never anything else you had staged.
//
// Usage:
//   node bin/capture.mjs "text"                               today's journal note
//   node bin/capture.mjs --to people/Some\ One.md "text"      append to an existing note
//   node bin/capture.mjs --type decision --title "T" "text"   a new note in its folder
//   node bin/capture.mjs --type topic --area A --title "T" "text"
//   Options: --area A (life area; default {{DEFAULT_PILLAR}}), --by NAME (default $USER),
//   --no-commit. TEXT may be piped on stdin instead.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FOLDER_TYPE, vaultRoot } from './lib-vault.mjs';

const DEFAULT_AREA = '{{DEFAULT_PILLAR}}';
const DEFAULT_LANG = '{{DEFAULT_LANG}}';
const FOLDER_OF = Object.fromEntries(Object.entries(FOLDER_TYPE).map(([dir, type]) => [type, dir]));

/** A new note: the contract's frontmatter, a heading, and the captured line. */
export function newNote({ type, title, area, text, by, date }) {
  const stage = type === 'project' ? 'stage: idea\n' : '';
  const line = type === 'decision' ? `**Decided:** ${text}` : text;
  return `---\ntitle: ${title}\ntype: ${type}\nstatus: current\n${stage}pillar: [${area}]\nlang: ${DEFAULT_LANG}\ncreated: ${date}\nupdated: ${date}\n---\n\n# ${title}\n\n${line} (captured by ${by}, ${date})\n`;
}

/** Add the captured line before the first `## ` section (or at the end), and bump `updated:`. */
export function appendLine(existing, { text, by, date }) {
  const lines = existing.replace(/^updated:\s*\d{4}-\d{2}-\d{2}\s*$/m, `updated: ${date}`).split('\n');
  let at = lines.findIndex((l, i) => i > 0 && l.startsWith('## '));
  if (at === -1) at = lines.length;
  let end = at;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;
  const before = lines.slice(0, end);
  const after = lines.slice(at).join('\n').replace(/\n*$/, '');
  return `${[...before, '', `${text} (captured by ${by}, ${date})`].join('\n')}\n${after ? `\n${after}\n` : ''}`;
}

function main() {
  const argv = process.argv.slice(2);
  const opt = { type: null, area: DEFAULT_AREA, title: null, to: null, by: process.env.USER || process.env.USERNAME || 'me', commit: true };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (['--type', '--area', '--title', '--to', '--by'].includes(a)) opt[a.slice(2)] = argv[(i += 1)];
    else if (a === '--no-commit') opt.commit = false;
    else rest.push(a);
  }
  const die = (msg) => { console.error(`capture: ${msg}`); process.exit(2); };
  const text = (rest.join(' ') || (process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8'))).trim();
  if (!text) die('no text given (pass it as an argument or on stdin)');
  if (text.includes('\n')) die('capture one line at a time; for longer material write a note or ingest a file');

  const root = vaultRoot([]);
  const date = new Date().toISOString().slice(0, 10);
  let target;
  let previous = null;
  if (opt.to || (!opt.title && (!opt.type || opt.type === 'daily'))) {
    target = opt.to ? path.resolve(root, opt.to) : path.join(root, 'journal', `${date}.md`);
    if (fs.existsSync(target)) previous = fs.readFileSync(target, 'utf8');
    else if (opt.to) die(`no such note: ${opt.to}`);
  } else {
    const type = opt.type || 'topic';
    if (!opt.title) die('--title is needed for a new note');
    if (/[\\/]/.test(opt.title)) die('a title cannot contain a slash');
    const dir = type === 'topic' ? opt.area : FOLDER_OF[type];
    if (!dir) die(`unknown --type ${type}`);
    if (type === 'topic' && !fs.existsSync(path.join(root, dir))) die(`no life-area folder ${dir}/; pass --area`);
    const name = ['meeting', 'review'].includes(type) && !/^\d{4}-\d{2}-\d{2}/.test(opt.title) ? `${date} ${opt.title}` : opt.title;
    target = path.join(root, dir, `${name}.md`);
    if (fs.existsSync(target)) die(`${path.relative(root, target)} exists; use --to to add to it`);
    opt.type = type;
  }

  const content = previous !== null
    ? appendLine(previous, { text, by: opt.by, date })
    : newNote({ type: opt.type || 'daily', title: opt.title || date, area: opt.area, text, by: opt.by, date });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);

  const rel = path.relative(root, target);
  const check = spawnSync(process.execPath, [path.join(root, 'bin', 'check.mjs'), target], { cwd: root, encoding: 'utf8' });
  if (check.status !== 0) {
    if (previous === null) fs.rmSync(target);
    else fs.writeFileSync(target, previous);
    process.stdout.write(check.stdout || '');
    die('the note would break the contract, so nothing was kept');
  }
  spawnSync(process.execPath, [path.join(root, 'bin', 'index.mjs')], { cwd: root, stdio: 'ignore' });

  const isGit = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout?.trim() === 'true';
  if (opt.commit && isGit) {
    const files = [rel, ...(fs.existsSync(path.join(root, 'MAP.md')) ? ['MAP.md'] : [])];
    spawnSync('git', ['-C', root, 'add', '--', ...files]);
    // --only: commit just these files, never anything else you had staged.
    const c = spawnSync('git', ['-C', root, 'commit', '-q', '-m', `capture: ${path.basename(rel, '.md')}`, '--only', '--', ...files], { encoding: 'utf8' });
    if (c.status !== 0) console.error(`capture: kept ${rel}, but the commit failed: ${(c.stderr || '').trim()}`);
  }
  console.log(`capture: ${previous === null ? 'wrote' : 'added to'} ${rel}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
