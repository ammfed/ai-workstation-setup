import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { installSkill } from '../../lib/claude.mjs';
import { versionCheck } from '../agent-clis/tools.mjs';

// clickup-axi: github.com/JanSuthacheeva/clickup-axi. Its README documents the
// agent skill; the binary comes from the same project's GitHub releases, with
// the published SHA256SUMS checked before it is installed.
const REPO = 'JanSuthacheeva/clickup-axi';
const BASE = `https://github.com/${REPO}/releases/latest/download`;

function releaseAsset(ctx) {
  const arch = { x64: 'amd64', arm64: 'arm64' }[ctx.platform.arch];
  const goos = { linux: 'linux', wsl: 'linux', macos: 'darwin', windows: 'windows' }[ctx.os];
  if (!arch || (goos === 'windows' && arch !== 'amd64')) return null;
  return `clickup-axi_${goos}_${arch}${goos === 'windows' ? '.exe' : ''}`;
}

function installBinary(ctx) {
  const asset = releaseAsset(ctx);
  if (!asset) throw new Skip(`clickup-axi publishes no binary for ${ctx.os}/${ctx.platform.arch}`);
  if (ctx.os === 'windows') {
    ctx.run(
      [
        `$dir = Join-Path $HOME '.local\\bin'; New-Item -ItemType Directory -Force $dir | Out-Null`,
        `$out = Join-Path $dir 'clickup-axi.exe'`,
        `Invoke-WebRequest '${BASE}/${asset}' -OutFile $out -UseBasicParsing`,
        `$sums = (Invoke-WebRequest '${BASE}/SHA256SUMS' -UseBasicParsing).Content`,
        `if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }`,
        `$want = (($sums -split "\`n") | Where-Object { $_ -match ' \\*?${asset.replace(/\./g, '\\.')}\\s*$' } | Select-Object -First 1) -replace '\\s.*$', ''`,
        `if ((Get-FileHash $out -Algorithm SHA256).Hash -ne $want.ToUpper()) { Remove-Item $out; throw 'clickup-axi checksum mismatch' }`,
        `$p = [Environment]::GetEnvironmentVariable('Path', 'User'); if (($p -split ';') -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', "$p;$dir", 'User') }`,
      ].join('; '),
    );
    return;
  }
  ctx.run(
    [
      'set -e',
      'tmp=$(mktemp -d)',
      `curl -fsSL -o "$tmp/${asset}" "${BASE}/${asset}"`,
      `curl -fsSL -o "$tmp/SHA256SUMS" "${BASE}/SHA256SUMS"`,
      `cd "$tmp"`,
      `grep -E " \\*?${asset}$" SHA256SUMS > want`,
      'if command -v sha256sum >/dev/null; then sha256sum -c want; else shasum -a 256 -c want; fi',
      'mkdir -p "$HOME/.local/bin"',
      `install -m 755 "$tmp/${asset}" "$HOME/.local/bin/clickup-axi"`,
      'rm -rf "$tmp"',
    ].join('; '),
  );
}

export default {
  name: 'clickup',
  title: 'ClickUp',
  description: 'clickup-axi CLI, its agent skill and session hook, plus a workspace structure guide',
  order: 80,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: false,
  questions: [
    {
      key: 'CLICKUP_TOKEN',
      type: 'secret',
      env: 'CLICKUP_TOKEN',
      message: 'ClickUp personal API token (ClickUp → Settings → Apps → API Token)',
    },
    { key: 'CLICKUP_SKILL', type: 'confirm', message: 'Install the clickup-axi agent skill for Claude Code?', default: true },
    { key: 'CLICKUP_HOOK', type: 'confirm', message: 'Install the session-start hook (a ClickUp dashboard at the start of each agent session)?', default: true },
    { key: 'CLICKUP_DEFAULT_LIST', type: 'text', message: 'Default list for new tasks (name or id; empty to skip)', default: '' },
  ],

  async install(ctx) {
    await ctx.step('clickup-axi', () =>
      ctx.ensureTool({ name: 'clickup-axi', install: { default: installBinary }, pathHints: ['~/.local/bin'], check: versionCheck('clickup-axi') }),
    );

    if (ctx.get('CLICKUP_SKILL')) await ctx.step('skill', () => installSkill(ctx, REPO, 'clickup-axi'));

    const token = ctx.get('CLICKUP_TOKEN');
    const tokenFile = path.join(ctx.home, '.config', 'clickup-axi', 'token');
    const authed = ctx.os !== 'windows' && fs.existsSync(tokenFile);
    await ctx.step('sign in', () => {
      if (authed) return ctx.ok('clickup-axi already has a stored token');
      if (!token) return ctx.todo('clickup-axi auth login   (or set CLICKUP_TOKEN)');
      ctx.run('clickup-axi auth login', { input: `${token}\n` });
    });

    if (ctx.get('CLICKUP_HOOK')) {
      // Re-running is a no-op per `clickup-axi setup --help`. It targets every detected agent host.
      await ctx.step('session hook', () => ctx.run('clickup-axi setup --global'));
    }

    const list = ctx.get('CLICKUP_DEFAULT_LIST');
    if (list) {
      await ctx.step('default list', () => {
        if (!authed && !token) throw new Skip('sign in first, then: clickup-axi config set default_list "<list>"');
        ctx.run(`clickup-axi config set default_list "${list.replace(/"/g, '')}"`);
      });
    }
    ctx.info('suggested workspace layout: docs/clickup-structure.md');
  },
};
