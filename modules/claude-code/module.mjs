import { Skip } from '../../lib/context.mjs';
import { readSettings, settingsPath } from '../../lib/claude.mjs';

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
        },
        'model, effort and theme',
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
  },
};
