import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { claudeDir } from '../../lib/claude.mjs';

// Edit-in-place links into your own dotfiles clone. The real files stay in the clone, so an edit
// through the link is an edit in the repository and `git diff` shows it. Every link goes through
// one fixed path (~/.dotfiles), so a moved clone needs one link changed, not all of them.

// Each agent tool's user-wide instructions file, from the tool's own docs. A tool counts as
// installed when its folder exists, so no link makes a folder for a tool you do not have.
export const AGENT_TOOLS = {
  claude: { label: 'claude - Claude Code (~/.claude/CLAUDE.md)', dir: (ctx) => claudeDir(ctx), file: 'CLAUDE.md' },
  codex: { label: 'codex - Codex CLI (~/.codex/AGENTS.md)', dir: (ctx) => process.env.CODEX_HOME || path.join(ctx.home, '.codex'), file: 'AGENTS.md' },
  opencode: { label: 'opencode - opencode (~/.config/opencode/AGENTS.md)', dir: (ctx) => path.join(ctx.home, '.config', 'opencode'), file: 'AGENTS.md' },
  gemini: { label: 'gemini - Gemini CLI (~/.gemini/GEMINI.md)', dir: (ctx) => path.join(ctx.home, '.gemini'), file: 'GEMINI.md' },
};

/** The comma-separated list of paths inside the clone, trimmed, without empty entries. */
export function parseLinks(text) {
  return String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** A path inside the clone: relative, and never climbing out of it. */
function insideClone(rel, key) {
  const norm = path.normalize(rel);
  if (path.isAbsolute(norm) || norm === '..' || norm.startsWith(`..${path.sep}`)) throw new Error(`${key}: ${rel} must be a path inside your dotfiles clone`);
  return norm;
}

/**
 * Make `link` a symlink to `dest`. A link that already points there is left alone. A real file
 * with the same text as `dest` is moved aside to <link>.bak-<stamp> and replaced by the link.
 * A real file with different text is kept, because linking it would swap your live settings for
 * the clone's copy; a to-do says to merge the two first. Another link, or a folder, is kept too.
 * `real` is the clone's own path for `dest`, compared before ~/.dotfiles exists (a dry run).
 */
export function linkFile(ctx, link, dest, real = dest) {
  const stat = fs.lstatSync(link, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) {
    const now = fs.readlinkSync(link);
    if (now === dest) return ctx.ok(`${link} already links to ${dest}`);
    return ctx.todo(`${link} links to ${now}, not ${dest}; remove that link by hand and rerun to link it`);
  }
  if (stat?.isDirectory()) return ctx.todo(`${link} is a folder; move it away by hand and rerun to link it to ${dest}`);
  if (stat && fs.existsSync(real) && fs.readFileSync(link, 'utf8') !== fs.readFileSync(real, 'utf8')) {
    return ctx.todo(`${link} differs from ${dest}; merge your live copy into the dotfiles file, then rerun to link it`);
  }
  if (ctx.dryRun) return ctx.say(`  ~ would link ${link} -> ${dest}${stat ? ' (the same text; a backup is kept)' : ''}`);
  if (stat) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    fs.renameSync(link, `${link}.bak-${stamp}`);
    ctx.info(`backed up ${link} -> ${path.basename(link)}.bak-${stamp}`);
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(dest, link);
  return ctx.ok(`linked ${link} -> ${dest}`);
}

export default {
  name: 'dotfiles',
  title: 'Dotfiles links (optional)',
  description: 'Opt-in: link files from your own dotfiles clone into place, and one shared agent-instructions file into every agent tool',
  // After preferences and second-brain, which write their own files beside these links.
  order: 75,
  group: 'tools',
  summary: 'your config files linked from your dotfiles repo',
  platforms: ['linux', 'macos', 'wsl'],
  unsupported: { windows: 'Windows links need Developer Mode or an administrator shell; link the files by hand, or run this inside WSL' },
  default: false,
  questions: [
    {
      key: 'DOTFILES_DIR',
      type: 'text',
      path: true,
      message: 'Your dotfiles clone, a folder outside this one (empty skips this module)',
      default: '',
      alwaysAsk: true,
    },
    {
      key: 'DOTFILES_LINKS',
      type: 'text',
      message: 'Files to link into your home folder, comma-separated, each a path inside the clone\'s home/ folder (for example .bashrc, .gitconfig; empty for none)',
      default: '',
      when: (ctx) => Boolean(ctx.get('DOTFILES_DIR')),
    },
    {
      key: 'DOTFILES_AGENTS_FILE',
      type: 'text',
      message: 'The shared agent-instructions file, a path inside the clone (empty for none)',
      default: 'home/AGENTS.md',
      when: (ctx) => Boolean(ctx.get('DOTFILES_DIR')),
    },
    {
      key: 'DOTFILES_AGENTS_TOOLS',
      type: 'multi',
      message: 'Agent tools that read the shared instructions file (each is linked only when the tool\'s folder exists)',
      default: Object.keys(AGENT_TOOLS),
      choices: Object.entries(AGENT_TOOLS).map(([value, t]) => ({ value, label: t.label })),
      when: (ctx) => Boolean(ctx.get('DOTFILES_DIR') && ctx.get('DOTFILES_AGENTS_FILE')),
    },
  ],

  async install(ctx) {
    const clone = ctx.get('DOTFILES_DIR');
    if (!clone) throw new Skip('no dotfiles clone given');
    if (!fs.existsSync(clone) && !ctx.dryRun) throw new Error(`${clone} does not exist; clone your dotfiles repository there first`);
    const fixed = path.join(ctx.home, '.dotfiles');
    const ready = await ctx.step('~/.dotfiles', () => {
      const stat = fs.lstatSync(fixed, { throwIfNoEntry: false });
      if (stat && !stat.isSymbolicLink()) throw new Error(`${fixed} is a real ${stat.isDirectory() ? 'folder' : 'file'}; move it away by hand so it can point at ${clone}`);
      if (stat && fs.readlinkSync(fixed) !== clone) throw new Error(`${fixed} points at ${fs.readlinkSync(fixed)}; point it at ${clone} by hand if that is your clone now`);
      linkFile(ctx, fixed, clone);
      return true;
    });
    if (!ready) return;

    for (const rel of parseLinks(ctx.get('DOTFILES_LINKS'))) {
      await ctx.step(rel, () => {
        const norm = insideClone(rel, 'DOTFILES_LINKS');
        const source = path.join(clone, 'home', norm);
        if (!fs.existsSync(source) && !ctx.dryRun) throw new Error(`${source} does not exist in your clone`);
        return linkFile(ctx, path.join(ctx.home, norm), path.join(fixed, 'home', norm), source);
      });
    }

    const shared = ctx.get('DOTFILES_AGENTS_FILE');
    if (!shared) return;
    const norm = insideClone(shared, 'DOTFILES_AGENTS_FILE');
    if (!fs.existsSync(path.join(clone, norm)) && !ctx.dryRun) return ctx.fail(`${path.join(clone, norm)} does not exist in your clone`);
    for (const name of ctx.get('DOTFILES_AGENTS_TOOLS') ?? []) {
      const tool = AGENT_TOOLS[name];
      await ctx.step(`${name} instructions`, () => {
        const dir = tool.dir(ctx);
        if (!fs.existsSync(dir)) throw new Skip(`${dir} does not exist, so ${name} is not set up here`);
        return linkFile(ctx, path.join(dir, tool.file), path.join(fixed, norm), path.join(clone, norm));
      });
    }
  },
};
