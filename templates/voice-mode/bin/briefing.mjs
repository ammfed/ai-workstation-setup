// The live briefing: what the voice needs to sound like the assistant you work with, not a
// stranger. It is built from the assistant's own current conversation (the newest Claude
// Code transcript: user and assistant text only, never tool output), notes such as a
// profile or a memory index, sections of a backlog, and the latest line of each live status
// log. Every part has its own size budget. Everything passes the redactor before it leaves
// the machine: keys, tokens, passwords, credentials in URLs and env-style secret lines.

import fs from 'node:fs';
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

// Wrappers the harness adds around what the user typed, and notices that are not the user.
const NOT_USER = /^\s*<(task-notification|command-name|command-message|command-args|local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr)\b/;

function messageText(r) {
  const content = r.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  // Text only: no thinking, tool calls or tool results.
  return content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
}

/** The last exchanges of a Claude Code transcript (.jsonl), as [{ who, text }]. */
export function transcriptTail(file, { maxBytes = 3_000_000, perMessage = 1500 } = {}) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(size, maxBytes));
  fs.readSync(fd, buf, 0, buf.length, size - buf.length);
  fs.closeSync(fd);
  const out = [];
  for (const line of buf.toString('utf8').split('\n')) {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue; // also the first, partial line
    }
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta || r.isSidechain) continue;
    let text = messageText(r);
    if (r.type === 'user' && NOT_USER.test(text)) continue;
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) continue;
    out.push({ who: r.type === 'user' ? 'User' : 'Assistant', text: clip(text, perMessage) });
  }
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

function part(p) {
  const max = p.maxChars || 4000;
  if (p.transcript) {
    const newest = newestTranscript(expandHome(p.transcript));
    if (!newest) return '';
    // Newest exchanges first until the budget is spent, then back into reading order.
    const lines = [];
    let used = 0;
    for (const m of transcriptTail(newest.file, { perMessage: p.perMessage || 1500 }).slice(-(p.messages || 30)).reverse()) {
      const line = `${m.who}: ${m.text}`;
      if (used + line.length > max) break;
      lines.unshift(line);
      used += line.length + 2;
    }
    return lines.join('\n\n');
  }
  if (p.glob) return clip(latestLines(p.glob, p.hours || 24), max);
  let text = fs.readFileSync(expandHome(p.path), 'utf8');
  if (p.sections) text = sections(text, p.sections);
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
    if (text) out.push(`## ${p.name}\n${text}`);
  }
  const text = redact(clip(out.join('\n\n'), b.maxChars || 24000));
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
  for (const p of config.briefing.parts || []) {
    try {
      if (p.transcript) stamp = Math.max(stamp, newestTranscript(expandHome(p.transcript))?.mtimeMs || 0);
      else if (p.path) stamp = Math.max(stamp, fs.statSync(expandHome(p.path)).mtimeMs);
    } catch {}
  }
  return stamp;
}
