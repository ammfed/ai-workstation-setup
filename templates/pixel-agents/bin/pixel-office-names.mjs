#!/usr/bin/env node
// pixel-office-names - give each character in the Pixel Agents office the name its agent has
// in herdr, instead of the folder it runs in.
//
// It writes ~/.pixel-agents/agent-names.json: { "<Claude session id>": "<name>" }. Pixel
// Agents reads that file only after the installer's optional office-names patch
// (PIXEL_AGENTS_NAMES); the office picks up new names within about ten seconds of a
// change, or on a page reload.
//
// A name is, in order: the agent's own name in herdr, else its tab label (without the
// prefix {{TAB_PREFIX}}, and skipping herdr's numbered default tabs), else its workspace label.
// Without herdr, write the file yourself in the same shape.
//
// Usage:
//   pixel-office-names                 sync once
//   pixel-office-names --watch [secs]  keep syncing, every 15 seconds by default
//
// Installed by ai-workstation-setup (agent-clis module). No dependencies. It never replaces
// the names file with an empty one.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAB_PREFIX = '{{TAB_PREFIX}}';
const NAMES = path.join(os.homedir(), '.pixel-agents', 'agent-names.json');

function herdr(...args) {
  const out = JSON.parse(execFileSync('herdr', args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }));
  return out.result ?? out;
}

const list = (result, key) => (Array.isArray(result) ? result : result?.[key] || []);

export function officeNames(agents, tabs, workspaces, prefix = TAB_PREFIX) {
  const tabLabel = new Map(tabs.map((t) => [t.tab_id, t.label || '']));
  const wsLabel = new Map(workspaces.map((w) => [w.workspace_id, w.label || '']));
  const names = {};
  for (const a of agents) {
    const sid = a.agent_session?.value;
    if (!sid) continue;
    let name = a.name || '';
    const tab = tabLabel.get(a.tab_id) || '';
    if (!name && tab && !/^\d+$/.test(tab)) name = prefix && tab.startsWith(prefix) ? tab.slice(prefix.length) : tab;
    if (!name) name = wsLabel.get(a.workspace_id) || '';
    if (name) names[sid] = name;
  }
  return names;
}

function syncOnce() {
  const names = officeNames(
    list(herdr('agent', 'list'), 'agents'),
    list(herdr('tab', 'list'), 'tabs'),
    list(herdr('workspace', 'list'), 'workspaces'),
  );
  const count = Object.keys(names).length;
  if (!count) return `no agent names found in herdr; ${NAMES} left unchanged`;
  const next = `${JSON.stringify(names, null, 2)}\n`;
  if (fs.existsSync(NAMES) && fs.readFileSync(NAMES, 'utf8') === next) return `${count} names, unchanged`;
  fs.mkdirSync(path.dirname(NAMES), { recursive: true });
  fs.writeFileSync(`${NAMES}.tmp`, next);
  fs.renameSync(`${NAMES}.tmp`, NAMES);
  return `${count} names written to ${NAMES}`;
}

function main() {
  const [flag, secs] = process.argv.slice(2);
  try {
    console.log(syncOnce());
  } catch (err) {
    console.error(`pixel-office-names: ${err.code === 'ENOENT' ? 'herdr is not on PATH' : err.message}`);
    if (flag !== '--watch') process.exit(1);
  }
  if (flag === '--watch') {
    const every = Math.max(5, Number(secs) || 15) * 1000;
    setInterval(() => {
      try {
        syncOnce();
      } catch (err) {
        console.error(`pixel-office-names: ${err.message}`);
      }
    }, every);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
