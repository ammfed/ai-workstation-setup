import { Skip } from '../../lib/context.mjs';

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
    { key: 'TERMINAL_WRITE_CONFIG', type: 'confirm', message: 'Write ~/.wezterm.lua (an existing one is only replaced if you agree)?', default: true },
    { key: 'TERMINAL_COLOR_SCHEME', type: 'text', message: 'Color scheme (any WezTerm built-in)', default: 'Tokyo Night', when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
    { key: 'TERMINAL_FONT_SIZE', type: 'text', message: 'Font size', default: '11.5', when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
    { key: 'TERMINAL_OPACITY', type: 'text', message: 'Window opacity (0.5 - 1.0)', default: '0.88', when: (ctx) => ctx.get('TERMINAL_WRITE_CONFIG') },
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

    if (ctx.get('TERMINAL_WRITE_CONFIG')) {
      await ctx.step('~/.wezterm.lua', () => {
        const opacity = Number(ctx.get('TERMINAL_OPACITY'));
        const size = Number(ctx.get('TERMINAL_FONT_SIZE'));
        if (!(opacity >= 0.3 && opacity <= 1)) throw new Error(`opacity must be between 0.3 and 1, got ${ctx.get('TERMINAL_OPACITY')}`);
        if (!(size > 4 && size < 72)) throw new Error(`font size looks wrong: ${ctx.get('TERMINAL_FONT_SIZE')}`);
        const content = ctx.template('terminal/wezterm.lua', {
          COLOR_SCHEME: ctx.get('TERMINAL_COLOR_SCHEME').replace(/'/g, "\\'"),
          FONT_SIZE: size,
          OPACITY: opacity,
          WSL_DEFAULT: ctx.get('TERMINAL_WSL_DEFAULT') ? 'true' : 'false',
        });
        return ctx.writeFile('~/.wezterm.lua', content, { onConflict: 'ask' });
      });
    }
  },
};
