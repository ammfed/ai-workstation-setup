// Claude Code config helpers shared by several modules.

import fs from 'node:fs';
import path from 'node:path';

export function claudeDir(ctx) {
  return process.env.CLAUDE_CONFIG_DIR || path.join(ctx.home, '.claude');
}

export function settingsPath(ctx) {
  return path.join(claudeDir(ctx), 'settings.json');
}

export function readSettings(ctx) {
  const file = settingsPath(ctx);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message})`);
  }
}

/** Add a SessionStart command hook unless one with the same command exists. */
export function addSessionStartHook(ctx, command) {
  return ctx.updateJson(
    settingsPath(ctx),
    (s) => {
      s.hooks ??= {};
      s.hooks.SessionStart ??= [];
      const present = s.hooks.SessionStart.some((m) => (m.hooks || []).some((h) => h.command === command));
      if (!present) s.hooks.SessionStart.push({ hooks: [{ type: 'command', command }] });
    },
    `SessionStart hook "${command}"`,
  );
}

/**
 * Make `command` the one hook for `event` whose command contains `marker`: an older
 * entry with a different command (for example a changed argument) is replaced.
 */
export function setHook(ctx, event, marker, command) {
  return ctx.updateJson(
    settingsPath(ctx),
    (s) => {
      s.hooks ??= {};
      s.hooks[event] ??= [];
      const ours = (h) => String(h.command || '').includes(marker);
      if (s.hooks[event].some((m) => (m.hooks || []).some((h) => h.command === command))) return;
      s.hooks[event] = s.hooks[event]
        .map((m) => ({ ...m, hooks: (m.hooks || []).filter((h) => !ours(h)) }))
        .filter((m) => m.hooks.length);
      s.hooks[event].push({ hooks: [{ type: 'command', command }] });
    },
    `${event} hook ${marker}`,
  );
}

export function setClaudeEnv(ctx, key, value) {
  return ctx.updateJson(
    settingsPath(ctx),
    (s) => {
      s.env ??= {};
      s.env[key] = value;
    },
    `env ${key}`,
  );
}

/** Install an agent skill for Claude Code, user-wide, with the skills CLI (github.com/vercel-labs/skills). */
export function installSkill(ctx, repo, name) {
  if (fs.existsSync(path.join(claudeDir(ctx), 'skills', name, 'SKILL.md'))) {
    ctx.ok(`skill ${name} already installed`);
    return;
  }
  ctx.run(`npx -y skills add ${repo} --skill ${name} -g -a claude-code -y`);
}
