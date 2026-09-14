-- WezTerm config written by ai-workstation-setup (modules/terminal).
-- Edit freely: the installer never overwrites a changed file without asking.
-- Reference: https://wezterm.org/config/files.html

local wezterm = require 'wezterm'
local config = wezterm.config_builder()

local is_windows = wezterm.target_triple:find('windows') ~= nil
local is_macos = wezterm.target_triple:find('darwin') ~= nil

-- Glass: translucent background, fully opaque text.
config.window_background_opacity = {{OPACITY}}
config.text_background_opacity = 1.0
if is_windows then
  config.win32_system_backdrop = 'Acrylic' -- frosted blur on Windows 11
end
if is_macos then
  config.macos_window_background_blur = 30
end

-- Chrome
config.window_decorations = 'TITLE|RESIZE'
config.use_fancy_tab_bar = false
config.hide_tab_bar_if_only_one_tab = false
config.window_padding = { left = 18, right = 18, top = 14, bottom = 10 }

-- Colors and type. Fonts fall back in order; install a Nerd Font for icons.
config.color_scheme = '{{COLOR_SCHEME}}'
config.font = wezterm.font_with_fallback {
  'JetBrainsMono Nerd Font',
  'Cascadia Code',
  'Menlo',
  'DejaVu Sans Mono',
}
config.font_size = {{FONT_SIZE}}
config.line_height = 1.15
config.default_cursor_style = 'BlinkingBar'
config.colors = {
  tab_bar = {
    background = 'rgba(0,0,0,0)',
    active_tab = { bg_color = 'rgba(60,60,90,0.4)', fg_color = '#c0caf5' },
    inactive_tab = { bg_color = 'rgba(0,0,0,0)', fg_color = '#565f89' },
    inactive_tab_hover = { bg_color = 'rgba(60,60,90,0.25)', fg_color = '#c0caf5' },
    new_tab = { bg_color = 'rgba(0,0,0,0)', fg_color = '#565f89' },
    new_tab_hover = { bg_color = 'rgba(150,160,210,0.35)', fg_color = '#c0caf5' },
  },
}

-- On Windows, optionally open the first WSL distro instead of PowerShell.
local use_wsl = {{WSL_DEFAULT}}
if is_windows and use_wsl then
  local domains = wezterm.default_wsl_domains()
  if #domains > 0 then
    config.default_domain = domains[1].name
  end
end

config.scrollback_lines = 10000
config.audible_bell = 'Disabled'
config.adjust_window_size_when_changing_font_size = false

return config
