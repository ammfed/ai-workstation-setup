import { Skip } from '../../lib/context.mjs';

// Each server is added user-wide with `claude mcp add`, using the command its
// upstream documents for Claude Code. Keys go into Claude Code's own local
// config (~/.claude.json), never into this repo.
const SERVERS = [
  {
    value: 'context7',
    label: 'context7 - up-to-date library docs (hosted; API key optional, raises rate limits)',
    // github.com/upstash/context7 docs/resources/all-clients.mdx
    command: (ctx) => {
      const key = ctx.get('CONTEXT7_API_KEY');
      const header = key ? ` --header "Authorization: Bearer ${key}"` : '';
      return { cmd: `claude mcp add --scope user${header} --transport http context7 https://mcp.context7.com/mcp`, redact: [key] };
    },
  },
  {
    value: 'chrome-devtools',
    label: 'chrome-devtools - drive and inspect a Chrome browser (needs Chrome)',
    // github.com/ChromeDevTools/chrome-devtools-mcp docs/client-configurations.md; native Windows needs the cmd /c wrapper for npx.
    command: (ctx) => ({
      cmd:
        ctx.os === 'windows'
          ? 'claude mcp add chrome-devtools --scope user -- cmd /c npx chrome-devtools-mcp@latest'
          : 'claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest',
    }),
  },
];

export default {
  name: 'mcp-servers',
  title: 'MCP servers',
  description: 'MCP servers for Claude Code (context7, chrome-devtools)',
  order: 40,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['claude-code'],
  default: true,
  questions: [
    {
      key: 'MCP_SERVERS',
      type: 'multi',
      message: 'MCP servers to add (the agent-clis module covers the same ground as CLIs: ctx7, chrome-devtools-axi)',
      default: [],
      choices: SERVERS,
    },
    {
      key: 'CONTEXT7_API_KEY',
      type: 'secret',
      message: 'Context7 API key from https://context7.com/dashboard',
      when: (ctx) => ctx.get('MCP_SERVERS').includes('context7'),
    },
  ],

  async install(ctx) {
    const chosen = SERVERS.filter((s) => ctx.get('MCP_SERVERS').includes(s.value));
    if (!chosen.length) ctx.ok('no MCP servers selected');
    for (const server of chosen) {
      await ctx.step(server.value, () => {
        if (!ctx.dryRun && !ctx.has('claude')) throw new Skip('`claude` is not on PATH yet; open a new terminal and re-run');
        if (ctx.capture(`claude mcp get ${server.value}`) !== null) return ctx.ok(`${server.value} already configured`);
        const { cmd, redact } = server.command(ctx);
        ctx.run(cmd, { redact });
      });
    }
    ctx.info('claude.ai connectors (Google Drive, Notion, Canva, ...) are account-level: enable them at claude.ai → Settings → Connectors');
  },
};
