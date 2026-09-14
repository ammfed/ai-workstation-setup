import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { addSessionStartHook, setClaudeEnv } from '../../lib/claude.mjs';

// An Obsidian vault skeleton with a frontmatter contract agents can rely on,
// plus the machine wiring that lets agents read and write it (obsidian-axi).
// Existing vault files are never modified.
const FOLDERS = ['00-inbox', '01-maps', '02-templates', '09-generated', '10-pillars', '11-people', '12-orgs', '20-notes', '21-sources', '30-projects', '31-meetings', '90-archive'];

const list = (s) => [...new Set(String(s).split(',').map((x) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))];

export default {
  name: 'second-brain',
  title: 'Second brain (Obsidian vault)',
  description: 'Obsidian vault skeleton with note templates and an agent contract, plus obsidian-axi wiring',
  order: 70,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: true,
  questions: [
    { key: 'VAULT_PATH', type: 'text', path: true, message: 'Vault folder (created if missing; existing notes are never touched)', default: '~/second-brain' },
    { key: 'VAULT_PILLARS', type: 'text', message: 'Life areas ("pillars"), comma-separated, at most 9', default: 'personal,professional,learning,health,finance' },
    { key: 'VAULT_LANGS', type: 'text', message: 'Languages notes are written in, comma-separated codes', default: 'en' },
    { key: 'VAULT_GIT', type: 'confirm', message: 'Track the vault with git?', default: true },
    { key: 'VAULT_AGENT_ACCESS', type: 'confirm', message: 'Give agents access (obsidian-axi, OBSIDIAN_VAULT, a Claude Code session hook)?', default: true },
    { key: 'VAULT_APP', type: 'confirm', message: 'Install the Obsidian app?', default: false },
  ],

  async install(ctx) {
    const vault = ctx.get('VAULT_PATH');
    const pillars = list(ctx.get('VAULT_PILLARS'));
    const langs = list(ctx.get('VAULT_LANGS'));
    if (!pillars.length || pillars.length > 9) throw new Error(`give 1 to 9 pillars, got ${pillars.length}`);
    const today = new Date().toISOString().slice(0, 10);
    const vars = {
      PILLARS: pillars.join(' | '),
      LANGS: [...langs, 'mixed'].join(' | '),
      DEFAULT_LANG: langs[0] || 'en',
      PILLAR_FILES: pillars.map((p, i) => `\`10.0${i + 1} ${p}.md\``).join(', '),
      TODAY: today,
    };

    await ctx.step('folders', () => {
      const created = FOLDERS.filter((f) => ctx.mkdir(path.join(vault, f)));
      if (created.length === 0) ctx.ok(`all ${FOLDERS.length} folders exist in ${vault}`);
      else if (!ctx.dryRun) ctx.ok(`created ${created.length} folder(s) in ${vault}`);
    });

    await ctx.step('vault contract', async () => {
      await ctx.writeFile(path.join(vault, 'AGENTS.md'), ctx.template('second-brain/AGENTS.md', vars));
      await ctx.writeFile(path.join(vault, 'CLAUDE.md'), ctx.template('second-brain/CLAUDE.md', vars));
      await ctx.writeFile(path.join(vault, '.gitignore'), ctx.template('second-brain/gitignore', vars));
      await ctx.writeFile(path.join(vault, '.obsidian', 'templates.json'), `${JSON.stringify({ folder: '02-templates' }, null, 2)}\n`);
    });

    await ctx.step('note templates', async () => {
      const dir = path.join(ctx.repoRoot, 'templates', 'second-brain', '02-templates');
      for (const file of fs.readdirSync(dir).sort()) {
        await ctx.writeFile(path.join(vault, '02-templates', file), ctx.template(`second-brain/02-templates/${file}`, vars));
      }
    });

    await ctx.step('pillar notes', async () => {
      for (const [i, name] of pillars.entries()) {
        const id = `10.0${i + 1}`;
        await ctx.writeFile(path.join(vault, '10-pillars', `${id} ${name}.md`), ctx.template('second-brain/pillar-note.md', { ...vars, ID: id, NAME: name }));
      }
    });

    if (ctx.get('VAULT_GIT')) {
      await ctx.step('git', () => {
        if (fs.existsSync(path.join(vault, '.git'))) return ctx.ok('vault is already a git repository');
        ctx.run(`git init "${vault}"`);
      });
    }

    if (ctx.get('VAULT_AGENT_ACCESS')) {
      // obsidian-axi resolves the vault from OBSIDIAN_VAULT, then defaultVault in ~/.config/obsidian-axi/config.json.
      await ctx.step('obsidian-axi', () => ctx.ensureTool({ name: 'obsidian-axi', install: { default: { npm: '@andershoffmann/obsidian-axi' } } }));
      await ctx.step('defaultVault', () =>
        ctx.updateJson(path.join(ctx.home, '.config', 'obsidian-axi', 'config.json'), (cfg) => {
          cfg.defaultVault = vault;
        }, 'obsidian-axi defaultVault'),
      );
      await ctx.step('OBSIDIAN_VAULT', () => ctx.setUserEnv('OBSIDIAN_VAULT', vault));
      await ctx.step('Claude Code env', () => setClaudeEnv(ctx, 'OBSIDIAN_VAULT', vault));
      await ctx.step('Claude Code hook', () => addSessionStartHook(ctx, 'obsidian-axi'));
    }

    if (ctx.get('VAULT_APP')) {
      await ctx.step('Obsidian app', () => {
        if (ctx.os === 'linux') {
          if (!ctx.has('flatpak') && !ctx.platform.simulated) throw new Skip('flatpak is not installed; download Obsidian from https://obsidian.md/download');
          if (ctx.capture('flatpak info md.obsidian.Obsidian') !== null) return ctx.ok('Obsidian (flatpak) already installed');
          return ctx.run('flatpak install -y flathub md.obsidian.Obsidian');
        }
        const where = ctx.os === 'wsl' ? 'on the Windows side ' : '';
        ctx.todo(`install Obsidian ${where}from https://obsidian.md/download`);
      });
    }
    ctx.info(`open ${vault} in Obsidian with "Open folder as vault"; agents read ${path.join(vault, 'AGENTS.md')}`);
  },
};
