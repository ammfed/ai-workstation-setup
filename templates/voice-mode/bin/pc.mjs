// `voice-mode pc`: this computer's status in a few spoken-style lines, read only when the voice
// is asked (a command record source). Battery, disk, memory, how busy it is, network, the
// busiest apps and uptime, from the system's own read-only sources: /sys and /proc on Linux,
// pmset and vm_stat on macOS, plus df and ps on both. Nothing is changed and nothing is sent
// anywhere; the voice gets the printed summary when it asks for it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** stdout of a read-only command, or '' when it is missing or fails. Never through a shell. */
function read(argv, timeoutMs = 2000) {
  try {
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] });
    return r.status === 0 ? r.stdout : '';
  } catch {
    return '';
  }
}

const readFile = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

const gb = (bytes) => `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;

/** Linux batteries from /sys/class/power_supply: [{ percent, state }]. */
export function linuxBattery(root = '/sys/class/power_supply') {
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((n) => readFile(path.join(root, n, 'type')).trim() === 'Battery')
    .map((n) => ({ percent: Number(readFile(path.join(root, n, 'capacity')).trim()), state: readFile(path.join(root, n, 'status')).trim().toLowerCase() }))
    .filter((b) => Number.isFinite(b.percent));
}

/** macOS `pmset -g batt`: [{ percent, state }]. */
export function parsePmset(text) {
  const m = /(\d+)%;\s*([^;]+);/.exec(String(text));
  return m ? [{ percent: Number(m[1]), state: m[2].trim().toLowerCase() }] : [];
}

/** `df -Pk <path>`: { usedPercent, freeBytes } of the file system holding it. */
export function parseDf(text) {
  const line = String(text).trim().split('\n').slice(1).pop() || '';
  const f = line.split(/\s+/);
  if (f.length < 6) return null;
  return { usedPercent: Number(f[4].replace('%', '')), freeBytes: Number(f[3]) * 1024 };
}

/** /proc/meminfo: { total, available } in bytes. */
export function parseMeminfo(text) {
  const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(String(text))?.[1]) * 1024;
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  return Number.isFinite(total) && Number.isFinite(available) ? { total, available } : null;
}

/** macOS `vm_stat`: available bytes (free, inactive, speculative and purgeable pages). */
export function parseVmStat(text) {
  const t = String(text);
  const page = Number(/page size of (\d+) bytes/.exec(t)?.[1] || 4096);
  const pages = (k) => Number(new RegExp(`^Pages ${k}:\\s+(\\d+)`, 'm').exec(t)?.[1] || 0);
  return (pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')) * page;
}

/**
 * `ps -A -o pid=,pcpu=,pmem=,comm=` grouped by app: one entry per executable name (a browser's
 * many processes count as one), busiest first. `exeOf(pid)` names the executable where the
 * system can say (Linux /proc/<pid>/exe), since some apps name their threads "MainThread".
 */
export function topApps(text, { exeOf = () => '', limit = 3 } = {}) {
  const apps = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    // An executable named only by its version (an app that installs itself per version) keeps its process name.
    const exe = path.basename(exeOf(Number(m[1])) || '');
    const name = exe && !/^[\d.]+$/.test(exe) ? exe : path.basename(m[4]);
    // The ps that is listing them is not one of the user's apps.
    if (name === 'ps') continue;
    const a = apps.get(name) || { name, cpu: 0, mem: 0, count: 0 };
    a.cpu += Number(m[2]);
    a.mem += Number(m[3]);
    a.count += 1;
    apps.set(name, a);
  }
  return [...apps.values()].sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, limit);
}

/** `nmcli -t -f STATE,CONNECTIVITY general`: a short phrase, or '' when it says nothing. */
export function parseNmcli(text) {
  const [state, connectivity] = String(text).trim().split(':');
  if (!state) return '';
  if (connectivity === 'full') return 'connected, internet reachable';
  if (state.startsWith('connected')) return `connected, internet ${connectivity || 'unknown'}`;
  return state;
}

function linuxExe(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '');
  } catch {
    return '';
  }
}

function uptimeText(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return [d && `${d} day${d === 1 ? '' : 's'}`, h && `${h} hour${h === 1 ? '' : 's'}`, !d && `${m} minute${m === 1 ? '' : 's'}`].filter(Boolean).join(' ') || 'just started';
}

/** The facts, gathered. `sys` stands in for the system in tests. */
export function gather(sys = {}) {
  const platform = sys.platform || process.platform;
  const run = sys.run || read;
  const facts = { platform };
  facts.battery = sys.battery ?? (platform === 'darwin' ? parsePmset(run(['pmset', '-g', 'batt'])) : linuxBattery());
  facts.disk = parseDf(run(['df', '-Pk', sys.root || '/']));
  if (platform === 'linux') facts.memory = parseMeminfo(sys.meminfo ?? readFile('/proc/meminfo'));
  else facts.memory = { total: sys.totalmem ?? os.totalmem(), available: parseVmStat(run(['vm_stat'])) || (sys.freemem ?? os.freemem()) };
  facts.load = { one: (sys.loadavg ?? os.loadavg())[0], cores: sys.cores ?? os.cpus().length };
  facts.network = platform === 'linux' ? parseNmcli(run(['nmcli', '-t', '-f', 'STATE,CONNECTIVITY', 'general'])) : '';
  if (!facts.network) {
    const up = Object.values(sys.interfaces ?? os.networkInterfaces()).flat().some((i) => i && !i.internal && i.family === 'IPv4');
    facts.network = up ? 'connected' : 'not connected';
  }
  facts.apps = topApps(run(['ps', '-A', '-o', 'pid=,pcpu=,pmem=,comm=']), { exeOf: sys.exeOf || (platform === 'linux' ? linuxExe : () => '') });
  facts.uptime = sys.uptime ?? os.uptime();
  return facts;
}

/** The facts as a few plain lines the voice can say in its own words. */
export function summary(f) {
  const out = [];
  if (f.battery?.length) out.push(`Battery: ${f.battery.map((b) => `${b.percent}%, ${b.state}`).join('; ')}.`);
  else out.push('Battery: none (a desktop, or not reported).');
  if (f.disk) out.push(`Disk: ${f.disk.usedPercent}% used, ${gb(f.disk.freeBytes)} free.`);
  if (f.memory) out.push(`Memory: ${gb(f.memory.total - f.memory.available)} of ${gb(f.memory.total)} in use.`);
  if (f.load) out.push(`Busy: load ${f.load.one.toFixed(1)} on ${f.load.cores} cores (${f.load.one < f.load.cores * 0.5 ? 'not very busy' : f.load.one < f.load.cores ? 'fairly busy' : 'very busy'}).`);
  out.push(`Network: ${f.network}.`);
  if (f.apps?.length) out.push(`Busiest apps: ${f.apps.map((a) => `${a.name} (${Math.round(a.cpu)}% CPU, ${Math.round(a.mem)}% memory)`).join(', ')}.`);
  out.push(`Up for ${uptimeText(f.uptime)}.`);
  return out.join('\n');
}
