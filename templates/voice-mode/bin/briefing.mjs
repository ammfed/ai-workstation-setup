// The live briefing: what the voice needs to sound like the assistant you work with, not a
// stranger. It is built from the assistant's own current conversation (the newest Claude
// Code transcript: what the user said and the assistant's final reply to each message, with
// harness notices, automated input and tool narration left out), notes such as a profile,
// learnings or whole memory files, sections of a backlog, the latest line of each live status
// log, and who is working on what. Every part has its own size budget. Everything passes the
// redactor before it leaves the machine: keys, tokens, passwords, credentials in URLs and
// env-style secret lines.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandGlob, expandHome } from './config.mjs';

// ------------------------------------------------------------------ redactor

const SECRET_NAME = '[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASSPHRASE|CREDENTIALS?)[A-Za-z0-9_]*';

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted private key]'],
  // Provider keys: OpenAI, Anthropic, OpenRouter and other sk- keys; GitHub; AWS; Google; Slack.
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted key]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[redacted token]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted key]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[redacted key]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[redacted token]'],
  // JSON web tokens.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted token]'],
  // Authorization headers and bearer tokens.
  [/\b(authorization|proxy-authorization|x-api-key|api-key)(["']?\s*[:=]\s*["']?)[^\s"',}]+(?:\s+[^\s"',}]+)?/gi, '$1$2[redacted]'],
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted]'],
  // user:password@ in links.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@'],
  // NAME=value and "name": "value" where the name says it is a secret.
  [new RegExp(`\\b(${SECRET_NAME})(\\s*=\\s*)(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s"']+)`, 'gi'), '$1$2[redacted]'],
  [new RegExp(`(["']${SECRET_NAME}["']\\s*:\\s*)(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s,}]+)`, 'gi'), '$1"[redacted]"'],
  // "my password is hunter2", "passcode: 1234".
  [/\b(password|passwd|passphrase|passcode)(\s+is\s+|\s*[:=]\s*)\S+/gi, '$1$2[redacted]'],
  // Anything else that looks like a random token: long, with upper and lower case and digits.
  [/\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g, '[redacted token]'],
];

/** Remove secrets from text: keys, tokens, passwords, credentials in URLs, secret env lines. */
export function redact(text) {
  let out = String(text ?? '');
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

// ------------------------------------------------------------------ parts

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 20).trimEnd()} [...]` : s);

// Messages in the user's place that the user did not type: harness notices, a compacted
// session's summary, shell escapes, and automated input from a supervising agent (marked
// with an invisible separator, U+2063, or an operational prefix such as FIRSTMATE_OP:). A part's `skip`
// adds patterns of its own.
const NOT_USER = [
  /^<(task-notification|local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook)\b/,
  /^\[Request interrupted/,
  /^This session is being continued from a previous conversation/,
  /^Caveat: /,
  /^Stop hook feedback/,
  /^⁣/,
  /^FIRSTMATE_OP:/,
];

function messageText(r) {
  const content = r.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  // Text only: no thinking, tool calls or tool results.
  return content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
}

/** A link as a few words: "repo pull request 12", "repo README.md", or host and path. */
function linkText(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.host.replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean);
  if (host === 'github.com' && segs.length >= 2) {
    const [, repo, kind, n] = segs;
    if ((kind === 'pull' || kind === 'issues') && /^\d+$/.test(n || '')) return `${repo} ${kind === 'pull' ? 'pull request' : 'issue'} ${n}`;
    if (kind === 'blob' || kind === 'tree') return `${repo} ${segs[segs.length - 1]}`;
    return `${repo} on GitHub`;
  }
  return segs.length ? `${host}/${segs.slice(0, 2).join('/')}` : host;
}

/** Spoken-style text: no tables, code, markdown marks, emoji or long links. */
export function plain(text) {
  const out = [];
  const lines = String(text).replace(/```[\s\S]*?(```|$)/g, '').split('\n');
  const rule = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/^\s*\|/.test(line)) {
      // A table: the header row and the rule under it go; each row becomes "first: rest".
      if (rule.test(line) || rule.test(lines[i + 1] || '')) continue;
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      line = cells.length > 1 ? `- ${cells[0]}: ${cells.slice(1).join('; ')}` : `- ${cells[0] || ''}`;
    }
    out.push(line.replace(/^\s*#{1,6}\s+/, ''));
  }
  return out
    .join('\n')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)\s]+\)/g, '$1')
    .replace(/https?:\/\/[^\s)<>\]]+/g, (m) => {
      const url = m.replace(/[.,;:!?'"]+$/, '');
      return linkText(url) + m.slice(url.length);
    })
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, '$1$2')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/(\S)[ \t]{2,}/g, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** What the user typed, or null for a message that is not the user (see NOT_USER). */
function userWords(text, skip) {
  let t = text.trim();
  // A slash command: its arguments are the user's words.
  if (/^<command-(name|message)>/.test(t)) {
    const name = /<command-name>([^<]*)<\/command-name>/.exec(t)?.[1]?.trim();
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1]?.trim();
    return args ? `${name ? `${name} ` : ''}${args}` : null;
  }
  // Pasted text stays unless it is automated input itself.
  t = t.replace(/<pasted_content[^>]*>([\s\S]*?)(?:<\/pasted_content>|$)/g, (m, inner) => (skip.some((re) => re.test(inner.trim())) ? '' : inner)).trim();
  return t && !skip.some((re) => re.test(t)) ? t : null;
}

/**
 * The conversation in a Claude Code transcript (.jsonl), as [{ who, text }]: each thing the
 * user said, and the assistant's final reply to each message (its narration between tool
 * calls is left out). A short reply to something the user did not say (an acknowledgement of
 * a notice) is left out too.
 */
export function transcriptTail(file, { maxBytes = 3_000_000, perMessage = 1500, skip = [] } = {}) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(size, maxBytes));
  fs.readSync(fd, buf, 0, buf.length, size - buf.length);
  fs.closeSync(fd);
  const notUser = [...NOT_USER, ...skip.map((p) => new RegExp(p))];
  const out = [];
  let reply = null;
  let toUser = false;
  const flush = () => {
    const text = reply && plain(reply);
    if (text && (toUser || text.length > 80)) out.push({ who: 'Assistant', text: clip(text, perMessage) });
    reply = null;
  };
  for (const line of buf.toString('utf8').split('\n')) {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue; // also the first, partial line
    }
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta || r.isSidechain) continue;
    const text = messageText(r).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    // Tool results carry no text: they do not end the assistant's turn.
    if (!text) continue;
    if (r.type === 'assistant') {
      if (!notUser.some((re) => re.test(text))) reply = text;
      continue;
    }
    const said = userWords(text, notUser);
    // A notice that comes before any reply leaves the user's message still the one answered.
    if (!said && !reply) continue;
    flush();
    toUser = !!said;
    const words = said && plain(said);
    if (words) out.push({ who: 'User', text: clip(words, perMessage) });
  }
  flush();
  return out;
}

/** The newest top-level .jsonl in a folder (a Claude Code project folder). */
export function newestTranscript(dir) {
  let best = null;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const st = fs.statSync(path.join(dir, f));
    if (!best || st.mtimeMs > best.mtimeMs) best = { file: path.join(dir, f), mtimeMs: st.mtimeMs };
  }
  return best;
}

/** Only the named `## ` sections of a markdown file. */
export function sections(text, names) {
  const want = new Set(names.map((n) => n.toLowerCase()));
  const out = [];
  let keep = false;
  for (const line of text.split('\n')) {
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) keep = want.has(h[1].toLowerCase());
    if (keep) out.push(line);
  }
  return out.join('\n').trim();
}

/** The newest line of each log matching a glob, for logs touched within `hours`. */
function latestLines(glob, hours) {
  const since = Date.now() - hours * 3600_000;
  const out = [];
  for (const f of expandGlob(expandHome(glob))) {
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      continue;
    }
    if (!st.isFile() || st.mtimeMs < since) continue;
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    out.push({ at: st.mtimeMs, text: `${path.basename(f).replace(/\.[^.]+$/, '')}: ${lines[lines.length - 1]}` });
  }
  return out.sort((a, b) => b.at - a.at).map((l) => `- ${l.text}`).join('\n');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A local time as "26 Sep 22:31". */
export function when(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const tilde = (p) => (p.startsWith(os.homedir() + path.sep) ? `~${p.slice(os.homedir().length)}` : p);
const globs = (g) => [].concat(g).flatMap((x) => expandGlob(expandHome(x)));

/** Whole files matching a glob, newest first, each under its own name; front matter becomes its description. */
function wholeFiles(p) {
  const skip = new Set(p.except || []);
  const files = globs(p.files)
    .filter((f) => !skip.has(path.basename(f)))
    .map((f) => ({ f, st: fs.statSync(f) }))
    .filter(({ st }) => st.isFile())
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return files
    .map(({ f }) => {
      let text = fs.readFileSync(f, 'utf8').trim();
      const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
      if (fm) text = [/^description:\s*(.+)$/m.exec(fm[1])?.[1], text.slice(fm[0].length).trim()].filter(Boolean).join('\n');
      return `### ${path.basename(f).replace(/\.[^.]+$/, '')}\n${text}`;
    })
    .join('\n\n');
}

const kv = (text) => Object.fromEntries(text.split('\n').map((l) => /^([A-Za-z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()]));

/**
 * Who is working on what, from task records: one `<id>.meta` file of key=value lines per
 * task (project, kind, worktree, and home when the task is itself an agent with its own
 * folder of task records), with its `<id>.status` log beside it. A task is listed while its
 * record or log changed within `days`, newest first, with its working copy and latest line.
 */
function tasks(p) {
  const since = Date.now() - (p.days || 14) * 86400_000;
  const all = globs(p.tasks)
    .filter((f) => f.endsWith('.meta'))
    .map((f) => ({ f, id: path.basename(f, '.meta'), home: path.dirname(path.dirname(f)), meta: kv(fs.readFileSync(f, 'utf8')) }));
  // An agent's own folder of task records is named after it: its tasks are "under" it.
  const owner = new Map(all.filter((t) => t.meta.home).map((t) => [path.resolve(expandHome(t.meta.home)), t.id]));
  const out = [];
  for (const t of all) {
    const log = path.join(path.dirname(t.f), `${t.id}.status`);
    let at = fs.statSync(t.f).mtimeMs;
    let latest = '';
    try {
      const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
      at = Math.max(at, fs.statSync(log).mtimeMs);
      latest = lines[lines.length - 1].replace(/\s*\[(?:key|corr)=[^\]]*\]|\s*\bcorr=[0-9a-f]+/g, '').trim();
    } catch {}
    if (at < since) continue;
    const under = owner.get(path.resolve(t.home));
    const what = [t.meta.kind || 'task', t.meta.project && `on ${path.basename(t.meta.project)}`, under && `under ${under}`].filter(Boolean).join(' ');
    const copy = t.meta.worktree ? `; working copy ${tilde(t.meta.worktree)}` : '';
    out.push({ at, text: `- ${t.id} (${what})${copy}; latest, ${when(at)}: ${clip(latest || 'no status yet', 240)}` });
  }
  return out.sort((a, b) => b.at - a.at).map((l) => l.text).join('\n');
}

function part(p) {
  const max = p.maxChars || 4000;
  if (p.transcript) {
    const newest = newestTranscript(expandHome(p.transcript));
    if (!newest) return '';
    // Newest exchanges first until the budget is spent, then back into reading order.
    const head = `(Your own session ${path.basename(newest.file, '.jsonl').slice(0, 8)}, last active ${when(newest.mtimeMs)}.)`;
    const lines = [];
    let used = head.length;
    for (const m of transcriptTail(newest.file, { perMessage: p.perMessage || 1500, skip: p.skip || [] }).slice(-(p.messages || 30)).reverse()) {
      const line = `${m.who}: ${m.text}`;
      if (used + line.length > max) break;
      lines.unshift(line);
      used += line.length + 2;
    }
    return lines.length ? [head, ...lines].join('\n\n') : '';
  }
  if (p.tasks) return clip(tasks(p), max);
  if (p.files) return clip(wholeFiles(p), max);
  if (p.glob) return clip(latestLines(p.glob, p.hours || 24), max);
  let text = fs.readFileSync(expandHome(p.path), 'utf8');
  if (p.sections) text = sections(text, p.sections);
  if (p.lineChars) text = text.split('\n').map((l) => clip(l, p.lineChars)).join('\n');
  return clip(text.trim(), max);
}

/**
 * The briefing text: each configured part under its own heading, redacted, within budget.
 * A part that cannot be read is left out and named in `missing`.
 */
export function buildBriefing(config) {
  const b = config.briefing;
  const out = [];
  const missing = [];
  for (const p of b.parts || []) {
    let text = '';
    try {
      text = part(p);
    } catch {
      missing.push(p.name);
      continue;
    }
    // A part's own headings sit under its "## name" heading.
    if (text) out.push(`## ${p.name}\n${text.replace(/^(#{1,4}) /gm, '##$1 ')}`);
  }
  const text = redact(clip(out.join('\n\n'), b.maxChars || 120000));
  return { text, missing, chars: text.length };
}

/**
 * The lines of `after` that `before` does not have, each under its part's heading: what a
 * provider that cannot replace its instructions mid-conversation is told instead.
 */
export function briefingChanges(before, after, max = 4000) {
  const had = new Set(String(before).split('\n'));
  const out = [];
  let heading = null;
  for (const line of String(after).split('\n')) {
    if (/^## /.test(line)) {
      heading = line;
      continue;
    }
    if (!line.trim() || had.has(line)) continue;
    if (heading) {
      out.push(heading);
      heading = null;
    }
    out.push(line);
  }
  return clip(out.join('\n'), max);
}

/** Newest modification time among the briefing's sources, to rebuild when one changes. */
export function briefingStamp(config) {
  let stamp = 0;
  const newest = (files) => {
    for (const f of files) {
      try {
        stamp = Math.max(stamp, fs.statSync(f).mtimeMs);
      } catch {}
    }
  };
  for (const p of config.briefing.parts || []) {
    try {
      if (p.transcript) stamp = Math.max(stamp, newestTranscript(expandHome(p.transcript))?.mtimeMs || 0);
      else if (p.path) newest([expandHome(p.path)]);
      else if (p.files || p.glob) newest(globs(p.files || p.glob));
      else if (p.tasks) newest(globs(p.tasks).flatMap((f) => [f, f.replace(/\.meta$/, '.status')]));
    } catch {}
  }
  return stamp;
}
