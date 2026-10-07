import { Skip } from '../../lib/context.mjs';

// JetBrainsMono Nerd Font, the config's first font, from Nerd Fonts' own instructions
// (github.com/ryanoasis/nerd-fonts README): the Homebrew cask on macOS, the release archive
// unpacked into the user font folder on Linux.
const FONT_FAMILY = 'JetBrainsMono Nerd Font';
const FONT_ARCHIVE = 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.tar.xz';
const FONT_DIR = '~/.local/share/fonts/JetBrainsMonoNerd';

// Windows: the same release archive, installed for this user only (no administrator): the
// .ttf files go to %LOCALAPPDATA%\Microsoft\Windows\Fonts and are registered under HKCU.
// Single quotes only, so Windows PowerShell 5.1 runs it unchanged.
const WIN_FONT_ARCHIVE = 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip';
const WIN_FONT_FILE = 'JetBrainsMonoNerdFont-Regular.ttf';
const WIN_FONT_INSTALL = [
  "$z = Join-Path $env:TEMP 'JetBrainsMono.zip'; $d = Join-Path $env:TEMP 'JetBrainsMonoNerdFont'",
  `Invoke-WebRequest -UseBasicParsing -Uri '${WIN_FONT_ARCHIVE}' -OutFile $z`,
  'Expand-Archive -Force -Path $z -DestinationPath $d',
  "$fonts = Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Fonts'; New-Item -ItemType Directory -Force -Path $fonts | Out-Null",
  "$key = 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'",
  "Get-ChildItem -Path $d -Filter '*.ttf' | ForEach-Object { $t = Join-Path $fonts $_.Name; Copy-Item -Force $_.FullName $t; New-ItemProperty -Path $key -Name ($_.BaseName + ' (TrueType)') -Value $t -PropertyType String -Force | Out-Null }",
  'Remove-Item -Recurse -Force $z, $d',
].join('; ');

/** Install the font on Windows for this user; shared with the wsl module. */
export function installFontWindows(ctx) {
  const probe = `@((Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Fonts\\${WIN_FONT_FILE}'), (Join-Path $env:WINDIR 'Fonts\\${WIN_FONT_FILE}')) | Where-Object { Test-Path $_ }`;
  if (!ctx.platform.simulated && ctx.capture(probe)) return ctx.ok(`${FONT_FAMILY} already installed`);
  ctx.run(WIN_FONT_INSTALL);
  if (!ctx.dryRun) ctx.ok(`${FONT_FAMILY} installed for your Windows user; restart WezTerm to pick it up`);
}

async function installFont(ctx) {
  if (ctx.os === 'windows') return installFontWindows(ctx);
  if (ctx.os === 'macos') {
    if (!ctx.platform.simulated && ctx.capture('brew list --cask font-jetbrains-mono-nerd-font') !== null) return ctx.ok(`${FONT_FAMILY} already installed`);
    if (!ctx.dryRun && !ctx.has('brew')) throw new Skip('needs Homebrew; or download JetBrainsMono.zip from https://github.com/ryanoasis/nerd-fonts/releases/latest');
    return ctx.run('brew install --cask font-jetbrains-mono-nerd-font');
  }
  if (!ctx.platform.simulated && (ctx.capture(`fc-list : family | grep -F "${FONT_FAMILY}"`) || '').length) return ctx.ok(`${FONT_FAMILY} already installed`);
  if (!ctx.platform.simulated && !ctx.dryRun) {
    for (const bin of ['curl', 'tar', 'fc-cache']) if (!ctx.has(bin)) throw new Skip(`needs ${bin}; or install the font by hand from https://github.com/ryanoasis/nerd-fonts/releases/latest`);
  }
  const dir = ctx.path(FONT_DIR);
  ctx.run(`mkdir -p "${dir}" && curl -fsSL ${FONT_ARCHIVE} | tar -xJ -C "${dir}" && fc-cache -f "${dir}"`);
}

export const CONFIG_DEFAULTS = { scheme: 'Tokyo Night', size: '11.5', opacity: '0.88', blink: '500' };

/**
 * Write ~/.wezterm.lua; shared with the wsl module. `wsl` opens new tabs in WSL: true takes
 * the first distribution that is not Docker's, a name (Ubuntu) takes that one when present.
 */
export function writeConfig(ctx, { scheme, size, opacity, blink, wsl = false }) {
  const blinkMs = cursorBlinkMs(blink);
  const op = Number(opacity);
  const sz = Number(size);
  if (!(op >= 0.3 && op <= 1)) throw new Error(`opacity must be between 0.3 and 1, got ${opacity}`);
  if (!(sz > 4 && sz < 72)) throw new Error(`font size looks wrong: ${size}`);
  const content = ctx.template('terminal/wezterm.lua', {
    COLOR_SCHEME: String(scheme).replace(/'/g, "\\'"),
    FONT_SIZE: sz,
    OPACITY: op,
    CURSOR_STYLE: blinkMs ? 'BlinkingBar' : 'SteadyBar',
    CURSOR_BLINK_RATE: blinkMs,
    WSL_DEFAULT: wsl ? 'true' : 'false',
    WSL_DISTRO: typeof wsl === 'string' ? wsl.replace(/[^\w.-]/g, '') : '',
  });
  return ctx.writeFile('~/.wezterm.lua', content, { onConflict: 'ask' });
}

export function cursorBlinkMs(text) {
  const ms = Number(String(text ?? '').trim());
  if (!Number.isInteger(ms) || ms < 0 || ms > 5000) throw new Error(`TERMINAL_CURSOR_BLINK_MS: "${text}" should be milliseconds from 0 (no blink) to 5000`);
  return ms;
}

export default {
  name: 'terminal',
  title: 'Terminal (WezTerm)',
  description: 'Optional: WezTerm with a translucent dark theme',
  order: 90,
  platforms: ['linux', 'macos', 'windows'],
  unsupported: {
    wsl: 'WezTerm and its font are Windows apps that read the Windows home folder; .\\install.ps1 --modules wsl (from Windows) installs them and writes the config there',
  },
  requires: [],
  default: false,
  questions: [
    { key: 'TERMINAL_INSTALL_WEZTERM', type: 'confirm', message: 'Install WezTerm?', default: true },
    { key: 'TERMINAL_INSTALL_FONT', type: 'confirm', message: 'Install JetBrainsMono Nerd Font, the font the config asks for first (icons included)?', default: true },
    { key: 'TERMINAL_WRITE_CONFIG', type: 'confirm', message: 'Write ~/.wezterm.lua (an existing one is only replaced if you agree)?', default: true },
    { key: 'TERMINAL_COLOR_SCHEME', type: 'text', message: 'Color scheme (any WezTerm built-in)', default: CONFIG_DEFAULTS.scheme, when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
    { key: 'TERMINAL_FONT_SIZE', type: 'text', message: 'Font size', default: CONFIG_DEFAULTS.size, when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
    { key: 'TERMINAL_OPACITY', type: 'text', message: 'Window opacity (0.5 - 1.0)', default: CONFIG_DEFAULTS.opacity, when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
    {
      key: 'TERMINAL_CURSOR_BLINK_MS',
      type: 'text',
      message: 'Cursor blink interval in milliseconds (0 for a steady cursor)',
      default: CONFIG_DEFAULTS.blink,
      when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG'),
    },
    {
      key: 'TERMINAL_WSL_DEFAULT',
      type: 'confirm',
      message: 'Open new WezTerm tabs in your WSL distro by default?',
      default: false,
      when: (ctx) => ctx.os === 'windows' && ctx.get('TERMINAL_WRITE_CONFIG'),
    },
  ],

  async install(ctx) {
    if (ctx.get('TERMINAL_INSTALL_WEZTERM')) {
      // wezterm.org/installation
      await ctx.step('WezTerm', () =>
        ctx.ensureTool({
          name: 'WezTerm',
          bin: 'wezterm',
          install: {
            macos: 'brew install --cask wezterm',
            windows: { pkg: { winget: 'wez.wezterm', scoop: 'extras/wezterm', choco: 'wezterm' } },
            linux: (c) => {
              if (!c.has('flatpak') && !c.platform.simulated) {
                throw new Skip('flatpak is not installed; see https://wezterm.org/install/linux.html for your distro');
              }
              c.run('flatpak install -y flathub org.wezfurlong.wezterm');
            },
          },
          // Its version is a date-style build id, not x.y.z, so it does not take the shared versionCheck.
          check: { about: 'reports its build', cmd: 'wezterm --version', expect: /^wezterm \S+/m },
        }),
      );
    }

    if (ctx.get('TERMINAL_INSTALL_FONT')) await ctx.step(FONT_FAMILY, () => installFont(ctx));

    if (ctx.get('TERMINAL_WRITE_CONFIG')) {
      await ctx.step('~/.wezterm.lua', () =>
        writeConfig(ctx, {
          scheme: ctx.get('TERMINAL_COLOR_SCHEME'),
          size: ctx.get('TERMINAL_FONT_SIZE'),
          opacity: ctx.get('TERMINAL_OPACITY'),
          blink: ctx.get('TERMINAL_CURSOR_BLINK_MS'),
          wsl: ctx.get('TERMINAL_WSL_DEFAULT'),
        }),
      );
    }
  },
};
