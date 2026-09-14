import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { TOOLS } from '../agent-clis/tools.mjs';

// Firstmate is used from an upstream clone (github.com/kunchenguid/firstmate);
// this module only clones it and writes its local, gitignored config/ files.
// Accepted values come from its docs/configuration.md.
const UPSTREAM = 'https://github.com/kunchenguid/firstmate';
const HARNESSES = ['claude', 'codex', 'opencode', 'pi', 'pi-signed', 'grok', 'kimi', 'cursor', 'omp'];
const CREW_ONLY_HARNESSES = ['gemini', 'muse', 'rovo', 'agy'];
const TREEHOUSE_BACKENDS = ['tmux', 'herdr', 'zellij', 'cmux'];
const BOOTSTRAP_TOOLS = ['git', 'node', 'gh', 'jq', 'no-mistakes', 'gh-axi', 'chrome-devtools-axi', 'tasks-axi', 'quota-axi'];

const BACKENDS = {
  tmux: { label: 'tmux - the reference default', tool: { name: 'tmux', install: { unix: { pkg: { apt: 'tmux', dnf: 'tmux', pacman: 'tmux', zypper: 'tmux', apk: 'tmux', brew: 'tmux' } } } } },
  herdr: { label: 'herdr - terminal workspace manager built for agents', tool: TOOLS.herdr },
  zellij: {
    label: 'zellij',
    tool: {
      name: 'zellij',
      install: { macos: { pkg: { brew: 'zellij' } }, linux: { pkg: { pacman: 'zellij', brew: 'zellij' } } },
      unsupported: { default: 'install zellij by hand: https://zellij.dev/documentation/installation' },
    },
  },
  cmux: { label: 'cmux (macOS)', manual: 'install cmux by hand; see docs/cmux-backend.md in your firstmate clone' },
  orca: { label: 'orca', manual: 'install orca by hand; see docs/orca-backend.md in your firstmate clone' },
};

function starterDispatch(harness) {
  const profile = (model, effort) => ({ harness, ...(harness === 'claude' ? { model } : {}), effort });
  return {
    rules: [
      {
        when: 'building: implementing a product, prototype, demo or other build deliverable (not docs-only edits, research or routine housekeeping)',
        use: [profile('claude-opus-5', 'high')],
        why: 'Build work gets the most capable model.',
      },
      {
        when: 'planning, architecture or design decisions, hard reasoning, debugging, refactoring, or judgment calls',
        use: [profile('claude-sonnet-5', 'medium')],
        why: 'Reasoning-heavy work gets more effort on a balanced model.',
      },
    ],
    default: [profile('claude-sonnet-5', 'low')],
  };
}

export default {
  name: 'firstmate',
  title: 'Firstmate',
  description: 'Firstmate agent-fleet supervisor: upstream clone plus your config choices',
  order: 60,
  platforms: ['linux', 'macos', 'wsl'],
  unsupported: { windows: 'firstmate supports macOS and Linux only; install WSL and run ./install.sh inside it' },
  requires: ['core', 'agent-clis'],
  default: true,
  questions: [
    { key: 'FIRSTMATE_DIR', type: 'text', path: true, message: 'Where to clone firstmate', default: '~/firstmate' },
    {
      key: 'FIRSTMATE_BACKEND',
      type: 'choice',
      message: 'Runtime backend (where worker agents run)',
      default: 'tmux',
      choices: Object.entries(BACKENDS).map(([value, b]) => ({ value, label: b.label })),
    },
    {
      key: 'FIRSTMATE_CREW_HARNESS',
      type: 'choice',
      message: 'Crewmate harness ("default" mirrors the harness you run firstmate in)',
      default: 'default',
      choices: ['default', ...HARNESSES, ...CREW_ONLY_HARNESSES].map((value) => ({ value })),
    },
    {
      key: 'FIRSTMATE_SECONDMATE_HARNESS',
      type: 'text',
      message: 'Secondmate harness line "<harness> [model] [effort]", or "default"',
      default: 'default',
    },
    {
      key: 'FIRSTMATE_PERMISSION_MODE',
      type: 'choice',
      message: 'Permission mode for Claude workers',
      default: 'bypass',
      choices: [
        { value: 'bypass', label: 'bypass - skip permission prompts (upstream default)' },
        { value: 'auto', label: "auto - Claude Code's classifier-reviewed permission mode" },
      ],
    },
    {
      key: 'FIRSTMATE_BACKLOG',
      type: 'choice',
      message: 'Backlog backend',
      default: 'tasks-axi',
      choices: [
        { value: 'tasks-axi', label: 'tasks-axi - markdown backlog managed through the CLI (default)' },
        { value: 'manual', label: 'manual - firstmate hand-edits its backlog' },
      ],
    },
    {
      key: 'FIRSTMATE_DISPATCH',
      type: 'choice',
      message: 'Crew dispatch profiles (config/crew-dispatch.json)',
      default: 'starter',
      choices: [
        { value: 'starter', label: 'starter - strong model for builds, more effort for planning, light default' },
        { value: 'none', label: 'none - every worker uses the crew harness' },
      ],
    },
    {
      key: 'FIRSTMATE_DISPATCH_HARNESS',
      type: 'choice',
      message: 'Harness used in the starter dispatch profiles',
      default: 'claude',
      choices: [...HARNESSES, ...CREW_ONLY_HARNESSES].map((value) => ({ value })),
      when: (ctx) => ctx.get('FIRSTMATE_DISPATCH') === 'starter',
    },
  ],

  async install(ctx) {
    const dir = ctx.get('FIRSTMATE_DIR');
    const backend = ctx.get('FIRSTMATE_BACKEND');

    await ctx.step('toolchain', () => {
      const missing = BOOTSTRAP_TOOLS.filter((t) => !ctx.has(t));
      if (!missing.length) return ctx.ok('firstmate bootstrap tools are present');
      ctx.info(`firstmate expects ${missing.join(', ')} (from core and agent-clis); its bootstrap re-checks and offers installs on first launch`);
    });

    const b = BACKENDS[backend];
    await ctx.step(`backend ${backend}`, () => {
      if (b.manual) throw new Skip(b.manual);
      return ctx.ensureTool(b.tool);
    });
    if (TREEHOUSE_BACKENDS.includes(backend)) await ctx.step('treehouse', () => ctx.ensureTool(TOOLS.treehouse));

    const cloned = await ctx.step('clone', () => {
      if (fs.existsSync(path.join(dir, '.git'))) return ctx.ok(`${dir} is already a clone`);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} exists and is not a git clone; choose another FIRSTMATE_DIR`);
      ctx.run(`git clone ${UPSTREAM} "${dir}"`);
      return true;
    });
    if (cloned === undefined) return;

    const config = (name) => path.join(dir, 'config', name);
    const secondmate = ctx.get('FIRSTMATE_SECONDMATE_HARNESS').trim() || 'default';
    const head = secondmate.split(/\s+/)[0];
    if (head !== 'default' && !HARNESSES.includes(head)) ctx.warn(`secondmate harness "${head}" is not one of ${HARNESSES.join(', ')}`);

    await ctx.step('config/backend', () => ctx.writeFile(config('backend'), `${backend}\n`, { onConflict: 'ask' }));
    await ctx.step('config/crew-harness', () => ctx.writeFile(config('crew-harness'), `${ctx.get('FIRSTMATE_CREW_HARNESS')}\n`, { onConflict: 'ask' }));
    if (secondmate !== 'default') {
      await ctx.step('config/secondmate-harness', () => ctx.writeFile(config('secondmate-harness'), `${secondmate}\n`, { onConflict: 'ask' }));
    }
    await ctx.step('config/claude-permission-mode', () =>
      ctx.writeFile(config('claude-permission-mode'), `${ctx.get('FIRSTMATE_PERMISSION_MODE')}\n`, { onConflict: 'ask' }),
    );
    if (ctx.get('FIRSTMATE_BACKLOG') === 'manual') {
      await ctx.step('config/backlog-backend', () => ctx.writeFile(config('backlog-backend'), 'manual\n', { onConflict: 'ask' }));
    }
    if (ctx.get('FIRSTMATE_DISPATCH') === 'starter') {
      await ctx.step('config/crew-dispatch.json', () =>
        ctx.writeFile(config('crew-dispatch.json'), `${JSON.stringify(starterDispatch(ctx.get('FIRSTMATE_DISPATCH_HARNESS')), null, 2)}\n`, {
          onConflict: 'ask',
        }),
      );
    }
    ctx.todo(`start firstmate: cd "${dir}" && claude   (or your harness; its AGENTS.md takes over)`);
  },
};
