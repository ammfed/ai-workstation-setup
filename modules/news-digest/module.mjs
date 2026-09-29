import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';

// A scheduled collector: every few hours it reads the sources you list (feeds and pages), keeps
// the items it has not seen, and writes one Markdown digest. The work is plain scripting in
// templates/news-digest/bin/news-digest.mjs; a model is called only when you give a command for
// it, with your own choice of model. The sources file starts empty: what you follow is yours.
// See docs/news-digest.md.

const NAME = 'news-digest';
const TAG = 'ai-workstation-setup news-digest';
const LAUNCHD_LABEL = 'local.ai-workstation-setup.news-digest';
const dir = (ctx) => path.join(ctx.home, '.config', 'ai-workstation-setup', NAME);

const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const unitQuote = (s) => `"${String(s).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STARTER_SOURCES = `# Sources for news-digest, one per line:   name | kind | url
#   feed  an RSS or Atom feed
#   page  a web page; its links with a readable title become items
# For example (remove the leading # to use a line):
# Example feed | feed | https://example.org/feed.xml
# Example page | page | https://example.org/news
`;

export function parseHours(value) {
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > 24) throw new Error(`NEWS_DIGEST_EVERY_HOURS must be a whole number from 1 to 24, got "${value}"`);
  return n;
}

async function systemdTimer(ctx, script, hours) {
  const unitDir = path.join(ctx.home, '.config', 'systemd', 'user');
  const service = [
    '[Unit]',
    `Description=Collect new items into a digest (${TAG})`,
    '',
    '[Service]',
    'Type=oneshot',
    'Nice=10',
    `Environment=${unitQuote(`PATH=${process.env.PATH}`)}`,
    `ExecStart=${unitQuote(process.execPath)} ${unitQuote(script)}`,
    '',
  ].join('\n');
  const timer = [
    '[Unit]',
    `Description=Run news-digest every ${hours} hour(s) (${TAG})`,
    '',
    '[Timer]',
    'OnBootSec=10min',
    `OnUnitActiveSec=${hours}h`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
  const a = await ctx.writeFile(path.join(unitDir, `${NAME}.service`), service, { onConflict: 'ask' });
  const b = await ctx.writeFile(path.join(unitDir, `${NAME}.timer`), timer, { onConflict: 'ask' });
  const enabled = ctx.capture(`systemctl --user is-enabled ${NAME}.timer`) === 'enabled';
  if (a || b || !enabled) ctx.run(`systemctl --user daemon-reload && systemctl --user enable --now ${NAME}.timer`);
  else ctx.ok(`${NAME}.timer is enabled`);
  ctx.info(`disable it with: systemctl --user disable --now ${NAME}.timer`);
}

function cronLine(ctx, script, hours) {
  const line = `17 */${hours} * * * PATH=${sq(process.env.PATH)} ${sq(process.execPath)} ${sq(script)} >/dev/null 2>&1 # ${TAG}`;
  const current = ctx.capture('crontab -l 2>/dev/null') || '';
  if (current.split('\n').includes(line)) return ctx.ok('news-digest is already in your crontab');
  const kept = current.split('\n').filter((l) => l && !l.includes(`# ${TAG}`));
  ctx.run('crontab -', { input: `${[...kept, line].join('\n')}\n` });
  ctx.info(`disable it by removing the line marked "# ${TAG}" with: crontab -e`);
}

async function launchdAgent(ctx, script, hours) {
  const plist = path.join(ctx.home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(script)}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(process.env.PATH)}</string></dict>
  <key>StartInterval</key><integer>${hours * 3600}</integer>
</dict>
</plist>
`;
  if (await ctx.writeFile(plist, content, { onConflict: 'ask' })) {
    ctx.run(`launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} 2>/dev/null; launchctl bootstrap gui/$(id -u) "${plist}"`);
  }
  ctx.info(`disable it with: launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} (and delete ${plist})`);
}

async function schedule(ctx, script, hours) {
  if (ctx.os === 'windows') {
    ctx.todo(`schedule it with Task Scheduler: schtasks /Create /SC HOURLY /MO ${hours} /TN "${NAME}" /TR "\\"${process.execPath}\\" \\"${script}\\"" /F`);
    return;
  }
  if (ctx.os === 'macos') return launchdAgent(ctx, script, hours);
  if (ctx.platform.simulated) {
    ctx.info(`would use a systemd user timer every ${hours} hour(s) when \`systemctl --user\` works, else a crontab line`);
    return;
  }
  if (ctx.capture('systemctl --user show-environment') !== null) return systemdTimer(ctx, script, hours);
  if (ctx.has('crontab')) return cronLine(ctx, script, hours);
  throw new Skip(`no systemd user session and no crontab found; run \`node "${script}"\` yourself`);
}

export default {
  name: NAME,
  title: 'News digest (a scheduled collector)',
  description: 'Opt-in: every few hours, gather new items from sources you list into one Markdown digest; a model only if you give one',
  order: 92,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  default: false,
  questions: [
    {
      key: 'NEWS_DIGEST_SOURCES',
      type: 'text',
      path: true,
      message: 'Sources file, one "name | feed or page | url" per line (a starter with examples is written if it is missing)',
      default: '~/.config/ai-workstation-setup/news-digest/sources.txt',
    },
    { key: 'NEWS_DIGEST_OUT', type: 'text', path: true, message: 'Folder for the digests', default: '~/news-digest' },
    { key: 'NEWS_DIGEST_EVERY_HOURS', type: 'text', message: 'Collect every how many hours (1 to 24)', default: '6' },
    {
      key: 'NEWS_DIGEST_MODEL',
      type: 'text',
      message: 'Command that reads the new items on stdin and prints a short summary, with the model of your choice (empty: no model, the digest lists items only)',
      default: '',
    },
    {
      key: 'NEWS_DIGEST_SCHEDULE',
      type: 'choice',
      message: 'Schedule',
      default: 'auto',
      choices: [
        { value: 'auto', label: 'auto - systemd user timer, launchd on macOS, else cron (Windows: the Task Scheduler command is printed)' },
        { value: 'none', label: 'none - run it yourself' },
      ],
    },
  ],

  async install(ctx) {
    const hours = parseHours(ctx.get('NEWS_DIGEST_EVERY_HOURS'));
    const base = dir(ctx);
    const script = path.join(base, 'bin', 'news-digest.mjs');
    const sources = ctx.get('NEWS_DIGEST_SOURCES');

    await ctx.step('script', () => ctx.writeFile(script, ctx.template('news-digest/bin/news-digest.mjs'), { onConflict: 'ask' }));
    await ctx.step('sources', async () => {
      if (fs.existsSync(sources)) return ctx.ok(`${sources} exists; left as it is`);
      await ctx.writeFile(sources, STARTER_SOURCES);
      ctx.todo(`list what you want to follow in ${sources}`);
    });
    await ctx.step('config', () => {
      const config = { sourcesFile: sources, outDir: ctx.get('NEWS_DIGEST_OUT'), model: ctx.get('NEWS_DIGEST_MODEL') || '', maxItemsPerSource: 20, keep: 60, timeoutSec: 30 };
      return ctx.writeFile(path.join(base, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { onConflict: 'ask' });
    });
    if (ctx.get('NEWS_DIGEST_SCHEDULE') === 'auto') await ctx.step('schedule', () => schedule(ctx, script, hours));
    ctx.info(`try it: node "${script}" --dry-run   (turn it off any time: create a file named "off" in ${base})`);
  },
};
