// Tests for a tool spec's `check`: after install, and on every re-run, ensureTool runs the
// tool's own harmless command and fails the step when the output does not match, so a tool
// that is on PATH but broken is reported instead of skipped. Uses node itself as the tool.
// Run: node --test test/tools.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context, detectPlatform } from '../lib/context.mjs';
import { TOOLS } from '../modules/agent-clis/tools.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function context({ dryRun = false } = {}) {
  const ctx = new Context({ platform: detectPlatform(), dryRun, interactive: false, answers: new Map(), prompter: null, repoRoot });
  return { ctx, rec: ctx.beginModule('test') };
}

// Prints the folder it ran from and a sum, so a test can see both the result and the temp folder.
const nodeTool = (expect) => ({
  name: 'node',
  install: { default: 'true' },
  check: { about: 'adds two numbers', files: { 'check.js': 'console.log(__dirname); console.log(6 * 7)' }, cmd: 'node "{tmp}/check.js"', expect },
});

test('a passing check keeps the step ok and removes its temporary folder', async () => {
  const { ctx, rec } = context();
  let output = '';
  const tool = nodeTool({ test: (out) => ((output = out), /42/.test(out)) });
  assert.equal(await ctx.step('node', () => ctx.ensureTool(tool)), 'present');
  assert.deepEqual(rec.failures, []);
  const dir = output.split(/\r?\n/)[0];
  assert.ok(dir && !fs.existsSync(dir), `temporary folder ${dir} should be gone`);
});

test('a check whose output does not match fails the step', async () => {
  const { ctx, rec } = context();
  assert.equal(await ctx.step('node', () => ctx.ensureTool(nodeTool(/43/))), undefined);
  assert.equal(rec.failures.length, 1);
  assert.match(rec.failures[0], /node: installed, but its check failed \(adds two numbers\)/);
});

test('--dry-run names the check without running it', async () => {
  const { ctx, rec } = context({ dryRun: true });
  assert.equal(await ctx.step('node', () => ctx.ensureTool(nodeTool(/never matches/))), 'present');
  assert.deepEqual(rec.failures, []);
});

// A dry run is the plan people are told to read first, so it has to name the checks of the
// tools it would install too, not only of the ones already on PATH.
test('--dry-run names the check of a tool that is not installed yet', async () => {
  const { ctx, rec } = context({ dryRun: true });
  const printed = [];
  const log = console.log;
  console.log = (line) => printed.push(line);
  try {
    const tool = { ...nodeTool(/never matches/), name: 'absent-tool' };
    assert.equal(await ctx.step('absent-tool', () => ctx.ensureTool(tool)), 'installed');
  } finally {
    console.log = log;
  }
  assert.deepEqual(rec.failures, []);
  assert.ok(
    printed.some((line) => line.includes('would check absent-tool: adds two numbers')),
    printed.join('\n'),
  );
});

// The quota-axi hold: 0.1.50 reports the share used as the share left, so its own check has to
// reject that version wherever it is already installed and name the version to go back to.
// Runs the real check spec with node standing in for the tool's `--version`.
const quotaCheck = (version) => ({
  name: 'node',
  install: { default: 'true' },
  check: { ...TOOLS['quota-axi'].check, files: { 'version.js': `console.log(${JSON.stringify(version)})` }, cmd: 'node "{tmp}/version.js"' },
});

test('the quota-axi check fails on 0.1.50 with the command that puts the held version back', async () => {
  const { ctx, rec } = context();
  assert.equal(await ctx.step('quota-axi', () => ctx.ensureTool(quotaCheck('0.1.50'))), undefined);
  assert.deepEqual(rec.failures, [
    "quota-axi: quota-axi's version check failed; 0.1.50 misreports used/remaining, so if that is the installed version run: npm install -g quota-axi@0.1.49",
  ]);
});

test('the quota-axi check passes on the held version and on later releases', async () => {
  for (const version of ['0.1.49', '0.1.51', 'quota-axi 1.0.0']) {
    const { ctx, rec } = context();
    assert.equal(await ctx.step('quota-axi', () => ctx.ensureTool(quotaCheck(version))), 'present');
    assert.deepEqual(rec.failures, [], `version ${version} should pass`);
  }
});

// The tasks-axi check has to prove the listing, not only the add: `add` echoes the id it was
// given, so an expectation that only looks for the id passes even when the queued list comes
// back empty — the regression (add filing the task elsewhere, or --state filtering breaking)
// the check exists to catch. Replays the real command's combined output through the real spec.
const tasksAxiCheck = (output) => ({
  name: 'node',
  install: { default: 'true' },
  check: { ...TOOLS['tasks-axi'].check, files: { 'out.js': `process.stdout.write(${JSON.stringify(output)})` }, cmd: 'node "{tmp}/out.js"' },
});

const ADD_ECHO = 'ok: added installer-check -> Queued\ntask:\n  id: installer-check\n  state: queued\nhelp[2]:\n  - Run `tasks-axi start installer-check --file=./backlog.md` to move it to in flight\n';

test('the tasks-axi check passes when the queued list holds the task it added', async () => {
  const { ctx, rec } = context();
  assert.equal(await ctx.step('tasks-axi', () => ctx.ensureTool(tasksAxiCheck(ADD_ECHO + 'count: 1\ntasks[1]{id,state,kind,repo,title}:\n  installer-check,queued,task,\"-\",installer check\n'))), 'present');
  assert.deepEqual(rec.failures, []);
});

test('the tasks-axi check fails when the add echoes the id but the queued list is empty', async () => {
  const { ctx, rec } = context();
  assert.equal(await ctx.step('tasks-axi', () => ctx.ensureTool(tasksAxiCheck(ADD_ECHO + 'count: 0\ntasks: 0 queued tasks in this backlog\n'))), undefined);
  assert.equal(rec.failures.length, 1);
  assert.match(rec.failures[0], /tasks-axi: installed, but its check failed \(adds and lists a task in a scratch backlog\)/);
});
