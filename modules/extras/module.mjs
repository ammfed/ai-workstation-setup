import fs from 'node:fs';
import { Skip } from '../../lib/context.mjs';
import { versionCheck } from '../agent-clis/tools.mjs';

// Optional desktop and document tools that sit next to an agent setup. Nothing is
// selected unless you pick it.
//   docling: docs "pip install docling" (github.com/docling-project/docling); installed
//     as an isolated CLI with uv or pipx when one is available.
//   OpenWhispr: docs quickstart downloads a release (github.com/OpenWhispr/openwhispr);
//     the same app is packaged as a Homebrew cask and a winget package.

const EXTRAS = [
  {
    value: 'docling',
    label: 'docling - turns PDFs, Word, PowerPoint and HTML files into clean markdown agents can read',
    async install(ctx) {
      return ctx.ensureTool({
        name: 'docling',
        install: {
          default: (c) => {
            if (c.dryRun && c.platform.simulated) return c.run('uv tool install docling   (or pipx install docling)');
            if (c.has('uv')) return c.run('uv tool install docling');
            if (c.has('pipx')) return c.run('pipx install docling');
            throw new Skip('needs uv or pipx for an isolated install; or run `pip install docling` yourself');
          },
        },
        pathHints: ['~/.local/bin'],
        check: versionCheck('docling'),
      });
    },
  },
  {
    value: 'openwhispr',
    label: 'openwhispr - desktop voice dictation: speak, and the text appears where your cursor is',
    // No check: a desktop app, not installed through ensureTool, with no offline command-line check.
    async install(ctx) {
      if (ctx.os === 'wsl') throw new Skip('a desktop app; install it on the Windows side (winget install --id OpenWhispr.OpenWhispr -e)');
      if (ctx.os === 'macos') {
        if (fs.existsSync('/Applications/OpenWhispr.app')) return ctx.ok('OpenWhispr already installed');
        if (!ctx.dryRun && !ctx.has('brew')) throw new Skip('needs Homebrew; or download it from https://github.com/OpenWhispr/openwhispr/releases/latest');
        ctx.run('brew install --cask openwhispr');
      } else if (ctx.os === 'windows') {
        if ((ctx.capture('winget list --id OpenWhispr.OpenWhispr -e') || '').includes('OpenWhispr')) return ctx.ok('OpenWhispr already installed');
        ctx.run('winget install --id OpenWhispr.OpenWhispr -e --accept-source-agreements --accept-package-agreements');
      } else {
        if (ctx.has('openwhispr')) return ctx.ok('OpenWhispr already installed');
        ctx.todo('install OpenWhispr from https://github.com/OpenWhispr/openwhispr/releases/latest (.deb, .rpm or .AppImage)');
        return;
      }
      ctx.todo('open OpenWhispr once: pick cloud, your own key, or a local model, and allow the microphone');
    },
  },
];

export default {
  name: 'extras',
  title: 'Extra tools',
  description: 'Optional: docling document converter, OpenWhispr voice dictation',
  order: 90,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: false,
  questions: [
    {
      key: 'EXTRAS',
      type: 'multi',
      message: 'Extra tools to install',
      default: [],
      choices: EXTRAS,
    },
  ],

  async install(ctx) {
    const chosen = EXTRAS.filter((e) => ctx.get('EXTRAS').includes(e.value));
    if (!chosen.length) throw new Skip('no extras selected');
    for (const e of chosen) await ctx.step(e.value, () => e.install(ctx));
  },
};
