import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { claudeDir, setHook } from '../../lib/claude.mjs';
import { TOOLS, versionCheck } from '../agent-clis/tools.mjs';
import { reminderTokens } from '../claude-code/module.mjs';

// Firstmate is used from an upstream clone (github.com/kunchenguid/firstmate);
// this module only clones it and writes its local, gitignored config/ files.
// Accepted values come from its docs/configuration.md.
const UPSTREAM = 'https://github.com/kunchenguid/firstmate';
const HARNESSES = ['claude', 'codex', 'opencode', 'pi', 'pi-signed', 'grok', 'kimi', 'cursor', 'omp'];
const CREW_ONLY_HARNESSES = ['gemini', 'muse', 'rovo', 'agy'];
const TREEHOUSE_BACKENDS = ['tmux', 'herdr', 'zellij', 'cmux'];
const BOOTSTRAP_TOOLS = ['git', 'node', 'gh', 'jq', 'no-mistakes', 'gh-axi', 'chrome-devtools-axi', 'tasks-axi', 'quota-axi'];

const BACKENDS = {
  tmux: {
    label: 'tmux - the reference default',
    tool: {
      name: 'tmux',
      install: { unix: { pkg: { apt: 'tmux', dnf: 'tmux', pacman: 'tmux', zypper: 'tmux', apk: 'tmux', brew: 'tmux' } } },
      // `tmux --version` is not a valid option, and its two-part version fails the shared pattern.
      check: { about: 'reports its version', cmd: 'tmux -V', expect: /^tmux \S+/m },
    },
  },
  herdr: { label: 'herdr - terminal workspace manager built for agents', tool: TOOLS.herdr },
  zellij: {
    label: 'zellij',
    tool: {
      name: 'zellij',
      install: { macos: { pkg: { brew: 'zellij' } }, linux: { pkg: { pacman: 'zellij', brew: 'zellij' } } },
      unsupported: { default: 'install zellij by hand: https://zellij.dev/documentation/installation' },
      check: versionCheck('zellij'),
    },
  },
  cmux: { label: 'cmux (macOS)', manual: 'install cmux by hand; see docs/cmux-backend.md in your firstmate clone' },
  orca: { label: 'orca', manual: 'install orca by hand; see docs/orca-backend.md in your firstmate clone' },
};

// Profiles use the current model ids; a non-Claude harness keeps only the effort.
export function dispatchProfiles(kind, harness) {
  const profile = (model, effort) => ({ harness, ...(harness === 'claude' ? { model } : {}), effort });
  if (kind === 'capable') {
    // A starting example after docs/model-map.md; change it to suit your own work. A stronger
    // model (Fable) is left to the person to ask for by name, not to a rule.
    return {
      rules: [
        {
          when: "The task designs a new look for a prototype's user-facing frontend, one that is not yet settled: screens, visual look, layout, characters, or clickable user journeys.",
          use: [profile('claude-opus-5-5', 'xhigh')],
          why: 'A new frontend look gets the most capable model at extra-high effort.',
        },
        {
          when: 'The task polishes a prototype frontend whose look is already settled: spacing, copy, states, small layout fixes, or fixes from a usability check.',
          use: [profile('claude-opus-5-5', 'high')],
          why: 'Polish of a settled look gets the most capable model at high effort.',
        },
        {
          when: 'The task investigates or diagnoses a problem whose cause is not yet known, or writes a plan, a design or an architecture before the build.',
          use: [profile('claude-opus-5-5', 'high')],
          why: 'Investigations, diagnosis and plans get high effort; re-run the same task at extra-high effort when the result is weak or the cause is hard to find, and fix or build at medium effort once the cause is proven or the plan is settled.',
        },
        {
          when: 'The task researches a question: it gathers and reads sources, compares them and reports what it found.',
          use: [profile('claude-opus-5-5', 'high')],
          why: 'The research worker plans and checks, and hands bulk fetching to agy with gemini-3.8-flash-high (claude-sonnet-4-6 on a Gemini quota error), reading and summaries to the reader subagent, and drafting to Sonnet 5.5 at high effort.',
        },
        {
          when: 'A small, well-defined task with a clear outcome and little ambiguity: a bug fix with a clear repro, a docs or copy edit, a version bump, a config tweak, or another narrow mechanical change.',
          use: [profile('claude-sonnet-5-5', 'high')],
          why: 'Small, clear tasks go to the faster model at high effort; after a failed check, re-run on Opus 5.5 at medium effort.',
        },
      ],
      default: [profile('claude-opus-5-5', 'medium')],
    };
  }
  return {
    rules: [
      {
        when: 'building: implementing a product, prototype, demo or other build deliverable (not docs-only edits, research or routine housekeeping)',
        use: [profile('claude-opus-5-5', 'high')],
        why: 'Build work gets the most capable model.',
      },
      {
        when: 'planning, architecture or design decisions, hard reasoning, debugging, refactoring, or judgment calls',
        use: [profile('claude-sonnet-5-5', 'medium')],
        why: 'Reasoning-heavy work gets more effort on a balanced model.',
      },
    ],
    default: [profile('claude-sonnet-5-5', 'low')],
  };
}

// With the capable profiles on Claude, second mates run like the default worker: Opus 5.5 at
// medium (docs/model-map.md). Otherwise they follow the harness's own default.
export function secondmateDefault(dispatch, harness) {
  return dispatch === 'capable' && harness === 'claude' ? 'claude claude-opus-5-5 medium' : 'default';
}

// Local second-mate homes from the primary's data/secondmates.md: "(home: <path>; ...)" per
// route, skipping remote routes (host:), whose homes live on another machine. The format is
// owned by the secondmate-provisioning skill in the firstmate clone.
export function localSecondmateHomes(registry) {
  const homes = [];
  for (const line of String(registry || '').split('\n')) {
    if (!line.startsWith('- ') || /\(host:/.test(line)) continue;
    const m = line.match(/\(home: ([^;)]+)[;)]/);
    if (m) homes.push(m[1].trim());
  }
  return homes;
}

// Schema: "Watched tool updates" in firstmate's docs/configuration.md. The axi tools
// announce a newer release through their own `update --check`.
function watchedTools(dir, clis) {
  const announcing = (name) => ({ name, command: name, version_args: ['--version'], announce_args: ['update', '--check'], announce_pattern: 'available: true' });
  return {
    tools: [
      { name: 'firstmate', git: { repo: dir, remote: 'origin' } },
      announcing('quota-axi'),
      ...(clis.includes('lavish-axi') ? [announcing('lavish-axi')] : []),
    ],
  };
}

const STOW_TEXT = 'Context is large. Run /stow now, before anything else, then continue.';

export function stowTokens(text) {
  return reminderTokens(text, 'FIRSTMATE_STOW_REMINDER_TOKENS');
}

function pinHome(ctx, where, value) {
  return ctx.updateJson(
    path.join(where, '.claude', 'settings.local.json'),
    (s) => {
      s.env ??= {};
      s.env.FM_HOME = value;
    },
    `FM_HOME pin in ${where}`,
  );
}

export default {
  name: 'firstmate',
  title: 'Firstmate',
  description: 'Firstmate agent-fleet supervisor: upstream clone plus your config choices',
  order: 60,
  group: 'agents',
  summary: 'Firstmate to run and watch several agents for you',
  platforms: ['linux', 'macos', 'wsl'],
  unsupported: { windows: 'firstmate needs Linux; .\\install.ps1 --modules wsl sets up WSL and installs it there' },
  requires: ['core', 'agent-clis'],
  default: true,
  questions: [
    { key: 'FIRSTMATE_DIR', type: 'text', path: true, message: 'Where to clone firstmate', default: '~/firstmate' },
    {
      key: 'FIRSTMATE_HOME',
      type: 'text',
      path: true,
      message: 'Operational home for config, state and data, kept apart from the code (FM_HOME; empty keeps them in the clone)',
      default: '',
    },
    {
      key: 'FIRSTMATE_PIN_HOME',
      type: 'confirm',
      message: 'Pin FM_HOME in each Firstmate home\'s Claude Code settings, so every session and second mate acts on its own home?',
      default: true,
    },
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
      default: 'capable',
      choices: [
        { value: 'capable', label: 'capable - Opus at medium effort, Opus at xhigh for a new frontend look, Opus at high for polish, investigations, plans and research with helpers, small clear tasks on Sonnet at high (docs/model-map.md)' },
        { value: 'starter', label: 'starter - strong model for builds, more effort for planning, light default' },
        { value: 'none', label: 'none - every worker uses the crew harness' },
      ],
    },
    {
      key: 'FIRSTMATE_DISPATCH_HARNESS',
      type: 'choice',
      message: 'Harness used in the dispatch profiles',
      default: 'claude',
      choices: [...HARNESSES, ...CREW_ONLY_HARNESSES].map((value) => ({ value })),
      when: (ctx) => ctx.get('FIRSTMATE_DISPATCH') !== 'none',
    },
    {
      key: 'FIRSTMATE_SECONDMATE_HARNESS',
      type: 'text',
      message: 'Secondmate harness line "<harness> [model] [effort]", or "default"',
      default: (ctx) => secondmateDefault(ctx.get('FIRSTMATE_DISPATCH'), ctx.get('FIRSTMATE_DISPATCH_HARNESS')),
    },
    {
      key: 'FIRSTMATE_HERDR_SPACES',
      type: 'choice',
      message: "Herdr presentation spaces (each task in its own disposable workspace; firstmate's docs/herdr-backend.md)",
      default: 'keep',
      choices: [
        { value: 'keep', label: 'keep - leave it to firstmate (on for Herdr 0.8 and newer)' },
        { value: 'off', label: 'off - tasks share the flat layout' },
        { value: 'on', label: 'on' },
      ],
      when: (ctx) => ctx.get('FIRSTMATE_BACKEND') === 'herdr',
    },
    {
      key: 'FIRSTMATE_MEMORY_BUDGET',
      type: 'text',
      message: 'Startup memory budget in estimated tokens for preferences and learnings (empty keeps the firstmate default, 7500)',
      default: '',
    },
    {
      key: 'FIRSTMATE_STOW_REMINDER',
      type: 'confirm',
      message: 'Remind the main Firstmate session and each second mate to run /stow (save its state) once its context gets large, before it is compacted?',
      default: true,
    },
    {
      key: 'FIRSTMATE_STOW_REMINDER_TOKENS',
      type: 'text',
      message: 'Remind once the context passes how many tokens ("auto": seven eighths of that home\'s auto-compact window, so 175000 for a 200000 window)',
      default: 'auto',
      when: (ctx) => ctx.get('FIRSTMATE_STOW_REMINDER'),
    },
    {
      key: 'FIRSTMATE_WATCH_UPDATES',
      type: 'confirm',
      message: 'Watch for updates to firstmate, quota-axi and lavish-axi (config/watched-tools.json)?',
      default: true,
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
      if (fs.existsSync(path.join(dir, '.git'))) {
        ctx.ok(`${dir} is already a clone`);
        return true;
      }
      if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} exists and is not a git clone; choose another FIRSTMATE_DIR`);
      ctx.run(`git clone ${UPSTREAM} "${dir}"`);
      return true;
    });
    if (cloned === undefined) return;

    const home = ctx.get('FIRSTMATE_HOME') || '';
    const opsHome = home || dir;
    const config = (name) => path.join(opsHome, 'config', name);
    if (home) {
      // firstmate's docs/configuration.md "FM_HOME": scripts run from the clone, state, data,
      // config and projects come from $FM_HOME.
      await ctx.step('FM_HOME', () => ctx.setUserEnv('FM_HOME', home));
    }
    // Second mates are found in the registry, so a re-run after adding one covers it too.
    const registry = path.join(opsHome, 'data', 'secondmates.md');
    const mates = fs.existsSync(registry) ? localSecondmateHomes(fs.readFileSync(registry, 'utf8')) : [];
    const mateStep = (label, mate, fn) =>
      ctx.step(`${label} ${path.basename(mate)}`, () => {
        if (!fs.existsSync(path.join(mate, '.fm-secondmate-home'))) throw new Skip(`${mate} is not a second-mate home (no .fm-secondmate-home)`);
        return fn();
      });
    if (ctx.get('FIRSTMATE_PIN_HOME')) {
      // A Claude Code session started in a home does not always get FM_HOME in its tool
      // environment, and scripts such as fm-send refuse to guess (firstmate issue 5713). The
      // pin goes in each home's gitignored .claude/settings.local.json.
      await ctx.step('FM_HOME pin', () => pinHome(ctx, dir, opsHome));
      for (const mate of mates) await mateStep('FM_HOME pin', mate, () => pinHome(ctx, mate, mate));
    }
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
    const dispatch = ctx.get('FIRSTMATE_DISPATCH');
    if (dispatch !== 'none') {
      await ctx.step('config/crew-dispatch.json', () =>
        ctx.writeFile(config('crew-dispatch.json'), `${JSON.stringify(dispatchProfiles(dispatch, ctx.get('FIRSTMATE_DISPATCH_HARNESS')), null, 2)}\n`, {
          onConflict: 'ask',
        }),
      );
    }
    const spaces = backend === 'herdr' ? ctx.get('FIRSTMATE_HERDR_SPACES') : 'keep';
    if (spaces && spaces !== 'keep') {
      await ctx.step('config/herdr-presentation-spaces', () => ctx.writeFile(config('herdr-presentation-spaces'), `${spaces}\n`, { onConflict: 'ask' }));
    }
    const budget = String(ctx.get('FIRSTMATE_MEMORY_BUDGET') || '').trim();
    if (budget) {
      await ctx.step('config/startup-memory-budget', () => {
        if (!/^[1-9]\d*$/.test(budget)) throw new Error('FIRSTMATE_MEMORY_BUDGET must be a positive whole number of tokens');
        return ctx.writeFile(config('startup-memory-budget'), `${budget}\n`, { onConflict: 'ask' });
      });
    }
    if (ctx.get('FIRSTMATE_WATCH_UPDATES')) {
      await ctx.step('config/watched-tools.json', async () => {
        const written = await ctx.writeFile(config('watched-tools.json'), `${JSON.stringify(watchedTools(dir, ctx.get('AGENT_CLIS') || []), null, 2)}\n`, {
          onConflict: 'ask',
        });
        if (written) ctx.todo(`arm the update check once: cd "${dir}" && bin/fm-tool-update-check.sh arm`);
      });
    }
    if (ctx.get('FIRSTMATE_STOW_REMINDER')) {
      // The claude-code module's context-reminder hook with its own text, registered in the
      // gitignored .claude/settings.local.json of the clone (where the main session starts) and
      // of each second-mate home. Workers run from their own worktrees and never see it.
      const tokens = stowTokens(ctx.get('FIRSTMATE_STOW_REMINDER_TOKENS'));
      const script = path.join(claudeDir(ctx), 'hooks', 'context-reminder.mjs');
      const command = `node "${script}" ${tokens} "${STOW_TEXT}"`;
      const register = (where) => setHook(ctx, 'UserPromptSubmit', 'context-reminder.mjs', command, path.join(where, '.claude', 'settings.local.json'));
      await ctx.step('stow reminder', async () => {
        await ctx.writeFile(script, ctx.template('claude-code/bin/context-reminder.mjs'), { onConflict: 'ask' });
        register(dir);
      });
      for (const mate of mates) await mateStep('stow reminder', mate, () => register(mate));
    }
    ctx.todo(`start firstmate: cd "${dir}" && claude   (or your harness; its AGENTS.md takes over)`);
    ctx.info('second mates (one persistent home per domain): see docs/firstmate.md');
  },
};
