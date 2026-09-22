// Install routes for the agent CLIs, each taken from the tool's upstream README.
// Shared with the firstmate module, which needs some of them for its backend.

const npm = (pkg) => ({ default: { npm: pkg } });

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
  'gh-axi': { name: 'gh-axi', install: npm('gh-axi'), about: 'GitHub for agents (uses your gh sign-in)', hook: true },
  'chrome-devtools-axi': { name: 'chrome-devtools-axi', install: npm('chrome-devtools-axi'), about: 'browser automation for agents (needs Chrome)', hook: true },
  'lavish-axi': { name: 'lavish-axi', install: npm('lavish-axi'), about: 'review rich HTML artifacts and decision pages (Node 22+)', hook: true, minNode: [22, 0] },
  'tasks-axi': {
    name: 'tasks-axi',
    install: npm('tasks-axi'),
    about: 'task/backlog CLI (firstmate needs it)',
    check: {
      about: 'adds and lists a task in a scratch backlog',
      cmd: 'tasks-axi add installer-check "installer check" --file "{tmp}/backlog.md"; tasks-axi list --file "{tmp}/backlog.md"',
      expect: /installer-check,queued/,
    },
  },
  // Pinned: 0.1.50 (quota-axi PR #248) reads Claude's usage `utilization` as headroom, so it
  // reports the share used as the share left; Claude Code's own status line and 0.1.49 agree
  // it is the share used. Move to @latest once a release reverts that.
  'quota-axi': { name: 'quota-axi', install: npm('quota-axi@0.1.49'), about: 'agent-provider quota windows (firstmate needs it; Node 22.19+)', minNode: [22, 19] },
  ctx7: { name: 'ctx7', install: npm('ctx7'), about: 'Context7 CLI: current library docs for agents' },
  'notion-axi': { name: 'notion-axi', install: npm('notion-axi'), about: 'Notion for agents (github.com/maximebrmd/notion-axi)' },
  'gws-axi': { name: 'gws-axi', install: npm('gws-axi'), about: 'Google Workspace for agents: Gmail, Calendar, Docs, Drive (github.com/JarvusInnovations/gws-axi)' },
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
