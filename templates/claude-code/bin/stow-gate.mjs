#!/usr/bin/env node
// stow-gate - a Claude Code PreToolUse hook that makes "stow before compaction" a hard rule.
// Installed by ai-workstation-setup (claude-code module, CLAUDE_STOW_GATE) into ~/.claude/hooks.
//
// Once a session's context passes the stow line, every tool call is refused except
// the stow skill itself, until a stow has started. The stow then runs normally (its own
// Bash, Read and Edit calls are allowed once it has started), and the gate stays open
// until the next compaction, after which it re-arms.
//
// Why a gate and not a reminder: a reminder (context-reminder.mjs) speaks once and can be
// read past during a busy run, and Claude Code ignores whatever a PreCompact hook says.
// A refused tool call cannot be read past.
//
// Usage, as the hook command:  node stow-gate.mjs [auto|<tokens>]
// "auto" (the default) puts the stow line at three quarters of the auto-compact window
// that applies to the session (autoCompactWindow in the project's .claude settings, else
// the user settings), so a 200000 window gates at 150000 and leaves room for the stow.
// With no window set it gates at 150000.
// A stow counts when, after the last compaction, the stow skill was called (Skill tool
// with skill "stow") or typed as /stow, at a context of at least 80% of the stow line.
// Context size is the latest main-thread assistant turn's input + cache tokens.
// It never blocks on its own errors: an unreadable or late payload or transcript allows the call.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FALLBACK = 150000;
const TAIL = 8 * 1024 * 1024;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function windowFor(cwd) {
  const files = [];
  for (let dir = path.resolve(cwd || '.'); ; dir = path.dirname(dir)) {
    for (const name of ['settings.local.json', 'settings.json']) {
      const s = readJson(path.join(dir, '.claude', name));
      if (s) files.push(s);
    }
    if (path.dirname(dir) === dir) break;
  }
  files.push(readJson(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')) || {});
  return files.map((s) => s.autoCompactWindow).find((w) => Number.isInteger(w) && w > 0);
}

function isStowCall(entry) {
  const content = entry?.message?.content;
  if (entry.type === 'assistant' && Array.isArray(content)) {
    return content.some((c) => c?.type === 'tool_use' && c.name === 'Skill' && /^(.*:)?stow$/.test(String(c.input?.skill || '')));
  }
  if (entry.type === 'user') {
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text || '').join('\n') : '';
    return text.includes('<command-name>/stow</command-name>');
  }
  return false;
}

// Walk the transcript tail: current context size, and the context size at the latest
// stow since the last compaction (null when there was none).
function scan(transcript) {
  const size = fs.statSync(transcript).size;
  const length = Math.min(size, TAIL);
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(transcript, 'r');
  try {
    fs.readSync(fd, buf, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }
  let tokens = null;
  let stowAt = null;
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // the first line may be cut in half
    }
    if (entry.isSidechain) continue;
    if (entry.subtype === 'compact_boundary') {
      tokens = 0;
      stowAt = null;
      continue;
    }
    const usage = entry.type === 'assistant' ? entry.message?.usage : null;
    if (usage) tokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    if (isStowCall(entry)) stowAt = tokens || 0;
  }
  return { tokens, stowAt };
}

// Read the hook payload without waiting for end-of-input: some sessions hand the hook a
// stdin that never closes (seen 13 Nov: a worker froze on every tool call). Stop as soon
// as a complete JSON object has arrived, and allow the call if none arrives in 2 seconds.
function readPayload() {
  return new Promise((resolve) => {
    let text = '';
    const done = (value) => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 2000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
      try {
        done(JSON.parse(text));
      } catch {
        // not complete yet
      }
    });
    process.stdin.on('end', () => {
      try {
        done(JSON.parse(text || '{}'));
      } catch {
        done(null);
      }
    });
    process.stdin.on('error', () => done(null));
  });
}

try {
  const input = await readPayload();
  if (!input) process.exit(0);
  const transcript = input.transcript_path;
  if (!transcript || !fs.existsSync(transcript)) process.exit(0);
  const arg = process.argv[2] || 'auto';
  const window = windowFor(input.cwd);
  const line = arg !== 'auto' && Number(arg) > 0 ? Number(arg) : window ? Math.round(window * 0.75) : FALLBACK;
  const { tokens, stowAt } = scan(transcript);
  if (tokens === null || tokens < line) process.exit(0);
  if (stowAt !== null && stowAt >= line * 0.8) process.exit(0);
  if (input.tool_name === 'Skill' && /^(.*:)?stow$/.test(String(input.tool_input?.skill || ''))) process.exit(0);
  const reason =
    `Stow gate: context is ${tokens} tokens, past the stow line of ${line}` +
    (window ? ` (auto-compaction at ${window})` : '') +
    '. Nothing else runs until the work is saved. Call the Skill tool with skill "stow" now and run the full pass; this tool call is refused, retry it after the stow has started.';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
} catch {
  // Never block on the gate's own failure.
}
process.exit(0);
