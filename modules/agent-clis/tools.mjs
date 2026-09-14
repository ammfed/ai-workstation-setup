// Install routes for the agent CLIs, each taken from the tool's upstream README.
// Shared with the firstmate module, which needs some of them for its backend.

const npm = (pkg) => ({ default: { npm: pkg } });

export const TOOLS = {
  'gh-axi': { name: 'gh-axi', install: npm('gh-axi'), about: 'GitHub for agents (uses your gh sign-in)', hook: true },
  'chrome-devtools-axi': { name: 'chrome-devtools-axi', install: npm('chrome-devtools-axi'), about: 'browser automation for agents (needs Chrome)', hook: true },
  'lavish-axi': { name: 'lavish-axi', install: npm('lavish-axi'), about: 'review rich HTML artifacts with your agent', hook: true },
  'tasks-axi': { name: 'tasks-axi', install: npm('tasks-axi'), about: 'task/backlog CLI (firstmate needs it)' },
  'quota-axi': { name: 'quota-axi', install: npm('quota-axi'), about: 'agent-provider quota windows (firstmate needs it; Node 22.19+)', minNode: [22, 19] },
  ctx7: { name: 'ctx7', install: npm('ctx7'), about: 'Context7 CLI: current library docs for agents' },
  'no-mistakes': {
    name: 'no-mistakes',
    about: 'validation pipeline: review, test, push, PR (firstmate needs it)',
    install: {
      unix: 'curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh | sh',
      windows: 'irm https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.ps1 | iex',
    },
    pathHints: ['~/.local/bin', '~/.no-mistakes/bin'],
  },
  treehouse: {
    name: 'treehouse',
    about: 'disposable git worktree pool for parallel agents',
    install: {
      unix: 'curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh',
      windows: 'irm https://kunchenguid.github.io/treehouse/install.ps1 | iex',
    },
    pathHints: ['~/.local/bin'],
  },
  herdr: {
    name: 'herdr',
    about: 'terminal workspace manager for agents',
    install: {
      unix: 'curl -fsSL https://herdr.dev/install.sh | sh',
      windows: 'irm https://herdr.dev/install.ps1 | iex',
    },
    pathHints: ['~/.local/bin'],
  },
  codex: {
    name: 'Codex CLI',
    bin: 'codex',
    about: "OpenAI's coding agent",
    install: {
      unix: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
      windows: 'irm https://chatgpt.com/codex/install.ps1 | iex',
    },
    pathHints: ['~/.local/bin'],
    signIn: 'run `codex` and sign in',
  },
  agy: {
    name: 'Antigravity CLI',
    bin: 'agy',
    about: "Google's Antigravity agent CLI",
    install: {
      unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
      windows: 'irm https://antigravity.google/cli/install.ps1 | iex',
    },
    pathHints: ['~/.local/bin'],
    signIn: 'run `agy` and sign in with Google',
  },
  composio: {
    name: 'composio',
    about: 'Composio CLI: connect agents to SaaS apps (not on native Windows)',
    install: { unix: 'curl -fsSL https://composio.dev/install | sh' },
    unsupported: { windows: 'Composio documents no native Windows installer; install it inside WSL' },
    pathHints: ['~/.local/bin', '~/.composio'],
    signIn: 'composio login   (and `composio setup` for its Claude Code plugin)',
  },
};
