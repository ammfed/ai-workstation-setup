#!/usr/bin/env node
// context-reminder - a Claude Code UserPromptSubmit and SessionStart hook.
//
// UserPromptSubmit: once a session's context passes a token threshold, it adds one
// reminder to the next prompt: save what matters (for example a memory save pass)
// before the context gets compacted. It fires once per crossing and re-arms after the
// context drops back below 90% of the threshold (after a compaction or /clear).
//
// SessionStart with source "compact": right after a compaction, it tells the agent
// where the full pre-compaction transcript is, so anything the summary dropped can be
// recovered and saved. This is the dependable backstop: a PreCompact hook cannot
// speak to the agent (Claude Code discards its messages), but the session that
// resumes after compaction can.
//
// Usage, as the hook command:  node context-reminder.mjs <tokens> ["reminder text"]
// Context size is read from the session transcript: the latest main-thread
// assistant turn's input, cache-read and cache-creation tokens.
// Installed by ai-workstation-setup (claude-code module). No dependencies; it
// always exits 0 and never blocks a prompt.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const threshold = Number(process.argv[2]) || 150000;
const reminder =
  process.argv[3] ||
  'Context is past the reminder threshold. Before continuing, save what matters from this session (for example run your memory save pass), then carry on.';

function contextTokens(transcript) {
  const size = fs.statSync(transcript).size;
  const length = Math.min(size, 4 * 1024 * 1024);
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(transcript, 'r');
  try {
    fs.readSync(fd, buf, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue; // the first line may be cut in half
    }
    const usage = entry?.message?.usage;
    if (entry.type !== 'assistant' || entry.isSidechain || !usage) continue;
    return (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  }
  return null;
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const sid = String(input.session_id || '');
  if (input.hook_event_name === 'SessionStart') {
    if (input.source === 'compact' && input.transcript_path) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `The conversation was just compacted. The full history before compaction is still in ${input.transcript_path}. Before continuing, check that everything worth keeping from it was saved (notes, decisions, open work) and save anything the summary dropped.`,
          },
        }),
      );
    }
  } else if (/^[A-Za-z0-9_-]+$/.test(sid) && input.transcript_path && fs.existsSync(input.transcript_path)) {
    const tokens = contextTokens(input.transcript_path);
    const dir = path.join(os.tmpdir(), 'claude-context-reminder');
    const mark = path.join(dir, sid);
    if (tokens !== null && tokens < threshold * 0.9) {
      fs.rmSync(mark, { force: true });
    } else if (tokens !== null && tokens >= threshold && !fs.existsSync(mark)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(mark, String(tokens));
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `${reminder} (context: ${tokens} tokens)` } }),
      );
    }
  }
} catch {
  // A reminder is best effort; never get in the way of the prompt.
}
process.exit(0);
