import { Skip } from '../../lib/context.mjs';

// JetBrainsMono Nerd Font, the config's first font, from Nerd Fonts' own instructions
// (github.com/ryanoasis/nerd-fonts README): the Homebrew cask on macOS, the release archive
// unpacked into the user font folder on Linux.
const FONT_FAMILY = 'JetBrainsMono Nerd Font';
const FONT_ARCHIVE = 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.tar.xz';
const FONT_DIR = '~/.local/share/fonts/JetBrainsMonoNerd';

async function installFont(ctx) {
  if (ctx.os === 'wsl') throw new Skip('WezTerm draws with Windows fonts; install the font on the Windows side (install.ps1 --modules terminal)');
  if (ctx.os === 'windows') {
    ctx.todo(`install ${FONT_FAMILY}: download JetBrainsMono.zip from https://github.com/ryanoasis/nerd-fonts/releases/latest, unzip, select the .ttf files and choose Install`);
    return;
  }
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
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  unsupported: {},
  requires: [],
  default: false,
  questions: [
    { key: 'TERMINAL_INSTALL_WEZTERM', type: 'confirm', message: 'Install WezTerm?', default: true },
    { key: 'TERMINAL_INSTALL_FONT', type: 'confirm', message: 'Install JetBrainsMono Nerd Font, the font the config asks for first (icons included)?', default: true },
    { key: 'TERMINAL_WRITE_CONFIG', type: 'confirm', message: 'Write ~/.wezterm.lua (an existing one is only replaced if you agree)?', default: true },
    { key: 'TERMINAL_COLOR_SCHEME', type: 'text', message: 'Color scheme (any WezTerm built-in)', default: 'Tokyo Night', when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
    { key: 'TERMINAL_FONT_SIZE', type: 'text', message: 'Font size', default: '11.5', when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
    { key: 'TERMINAL_OPACITY', type: 'text', message: 'Window opacity (0.5 - 1.0)', default: '0.88', when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
    {
      key: 'TERMINAL_CURSOR_BLINK_MS',
      type: 'text',
      message: 'Cursor blink interval in milliseconds (0 for a steady cursor)',
      default: '500',
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
    if (ctx.os === 'wsl') {
      ctx.info('inside WSL: WezTerm is a Windows app, so run install.ps1 on the Windows side for it; only the config is written here');
    } else if (ctx.get('TERMINAL_INSTALL_WEZTERM')) {
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
      await ctx.step('~/.wezterm.lua', () => {
        const blink = cursorBlinkMs(ctx.get('TERMINAL_CURSOR_BLINK_MS'));
        const opacity = Number(ctx.get('TERMINAL_OPACITY'));
        const size = Number(ctx.get('TERMINAL_FONT_SIZE'));
        if (!(opacity >= 0.3 && opacity <= 1)) throw new Error(`opacity must be between 0.3 and 1, got ${ctx.get('TERMINAL_OPACITY')}`);
        if (!(size > 4 && size < 72)) throw new Error(`font size looks wrong: ${ctx.get('TERMINAL_FONT_SIZE')}`);
        const content = ctx.template('terminal/wezterm.lua', {
          COLOR_SCHEME: ctx.get('TERMINAL_COLOR_SCHEME').replace(/'/g, "\\'"),
          FONT_SIZE: size,
          OPACITY: opacity,
          CURSOR_STYLE: blink ? 'BlinkingBar' : 'SteadyBar',
          CURSOR_BLINK_RATE: blink,
          WSL_DEFAULT: ctx.get('TERMINAL_WSL_DEFAULT') ? 'true' : 'false',
        });
        return ctx.writeFile('~/.wezterm.lua', content, { onConflict: 'ask' });
      });
    }
  },
};
