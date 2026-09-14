import { Skip } from '../../lib/context.mjs';

// GitHub CLI Linux routes follow github.com/cli/cli docs/install_linux.md.
function ghLinux(ctx) {
  const s = ctx.sudo();
  const routes = {
    apt: [
      `(type -p wget >/dev/null || (${s}apt update && ${s}apt install wget -y))`,
      `${s}mkdir -p -m 755 /etc/apt/keyrings`,
      'out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg',
      `cat $out | ${s}tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null`,
      `${s}chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg`,
      `${s}mkdir -p -m 755 /etc/apt/sources.list.d`,
      `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | ${s}tee /etc/apt/sources.list.d/github-cli.list > /dev/null`,
      `${s}apt update`,
      `${s}apt install gh -y`,
    ].join(' && '),
    dnf: `${s}dnf install -y dnf5-plugins && ${s}dnf config-manager addrepo --from-repofile=https://cli.github.com/packages/rpm/gh-cli.repo && ${s}dnf install -y gh --repo gh-cli`,
    zypper: `${s}zypper addrepo https://cli.github.com/packages/rpm/gh-cli.repo && ${s}zypper --non-interactive ref && ${s}zypper --non-interactive install gh`,
    pacman: `${s}pacman -S --needed --noconfirm github-cli`,
    apk: `${s}apk add github-cli`,
    brew: 'brew install gh',
  };
  const cmd = routes[ctx.platform.pkg];
  if (!cmd) throw new Skip('no known gh route for this distro; see https://github.com/cli/cli#installation');
  ctx.run(cmd);
}

export default {
  name: 'core',
  title: 'Core prerequisites',
  description: 'git, Node.js, GitHub CLI (signed in) and jq',
  order: 10,
  platforms: ['linux', 'macos', 'wsl', 'windows'],
  requires: [],
  default: true,
  questions: [
    {
      key: 'CORE_GH_LOGIN',
      type: 'confirm',
      message: 'Sign in to GitHub with `gh auth login` if you are not signed in yet?',
      default: true,
      when: (ctx) => ctx.interactive,
    },
  ],

  async install(ctx) {
    await ctx.step('git', () =>
      ctx.ensureTool({
        name: 'git',
        install: {
          default: { pkg: { apt: 'git', dnf: 'git', pacman: 'git', zypper: 'git', apk: 'git', brew: 'git', winget: 'Git.Git', scoop: 'git', choco: 'git' } },
        },
      }),
    );

    await ctx.step('Node.js', () => {
      const [major, minor] = process.versions.node.split('.').map(Number);
      ctx.ok(`Node.js ${process.versions.node} (running this installer)`);
      if (major < 22 || (major === 22 && minor < 19)) {
        ctx.warn('quota-axi (used by firstmate) needs Node 22.19+: run `nvm install --lts` (or `winget upgrade OpenJS.NodeJS.LTS`)');
      }
    });

    await ctx.step('GitHub CLI', () =>
      ctx.ensureTool({
        name: 'GitHub CLI',
        bin: 'gh',
        install: { linux: ghLinux, macos: { pkg: { brew: 'gh' } }, windows: { pkg: { winget: 'GitHub.cli', scoop: 'gh', choco: 'gh' } } },
      }),
    );

    await ctx.step('jq', () =>
      ctx.ensureTool({
        name: 'jq',
        install: {
          default: { pkg: { apt: 'jq', dnf: 'jq', pacman: 'jq', zypper: 'jq', apk: 'jq', brew: 'jq', winget: 'jqlang.jq', scoop: 'jq', choco: 'jq' } },
        },
      }),
    );

    await ctx.step('GitHub sign-in', () => {
      if (!ctx.dryRun && !ctx.has('gh')) throw new Skip('gh is not on PATH yet; open a new terminal and re-run');
      if (ctx.capture('gh auth status') !== null) return ctx.ok('gh is signed in');
      if (ctx.get('CORE_GH_LOGIN')) ctx.run('gh auth login');
      else ctx.todo('gh auth login');
    });
  },
};
