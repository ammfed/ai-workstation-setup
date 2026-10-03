import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';

// Install routes for the agent CLIs, each taken from the tool's upstream README.
// Shared with the firstmate module, which needs some of them for its backend.

const npm = (pkg) => ({ default: { npm: pkg } });

// An isolated Python CLI, the way the tool's README gives it: uv first, else pipx.
const uvTool = (pkg) => ({
  default: (ctx) => {
    if (ctx.dryRun && ctx.platform.simulated) return ctx.run(`uv tool install ${pkg}   (or pipx install ${pkg})`);
    if (ctx.has('uv')) return ctx.run(`uv tool install ${pkg}`);
    if (ctx.has('pipx')) return ctx.run(`pipx install ${pkg}`);
    throw new Skip(`needs uv or pipx for an isolated install (https://docs.astral.sh/uv/); then: uv tool install ${pkg}`);
  },
});

// Smallest offline proof a CLI is runnable, not only a name on PATH: it prints its own version.
// Exported because the other modules register tools that prove themselves the same way.
export const versionCheck = (bin) => ({ about: 'reports its version', cmd: `${bin} --version`, expect: /\d+\.\d+\.\d+/ });

// Every tool the setup registers through ensureTool gets a check except these four, on purpose:
// pixel-agents (`--version` is not a version flag, it starts the app), agy and composio (out of
// scope for checks for now), and OpenWhispr in modules/extras (a desktop app, not installed
// through ensureTool, with no offline command-line check).

// mermaid-ascii publishes release archives and a checksums file per version
// (github.com/AlexanderGrooff/mermaid-ascii, README "Installation").
const MERMAID_REPO = 'https://github.com/AlexanderGrooff/mermaid-ascii';

function installMermaidAscii(ctx) {
  const arch = { x64: 'x86_64', arm64: 'arm64' }[ctx.platform.arch];
  const os = { linux: 'Linux', wsl: 'Linux', macos: 'Darwin', windows: 'Windows' }[ctx.os];
  if (!arch) throw new Error(`mermaid-ascii publishes no build for ${ctx.os}/${ctx.platform.arch}`);
  if (ctx.os === 'windows') {
    const asset = `mermaid-ascii_${os}_${arch}.zip`;
    ctx.run(
      [
        `$tag = (Invoke-RestMethod 'https://api.github.com/repos/AlexanderGrooff/mermaid-ascii/releases/latest').tag_name`,
        `$tmp = Join-Path $env:TEMP ('mermaid-ascii-' + [guid]::NewGuid())`,
        `New-Item -ItemType Directory -Force $tmp | Out-Null`,
        `$zip = Join-Path $tmp '${asset}'`,
        `Invoke-WebRequest "${MERMAID_REPO}/releases/download/$tag/${asset}" -OutFile $zip -UseBasicParsing`,
        `$sums = (Invoke-WebRequest "${MERMAID_REPO}/releases/download/$tag/mermaid-ascii_$($tag)_checksums.txt" -UseBasicParsing).Content`,
        `if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }`,
        `$want = (($sums -split "\`n") | Where-Object { $_ -match ' ${asset.replace(/\./g, '\\.')}\\s*$' } | Select-Object -First 1) -replace '\\s.*$', ''`,
        `if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $want.ToUpper()) { throw 'mermaid-ascii checksum mismatch' }`,
        `Expand-Archive $zip -DestinationPath $tmp -Force`,
        `$dir = Join-Path $HOME '.local\\bin'; New-Item -ItemType Directory -Force $dir | Out-Null`,
        `Copy-Item (Join-Path $tmp 'mermaid-ascii.exe') (Join-Path $dir 'mermaid-ascii.exe') -Force`,
        `Remove-Item $tmp -Recurse -Force`,
        `$p = [Environment]::GetEnvironmentVariable('Path', 'User'); if (($p -split ';') -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', "$p;$dir", 'User') }`,
      ].join('; '),
    );
    return;
  }
  const asset = `mermaid-ascii_${os}_${arch}.tar.gz`;
  ctx.run(
    [
      'set -e',
      `tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' ${MERMAID_REPO}/releases/latest | sed 's#.*/tag/##')`,
      'tmp=$(mktemp -d)',
      'cd "$tmp"',
      `curl -fsSL -o ${asset} "${MERMAID_REPO}/releases/download/$tag/${asset}"`,
      `curl -fsSL -o sums "${MERMAID_REPO}/releases/download/$tag/mermaid-ascii_\${tag}_checksums.txt"`,
      `grep -E " \\*?${asset}$" sums > want`,
      'if command -v sha256sum >/dev/null; then sha256sum -c want; else shasum -a 256 -c want; fi',
      `tar xzf ${asset} mermaid-ascii`,
      'mkdir -p "$HOME/.local/bin"',
      'install -m 755 mermaid-ascii "$HOME/.local/bin/mermaid-ascii"',
      'cd / && rm -rf "$tmp"',
    ].join('; '),
  );
}

export const TOOLS = {
  'gh-axi': { name: 'gh-axi', install: npm('gh-axi'), about: 'GitHub for agents (uses your gh sign-in)', hook: true, check: versionCheck('gh-axi') },
  'chrome-devtools-axi': { name: 'chrome-devtools-axi', install: npm('chrome-devtools-axi'), about: 'browser automation for agents (needs Chrome)', hook: true, check: versionCheck('chrome-devtools-axi') },
  'lavish-axi': { name: 'lavish-axi', install: npm('lavish-axi'), about: 'review rich HTML artifacts and decision pages (Node 22+)', hook: true, minNode: [22, 0], check: versionCheck('lavish-axi') },
  'tasks-axi': {
    name: 'tasks-axi',
    install: npm('tasks-axi'),
    about: 'task/backlog CLI (firstmate needs it)',
    check: {
      about: 'adds and lists a task in a scratch backlog',
      cmd: 'tasks-axi add installer-check "installer check" --file "{tmp}/backlog.md"; tasks-axi list --state queued --file "{tmp}/backlog.md"',
      expect: /^count: 1\r?$/m,
    },
  },
  'quota-axi': { name: 'quota-axi', install: npm('quota-axi'), about: 'agent-provider quota windows (firstmate needs it; Node 22.19+)', minNode: [22, 19], check: versionCheck('quota-axi') },
  ctx7: { name: 'ctx7', install: npm('ctx7'), about: 'Context7 CLI: current library docs for agents', check: versionCheck('ctx7') },
  'notion-axi': { name: 'notion-axi', install: npm('notion-axi'), about: 'Notion for agents (github.com/maximebrmd/notion-axi)', check: versionCheck('notion-axi') },
  'gws-axi': { name: 'gws-axi', install: npm('gws-axi'), about: 'Google Workspace for agents: Gmail, Calendar, Docs, Drive (github.com/JarvusInnovations/gws-axi)', check: versionCheck('gws-axi') },
  'no-mistakes': {
    name: 'no-mistakes',
    about: 'validation pipeline: review, test, push, PR (firstmate needs it)',
    install: {
      unix: 'curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh | sh',
      windows: 'irm https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.ps1 | iex',
    },
    pathHints: ['~/.local/bin', '~/.no-mistakes/bin'],
    check: versionCheck('no-mistakes'),
  },
  treehouse: {
    name: 'treehouse',
    about: 'disposable git worktree pool for parallel agents',
    install: {
      unix: 'curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh',
      windows: 'irm https://kunchenguid.github.io/treehouse/install.ps1 | iex',
    },
    pathHints: ['~/.local/bin'],
    check: versionCheck('treehouse'),
  },
  herdr: {
    name: 'herdr',
    about: 'terminal workspace manager for agents',
    install: {
      unix: 'curl -fsSL https://herdr.dev/install.sh | sh',
      windows: 'irm https://herdr.dev/install.ps1 | iex',
    },
    pathHints: ['~/.local/bin'],
    check: versionCheck('herdr'),
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
    check: versionCheck('codex'),
  },
  pi: {
    name: 'Pi',
    bin: 'pi',
    about: 'Pi coding agent, a Firstmate harness (github.com/earendil-works/pi; Node 22.19+)',
    // packages/coding-agent/README.md: npm with --ignore-scripts, which a normal install does not need scripts for.
    install: npm('--ignore-scripts @earendil-works/pi-coding-agent'),
    minNode: [22, 19],
    signIn: 'run `pi` and sign in to a model provider',
    check: versionCheck('pi'),
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
  'mermaid-ascii': {
    name: 'mermaid-ascii',
    about: 'draws Mermaid diagrams as plain-text boxes for chat, terminals and READMEs',
    install: { default: installMermaidAscii },
    pathHints: ['~/.local/bin'],
    check: {
      about: 'draws a two-box diagram',
      files: { 'check.mmd': 'graph LR\nInstall --> Check\n' },
      cmd: 'mermaid-ascii -f "{tmp}/check.mmd"',
      expect: /Install[\s\S]*Check/,
    },
  },
  'pixel-agents': {
    name: 'pixel-agents',
    about: 'live view of what each Claude Code agent is doing, in the browser (github.com/pixel-agents-hq/pixel-agents)',
    install: npm('pixel-agents'),
    signIn: 'pixel-agents   (run it in a project; it asks before adding its Claude Code hooks)',
    // No check: see the list next to versionCheck.
  },
  gnhf: {
    name: 'gnhf',
    about: 'overnight agent loop: one small committed change per iteration toward an objective (github.com/kunchenguid/gnhf)',
    install: npm('gnhf'),
    signIn: 'gnhf --max-iterations 5 --max-tokens 2000000 "<objective>"   (run it in a clean repo; it works on a gnhf/ branch and never pushes unless given --push)',
    check: versionCheck('gnhf'),
  },
  ntn: {
    name: 'ntn',
    about: "Notion's own CLI (beta): pages, data sources, the API and workers from the terminal (developers.notion.com/cli)",
    // developers.notion.com/cli/get-started/installation: the script on macOS and Linux, winget on Windows.
    install: { unix: 'curl -fsSL https://ntn.dev | bash', windows: 'winget install --id Notion.ntn -e --accept-source-agreements --accept-package-agreements' },
    pathHints: ['~/.local/bin'],
    signIn: 'ntn login',
    check: versionCheck('ntn'),
  },
  'claude-swap': {
    name: 'claude-swap',
    bin: 'cswap',
    about: 'switch between several Claude Code accounts and see each one\'s usage (github.com/realiti4/claude-swap)',
    install: uvTool('claude-swap'),
    pathHints: ['~/.local/bin'],
    signIn: 'cswap add   (once per Claude account, while signed in to it)',
    check: versionCheck('cswap'),
  },
  notebooklm: {
    name: 'notebooklm-mcp-cli',
    bin: 'nlm',
    about: 'NotebookLM for agents: the nlm CLI and an MCP server (github.com/jacob-bd/notebooklm-mcp-cli)',
    install: uvTool('notebooklm-mcp-cli'),
    pathHints: ['~/.local/bin'],
    signIn: 'nlm login   (signs in with your Google account in a browser)',
    check: versionCheck('nlm'),
  },
  m365: {
    name: 'CLI for Microsoft 365',
    bin: 'm365',
    about: 'Microsoft 365 and SharePoint from the terminal (github.com/pnp/cli-microsoft365)',
    install: npm('@pnp/cli-microsoft365'),
    signIn: 'm365 setup, then m365 login',
    check: versionCheck('m365'),
  },
  vercel: {
    name: 'Vercel CLI',
    bin: 'vercel',
    about: 'deploy and manage Vercel projects (github.com/vercel/vercel)',
    install: npm('vercel'),
    signIn: 'vercel login',
    check: versionCheck('vercel'),
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

// A wrapper in ~/.local/bin only takes effect when that folder comes before the real tool's.
export function warnPathOrder(ctx, target, bin) {
  if (ctx.platform.simulated || ctx.dryRun) return;
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const mine = dirs.indexOf(path.dirname(target));
  const real = dirs.findIndex((d, i) => i !== mine && fs.existsSync(path.join(d, bin)));
  if (mine === -1 || (real !== -1 && real < mine)) ctx.warn(`${path.dirname(target)} must come before ${real === -1 ? 'the real ' + bin : dirs[real]} on PATH for the ${bin} wrapper to work`);
}
