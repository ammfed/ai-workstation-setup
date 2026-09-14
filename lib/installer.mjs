#!/usr/bin/env node
// The installer behind install.sh and install.ps1: selects modules, asks every
// question up front, then installs module by module and prints a summary.
// It uses only Node built-ins, so a fresh clone runs with nothing but Node 20+.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context, OSES, Skip, c, detectPlatform, parseAnswersFile } from './context.mjs';
import { Prompter } from './prompt.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: ./install.sh [options]        (Linux, macOS, WSL)
       .\\install.ps1 [options]       (native Windows)

Options:
  --dry-run               Show what would happen; change nothing.
  --list                  List modules and the platforms they support.
  --modules a,b           Modules to run ("default", "all", or names). Skips the module question.
  --answers FILE          Read answers from a KEY=value file (see answers.example.env).
  --yes, --non-interactive
                          Never prompt: use answers, then defaults. Secrets come from env vars only.
  --save-answers FILE     Write the answers given this run (never secrets) to FILE for reuse.
  --platform OS           Pretend to be linux|macos|wsl|windows. Only with --dry-run (for testing).
  -h, --help              Show this help.`;

async function loadModules() {
  const dir = path.join(repoRoot, 'modules');
  const modules = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'module.mjs');
    if (!fs.existsSync(file)) continue;
    const m = (await import(pathToFileURL(file).href)).default;
    const problems = [];
    if (m?.name !== name) problems.push(`name must be "${name}"`);
    for (const k of ['title', 'description']) if (typeof m?.[k] !== 'string') problems.push(`${k} must be a string`);
    if (!Number.isFinite(m?.order)) problems.push('order must be a number');
    if (!Array.isArray(m?.platforms) || !m.platforms.every((p) => OSES.includes(p))) {
      problems.push(`platforms must be a list drawn from ${OSES.join(', ')}`);
    }
    if (typeof m?.install !== 'function') problems.push('install must be a function');
    if (problems.length) throw new Error(`modules/${name}/module.mjs: ${problems.join('; ')}`);
    modules.push({ requires: [], default: false, unsupported: {}, questions: [], ...m });
  }
  return modules.sort((a, b) => a.order - b.order);
}

function unsupportedReason(m, os) {
  if (m.platforms.includes(os)) return null;
  return m.unsupported[os] || `supports ${m.platforms.join(', ')} only`;
}

function questionsOf(m, ctx) {
  return typeof m.questions === 'function' ? m.questions(ctx) : m.questions;
}

function printList(modules, platform) {
  console.log(`Modules (this machine: ${platform.os}):\n`);
  for (const m of modules) {
    const mark = unsupportedReason(m, platform.os) ? c.yellow('–') : c.green('✓');
    console.log(`  ${mark} ${m.name.padEnd(13)} ${m.description}`);
    console.log(`    ${c.dim(`platforms: ${m.platforms.join(', ')}  default: ${m.default ? 'yes' : 'no'}${m.requires.length ? `  requires: ${m.requires.join(', ')}` : ''}`)}`);
  }
}

async function selectModules(ctx, modules) {
  const { os } = ctx.platform;
  const byName = Object.fromEntries(modules.map((m) => [m.name, m]));
  const supported = modules.filter((m) => !unsupportedReason(m, os));
  const defaults = supported.filter((m) => m.default).map((m) => m.name);

  const unsupported = modules.filter((m) => unsupportedReason(m, os));
  if (unsupported.length) {
    console.log(`\nNot available on ${os}:`);
    for (const m of unsupported) console.log(`  ${c.yellow('–')} ${m.name}: ${unsupportedReason(m, os)}`);
  }

  let names = ctx.answers.get('MODULES');
  if (names === undefined) {
    names = ctx.interactive
      ? await ctx.prompter.multi(
          'Which modules should be set up?',
          supported.map((m) => ({ value: m.name, label: `${m.name.padEnd(13)} ${m.description}` })),
          defaults,
        )
      : defaults;
  } else if (names === 'default') names = defaults;
  else if (names === 'all') names = supported.map((m) => m.name);
  else names = names.split(',').map((s) => s.trim()).filter(Boolean);

  const unknown = names.filter((n) => !byName[n]);
  if (unknown.length) throw new Error(`unknown module(s): ${unknown.join(', ')} (see --list)`);

  const wanted = new Set(names);
  const addRequired = (name) => {
    for (const dep of byName[name].requires) {
      if (wanted.has(dep)) continue;
      wanted.add(dep);
      console.log(`  ${c.dim('•')} adding ${dep} (required by ${name})`);
      addRequired(dep);
    }
  };
  for (const n of [...wanted]) addRequired(n);
  ctx.values.MODULES = modules.filter((m) => wanted.has(m.name)).map((m) => m.name);
  return modules.filter((m) => wanted.has(m.name));
}

function saveAnswers(file, values) {
  const lines = ['# Answers saved by ai-workstation-setup. Secrets are never saved here.'];
  for (const [k, v] of Object.entries(values)) {
    const text = Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v;
    lines.push(`${k}=${text}`);
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`\nSaved answers to ${file}`);
}

function printSummary(ctx, results) {
  console.log(`\n${c.bold(`Summary${ctx.dryRun ? ' (dry run: nothing was changed)' : ''}`)}`);
  const paint = { done: c.green, failed: c.red, unsupported: c.yellow };
  for (const r of results) {
    let note = '';
    if (r.status === 'unsupported') note = r.rec.skips[0];
    else if (r.rec.failures.length) note = `${r.rec.failures.length} step(s) failed`;
    else if (r.rec.skips.length) note = `${r.rec.skips.length} step(s) skipped`;
    console.log(`  ${r.m.name.padEnd(13)} ${paint[r.status](r.status.padEnd(11))} ${c.dim(note || '')}`);
  }
  const failures = results.flatMap((r) => r.rec.failures.map((f) => `${r.m.name}: ${f}`));
  const todos = results.flatMap((r) => r.rec.todos.map((t) => `${r.m.name}: ${t}`));
  if (failures.length) {
    console.log(`\n${c.red('Failed:')}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  if (todos.length) {
    console.log(`\n${c.cyan('Left for you to do:')}`);
    for (const t of todos) console.log(`  → ${t}`);
  }
  if (failures.length) console.log('\nFix the failures above and re-run: steps that already succeeded are skipped.');
}

async function main() {
  const { values: opts } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      'non-interactive': { type: 'boolean' },
      answers: { type: 'string' },
      modules: { type: 'string' },
      'save-answers': { type: 'string' },
      platform: { type: 'string' },
      list: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  const platform = detectPlatform(opts.platform);
  const modules = await loadModules();
  if (opts.list) {
    printList(modules, platform);
    return 0;
  }
  const dryRun = Boolean(opts['dry-run']);
  if (platform.simulated && !dryRun) {
    throw new Error(`--platform ${platform.os} is not this machine (${platform.host}); it is only allowed with --dry-run`);
  }
  const interactive = !(opts.yes || opts['non-interactive']);
  if (interactive && !process.stdin.isTTY) {
    throw new Error('no interactive terminal: pass --yes (with --answers FILE) to run unattended');
  }

  const answers = opts.answers ? parseAnswersFile(opts.answers) : new Map();
  if (opts.modules) answers.set('MODULES', opts.modules);
  const prompter = interactive ? new Prompter() : null;
  const ctx = new Context({ platform, dryRun, interactive, answers, prompter, repoRoot });

  console.log(c.bold('ai-workstation-setup'));
  console.log(
    `  platform: ${platform.os} (${platform.arch})  package manager: ${platform.pkg || 'none found'}  shell: ${platform.shell}` +
      `${dryRun ? c.cyan('  [dry run]') : ''}${platform.simulated ? c.yellow(`  [simulated on ${platform.host}]`) : ''}`,
  );

  const selected = await selectModules(ctx, modules);

  // Phase 1: every question up front, so the install can then run unattended.
  const known = new Set(['MODULES']);
  for (const m of modules) for (const q of questionsOf(m, ctx)) known.add(q.key);
  for (const key of answers.keys()) if (!known.has(key)) console.log(`  ${c.yellow('!')} answers file: unknown key ${key} (ignored)`);

  for (const m of selected) {
    if (unsupportedReason(m, platform.os)) continue;
    const qs = questionsOf(m, ctx);
    if (!qs.length) continue;
    if (interactive) console.log(`\n${c.bold(m.title)}`);
    for (const q of qs) {
      if (q.when && !q.when(ctx)) continue;
      await ctx.ask(q);
    }
  }
  if (opts['save-answers']) saveAnswers(opts['save-answers'], ctx.values);

  // Phase 2: install.
  const results = [];
  for (const m of selected) {
    console.log(`\n${c.bold(`[${m.name}]`)} ${m.title}`);
    const rec = ctx.beginModule(m.name);
    const reason = unsupportedReason(m, platform.os);
    if (reason) {
      ctx.skip(`not supported on ${platform.os}: ${reason}`);
      results.push({ m, rec, status: 'unsupported' });
      continue;
    }
    try {
      await m.install(ctx);
    } catch (err) {
      if (err instanceof Skip) ctx.skip(err.message);
      else ctx.fail(err.message);
    }
    results.push({ m, rec, status: rec.failures.length ? 'failed' : 'done' });
  }
  prompter?.release();
  printSummary(ctx, results);
  return results.some((r) => r.status === 'failed') ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`${c.red('error:')} ${err.message}`);
    process.exit(2);
  },
);
