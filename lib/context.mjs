// The object every module receives. It owns platform detection, prompting,
// command execution, dry-run, and safe config edits, so a module only says
// WHAT it wants and never re-implements HOW (or how to not do it in --dry-run).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const paint = (code) => (s) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { dim: paint(2), bold: paint(1), green: paint(32), yellow: paint(33), red: paint(31), cyan: paint(36) };

export const OSES = ['linux', 'macos', 'wsl', 'windows'];
const TAG = 'ai-workstation-setup';
const CHECK_TIMEOUT_MS = 60_000;

/** Thrown to skip a step or module with a printed reason (not a failure). */
export class Skip extends Error {}

// ---------------------------------------------------------------- platform

function hostOs() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  if (process.env.WSL_DISTRO_NAME) return 'wsl';
  try {
    if (/microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'))) return 'wsl';
  } catch {
    // not Linux-like; fall through
  }
  return 'linux';
}

export function which(bin) {
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.PS1').split(';')] : [''];
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

const PKG_BY_OS = {
  windows: ['winget', 'scoop', 'choco'],
  macos: ['brew'],
  linux: ['apt-get', 'dnf', 'pacman', 'zypper', 'apk', 'brew'],
};

export function detectPlatform(override) {
  const host = hostOs();
  const name = override || host;
  if (!OSES.includes(name)) throw new Error(`unknown platform "${name}" (expected one of ${OSES.join(', ')})`);
  const simulated = name !== host;
  const candidates = PKG_BY_OS[name === 'wsl' ? 'linux' : name];
  const pkg = simulated ? candidates[0] : candidates.find((p) => which(p)) || null;
  return {
    os: name,
    host,
    simulated,
    arch: process.arch,
    pkg: pkg === 'apt-get' ? 'apt' : pkg,
    shell: name === 'windows' ? 'powershell' : path.basename(process.env.SHELL || 'sh'),
    home: os.homedir(),
    isRoot: typeof process.getuid === 'function' && process.getuid() === 0,
  };
}

// ---------------------------------------------------------------- answers

export function parseAnswersFile(file) {
  const out = new Map();
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) throw new Error(`${file}: cannot parse line "${line}" (expected KEY=value)`);
    out.set(m[1], m[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return out;
}

function expandHome(p) {
  return typeof p === 'string' && (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) ? path.join(os.homedir(), p.slice(1)) : p;
}

// ---------------------------------------------------------------- context

export class Context {
  constructor({ platform, dryRun, interactive, answers, prompter, repoRoot }) {
    Object.assign(this, { platform, dryRun, interactive, answers, prompter, repoRoot });
    this.values = {};
    this.secrets = {};
    this.backedUp = new Set();
    this.aptUpdated = false;
    this.record = null;
  }

  get os() {
    return this.platform.os;
  }

  get home() {
    return this.platform.home;
  }

  /** Pick a value for this OS: exact os, then linux for wsl, then unix, then default. */
  forOs(map) {
    if (!map) return undefined;
    const { os: name } = this.platform;
    if (name in map) return map[name];
    if (name === 'wsl' && 'linux' in map) return map.linux;
    if (name !== 'windows' && 'unix' in map) return map.unix;
    return map.default;
  }

  // ------------------------------------------------------------ logging

  beginModule(name) {
    this.record = { name, failures: [], skips: [], warnings: [], todos: [] };
    return this.record;
  }
  info(msg) {
    console.log(`  ${c.dim('•')} ${msg}`);
  }
  ok(msg) {
    console.log(`  ${c.green('✓')} ${msg}`);
  }
  warn(msg) {
    console.log(`  ${c.yellow('!')} ${msg}`);
    this.record?.warnings.push(msg);
  }
  skip(msg) {
    console.log(`  ${c.yellow('–')} skipped: ${msg}`);
    this.record?.skips.push(msg);
  }
  /** Something the user must do by hand afterwards; repeated in the final summary. */
  todo(msg) {
    console.log(`  ${c.cyan('→')} to do: ${msg}`);
    this.record?.todos.push(msg);
  }
  fail(msg) {
    console.log(`  ${c.red('✗')} ${msg}`);
    this.record?.failures.push(msg);
  }

  /** Run one unit of work; a failure is recorded and the module continues. */
  async step(label, fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Skip) this.skip(`${label}: ${err.message}`);
      else this.fail(`${label}: ${err.message}`);
      return undefined;
    }
  }

  // ------------------------------------------------------------ questions

  async ask(q) {
    if (q.type === 'secret') return this.askSecret(q);
    let v = this.answers.get(q.key);
    if (v === undefined) {
      const def = typeof q.default === 'function' ? q.default(this) : q.default;
      v = this.interactive ? await this.prompter.ask(q, def) : def;
    }
    v = this.normalize(q, v);
    this.values[q.key] = v;
    return v;
  }

  normalize(q, v) {
    switch (q.type) {
      case 'confirm':
        if (typeof v === 'boolean') return v;
        if (/^(y|yes|true|1)$/i.test(String(v))) return true;
        if (/^(n|no|false|0|)$/i.test(String(v ?? ''))) return false;
        throw new Error(`${q.key}: expected yes or no, got "${v}"`);
      case 'multi': {
        const list = Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (list.length === 1 && list[0] === 'none') return [];
        const allowed = q.choices.map((ch) => ch.value);
        const bad = list.filter((x) => !allowed.includes(x));
        if (bad.length) throw new Error(`${q.key}: unknown option(s) ${bad.join(', ')} (allowed: ${allowed.join(', ')})`);
        return list;
      }
      case 'choice':
        if (!q.choices.some((ch) => ch.value === v)) {
          throw new Error(`${q.key}: "${v}" is not one of ${q.choices.map((ch) => ch.value).join(', ')}`);
        }
        return v;
      default: {
        if (!q.path) return String(v ?? '');
        const p = expandHome(String(v ?? ''));
        // Your data never lives in the clone: updates would collide with it, and it could be committed.
        const rel = p && path.relative(this.repoRoot, path.resolve(p));
        if (p && (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)))) {
          throw new Error(`${q.key}: ${p} is inside this clone; choose a folder outside it`);
        }
        return p;
      }
    }
  }

  /** Secrets come from the environment or a hidden prompt; never from, or into, an answers file. */
  async askSecret(q) {
    const envName = q.env || q.key;
    let v = process.env[envName] || '';
    if (!v && this.interactive) v = await this.prompter.secret(q.message);
    this.secrets[q.key] = v;
    return v;
  }

  get(key) {
    return key in this.secrets ? this.secrets[key] : this.values[key];
  }

  async confirm(message, def = true) {
    if (!this.interactive) return def;
    return this.prompter.confirm(message, def);
  }

  // ------------------------------------------------------------ commands

  has(bin) {
    if (this.platform.simulated) return false;
    return Boolean(which(bin));
  }

  shellFor(cmd) {
    if (this.platform.host === 'windows') return ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd]];
    return [which('bash') ? 'bash' : 'sh', ['-c', cmd]];
  }

  /** Read-only probe: runs even in --dry-run. Returns trimmed stdout, or null on failure. */
  capture(cmd) {
    if (this.platform.simulated) return null;
    const [bin, args] = this.shellFor(cmd);
    const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return r.status === 0 ? r.stdout.trim() : null;
  }

  /**
   * Run a command that changes the machine. Prints instead of running in --dry-run.
   * `redact` lists secret substrings that must never be printed.
   */
  run(cmd, { env, input, redact = [] } = {}) {
    const shown = redact.filter(Boolean).reduce((s, r) => s.split(r).join('***'), cmd);
    if (this.dryRun) {
      console.log(`  ${c.cyan('~')} would run: ${shown}`);
      return;
    }
    console.log(`  ${c.dim('$')} ${shown}`);
    this.prompter?.release();
    const [bin, args] = this.shellFor(cmd);
    const r = spawnSync(bin, args, {
      stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
      input,
      env: { ...process.env, ...env },
    });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`command failed (exit ${r.status}): ${cmd}`);
    if (this.platform.host === 'windows') this.refreshPath();
  }

  sudo() {
    if (this.os === 'windows' || this.os === 'macos' || this.platform.isRoot) return '';
    if (!this.platform.simulated && !which('sudo')) return '';
    return this.interactive ? 'sudo ' : 'sudo -n ';
  }

  /** Install with the detected package manager. `names` maps manager -> package spec. */
  pkgInstall(names) {
    const pm = this.platform.pkg;
    if (!pm) throw new Skip(`no supported package manager found (looked for ${PKG_BY_OS[this.os === 'wsl' ? 'linux' : this.os].join(', ')})`);
    const spec = names[pm];
    if (!spec) throw new Skip(`no package known for ${pm}; install it manually`);
    const s = this.sudo();
    switch (pm) {
      case 'apt':
        if (!this.aptUpdated) {
          this.run(`${s}apt-get update`);
          this.aptUpdated = true;
        }
        return this.run(`${s}env DEBIAN_FRONTEND=noninteractive apt-get install -y ${spec}`);
      case 'dnf':
        return this.run(`${s}dnf install -y ${spec}`);
      case 'pacman':
        return this.run(`${s}pacman -S --needed --noconfirm ${spec}`);
      case 'zypper':
        return this.run(`${s}zypper --non-interactive install ${spec}`);
      case 'apk':
        return this.run(`${s}apk add ${spec}`);
      case 'brew':
        return this.run(`brew install ${spec}`);
      case 'winget':
        return this.run(`winget install --id ${spec} -e --accept-source-agreements --accept-package-agreements`);
      case 'scoop':
        return this.run(`scoop install ${spec}`);
      case 'choco':
        return this.run(`choco install -y ${spec}`);
      default:
        throw new Skip(`package manager ${pm} is not supported`);
    }
  }

  npmGlobal(pkg) {
    if (!this.dryRun && this.os !== 'windows') {
      const prefix = this.capture('npm prefix -g');
      if (prefix) {
        try {
          fs.accessSync(prefix, fs.constants.W_OK);
        } catch {
          throw new Error(
            `npm's global prefix ${prefix} is not writable. Use a per-user Node (the core module installs one with nvm) ` +
              `or run: npm config set prefix ~/.npm-global (and add ~/.npm-global/bin to PATH)`,
          );
        }
      }
    }
    this.run(`npm install -g ${pkg}`);
  }

  /**
   * Make sure a CLI exists. spec.install maps os -> shell string | { pkg } | { npm } | function.
   * spec.unsupported maps os -> reason, printed when that OS has no install route.
   */
  async ensureTool(spec) {
    const bin = spec.bin || spec.name;
    if (this.has(bin)) {
      this.ok(`${spec.name} already installed`);
      this.checkTool(spec);
      return 'present';
    }
    const how = this.forOs(spec.install);
    if (!how) {
      throw new Skip(this.forOs(spec.unsupported) || `no install route for ${spec.name} on ${this.os}`);
    }
    if (typeof how === 'function') await how(this);
    else if (typeof how === 'string') this.run(how);
    else if (how.pkg) this.pkgInstall(how.pkg);
    else if (how.npm) this.npmGlobal(how.npm);
    if (this.dryRun) {
      this.checkTool(spec);
      return 'installed';
    }
    for (const dir of spec.pathHints || []) this.addToProcessPath(dir);
    if (which(bin)) {
      this.ok(`${spec.name} installed`);
      this.checkTool(spec);
    } else this.warn(`${spec.name} was installed but \`${bin}\` is not on PATH yet; open a new terminal`);
    return 'installed';
  }

  /**
   * Prove a tool works, not only that it is on PATH. `spec.check` is a harmless command of
   * the tool's own: `cmd` runs with `{tmp}` replaced by a fresh temporary folder (holding
   * `files`, removed afterwards), and it must exit 0 with stdout matching `expect`. It runs every time,
   * so a re-run is also a health check of each installed tool; --dry-run only names it.
   * A check is a third-party command, so it is killed after `timeoutMs` (default 60s) and
   * a check that never returns fails its step instead of wedging the install.
   */
  checkTool({ name, check }) {
    if (!check) return;
    if (this.dryRun) {
      this.info(`would check ${name}: ${check.about}`);
      return;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${TAG}-check-`));
    try {
      for (const [file, text] of Object.entries(check.files || {})) fs.writeFileSync(path.join(tmp, file), text);
      const timeout = check.timeoutMs ?? CHECK_TIMEOUT_MS;
      const [bin, args] = this.shellFor(check.cmd.split('{tmp}').join(tmp));
      const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, killSignal: 'SIGKILL' });
      if (r.error?.code === 'ETIMEDOUT') {
        throw new Error(`installed, but its check timed out after ${timeout / 1000}s (${check.about}): ${check.cmd}`);
      }
      const out = r.status === 0 ? r.stdout.trim() : null;
      if (out === null || !check.expect.test(out)) throw new Error(`installed, but its check failed (${check.about}): ${check.cmd}`);
      this.ok(`${name} works: ${check.about}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  addToProcessPath(dir) {
    const d = expandHome(dir);
    const parts = (process.env.PATH || '').split(path.delimiter);
    if (!parts.includes(d)) process.env.PATH = [d, ...parts].join(path.delimiter);
  }

  refreshPath() {
    const [bin, args] = this.shellFor(
      "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
    );
    const r = spawnSync(bin, args, { encoding: 'utf8' });
    if (r.status !== 0) return;
    const merged = new Set([...(process.env.Path || process.env.PATH || '').split(';'), ...r.stdout.trim().split(';')]);
    process.env.Path = [...merged].filter(Boolean).join(';');
  }

  // ------------------------------------------------------------ files

  path(...parts) {
    return path.join(...parts.map(expandHome));
  }

  template(rel, vars = {}) {
    const text = fs.readFileSync(path.join(this.repoRoot, 'templates', rel), 'utf8');
    return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  backup(file) {
    if (this.backedUp.has(file) || !fs.existsSync(file)) return;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    fs.copyFileSync(file, `${file}.bak-${stamp}`);
    this.backedUp.add(file);
    this.info(`backed up ${file} -> ${path.basename(file)}.bak-${stamp}`);
  }

  /**
   * Write a file. An identical file is left alone. A different existing file is
   * never silently replaced: `onConflict: 'keep'` leaves it, 'ask' asks (default
   * keep) and backs it up before replacing.
   */
  async writeFile(file, content, { onConflict = 'keep', mode } = {}) {
    const target = expandHome(file);
    if (fs.existsSync(target)) {
      if (fs.readFileSync(target, 'utf8') === content) {
        this.ok(`${target} is already up to date`);
        return false;
      }
      const replace = onConflict === 'ask' && (await this.confirm(`${target} exists and differs. Replace it (a backup is kept)?`, false));
      if (!replace) {
        this.skip(`${target} exists with different content; left untouched`);
        return false;
      }
    }
    if (this.dryRun) {
      console.log(`  ${c.cyan('~')} would write ${target}`);
      return true;
    }
    this.backup(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, mode ? { mode } : undefined);
    this.ok(`wrote ${target}`);
    return true;
  }

  mkdir(dir) {
    const target = expandHome(dir);
    if (fs.existsSync(target)) return false;
    if (this.dryRun) console.log(`  ${c.cyan('~')} would create ${target}/`);
    else fs.mkdirSync(target, { recursive: true });
    return true;
  }

  /** Edit a JSON file through a mutator. Refuses to touch a file it cannot parse. */
  updateJson(file, mutate, label = file) {
    const target = expandHome(file);
    let data = {};
    if (fs.existsSync(target)) {
      try {
        data = JSON.parse(fs.readFileSync(target, 'utf8'));
      } catch (err) {
        throw new Error(`${target} is not valid JSON (${err.message}); fix it by hand, it was not changed`);
      }
    }
    const before = JSON.stringify(data);
    mutate(data);
    if (JSON.stringify(data) === before) {
      this.ok(`${label}: already configured`);
      return false;
    }
    if (this.dryRun) {
      console.log(`  ${c.cyan('~')} would update ${target} (${label})`);
      return true;
    }
    this.backup(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
    this.ok(`updated ${target} (${label})`);
    return true;
  }

  /** Persist an environment variable for future shells. */
  async setUserEnv(key, value) {
    process.env[key] = value;
    if (this.os === 'windows') {
      const current = this.capture(`[Environment]::GetEnvironmentVariable('${key}','User')`);
      if (current === value) return this.ok(`${key} already set for your user`);
      return this.run(`[Environment]::SetEnvironmentVariable('${key}', '${value.replace(/'/g, "''")}', 'User')`);
    }
    const fish = this.platform.shell === 'fish';
    const profile = fish
      ? path.join(this.home, '.config', 'fish', 'conf.d', `${TAG}.fish`)
      : path.join(this.home, { zsh: '.zshrc', bash: this.os === 'macos' ? '.bash_profile' : '.bashrc' }[this.platform.shell] || '.profile');
    const quoted = `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
    const line = fish ? `set -gx ${key} ${quoted}  # ${TAG}` : `export ${key}=${quoted}  # ${TAG}`;
    const text = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';
    const lines = text.split('\n');
    const pattern = fish ? new RegExp(`^\\s*set\\s+-gx\\s+${key}\\s`) : new RegExp(`^\\s*export\\s+${key}=`);
    const idx = lines.findIndex((l) => pattern.test(l));
    if (idx >= 0 && lines[idx] === line) return this.ok(`${key} already exported in ${profile}`);
    if (idx >= 0 && !lines[idx].includes(`# ${TAG}`)) {
      return this.warn(`${key} is already set in ${profile} by you; left untouched (wanted ${value})`);
    }
    if (this.dryRun) return console.log(`  ${c.cyan('~')} would set ${key} in ${profile}`);
    this.backup(profile);
    if (idx >= 0) lines[idx] = line;
    else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, line);
    fs.mkdirSync(path.dirname(profile), { recursive: true });
    fs.writeFileSync(profile, `${lines.join('\n').replace(/\n*$/, '')}\n`);
    this.ok(`set ${key} in ${profile} (new shells pick it up)`);
  }
}
