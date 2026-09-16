import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { addSessionStartHook, setClaudeEnv } from '../../lib/claude.mjs';

// A second brain: plain markdown notes with a frontmatter contract agents can rely on, plus
// the scripts that keep that contract true. Two kinds of folder hold notes. Life-area folders
// hold topic notes and are the user's to name. Entity folders hold one fixed note type each
// and ship empty. There is no numbering scheme and no search index: a generated MAP.md plus
// grep is how the vault is read.
//
// Raw source files stay outside the vault and are never copied in or modified, so the vault is
// a layer of notes over an archive it does not own. Existing vault files are never modified.

// One fixed note type each, and what belongs in them.
const ENTITY_FOLDERS = {
  people: 'One note per person. What they do, how they relate to you, and what you have agreed.',
  projects: 'One note per initiative, carrying `stage: idea|active|on-hold|done` and its next action.',
  decisions: 'One note per decision made: what was decided, why, and what it affects.',
  meetings: 'One note per meeting. The filename starts `YYYY-MM-DD`, so `ls` reads as a timeline.',
  journal: 'One note per day, filename `YYYY-MM-DD.md`. Transient: capture here, then sweep it into real notes.',
  reviews: 'Weekly or monthly reviews. The per-life-area sweep, and where a project stage changes on purpose.',
  sources: 'One note per raw file ingested. The bridge to the original document, which never enters this vault.',
};

const NOTE_TYPES = ['source', 'topic', 'person', 'project', 'decision', 'meeting', 'daily', 'review'];
const SCRIPTS = ['lib-vault.mjs', 'index.mjs', 'check.mjs', 'ingest.mjs', 'housekeeping.mjs'];

const list = (s) => [...new Set(String(s).split(',').map((x) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))];

export default {
  name: 'second-brain',
  title: 'Second brain (Obsidian vault)',
  description: 'Markdown vault with a note contract, provenance rules, note templates and the scripts that keep them true',
  order: 70,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: true,
  questions: [
    { key: 'VAULT_PATH', type: 'text', path: true, message: 'Vault folder (created if missing; existing notes are never touched)', default: '~/second-brain' },
    { key: 'VAULT_PILLARS', type: 'text', message: 'Life areas, one folder each, comma-separated (an example set; edit it to match your life)', default: 'professional,personal,growth,health,finance' },
    { key: 'VAULT_RAW_DIR', type: 'text', path: true, message: 'Where raw source files live, OUTSIDE the vault (never copied in, never modified)', default: '~/raw-sources' },
    { key: 'VAULT_LANGS', type: 'text', message: 'Languages notes are written in, comma-separated codes', default: 'en' },
    { key: 'VAULT_SCRIPTS', type: 'confirm', message: 'Install the vault scripts (map generator, contract checker, ingestion driver, housekeeping pass)?', default: true },
    { key: 'VAULT_GIT', type: 'confirm', message: 'Track the vault with git?', default: true },
    { key: 'VAULT_AGENT_ACCESS', type: 'confirm', message: 'Give agents access (obsidian-axi, OBSIDIAN_VAULT, a Claude Code session hook)?', default: true },
    { key: 'VAULT_APP', type: 'confirm', message: 'Install the Obsidian app?', default: false },
  ],

  async install(ctx) {
    const vault = ctx.get('VAULT_PATH');
    const pillars = list(ctx.get('VAULT_PILLARS'));
    const langs = list(ctx.get('VAULT_LANGS'));
    const rawDir = ctx.get('VAULT_RAW_DIR');
    const scripts = ctx.get('VAULT_SCRIPTS');
    if (!pillars.length || pillars.length > 9) throw new Error(`give 1 to 9 life areas, got ${pillars.length}`);
    const today = new Date().toISOString().slice(0, 10);
    const vars = {
      PILLAR_BULLETS: pillars.map((p) => `- \`${p}/\``).join('\n'),
      PILLARS_INLINE: pillars.join('|'),
      ALL_PILLARS_LIST: pillars.join(', '),
      DEFAULT_PILLAR: pillars[0],
      LANGS: [...langs, 'mixed'].join('|'),
      DEFAULT_LANG: langs[0] || 'en',
      RAW_DIR: rawDir,
      TODAY: today,
    };
    const folders = [...pillars, ...Object.keys(ENTITY_FOLDERS)];

    await ctx.step('folders', () => {
      const created = [...folders, 'templates', 'prompts'].filter((f) => ctx.mkdir(path.join(vault, f)));
      if (created.length === 0) ctx.ok(`all ${folders.length + 2} folders exist in ${vault}`);
      else if (!ctx.dryRun) ctx.ok(`created ${created.length} folder(s) in ${vault}`);
    });

    await ctx.step('vault contract', async () => {
      await ctx.writeFile(path.join(vault, 'AGENTS.md'), ctx.template('second-brain/AGENTS.md', vars));
      await ctx.writeFile(path.join(vault, 'CLAUDE.md'), ctx.template('second-brain/CLAUDE.md', vars));
      await ctx.writeFile(path.join(vault, 'START-HERE.md'), ctx.template('second-brain/START-HERE.md', vars));
      await ctx.writeFile(path.join(vault, '.gitignore'), ctx.template('second-brain/gitignore', vars));
      await ctx.writeFile(path.join(vault, '.obsidian', 'templates.json'), `${JSON.stringify({ folder: 'templates' }, null, 2)}\n`);
    });

    // Every folder ships empty apart from a README that says what belongs in it, which also
    // keeps the folder present in a fresh clone.
    await ctx.step('folder readmes', async () => {
      for (const folder of folders) {
        const blurb = ENTITY_FOLDERS[folder]
          ?? `A life area. Topic notes about ${folder}, one note per topic. Rename or drop this folder if it is not one of yours.`;
        await ctx.writeFile(path.join(vault, folder, 'README.md'), ctx.template('second-brain/folder-readme.md', { ...vars, FOLDER: folder, BLURB: blurb }));
      }
    });

    await ctx.step('note templates', async () => {
      for (const type of NOTE_TYPES) {
        await ctx.writeFile(path.join(vault, 'templates', `${type}.md`), ctx.template(`second-brain/note-templates/${type}.md`, vars));
      }
    });

    if (scripts) {
      await ctx.step('vault scripts', async () => {
        for (const file of SCRIPTS) {
          await ctx.writeFile(path.join(vault, 'bin', file), ctx.template(`second-brain/bin/${file}`, vars), { mode: 0o755 });
        }
        await ctx.writeFile(path.join(vault, 'prompts', 'ingest.md'), ctx.template('second-brain/prompts/ingest.md', vars));
      });

      // MAP.md is generated, never hand-written, so generate the first one here. An existing
      // one is left alone like every other existing file: it is the vault's, not ours.
      await ctx.step('initial map', () => {
        if (fs.existsSync(path.join(vault, 'MAP.md'))) return ctx.ok('MAP.md exists; regenerate it with bin/index.mjs');
        return ctx.run(`node "${path.join(vault, 'bin', 'index.mjs')}" "${vault}"`);
      });

      ctx.todo(`run \`node ${path.join(vault, 'bin', 'housekeeping.mjs')}\` on a timer every few hours (systemd --user, launchd, Task Scheduler or cron): it validates the vault and regenerates MAP.md, needs no credentials and makes no network calls`);
      ctx.todo(`set AGENT_CLI (and AGENT_CLI_ARGS) to the agent CLI that should read raw files, then drop files in ${rawDir} and run \`node ${path.join(vault, 'bin', 'ingest.mjs')} --dry-run\``);
    }

    await ctx.step('raw source folder', () => {
      if (!ctx.mkdir(rawDir)) return ctx.ok(`${rawDir} already exists`);
      if (!ctx.dryRun) ctx.ok(`created ${rawDir}; raw files live here, outside the vault, and are never modified`);
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
      await ctx.step('VAULT_PATH', () => ctx.setUserEnv('VAULT_PATH', vault));
      await ctx.step('RAW_DIR', () => ctx.setUserEnv('RAW_DIR', rawDir));
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
    ctx.info(`open ${vault} in Obsidian with "Open folder as vault"; people start at ${path.join(vault, 'START-HERE.md')}, agents at ${path.join(vault, 'AGENTS.md')}`);
  },
};
