// Tests for how the installer reuses saved answers after an update: answered questions
// are kept (even for modules not run this time), new questions get an answer, questions
// that no longer exist are dropped, and secrets are never saved. Dry runs only.
// Run: node --test test/answers.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'answers-test-'));
const vault = path.join(tmp, 'kept-vault');
const firstmateDir = path.join(tmp, 'kept-firstmate');

function install(...args) {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', 'linux', ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    stdin: 'ignore',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function readAnswers(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

test('saved answers: kept, new asked, removed dropped, secrets never saved', () => {
  const file = path.join(tmp, 'answers.env');
  fs.writeFileSync(
    file,
    [
      'MODULES=core,second-brain',
      `VAULT_PATH=${vault}`,
      'VAULT_LANGS=en,fr',
      `FIRSTMATE_DIR=${firstmateDir}`, // a module not selected this run
      'QUESTION_REMOVED_UPSTREAM=yes',
      'CLICKUP_TOKEN=placeholder', // a secret: must never be saved
      '',
    ].join('\n'),
  );
  const r = install('--answers', file, '--save-answers', file);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ignoring QUESTION_REMOVED_UPSTREAM \(no question uses it any more\)/);
  assert.match(r.out, /new question VAULT_RAW_DIR: using the default/);
  assert.doesNotMatch(r.out, /new question VAULT_PATH/);

  const saved = readAnswers(file);
  assert.equal(saved.MODULES, 'core,second-brain');
  assert.equal(saved.VAULT_PATH, vault);
  assert.equal(saved.VAULT_LANGS, 'en,fr');
  assert.equal(saved.FIRSTMATE_DIR, firstmateDir);
  assert.ok('VAULT_RAW_DIR' in saved, 'a new question is answered and saved');
  assert.ok(!('QUESTION_REMOVED_UPSTREAM' in saved));
  assert.ok(!('CLICKUP_TOKEN' in saved));

  // A second run asks nothing new and changes nothing.
  const before = fs.readFileSync(file, 'utf8');
  const again = install('--answers', file, '--save-answers', file);
  assert.equal(again.code, 0, again.out);
  assert.doesNotMatch(again.out, /new question/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a folder inside the clone is refused', () => {
  const file = path.join(tmp, 'inside.env');
  fs.writeFileSync(file, `MODULES=second-brain\nVAULT_PATH=${path.join(repoRoot, 'vault')}\n`);
  const r = install('--answers', file);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /inside this clone/);
});

test('a retired choice is swapped for what covers it; an unknown one still stops the run', () => {
  const file = path.join(tmp, 'retired.env');
  // Everything on offer today plus the two retired names, so no new skill joins the selection.
  const offered = `${readAnswers(path.join(repoRoot, 'answers.example.env')).SKILLS_OFFERED},grill-me,grill-with-docs`;
  fs.writeFileSync(file, `MODULES=skills\nSKILLS=kun,grill-me,tdd,grill-with-docs\nSKILLS_OFFERED=${offered}\n`);
  const r = install('--answers', file, '--save-answers', file);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /SKILLS: grill-me is retired; grilling covers it \(added in its place\)/);
  assert.match(r.out, /SKILLS: grill-with-docs is retired; grilling covers it \(already chosen\)/);
  assert.doesNotMatch(r.out, /new skills added/);
  assert.match(r.out, /would install: kun, grilling, tdd\n/);
  assert.equal(readAnswers(file).SKILLS, 'kun,grilling,tdd');

  fs.writeFileSync(file, `MODULES=skills\nSKILLS=kun,grill-never-offered\nSKILLS_OFFERED=${offered}\n`);
  const bad = install('--answers', file);
  assert.equal(bad.code, 2, bad.out);
  assert.match(bad.out, /SKILLS: unknown option\(s\) grill-never-offered/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
