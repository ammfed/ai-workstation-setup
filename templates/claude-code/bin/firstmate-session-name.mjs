#!/usr/bin/env node
// firstmate-session-name - a Claude Code UserPromptSubmit hook.
//
// Firstmate starts every worker and second mate with one line: "Firstmate operational
// input waiting: read '<record>' ...". Claude Code titles a session from its first
// prompt, so every one shows up as "Firstmate operational input" in the terminal title,
// the herdr panel and remote sessions. When the prompt is that line, the record is a
// launch brief, and the session has no name yet, this hook names the session after the
// task: the brief's status file "state/<task-id>.status" gives the id, and
// "ai-workstation-mate" becomes "AI workstation mate".
//
// Claude Code reads the name from hookSpecificOutput.sessionTitle, with the same effect
// as /rename. A session that already has a name (--name, /rename, an earlier run) keeps it.
// Installed by ai-workstation-setup (firstmate module). No dependencies; it always exits 0
// and never blocks a prompt.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOORBELL = /^: Firstmate operational input waiting: read '([^']+)'/;
const LAUNCH = /FIRSTMATE_OP: v1 launch-brief:/;
const STATUS = /\/state\/([A-Za-z0-9][A-Za-z0-9._-]*)\.status\b/;
const UPPER = new Set(['ai', 'api', 'aws', 'ci', 'cli', 'css', 'gcp', 'html', 'id', 'json', 'llm', 'mcp', 'pdf', 'pr', 'qa', 'qc', 'sdk', 'sql', 'ui', 'url', 'ux', 'wsl']);

/** "ai-workstation-mate" -> "AI workstation mate". */
export function taskTitle(id) {
  const words = String(id).split(/[-_.]+/).filter(Boolean);
  if (!words.length) return '';
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (UPPER.has(lower)) return lower.toUpperCase();
      return i === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/** The session name for one submitted prompt, or '' when this hook should stay quiet. */
export function titleFor(input) {
  if (!input || input.session_title) return '';
  const m = String(input.prompt || '').match(DOORBELL);
  if (!m || path.basename(path.dirname(m[1])) !== 'operational-inbox') return '';
  let head;
  try {
    const fd = fs.openSync(m[1], 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, n).toString('utf8');
  } catch {
    return '';
  }
  if (!LAUNCH.test(head.slice(0, 200))) return '';
  const id = head.match(STATUS);
  return id ? taskTitle(id[1]) : '';
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return;
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  const title = titleFor(input);
  if (title) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: title } }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch {
    // Never block a prompt.
  }
}
