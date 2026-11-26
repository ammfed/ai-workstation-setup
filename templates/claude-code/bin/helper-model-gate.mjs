#!/usr/bin/env node
// helper-model-gate - a Claude Code PreToolUse hook that refuses to start a helper whose model
// is not named. Installed by ai-workstation-setup (claude-code module, CLAUDE_HELPER_MODEL_GATE)
// into ~/.claude/hooks, registered on the Agent tool (matcher "Agent|Task": Task is the
// tool's old name, still accepted as an alias).
//
// Why a hook and not a rule: a helper with no model runs on its parent's model and effort, so
// an unnamed helper under an expensive parent runs expensive too. The written rule to name one
// was broken more than once; a refused call cannot be read past (workflow-playbook rule 9.2).
//
// Allowed: a call whose tool_input.model is a non-empty string; a call whose subagent_type
// names an agent whose own definition sets a model (not "inherit"), found the way Claude Code
// finds it: project .claude/agents folders from the payload's cwd up to the repository root,
// closest first, then the user's ~/.claude/agents, each scanned recursively and matched on
// the frontmatter name; and a fork (subagent_type "fork"), which always runs on its parent's
// model and ignores a model it is given, so there is nothing for it to name. Also allowed
// while CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set, because then Claude Code refuses a passed
// model. A built-in or plugin agent type has no definition here, so it still needs a model.
// Fields from code.claude.com/docs/en/hooks ("PreToolUse", "Agent") and /docs/en/sub-agents.
// It never blocks on its own errors: an unreadable or late payload allows the call.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REASON =
  'Helper model gate: name a model for this helper. Pass model (haiku, sonnet, opus or fable) picked from the helper model table in the models-and-research skill, then start it again.';

/** The deny reason for one PreToolUse payload, or '' when the call may run. */
export function refusal(input, env = process.env) {
  if (!input || !['Agent', 'Task'].includes(input.tool_name)) return '';
  const toolInput = input.tool_input || {};
  if (toolInput.subagent_type === 'fork') return '';
  if (/^(1|true|yes|on)$/i.test(String(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE || ''))) return '';
  if (typeof toolInput.model === 'string' && toolInput.model.trim()) return '';
  const type = String(toolInput.subagent_type || '').trim();
  if (type) {
    const model = definedModel(type, input.cwd, env);
    if (model && model.toLowerCase() !== 'inherit') return '';
  }
  return REASON;
}

// The agent folders Claude Code reads, highest precedence first.
function agentDirs(cwd, env) {
  const dirs = [];
  if (cwd) {
    for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
      dirs.push(path.join(dir, '.claude', 'agents'));
      if (fs.existsSync(path.join(dir, '.git')) || path.dirname(dir) === dir) break;
    }
  }
  dirs.push(path.join(env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude'), 'agents'));
  return dirs;
}

function markdownFiles(dir, depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return depth < 4 ? markdownFiles(file, depth + 1) : [];
    return e.name.endsWith('.md') ? [file] : [];
  });
}

/** The frontmatter fields of an agent definition file (simple `key: value` lines). */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields = {};
  for (const line of (m ? m[1] : '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*?)\s*$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

/** The model field of the definition Claude Code would use for agent `type`, or '' when none. */
export function definedModel(type, cwd, env = process.env) {
  for (const dir of agentDirs(cwd, env)) {
    for (const file of markdownFiles(dir)) {
      let fields;
      try {
        fields = frontmatter(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      if (fields.name === type) return fields.model || '';
    }
  }
  return '';
}

// Read the hook payload without waiting for end-of-input (some sessions hand the hook a stdin
// that never closes; see stow-gate.mjs). Allow the call if no payload arrives in 2 seconds.
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

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const reason = refusal(await readPayload());
    if (reason) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    }
  } catch {
    // never block on our own errors
  }
  process.exit(0);
}
