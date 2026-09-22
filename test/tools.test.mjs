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
