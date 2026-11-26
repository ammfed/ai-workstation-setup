#!/usr/bin/env node
// review-pages: which Lavish review pages the user has answered, read without collecting anything.
//
// lavish-axi keeps every session in one state file ($LAVISH_AXI_STATE_DIR/state.json, else
// ~/.lavish-axi/state.json), whichever agent or Firstmate home made the page. This script only
// reads that file. It never polls, never calls the Lavish server and never writes, so an answer
// stays queued for the agent that made the page.
//
// Why `lavish-axi` on its own is not enough: its list leaves out every ended page, so an answer
// sent with "Send & End" that nobody collected is not shown at all. And once an agent collects an
// answer, the page goes back to "open" with 0 pending answers, the same as a page nobody touched.
// This script reads the page's chat as well, so both show as answered.
//
// Usage: node review-pages.mjs [--under <dir>] [--days <n>] [--all] [--json]
//   --under <dir>  only pages whose file is inside <dir> (for example one Firstmate home)
//   --days <n>     only pages changed in the last <n> days
//   --all          also pages that ended and hold nothing new (normally left out)
//   --json         one JSON array instead of text lines
// Exit status: 0 ok (also when there are no pages), 1 the state file cannot be read, 2 usage.
//
// Installed by ai-workstation-setup (preferences module). Node built-ins only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: review-pages.mjs [--under <dir>] [--days <n>] [--all] [--json]';

// What each state means, in the words the agent repeats to the user.
export const MEANING = {
  answered: 'answered, the answer is waiting to be collected',
  'answered-collected': 'answered, the answer was collected by the agent that polls it',
  waiting: 'waiting on the user',
  ended: 'ended with no answer since the last agent message',
};

export function stateFile(env = process.env) {
  return path.join(env.LAVISH_AXI_STATE_DIR || path.join(os.homedir(), '.lavish-axi'), 'state.json');
}

const firstLine = (text) => String(text ?? '').split('\n').find((l) => l.trim()) ?? '';
const clip = (text, n = 100) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);

// One session from state.json -> { state, ... }. Rules, first match wins:
// 1. queued prompts                      -> answered (not yet collected)
// 2. the chat ends with a user message   -> answered-collected
// 3. the session ended                   -> ended
// 4. otherwise                           -> waiting
export function classify(session) {
  const prompts = Array.isArray(session.prompts) ? session.prompts : [];
  const chat = Array.isArray(session.chat) ? session.chat : [];
  const last = chat[chat.length - 1];
  const lastUser = [...chat].reverse().find((c) => c?.role === 'user');
  const ended = session.status === 'ended';
  let state;
  if (prompts.length > 0) state = 'answered';
  else if (last?.role === 'user') state = 'answered-collected';
  else if (ended) state = 'ended';
  else state = 'waiting';
  const answerText = prompts.length ? prompts[prompts.length - 1]?.prompt : state === 'answered-collected' ? lastUser?.text : '';
  return {
    file: session.file,
    state,
    pending: prompts.length,
    ended,
    endedBy: ended ? session.ended_by || null : null,
    answeredAt: state.startsWith('answered') ? lastUser?.at || session.updated_at || null : null,
    updatedAt: session.updated_at || null,
    answer: clip(firstLine(answerText)),
    url: session.url || null,
  };
}

const inside = (file, dir) => {
  const rel = path.relative(dir, file);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
};

// All pages, newest first. Without `all`, a page that ended with nothing new is left out.
export function readPages({ file = stateFile(), under = null, days = null, all = false, now = Date.now() } = {}) {
  if (!fs.existsSync(file)) return [];
  const sessions = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).sessions || {});
  return sessions
    .filter((s) => s && typeof s.file === 'string')
    .filter((s) => !under || inside(s.file, under))
    .filter((s) => days == null || now - Date.parse(s.updated_at) <= days * 86400000)
    .map(classify)
    .filter((p) => all || !(p.ended && p.state !== 'answered'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function format(p) {
  const bits = [MEANING[p.state]];
  if (p.ended) bits.push(`page ended by ${p.endedBy || 'unknown'}`);
  if (p.answeredAt) bits.push(`answered ${p.answeredAt.slice(0, 16).replace('T', ' ')} UTC`);
  if (p.answer) bits.push(`answer: "${p.answer}"`);
  return `${p.state}\t${p.file}\t${bits.join('; ')}`;
}

function main(argv) {
  const opts = { under: null, days: null, all: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--under' && argv[i + 1]) opts.under = path.resolve(argv[++i].replace(/^~(?=$|\/)/, os.homedir()));
    else if (a === '--days' && /^\d+$/.test(argv[i + 1] ?? '')) opts.days = Number(argv[++i]);
    else if (a === '-h' || a === '--help') return console.log(USAGE), 0;
    else return console.error(`review-pages: unknown argument ${a}\n${USAGE}`), 2;
  }
  const file = stateFile();
  let pages;
  try {
    pages = readPages({ file, under: opts.under, days: opts.days, all: opts.all });
  } catch (err) {
    console.error(`review-pages: cannot read ${file}: ${err.message}`);
    return 1;
  }
  if (opts.json) return console.log(JSON.stringify(pages, null, 2)), 0;
  if (!pages.length) return console.log('review-pages: no review pages to report'), 0;
  const count = (s) => pages.filter((p) => p.state === s).length;
  console.log(`review-pages: ${count('answered')} answered and not collected, ${count('answered-collected')} answered and collected, ${count('waiting')} waiting on the user`);
  for (const p of pages) console.log(format(p));
  return 0;
}

const self = process.argv[1] && fs.realpathSync(process.argv[1]);
if (self && self === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
