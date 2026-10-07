// Tests for Windows onboarding. The reproduction: a default run of install.ps1 on native
// Windows skipped firstmate without naming it in the summary and never offered WSL. Dry runs
// simulate Windows from Linux or macOS; on a Windows host the probes would be real, so skip.
// Run: node --test test/windows.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cloneUrl, linuxUserName, resumeCommand } from '../modules/wsl/module.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = process.platform === 'win32' && 'simulates Windows from another system';

function install(platform, ...args) {
  const r = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', platform, '--answers', path.join(repoRoot, 'answers.example.env'), ...args],
    { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, stdin: 'ignore' },
  );
  return { code: r.status, out: r.stdout + r.stderr };
}

const summaryOf = (out) => out.slice(out.indexOf('\nSummary'));
const literal = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test('a default Windows run names firstmate in the summary and says how to get it', { skip }, () => {
  const { code, out } = install('windows');
  assert.equal(code, 0, out);
  const summary = summaryOf(out);
  assert.match(summary, /Not set up on windows:\n\s+– firstmate: .*\.\\install\.ps1 --modules wsl/);
  assert.match(out, /winget install --id Anthropic\.Claude -e/, 'the Windows-only path installs the Claude desktop app');
});

test('the wsl module plans WSL, Ubuntu, a Linux user and the full setup inside it', { skip }, () => {
  const { code, out } = install('windows', '--modules', 'wsl');
  assert.equal(code, 0, out);
  const order = [
    /winget install --id Anthropic\.Claude -e/,
    /winget install --id Google\.Chrome -e/,
    /winget install --id Obsidian\.Obsidian -e/,
    /winget install --id wez\.wezterm -e/,
    literal('https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip'),
    /Start-Process wsl\.exe -ArgumentList '--install','--no-distribution' -Verb RunAs/,
    /one-time sign-in entry that runs: powershell\.exe .*install\.ps1" --modules wsl --yes/,
    /wsl\.exe --install -d Ubuntu --no-launch/,
    /wsl\.exe -u root -e bash -lc 'id -u \S+ .*adduser/,
    /wsl\.exe -u root -e bash -lc 'f=\/etc\/wsl\.conf; .*systemd=true/,
    /apt-get install -y git curl/,
    literal('git clone https://github.com/ammfed/ai-workstation-setup ~/ai-workstation-setup'),
    /wsl\.exe -u root -e bash -lc '.*NOPASSWD:ALL.*\/etc\/sudoers\.d\/ai-workstation-setup-install/,
    /wsl\.exe -e bash -lc 'cd ~\/ai-workstation-setup && \.\/install\.sh --yes'/,
    /wsl\.exe -u root -e bash -lc 'rm -f \/etc\/sudoers\.d\/ai-workstation-setup-install'/,
    /\.wezterm\.lua/,
  ];
  let at = 0;
  for (const re of order) {
    const m = out.slice(at).match(re);
    assert.ok(m, `missing, or out of order: ${re}\n${out}`);
    at += m.index + m[0].length;
  }
  assert.doesNotMatch(summaryOf(out), /Not set up on windows/, 'firstmate is set up inside WSL, so nothing is missed');
});

test('without a terminal (an AI assistant), no step waits for a password', { skip }, () => {
  // These dry runs have no terminal, like an assistant's shell: the user is created without a
  // password and the person sets it later; sudo inside Linux needs none while the setup runs.
  const { code, out } = install('windows', '--modules', 'wsl');
  assert.equal(code, 0, out);
  assert.match(out, /adduser --disabled-password --gecos/);
  assert.match(out, /to do: choose your Linux password: wsl\.exe -u root passwd \S+/);
  assert.doesNotMatch(out, /sudo -v/);
});

test('the wsl module installs only the Windows apps chosen, and none for "none"', { skip }, () => {
  const answers = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-apps-')), 'answers.env');
  fs.writeFileSync(answers, 'WSL_WINDOWS_APPS=none\n');
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', 'windows', '--answers', answers, '--modules', 'wsl'], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /winget install|JetBrainsMono\.zip|\.wezterm\.lua/);
  assert.match(r.stdout, /wsl\.exe --install -d Ubuntu/);
});

test('inside WSL, terminal is a Windows-side module and the summary names the Windows pieces', { skip }, () => {
  const { code, out } = install('wsl', '--modules', 'terminal,claude-code,second-brain');
  assert.equal(code, 0, out);
  assert.match(out, /terminal: WezTerm and its font are Windows apps/);
  const summary = summaryOf(out);
  assert.match(summary, /On the Windows side .*\n\s+– claude-code: .*Claude desktop app/);
  assert.match(summary, /– second-brain: .*\\\\wsl\.localhost/);
});

test('inside WSL, core checks PATH, switches on systemd, and opens links in Windows', { skip }, () => {
  const { code, out } = install('wsl', '--modules', 'core');
  assert.equal(code, 0, out);
  assert.match(out, /sudo -n sh -c 'f=\/etc\/wsl\.conf;/);
  assert.match(out, /wsl\.exe --shutdown/);
  assert.match(out, /would write .*\.local\/bin\/open-in-windows/);
  assert.match(out, /would set BROWSER/);
  assert.match(out, /gh auth login && gh auth setup-git/);
});

test('the wsl module is only offered on Windows', { skip }, () => {
  for (const os of ['linux', 'macos', 'wsl']) {
    const { code, out } = install(os, '--modules', 'wsl');
    assert.equal(code, 0, out);
    assert.match(summaryOf(out), /wsl\s+unsupported/, os);
  }
});

test('install.ps1 asks one question only when nothing else says what to do', () => {
  const ps1 = fs.readFileSync(path.join(repoRoot, 'install.ps1'), 'utf8');
  assert.match(ps1, /\[Console\]::IsInputRedirected[\s\S]*--modules wsl --yes[\s\S]*exit 2/, 'with no terminal it names the unattended commands instead of waiting for an answer');
  assert.match(ps1, /'\^\(1\|\)\$' \{ \$forward = @\('--modules', 'wsl'\) \+ \$argv; \$assumeYes = \$true/, 'the recommended choice (and Enter) runs the wsl module, which asks only which Windows apps to add');
  assert.match(ps1, /'\^2\$' \{ \$forward = @\('--yes'\) \+ \$argv/, 'Windows only runs with defaults');
  assert.match(ps1, /@forward/);
  for (const flag of ['--yes', '--modules', '--answers', '--list', '--help']) assert.ok(ps1.includes(`'${flag}'`), `${flag} skips the question`);
});

test('helpers: Linux user name, resume command length, clone URL', () => {
  assert.equal(linuxUserName('Jane.Doe'), 'janedoe');
  assert.equal(linuxUserName('1st User'), 'stuser');
  assert.equal(linuxUserName('日本'), 'user');
  assert.match(resumeCommand('C:\\Users\\me\\ai-workstation-setup'), /^powershell\.exe .* --modules wsl --yes$/);
  assert.equal(resumeCommand(`C:\\${'x'.repeat(260)}`), null, 'Windows ignores a sign-in entry over 260 characters');
  assert.equal(cloneUrl('https://github.com/someone/ai-workstation-setup.git'), 'https://github.com/someone/ai-workstation-setup.git');
  assert.equal(cloneUrl(null), 'https://github.com/ammfed/ai-workstation-setup');
  assert.equal(cloneUrl('C:\\local\\copy'), 'https://github.com/ammfed/ai-workstation-setup');
});
