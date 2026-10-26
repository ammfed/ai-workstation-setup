import fs from 'node:fs';
import path from 'node:path';

// One OpenRouter key and one decision model (Jev by default) for the tools that can reach a model
// through OpenRouter by their own documented settings. The key is taken from OPENROUTER_API_KEY or
// pasted on the last screen and stored only in a local env file (mode 600), outside this clone. Tools are
// wired only through settings they document; where a tool offers none, it is named, not patched.
// See docs/openrouter.md.

const NAME = 'openrouter';
const DEFAULT_MODEL = 'typesafe/jev-1.13';

export function keyFile(ctx) {
  return path.join(ctx.home, '.config', 'ai-workstation-setup', NAME, '.env');
}

// Replace or add the OPENROUTER_API_KEY line, keeping every other line of the file.
export function withKey(text, key) {
  const lines = String(text || '').split('\n').filter((l, i, all) => !(i === all.length - 1 && l === ''));
  const line = `OPENROUTER_API_KEY=${key}`;
  const i = lines.findIndex((l) => /^\s*OPENROUTER_API_KEY=/.test(l));
  if (i >= 0) lines[i] = line;
  else lines.push(line);
  return `${lines.join('\n')}\n`;
}

function storeKey(ctx, file, current, key) {
  const next = withKey(current, key);
  if (current === next) return ctx.ok(`${file} already holds this key`);
  if (ctx.dryRun) return ctx.say(`  ~ would store the key in ${file} (mode 600)`);
  ctx.backup(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  ctx.ok(`stored the key in ${file} (mode 600)`);
}

export default {
  name: NAME,
  title: 'OpenRouter key (optional)',
  description: 'Opt-in: one OpenRouter key and decision model (Jev by default) for the tools that support it, kept in a local env file',
  // Before voice-mode, which reads the key file and model from these answers.
  order: 85,
  group: 'tools',
  summary: 'one OpenRouter key for the tools that use it',
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  default: false,
  questions: [
    {
      key: 'OPENROUTER_API_KEY',
      type: 'secret',
      env: 'OPENROUTER_API_KEY',
      message: 'OpenRouter API key from https://openrouter.ai/settings/keys (empty to add it to the key file later)',
    },
    {
      key: 'OPENROUTER_MODEL',
      type: 'text',
      message: 'Decision model on OpenRouter for tools that ask one (voice mode actions)',
      default: DEFAULT_MODEL,
    },
  ],

  async install(ctx) {
    const file = keyFile(ctx);
    await ctx.step('key file', async () => {
      const key = ctx.get('OPENROUTER_API_KEY');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (key) return storeKey(ctx, file, current, key);
      if (/^\s*OPENROUTER_API_KEY=\S/m.test(current || '')) return ctx.ok(`${file} already holds a key; left as it is`);
      if (current === null) await ctx.writeFile(file, 'OPENROUTER_API_KEY=\n', { mode: 0o600 });
      ctx.keyAtEnd({
        name: 'OpenRouter',
        label: 'OpenRouter key (on openrouter.ai: Keys)',
        apply: (v) => storeKey(ctx, file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, v),
        todo: `put your OpenRouter key in ${file} (mode 600; never commit it or paste it in chat)`,
      });
    });

    await ctx.step('tools', () => {
      const voice = (ctx.values.MODULES || []).includes('voice-mode');
      ctx.info(
        voice
          ? `voice mode reads this key file and uses ${ctx.get('OPENROUTER_MODEL')} for its actions`
          : 'voice mode, when you install it, reads this key file for its actions',
      );
      ctx.info("compact-adviser calls TypeSafe directly and documents no OpenRouter setting; it uses TYPESAFE_API_KEY. Firstmate's dispatch resolver takes OpenRouter through FM_DISPATCH_PROVIDER and FM_DISPATCH_MODEL and reads its own OPENROUTER_API_KEY from the environment or $FM_HOME/.env, not this key file (see docs/openrouter.md)");
    });
  },
};
