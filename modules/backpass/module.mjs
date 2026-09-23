import path from 'node:path';
import { Skip } from '../../lib/context.mjs';
import { versionCheck } from '../agent-clis/tools.mjs';

// backpass (github.com/kunchenguid/backpass) reads past agent sessions for a project
// and proposes fixes to its instruction files. Its analysis sends session content to
// an AI model, so this module only installs it behind templates/backpass/bin/backpass-gate.mjs:
// an allowlist of projects, a denylist word check over every session before any model
// call, one pinned agent and model, a kill switch, a lock, and never `backpass apply`.
// Install routes: `npm install -g backpass` and `npm install -g acpx@latest`, from each
// project's README (backpass reaches models only through acpx).

const dir = (ctx) => path.join(ctx.home, '.config', 'ai-workstation-setup', 'backpass');

const DENYLIST_STARTER = `# One word or phrase per line, matched case-insensitively.
# backpass-gate skips a whole project when any of its sessions mentions one of these,
# before anything is sent to a model. Add the names of clients, employers, people and
# projects you never want to leave this machine. An empty list blocks every run.
`;

export default {
  name: 'backpass',
  title: 'backpass (learn from past sessions)',
  description: 'Opt-in: backpass proposes instruction-file fixes from past sessions, behind a privacy gate',
  order: 55,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: ['core'],
  default: false,
  questions: [
    {
      key: 'BACKPASS_PROJECTS',
      type: 'text',
      message: 'Projects backpass may read, as comma-separated folders (only these are ever analyzed)',
      default: '',
    },
    {
      key: 'BACKPASS_DENYLIST',
      type: 'text',
      path: true,
      message: 'Denylist file: sessions mentioning any word in it are never sent (created with instructions if missing)',
      default: '~/.config/ai-workstation-setup/backpass/denylist.txt',
    },
    {
      key: 'BACKPASS_AGENT',
      type: 'choice',
      message: 'The one agent backpass may use for its analysis',
      default: 'claude',
      choices: [
        { value: 'claude', label: 'claude - Claude Code' },
        { value: 'codex', label: 'codex - Codex CLI' },
      ],
    },
    {
      key: 'BACKPASS_MODEL',
      type: 'text',
      message: 'The one model backpass may use for both passes',
      default: (ctx) => (ctx.values.BACKPASS_AGENT === 'codex' ? 'gpt-5.5' : 'claude-sonnet-5'),
    },
    {
      key: 'BACKPASS_SCHEDULE',
      type: 'choice',
      message: 'Run it in the background',
      default: 'none',
      choices: [
        { value: 'none', label: 'none - only when you run it' },
        { value: '30m', label: '30m - every 30 minutes, one overdue project at a time (cron)' },
      ],
      when: (ctx) => ctx.os !== 'windows',
    },
  ],

  async install(ctx) {
    const projects = String(ctx.get('BACKPASS_PROJECTS') || '').split(',').map((p) => p.trim()).filter(Boolean);
    if (!projects.length) throw new Skip('no projects on the allowlist (BACKPASS_PROJECTS)');

    await ctx.step('acpx', () => ctx.ensureTool({ name: 'acpx', install: { default: { npm: 'acpx@latest' } }, check: versionCheck('acpx') }));
    await ctx.step('backpass', () => ctx.ensureTool({ name: 'backpass', install: { default: { npm: 'backpass' } }, check: versionCheck('backpass') }));

    const base = dir(ctx);
    const runner = path.join(base, 'backpass-gate.mjs');
    const denylist = ctx.get('BACKPASS_DENYLIST');

    await ctx.step('privacy gate', async () => {
      await ctx.writeFile(runner, ctx.template('backpass/bin/backpass-gate.mjs'), { onConflict: 'ask' });
      await ctx.writeFile(denylist, DENYLIST_STARTER, { onConflict: 'keep' });
      await ctx.writeFile(
        path.join(base, 'config.json'),
        `${JSON.stringify(
          {
            projects: projects.map((p) => ctx.path(p)),
            denylist,
            agent: ctx.get('BACKPASS_AGENT'),
            model: ctx.get('BACKPASS_MODEL'),
            cooldownDays: 7,
          },
          null,
          2,
        )}\n`,
        { onConflict: 'ask' },
      );
      ctx.todo(`add your private words to ${denylist}; until it has one, every run is skipped`);
      ctx.todo(`check a project without any model call: node "${runner}" --dry-run`);
    });

    if (ctx.os === 'windows') {
      ctx.info(`to run it on a schedule, add a Task Scheduler task for: node "${runner}" --scheduled`);
    } else if (ctx.get('BACKPASS_SCHEDULE') === '30m') {
      await ctx.step('schedule', () => {
        const line = `*/30 * * * * "${process.execPath}" "${runner}" --scheduled >/dev/null 2>&1 # ai-workstation-setup backpass`;
        const current = ctx.capture('crontab -l 2>/dev/null') || '';
        if (current.split('\n').includes(line)) return ctx.ok('backpass schedule already in crontab');
        const kept = current.split('\n').filter((l) => l && !l.includes('# ai-workstation-setup backpass'));
        ctx.run('crontab -', { input: `${[...kept, line].join('\n')}\n` });
      });
    }

    ctx.info(`pause it any time by creating ${path.join(base, 'off')}; review proposals with \`backpass apply\` in the project`);
  },
};
