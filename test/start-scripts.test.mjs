// Tests for the start scripts: Node.js is installed without a question when it is missing,
// with the design's two lines at a terminal and the technical line under --yes or without one.
// install.ps1 keeps its one question (Linux inside Windows stays the default).
// Run: node --test test/start-scripts.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installSh = path.join(repoRoot, 'install.sh');
const READY = [
  '  Getting ready: installing Node.js, a small helper this setup runs on.',
  '  It is for your user only and takes a minute or two.',
];

const which = (name) => {
  const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const posix = process.platform !== 'win32' && which('bash');
const pty = process.platform === 'linux' && which('script');

// A PATH with only what install.sh needs before it would install Node.js, and no node, so the
// missing-Node.js branch runs whatever this machine has; a throwaway HOME has no nvm either.
function noNode() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiws-start-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const tool of ['bash', 'dirname', 'grep', 'mktemp', 'tail', 'rm']) {
    const real = which(tool);
    if (real) fs.symlinkSync(real, path.join(bin, tool));
  }
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  return { PATH: bin, HOME: home, NVM_DIR: path.join(home, '.nvm'), LANG: 'C' };
}

test('install.sh asks nothing about Node.js', () => {
  const sh = fs.readFileSync(installSh, 'utf8');
  assert.doesNotMatch(sh, /\bread\b/, 'no read: the start script asks no question');
  assert.doesNotMatch(sh, /\[Y\/n\]/);
  for (const line of READY) assert.ok(sh.includes(`echo "${line}"`), line);
});

test('install.ps1 installs Node.js without asking and keeps its one setup question', () => {
  const ps1 = fs.readFileSync(path.join(repoRoot, 'install.ps1'), 'utf8');
  assert.doesNotMatch(ps1, /\[Y\/n\]/);
  assert.equal((ps1.match(/Read-Host/g) || []).length, 1, 'only "How should this machine be set up?" is asked');
  assert.ok(ps1.includes("Write-Host '  Getting ready: installing Node.js, a small helper this setup runs on.'"));
  assert.match(ps1, /'\^\(1\|\)\$' \{ \$forward = @\('--modules', 'wsl'\)/, 'Enter still means Linux inside Windows (call 4 B)');
});

test('without a terminal, a dry run names the Node.js install and asks nothing', { skip: !posix }, () => {
  for (const args of [['--dry-run'], ['--dry-run', '--yes']]) {
    const r = spawnSync('bash', [installSh, ...args], { env: noNode(), encoding: 'utf8', input: '' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /The installer needs Node\.js 20\+ \(found: none\)\./);
    assert.match(r.stdout, /~ would run: curl -o- https:\/\/raw\.githubusercontent\.com\/nvm-sh\/nvm\/v[\d.]+\/install\.sh \| bash && nvm install 24/);
    assert.doesNotMatch(r.stdout, /Getting ready|\[Y\/n\]/);
  }
});

test('without a terminal and without --yes, a real run stops before installing anything', { skip: !posix }, () => {
  const env = noNode();
  fs.writeFileSync(path.join(env.PATH, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const r = spawnSync('bash', [installSh], { env, encoding: 'utf8', input: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No terminal to ask on\. Re-run with --yes/);
  assert.ok(!fs.existsSync(env.NVM_DIR));
});

test('at a terminal, the design\'s two lines show instead of a question', { skip: !pty }, () => {
  const env = noNode();
  // script(1) runs the command in a pseudo-terminal, so install.sh sees a terminal on stdin
  // and stdout, as a friend's would be.
  const r = spawnSync(pty, ['-qec', `bash ${JSON.stringify(installSh)} --dry-run`, '/dev/null'], {
    env: { ...env, SHELL: '/bin/sh' }, encoding: 'utf8', input: '',
  });
  const out = r.stdout.replace(/\r/g, '');
  assert.equal(r.status, 0, out);
  const lines = out.split('\n');
  assert.deepEqual(lines.slice(0, 2), READY);
  assert.doesNotMatch(out, /The installer needs Node\.js|\[Y\/n\]/);
  for (const line of READY) assert.ok(line.length <= 72, line);
});
