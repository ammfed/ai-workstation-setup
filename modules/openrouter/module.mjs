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

// Replace or add a KEY=value line for each entry, keeping every other line of the file.
export function withEnv(text, entries) {
  const lines = String(text || '').split('\n').filter((l, i, all) => !(i === all.length - 1 && l === ''));
  for (const [name, value] of Object.entries(entries)) {
    const line = `${name}=${value}`;
    const i = lines.findIndex((l) => new RegExp(`^\\s*${name}=`).test(l));
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

export function withKey(text, key) {
  return withEnv(text, { OPENROUTER_API_KEY: key });
}

// The Firstmate home whose .env the dispatch resolver reads: the answer, else the firstmate
// module's home (its clone when it has none) from this run or the saved answers, so
// `--modules openrouter` alone still finds it, else FM_HOME, else the default clone ~/firstmate.
export function firstmateHome(ctx) {
  const saved = ['FIRSTMATE_HOME', 'FIRSTMATE_DIR'].map((key) => ctx.get(key) ?? ctx.answers.get(key)).find(Boolean);
  const home = ctx.get('OPENROUTER_FIRSTMATE_HOME') || saved || process.env.FM_HOME;
  return home ? ctx.path(home) : path.join(ctx.home, 'firstmate');
}

// Firstmate's built-in OpenRouter setting (its docs/configuration.md, "Typed dispatch
// resolution"): only these two lines change; the file's other lines, its key among them, stay.
function writeDispatch(ctx, file, model) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const next = withEnv(current, { FM_DISPATCH_PROVIDER: 'openrouter', FM_DISPATCH_MODEL: model });
  if (current === next) return ctx.ok(`${file} already routes Firstmate dispatch through OpenRouter (${model})`);
  if (ctx.dryRun) return ctx.say(`  ~ would set FM_DISPATCH_PROVIDER=openrouter and FM_DISPATCH_MODEL=${model} in ${file}`);
  ctx.backup(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A new file is private; an existing one keeps its mode.
  fs.writeFileSync(file, next, current === null ? { mode: 0o600 } : undefined);
  ctx.ok(`set FM_DISPATCH_PROVIDER=openrouter and FM_DISPATCH_MODEL=${model} in ${file}`);
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
      message: 'Decision model on OpenRouter for tools that ask one (voice mode actions, Firstmate dispatch)',
      default: DEFAULT_MODEL,
    },
    {
      key: 'OPENROUTER_FIRSTMATE',
      type: 'confirm',
      message: "Route Firstmate's dispatch resolver through OpenRouter (sets FM_DISPATCH_PROVIDER and FM_DISPATCH_MODEL in the Firstmate home's .env)?",
      default: false,
    },
    {
      key: 'OPENROUTER_FIRSTMATE_HOME',
      type: 'text',
      path: true,
      message: 'Firstmate home whose .env gets those settings (empty: FIRSTMATE_HOME, the firstmate clone, FM_HOME, then ~/firstmate)',
      default: '',
      when: (ctx) => ctx.get('OPENROUTER_FIRSTMATE'),
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

    if (ctx.get('OPENROUTER_FIRSTMATE')) {
      await ctx.step('Firstmate dispatch', () => {
        const env = path.join(firstmateHome(ctx), '.env');
        writeDispatch(ctx, env, ctx.get('OPENROUTER_MODEL') || DEFAULT_MODEL);
        const text = fs.existsSync(env) ? fs.readFileSync(env, 'utf8') : '';
        if (!process.env.OPENROUTER_API_KEY && !/^\s*OPENROUTER_API_KEY=\S/m.test(text)) {
          ctx.todo(`put your OpenRouter key as OPENROUTER_API_KEY in ${env} or your environment; Firstmate's resolver reads it there, not from ${file}`);
        }
      });
    }

    await ctx.step('tools', () => {
      const voice = (ctx.values.MODULES || []).includes('voice-mode');
      ctx.info(
        voice
          ? `voice mode reads this key file and uses ${ctx.get('OPENROUTER_MODEL')} for its actions`
          : 'voice mode, when you install it, reads this key file for its actions',
      );
      ctx.info('compact-adviser calls TypeSafe directly and documents no OpenRouter setting; it uses TYPESAFE_API_KEY (see docs/openrouter.md)');
      if (!ctx.get('OPENROUTER_FIRSTMATE')) {
        ctx.info("Firstmate's dispatch resolver takes OpenRouter through FM_DISPATCH_PROVIDER and FM_DISPATCH_MODEL; answer yes to OPENROUTER_FIRSTMATE to set them (see docs/openrouter.md)");
      }
    });
  },
};
