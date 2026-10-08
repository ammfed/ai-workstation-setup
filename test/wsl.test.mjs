// Tests for the Windows and WSL split: how the installer knows it runs inside WSL, the checks it
// makes there (clone location, Windows tools on PATH, systemd, memory, virtualization), and the
// per-module decision of what runs inside WSL and what runs on the Windows side, which
// docs/windows-wsl.md must state the same way. Invented paths and values only.
// Run: node --test test/wsl.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SIDES,
  TEMP_SUDOERS,
  bootCleanupScript,
  leftoverSudoCleanup,
  WSL_SIDES,
  cloneLocationProblem,
  detectWsl,
  isWindowsMount,
  memoryHint,
  systemdOn,
  systemdOnScript,
  virtualizationProblem,
  windowsLeaks,
  windowsPathOf,
} from '../lib/wsl.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WSL1 = 'Linux version 4.4.0-19041-Microsoft (gcc version 5.4.0 (GCC) ) #1237-Microsoft';
const WSL2 = 'Linux version 6.6.87.2-microsoft-standard-WSL2 (root@host) (gcc (GCC) 11.2.0) #1 SMP PREEMPT_DYNAMIC';
const PLAIN = 'Linux version 6.8.0-45-generic (buildd@lcy02-amd64-075) (x86_64-linux-gnu-gcc-13) #45-Ubuntu SMP';

async function modules() {
  const dir = path.join(repoRoot, 'modules');
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, 'module.mjs');
    if (fs.existsSync(file)) out[name] = (await import(pathToFileURL(file).href)).default;
  }
  return out;
}

test('WSL is detected from WSL_DISTRO_NAME or /proc/version, with its version', () => {
  assert.deepEqual(detectWsl({ env: {}, procVersion: PLAIN }), { wsl: false, version: null });
  assert.deepEqual(detectWsl({ env: {}, procVersion: WSL2 }), { wsl: true, version: 2 });
  assert.deepEqual(detectWsl({ env: {}, procVersion: WSL1 }), { wsl: true, version: 1 });
  assert.deepEqual(detectWsl({ env: { WSL_DISTRO_NAME: 'Ubuntu' }, procVersion: WSL2 }), { wsl: true, version: 2 });
  assert.deepEqual(detectWsl({ env: { WSL_DISTRO_NAME: 'Ubuntu' }, procVersion: null }), { wsl: true, version: null });
  assert.deepEqual(detectWsl({ env: {}, procVersion: null }), { wsl: false, version: null });
});

test('a clone on a Windows drive is refused with the way out; a Linux clone passes', () => {
  assert.equal(isWindowsMount('/mnt/c/Users/someone/ai-workstation-setup'), true);
  assert.equal(isWindowsMount('/mnt/d'), true);
  assert.equal(isWindowsMount('/mnt/wslg/runtime-dir'), false, 'WSLg sockets are Linux, not a Windows drive');
  assert.equal(isWindowsMount('/srv/work/mnt/c'), false);
  assert.equal(cloneLocationProblem('/srv/work/ai-workstation-setup'), null);
  const why = cloneLocationProblem('/mnt/c/Users/someone/ai-workstation-setup');
  assert.match(why, /Windows drive/);
  assert.match(why, /git clone .* ~\/ai-workstation-setup/);
});

test('Windows programs found on PATH inside WSL are named, Linux ones are not', () => {
  const found = {
    node: '/mnt/c/Program Files/nodejs/node.exe',
    npm: '/mnt/c/Program Files/nodejs/npm',
    git: '/usr/bin/git',
    code: '/mnt/c/Users/someone/AppData/Local/Programs/Microsoft VS Code/bin/code',
    claude: null,
  };
  assert.deepEqual(windowsLeaks(found).map((l) => l.tool), ['node', 'npm']);
  assert.deepEqual(windowsLeaks({ git: '/usr/bin/git', node: '/usr/local/bin/node' }), []);
});

test('systemd counts as on only with systemd=true under [boot]', () => {
  assert.equal(systemdOn('[boot]\nsystemd=true\n'), true);
  assert.equal(systemdOn('[boot]\nsystemd = true\n[user]\ndefault=someone\n'), true);
  assert.equal(systemdOn('[boot]\nsystemd=false\n'), false);
  assert.equal(systemdOn('[user]\ndefault=someone\nsystemd=true\n'), false, 'the key belongs to [boot] only');
  assert.equal(systemdOn(''), false);
});

// The script runs inside Ubuntu only, so it is tested where GNU sed is (not macOS's BSD sed).
test('the systemd script turns it on in every starting state and keeps other settings', { skip: process.platform !== 'linux' && 'needs GNU sed, as in Ubuntu' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-conf-'));
  const cases = {
    missing: null,
    empty: '',
    'user only': '[user]\ndefault=someone\n',
    'boot without systemd': '[boot]\ncommand=service cron start\n',
    'systemd off': '[boot]\nsystemd=false\n[user]\ndefault=someone\n',
    'already on': '[boot]\nsystemd=true\n',
  };
  for (const [name, text] of Object.entries(cases)) {
    const file = path.join(dir, `${name.replace(/ /g, '-')}.conf`);
    if (text !== null) fs.writeFileSync(file, text);
    const r = spawnSync('sh', ['-c', systemdOnScript(file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    const after = fs.readFileSync(file, 'utf8');
    assert.equal(systemdOn(after), true, `${name}:\n${after}`);
    assert.equal((after.match(/systemd\s*=/g) || []).length, 1, `${name}: one systemd line:\n${after}`);
    if (text?.includes('default=someone')) assert.match(after, /\[user\]\ndefault=someone/, name);
    if (text?.includes('command=')) assert.match(after, /command=service cron start/, name);
    // Run twice: nothing changes the second time.
    spawnSync('sh', ['-c', systemdOnScript(file)]);
    assert.equal(fs.readFileSync(file, 'utf8'), after, `${name}: idempotent`);
  }
  assert.doesNotMatch(systemdOnScript('/etc/wsl.conf'), /"/, 'no double quotes, so Windows PowerShell 5.1 hands it to wsl.exe intact');
});

test('a Linux path becomes the path Windows apps open', () => {
  assert.equal(windowsPathOf('/srv/work/second-brain', 'Ubuntu'), '\\\\wsl.localhost\\Ubuntu\\srv\\work\\second-brain');
  assert.equal(windowsPathOf('/mnt/c/Users/someone/vault', 'Ubuntu'), 'C:\\Users\\someone\\vault');
  assert.equal(windowsPathOf('/mnt/d', 'Ubuntu'), 'D:\\');
});

test('virtualization: a running hypervisor passes, firmware switched off stops with the BIOS step', () => {
  assert.equal(virtualizationProblem({ hypervisorPresent: true, firmwareEnabled: false }), null, 'Hyper-V hides the firmware flag once it runs');
  assert.equal(virtualizationProblem({ hypervisorPresent: false, firmwareEnabled: true }), null);
  assert.equal(virtualizationProblem({ hypervisorPresent: null, firmwareEnabled: null }), null, 'unknown is not a reason to stop');
  assert.match(virtualizationProblem({ hypervisorPresent: false, firmwareEnabled: false }), /BIOS|UEFI/);
});

test('memory: a small WSL VM gets the .wslconfig hint, a normal one does not', () => {
  assert.equal(memoryHint(16 * 1024 * 1024), null);
  assert.match(memoryHint(3 * 1024 * 1024), /\.wslconfig.*memory=/);
  assert.equal(memoryHint(null), null);
});

test('every module has a WSL decision that agrees with the platforms it declares', async () => {
  const all = await modules();
  assert.deepEqual(Object.keys(WSL_SIDES).sort(), Object.keys(all).sort(), 'one decision per module, no strays');
  for (const [name, { side, note }] of Object.entries(WSL_SIDES)) {
    const m = all[name];
    assert.ok(SIDES.includes(side), `${name}: side ${side}`);
    assert.ok(note && note.length > 10, `${name}: a note says why`);
    const inWsl = m.platforms.includes('wsl');
    if (side === 'linux' || side === 'both') assert.ok(inWsl, `${name} runs inside WSL, so it must list wsl`);
    if (side === 'windows' || side === 'skip') {
      assert.ok(!inWsl, `${name} does not run inside WSL, so it must not list wsl`);
      assert.ok(m.unsupported?.wsl, `${name}: the reason printed inside WSL`);
    }
    if (side === 'windows' || side === 'both') assert.ok(m.platforms.includes('windows') || name === 'wsl', `${name} has a Windows side`);
  }
});

test('docs/windows-wsl.md states the same decision for every module', () => {
  const doc = fs.readFileSync(path.join(repoRoot, 'docs', 'windows-wsl.md'), 'utf8');
  const label = { linux: 'inside WSL', windows: 'Windows side', both: 'both, with a bridge', skip: 'not under WSL' };
  for (const [name, { side }] of Object.entries(WSL_SIDES)) {
    const row = doc.split('\n').find((l) => l.startsWith(`| \`${name}\` |`));
    assert.ok(row, `docs/windows-wsl.md has a row for ${name}`);
    assert.ok(row.split('|')[2].trim() === label[side], `${name}: docs say "${row.split('|')[2].trim()}", the code says "${label[side]}"`);
  }
  assert.match(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8'), /docs\/windows-wsl\.md/, 'README links the map');
});

// A run cut off (crash, restart, killed) must not leave the temporary NOPASSWD rule behind.
test('the next Ubuntu start removes the temporary sudo rule, keeping any boot command', { skip: process.platform !== 'linux' && 'needs GNU sed, as in Ubuntu' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-boot-'));
  const rm = `rm -f ${TEMP_SUDOERS}`;
  const cases = {
    missing: null,
    'systemd only': '[boot]\nsystemd=true\n',
    'cron command': '[boot]\nsystemd=true\ncommand=service cron start\n[user]\ndefault=someone\n',
    'no boot section': '[user]\ndefault=someone\n',
  };
  for (const [name, text] of Object.entries(cases)) {
    const file = path.join(dir, `${name.replace(/ /g, '-')}.conf`);
    if (text !== null) fs.writeFileSync(file, text);
    const r = spawnSync('sh', ['-c', bootCleanupScript(file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    const after = fs.readFileSync(file, 'utf8');
    const commands = after.split('\n').filter((l) => /^\s*command\s*=/.test(l));
    assert.equal(commands.length, 1, `${name}: one boot command:\n${after}`);
    assert.ok(commands[0].includes(rm), `${name}: the boot command removes the rule:\n${after}`);
    assert.match(after, /\[boot\][^[]*command=/, `${name}: under [boot]`);
    if (text?.includes('service cron start')) assert.match(commands[0], /^command=service cron start; rm -f /, `${name}: the existing command is kept`);
    if (text?.includes('systemd=true')) assert.match(after, /systemd=true/, name);
    if (text?.includes('default=someone')) assert.match(after, /\[user\]\ndefault=someone/, name);
    spawnSync('sh', ['-c', bootCleanupScript(file)]);
    assert.equal(fs.readFileSync(file, 'utf8'), after, `${name}: idempotent`);
    // The boot command really removes the file: run it as WSL would, through sh.
    const fake = path.join(dir, 'rule');
    fs.writeFileSync(fake, 'x');
    // An earlier boot command that fails must not stop the removal ("service cron start" -> false).
    spawnSync('sh', ['-c', commands[0].replace(/^\s*command\s*=/, '').replace('service cron start', 'false').split(TEMP_SUDOERS).join(fake)]);
    assert.equal(fs.existsSync(fake), false, `${name}: the command removes the file`);
  }
  assert.doesNotMatch(bootCleanupScript('/etc/wsl.conf'), /"/, 'no double quotes, so Windows PowerShell 5.1 hands it to wsl.exe intact');
});

test('a run inside WSL removes a leftover rule first, but not the one its own setup run holds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-sudoers-'));
  const file = path.join(dir, 'ai-workstation-setup-install');
  assert.equal(leftoverSudoCleanup({ file, env: {} }), null, 'nothing to remove');
  fs.writeFileSync(file, 'someone ALL=(ALL) NOPASSWD:ALL\n');
  assert.equal(leftoverSudoCleanup({ file, env: {} }), `sudo -n rm -f ${file}`);
  assert.equal(leftoverSudoCleanup({ file, env: { AI_WORKSTATION_SETUP_TEMP_SUDO: '1' } }), null, 'the Windows-driven run holds it on purpose');
  assert.equal(TEMP_SUDOERS, '/etc/sudoers.d/ai-workstation-setup-install');
});
