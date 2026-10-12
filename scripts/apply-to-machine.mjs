// apply-to-machine.mjs - bring an existing machine up to this template's Claude Code setup
// without a full reinstall. scripts/apply-to-machine.sh runs it; see that file for usage.
//
// It changes only what the claude-code module ships with its default answers:
//   - the shipped hooks, status line and reader subagent files in your Claude folder
//     (a file you edited yourself is replaced only when you say yes),
//   - the hook registrations in settings.json: the context reminder on UserPromptSubmit,
//     PostToolUse and SessionStart (keeping your threshold and text), and the update reminder,
//   - settings keys the defaults set and you have not set: the status line, and the effort
//     per model from the model map (docs/model-map.md).
// Every other key in settings.json stays as it is. Missing default tools (agent-clis) and
// the diagram-design plugin are installed only after a y/N question for each one.
// Before it changes a file it copies it into one backup set,
// ~/.config/ai-workstation-setup/apply-backups/<time>/; --undo puts back the latest set.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, Skip, c, detectPlatform } from '../lib/context.mjs';
import { claudeDir, setHook, settingsPath } from '../lib/claude.mjs';
import { Prompter } from '../lib/prompt.mjs';
import { DEFAULTS as DEFAULT_TOOLS } from '../modules/agent-clis/module.mjs';
import { TOOLS } from '../modules/agent-clis/tools.mjs';
import claudeCode, { parseModelEfforts } from '../modules/claude-code/module.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMINDER_EVENTS = ['UserPromptSubmit', 'PostToolUse', 'SessionStart'];
const PLUGIN = { name: 'diagram-design', id: 'diagram-design@diagram-design', marketplace: 'cathrynlavery/diagram-design' };

const defaultOf = (key) => claudeCode.questions.find((q) => q.key === key).default;

/** The context-reminder command in the installer's form, keeping the threshold and text of `existing`. */
export function reminderCommand(script, existing) {
  const args = String(existing || '').split('context-reminder.mjs')[1] || '';
  const tokens = args.replace(/^"/, '').trim().split(/\s+/)[0] || defaultOf('CLAUDE_CONTEXT_REMINDER_TOKENS');
  const text = args.match(/"([^"]*)"\s*$/)?.[1] || '';
  return `node "${script}" ${tokens} --user${text ? ` "${text}"` : ''}`;
}

/**
 * The settings file as this template's defaults want it, with `changes` naming each difference.
 * `statusLine`: 'set' to point the status line at the shipped gauges, anything else to keep it.
 * `reminderCurrent`: false when the reminder hook file stays an older one of your own, which
 * may not know the --user flag; its registered command is then kept as it is.
 */
export function planSettings(settings, { home, statusLine, gitClone, reminderCurrent = true }) {
  const data = structuredClone(settings);
  const changes = [];
  // A stand-in for the installer's context: the lib/claude.mjs helpers edit `data` in memory.
  const shim = {
    home,
    updateJson(_file, mutate) {
      const before = JSON.stringify(data);
      mutate(data);
      return JSON.stringify(data) !== before;
    },
  };
  const claude = claudeDir(shim);

  const reminder = path.join(claude, 'hooks', 'context-reminder.mjs');
  const current = (data.hooks?.UserPromptSubmit || []).flatMap((m) => m?.hooks || []).find((h) => String(h?.command || '').includes('context-reminder.mjs'));
  const command = reminderCurrent || !current ? reminderCommand(reminder, current?.command) : current.command;
  for (const event of REMINDER_EVENTS) {
    if (setHook(shim, event, 'context-reminder.mjs', command)) changes.push(`register the context reminder on ${event}`);
  }

  if (gitClone) {
    const check = path.join(claude, 'hooks', 'update-check.mjs');
    if (setHook(shim, 'SessionStart', 'update-check.mjs', `node "${check}" "${repoRoot}"`)) changes.push('register the update reminder on SessionStart');
  }

  for (const [model, effortLevel] of Object.entries(parseModelEfforts(defaultOf('CLAUDE_MODEL_EFFORTS')))) {
    if (data.modelSettings?.[model]?.effortLevel) continue;
    data.modelSettings ??= {};
    data.modelSettings[model] = { ...data.modelSettings[model], effortLevel };
    changes.push(`set the effort for ${model} to ${effortLevel}`);
  }

  if (statusLine === 'set') {
    const gauges = `node "${path.join(claude, 'statusline-gauges.mjs')}"`;
    if (data.statusLine?.command !== gauges) {
      data.statusLine = { type: 'command', command: gauges, padding: 0 };
      changes.push('point the status line at the shipped gauges');
    }
  }
  return { data, changes };
}

/** The status line command, when it is not the shipped gauges; null when there is none or it is ours. */
function otherStatusLine(settings) {
  const cmd = settings.statusLine?.command;
  return cmd && !String(cmd).includes('statusline-gauges.mjs') ? String(cmd) : null;
}

function backupRoot(home) {
  return path.join(home, '.config', 'ai-workstation-setup', 'apply-backups');
}

function latestSet(home) {
  const root = backupRoot(home);
  if (!fs.existsSync(root)) return null;
  const sets = fs.readdirSync(root).filter((d) => /^\d{8}-\d{6}(-\d+)?$/.test(d)).sort();
  return sets.length ? path.join(root, sets.at(-1)) : null;
}

/** A new, empty backup set folder; each file is copied in before it changes. */
function newSet(home) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let dir = path.join(backupRoot(home), stamp);
  for (let n = 1; fs.existsSync(dir); n++) dir = path.join(backupRoot(home), `${stamp}-${n}`);
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  const save = () => fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(entries, null, 2)}\n`);
  return {
    dir,
    keep(file) {
      if (entries.some((e) => e.path === file)) return;
      const existed = fs.existsSync(file);
      const copy = existed ? String(entries.length) : null;
      if (existed) fs.copyFileSync(file, path.join(dir, copy));
      entries.push({ path: file, existed, copy });
      save();
    },
  };
}

function undo(home) {
  const set = latestSet(home);
  if (!set) {
    console.error(`no backup set made by this script was found in ${backupRoot(home)}`);
    return 1;
  }
  const entries = JSON.parse(fs.readFileSync(path.join(set, 'manifest.json'), 'utf8'));
  for (const e of entries) {
    if (e.existed) {
      fs.mkdirSync(path.dirname(e.path), { recursive: true });
      fs.copyFileSync(path.join(set, e.copy), e.path);
      console.log(`  ${c.green('✓')} restored ${e.path}`);
    } else if (fs.existsSync(e.path)) {
      fs.rmSync(e.path);
      console.log(`  ${c.green('✓')} removed ${e.path} (this script created it)`);
    }
  }
  fs.renameSync(set, `${set}.undone`);
  console.log(`undid the backup set ${path.basename(set)}; tools and plugins it installed stay installed`);
  return 0;
}

function nodeAtLeast([major, minor]) {
  const [m, n] = process.versions.node.split('.').map(Number);
  return m > major || (m === major && n >= minor);
}

export async function main(argv) {
  const mode = argv[0] === '--dry-run' ? 'dry-run' : argv[0] === '--undo' ? 'undo' : 'apply';
  if (argv.length > 1 || (argv[0] && mode === 'apply')) {
    console.error(`unknown option: ${argv.join(' ')} (use --dry-run or --undo)`);
    return 2;
  }
  const platform = detectPlatform();
  const home = platform.home;
  if (mode === 'undo') return undo(home);

  const dryRun = mode === 'dry-run';
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const prompter = terminal && !dryRun ? new Prompter() : null;
  const ctx = new Context({ platform, dryRun, interactive: Boolean(prompter), answers: new Map(), prompter, repoRoot });
  ctx.beginModule('apply-to-machine');
  const ask = async (question) => {
    if (dryRun) {
      ctx.info(`would ask: ${question} [y/N]`);
      return false;
    }
    if (!prompter) {
      ctx.skip(`${question} (no terminal to ask; answered no)`);
      return false;
    }
    return prompter.confirm(question, false);
  };

  const shim = { home };
  const claude = claudeDir(shim);
  const file = settingsPath(shim);
  let settings = {};
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`${file} is not valid JSON (${err.message}); fix it by hand, nothing was changed`);
      return 1;
    }
  }
  const gitClone = fs.existsSync(path.join(repoRoot, '.git'));

  console.log(c.bold(`${dryRun ? 'Plan (dry run, nothing is written)' : 'Applying'}: Claude Code setup from ${repoRoot}`));

  // 1. Questions first: the status line, files you changed, missing tools.
  const other = otherStatusLine(settings);
  let statusLine = other ? 'keep' : 'set';
  if (other && (await ask(`Your status line runs "${other}". Replace it with the shipped gauges (a backup is kept)?`))) statusLine = 'set';

  const files = [
    ['claude-code/bin/context-reminder.mjs', path.join(claude, 'hooks', 'context-reminder.mjs')],
    ...(gitClone ? [['claude-code/bin/update-check.mjs', path.join(claude, 'hooks', 'update-check.mjs')]] : []),
    ['claude-code/agents/reader.md', path.join(claude, 'agents', 'reader.md')],
  ];
  const gauges = path.join(claude, 'statusline-gauges.mjs');
  if (statusLine === 'set' || fs.existsSync(gauges)) files.push(['claude-code/bin/statusline-gauges.mjs', gauges]);
  const writes = [];
  let reminderCurrent = true;
  for (const [rel, target] of files) {
    const content = ctx.template(rel);
    if (!fs.existsSync(target)) {
      writes.push({ target, content, label: `copy ${path.basename(target)} into ${path.dirname(target)}` });
      continue;
    }
    const current = fs.readFileSync(target, 'utf8');
    if (current === content) continue;
    if (ctx.wasShipped(target, current, ctx.rendered.get(content))) {
      writes.push({ target, content, label: `update ${target} (an older version this setup shipped)` });
    } else if (await ask(`${target} differs from the shipped version and is not one this setup shipped. Replace it (a backup is kept)?`)) {
      writes.push({ target, content, label: `replace ${target} (you said yes)` });
    } else if (rel.endsWith('context-reminder.mjs')) reminderCurrent = false;
  }

  const { data, changes } = planSettings(settings, { home, statusLine, gitClone, reminderCurrent });

  const tools = [];
  for (const key of DEFAULT_TOOLS) {
    const spec = TOOLS[key];
    if (ctx.has(spec.bin || spec.name)) continue;
    if (spec.minNode && !nodeAtLeast(spec.minNode)) {
      ctx.skip(`${spec.name}: needs Node ${spec.minNode.join('.')}+ (running ${process.versions.node})`);
      continue;
    }
    if (await ask(`${spec.name} (${spec.about}) is not installed. Install it now?`)) tools.push(spec);
  }
  const plugin = !settings.enabledPlugins?.[PLUGIN.id] && ctx.has('claude') && (await ask(`Install the ${PLUGIN.name} plugin for Claude Code?`));

  // 2. The plan.
  const total = writes.length + changes.length;
  if (!total && !tools.length && !plugin) {
    console.log('nothing to change: your Claude Code files and settings already match this template');
    return 0;
  }
  if (dryRun) {
    for (const w of writes) console.log(`  ${c.cyan('~')} would ${w.label}`);
    for (const ch of changes) console.log(`  ${c.cyan('~')} would ${ch} in ${file}`);
    console.log(`dry run: ${writes.length} file(s) to copy, ${changes.length} settings change(s); questions above are asked on a real run`);
    return 0;
  }

  // 3. Back up, then write. shipped.json records what this setup wrote, so a later run
  // knows those files are not your own edits; it is part of the backup set too.
  const set = total || plugin ? newSet(home) : null;
  if (writes.length) set.keep(ctx.shippedManifest);
  for (const w of writes) {
    set.keep(w.target);
    fs.mkdirSync(path.dirname(w.target), { recursive: true });
    fs.writeFileSync(w.target, w.content);
    ctx.recordShipped(w.target, w.content);
  }
  if (set) set.keep(file);
  if (changes.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  for (const w of writes) ctx.ok(w.label);
  for (const ch of changes) ctx.ok(`${ch} in ${file}`);

  for (const spec of tools) await ctx.step(spec.name, () => ctx.ensureTool(spec));
  if (plugin) {
    await ctx.step(`plugin ${PLUGIN.name}`, () => {
      if (!(ctx.capture('claude plugin marketplace list') || '').includes(PLUGIN.name)) ctx.run(`claude plugin marketplace add ${PLUGIN.marketplace}`);
      ctx.run(`claude plugin install ${PLUGIN.id}`);
    });
  }
  prompter?.release();
  if (set) console.log(`backup set: ${set.dir}; undo with: scripts/apply-to-machine.sh --undo`);
  if (ctx.record.failures.length) {
    console.log(c.red(`${ctx.record.failures.length} step(s) failed; see above`));
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Skip ? err.message : err.stack || String(err));
      process.exit(1);
    },
  );
}
