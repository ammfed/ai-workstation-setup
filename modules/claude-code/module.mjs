import { Skip } from '../../lib/context.mjs';
import path from 'node:path';
import { claudeDir, readSettings, setHook, settingsPath } from '../../lib/claude.mjs';

const PLUGINS = [
  {
    value: 'diagram-design',
    label: 'diagram-design - architecture, flow, sequence and chart diagrams',
    marketplace: 'cathrynlavery/diagram-design',
    marketplaceName: 'diagram-design',
    id: 'diagram-design@diagram-design',
  },
];

const keep = { value: 'keep', label: 'keep (Claude Code default, or what you already set)' };

export default {
  name: 'claude-code',
  title: 'Claude Code',
  description: 'Claude Code CLI plus settings: model, effort, theme, status line, plugins',
  order: 20,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: true,
  questions: [
    {
      key: 'CLAUDE_MODEL',
      type: 'choice',
      message: 'Default model',
      default: 'keep',
      choices: [keep, { value: 'opus', label: 'opus - most capable' }, { value: 'sonnet', label: 'sonnet - balanced' }, { value: 'haiku', label: 'haiku - fastest' }],
    },
    {
      key: 'CLAUDE_EFFORT',
      type: 'choice',
      message: 'Default effort level',
      default: 'keep',
      choices: [keep, { value: 'low' }, { value: 'medium' }, { value: 'high' }],
    },
    {
      key: 'CLAUDE_THEME',
      type: 'choice',
      message: 'Theme',
      default: 'keep',
      choices: [keep, { value: 'dark' }, { value: 'light' }],
    },
    {
      key: 'CLAUDE_THINKING_SUMMARIES',
      type: 'choice',
      message: 'Thinking summaries in the transcript',
      default: 'keep',
      choices: [keep, { value: 'hide', label: 'hide - a collapsed stub, for calmer output' }, { value: 'show', label: 'show - summaries of Claude\'s thinking' }],
    },
    {
      key: 'CLAUDE_STATUSLINE',
      type: 'choice',
      message: 'Status line',
      default: 'ccstatusline',
      choices: [
        { value: 'ccstatusline', label: 'ccstatusline - model, git branch, context and usage gauges (customizable)' },
        { value: 'none', label: 'none - leave the status line alone' },
      ],
    },
    {
      key: 'CLAUDE_PLUGINS',
      type: 'multi',
      message: 'Plugins to install',
      default: ['diagram-design'],
      choices: PLUGINS,
    },
    {
      key: 'CLAUDE_CONTEXT_REMINDER',
      type: 'confirm',
      message: 'Add a hook that reminds the agent to save its notes once the context gets large?',
      default: false,
    },
    {
      key: 'CLAUDE_CONTEXT_REMINDER_TOKENS',
      type: 'text',
      message: 'Remind once the context passes how many tokens (set it well below your model\'s window)',
      default: '150000',
      when: (ctx) => ctx.get('CLAUDE_CONTEXT_REMINDER'),
    },
  ],

  async install(ctx) {
    const state = await ctx.step('Claude Code', () =>
      ctx.ensureTool({
        name: 'Claude Code',
        bin: 'claude',
        install: {
          unix: 'curl -fsSL https://claude.ai/install.sh | bash',
          windows: 'irm https://claude.ai/install.ps1 | iex',
        },
        pathHints: ['~/.local/bin'],
      }),
    );
    if (state === 'installed') ctx.todo('run `claude` once and sign in');

    await ctx.step('settings', () =>
      ctx.updateJson(
        settingsPath(ctx),
        (s) => {
          for (const [key, answer] of [['model', 'CLAUDE_MODEL'], ['effortLevel', 'CLAUDE_EFFORT'], ['theme', 'CLAUDE_THEME']]) {
            const v = ctx.get(answer);
            if (v && v !== 'keep') s[key] = v;
          }
          const thinking = ctx.get('CLAUDE_THINKING_SUMMARIES');
          if (thinking && thinking !== 'keep') s.showThinkingSummaries = thinking === 'show';
        },
        'model, effort, theme and thinking summaries',
      ),
    );

    if (ctx.get('CLAUDE_STATUSLINE') === 'ccstatusline') {
      await ctx.step('status line', () => {
        const current = readSettings(ctx).statusLine;
        if (current && !String(current.command || '').includes('ccstatusline')) {
          throw new Skip(`a status line is already configured (${current.command}); left untouched`);
        }
        ctx.updateJson(
          settingsPath(ctx),
          (s) => {
            s.statusLine = { type: 'command', command: 'npx -y ccstatusline@latest', padding: 0 };
          },
          'status line',
        );
        ctx.info('customize its widgets any time with: npx -y ccstatusline@latest');
      });
    }

    for (const p of PLUGINS.filter((pl) => ctx.get('CLAUDE_PLUGINS').includes(pl.value))) {
      await ctx.step(`plugin ${p.value}`, () => {
        if (readSettings(ctx).enabledPlugins?.[p.id]) return ctx.ok(`plugin ${p.value} already enabled`);
        if (!ctx.dryRun && !ctx.has('claude')) throw new Skip('`claude` is not on PATH yet; open a new terminal and re-run');
        const marketplaces = ctx.capture('claude plugin marketplace list') || '';
        if (!marketplaces.includes(p.marketplaceName)) ctx.run(`claude plugin marketplace add ${p.marketplace}`);
        ctx.run(`claude plugin install ${p.id}`);
      });
    }

    if (ctx.get('CLAUDE_CONTEXT_REMINDER')) {
      await ctx.step('context reminder hook', async () => {
        const tokens = Number(ctx.get('CLAUDE_CONTEXT_REMINDER_TOKENS'));
        if (!Number.isInteger(tokens) || tokens <= 0) throw new Error('CLAUDE_CONTEXT_REMINDER_TOKENS must be a whole number of tokens');
        const script = path.join(claudeDir(ctx), 'hooks', 'context-reminder.mjs');
        await ctx.writeFile(script, ctx.template('claude-code/bin/context-reminder.mjs'), { onConflict: 'ask' });
        setHook(ctx, 'UserPromptSubmit', 'context-reminder.mjs', `node "${script}" ${tokens}`);
      });
    }
  },
};
