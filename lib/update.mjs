#!/usr/bin/env node
// The updater behind update.sh and update.ps1: brings this clone up to date with the
// template's default branch, by fast-forward only.
//
// It never forces, never merges, never rebases, never stashes and never discards
// anything. A dirty working tree, a clone that has diverged from upstream, or an
// upstream change that would land on one of your own (gitignored) files is refused
// with an explanation and nothing is changed. Your own material (answers.env and the
// other gitignored files) is untracked, so a fast-forward never touches it.
//
// Where updates come from: the `upstream` remote when there is one; otherwise
// `origin` when it is the template itself (a plain clone). A fork has neither, so the
// updater offers to add the template as `upstream` - it asks first, and with --yes it
// only does so when --add-upstream is also given.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { c } from './context.mjs';

const TEMPLATE_URL = 'https://github.com/ammfed/ai-workstation-setup';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: ./update.sh [options]        (Linux, macOS, WSL)
       .\\update.ps1 [options]       (native Windows)

Fast-forwards this clone to the template's latest version. Your answers and other
gitignored files are never touched. Refuses (and explains) when the clone has local
changes or has diverged; never forces, merges, rebases, stashes or discards.

Options:
  --dry-run               Fetch and report what would happen; change nothing.
  --yes, --non-interactive
                          Never prompt. A fork's missing upstream is then only added
                          with --add-upstream.
  --add-upstream          Consent to add the template as the "upstream" remote when
                          this clone has none and origin is not the template (a fork).
  --upstream-url URL      The template repository (default ${TEMPLATE_URL}).
  -h, --help              Show this help.

Exit status: 0 updated or already current, 1 refused (nothing changed), 2 usage or setup error.`;

class Refusal extends Error {}

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  if (r.error) throw new Error(`cannot run git: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  }
  return r.status === 0 ? r.stdout.trim() : null;
}

/** A comparable form of a remote URL: https and ssh GitHub forms match, and local paths resolve. */
function sameRepo(a, b) {
  const norm = (u) => {
    let s = String(u || '').trim();
    const scp = s.match(/^[^@/]+@([^:/]+):(.+)$/); // git@host:owner/repo
    if (scp) s = `https://${scp[1]}/${scp[2]}`;
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = path.resolve(s.replace(/^file:\/\//, ''));
    s = s.replace(/^(ssh|git|https?):\/\/([^@/]+@)?/i, 'https://');
    return s.replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();
  };
  return norm(a) === norm(b);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(`? ${question} [y/N]: `, (a) => {
      rl.close();
      resolve(/^y(es)?$/i.test(a.trim()));
    }),
  );
}

async function chooseRemote(opts, interactive) {
  const remotes = (git(['remote']) || '').split('\n').filter(Boolean);
  if (remotes.includes('upstream')) return 'upstream';
  const origin = remotes.includes('origin') ? git(['remote', 'get-url', 'origin']) : null;
  if (origin && sameRepo(origin, opts.url)) return 'origin';

  console.log(
    origin
      ? `This clone's origin (${origin}) is not the template, so it looks like a fork.`
      : 'This clone has no origin remote.',
  );
  console.log(`Updates come from the template, ${opts.url}, which is not a remote here yet.`);
  const add = opts['add-upstream'] || (interactive && (await ask(`Add it as the "upstream" remote now?`)));
  if (!add) {
    throw new Refusal(
      `No upstream to update from. Add it yourself with:\n    git remote add upstream ${opts.url}\n` +
        'or re-run with --add-upstream. Nothing was changed.',
    );
  }
  if (opts['dry-run']) {
    console.log(`  ~ would run: git remote add upstream ${opts.url}`);
    return { dryRunUrl: opts.url };
  }
  git(['remote', 'add', 'upstream', opts.url]);
  console.log(`  ${c.green('✓')} added remote upstream -> ${opts.url}`);
  return 'upstream';
}

function defaultBranch(remote) {
  const out = git(['ls-remote', '--symref', remote, 'HEAD'], { allowFail: true }) || '';
  const m = out.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m);
  if (m) return m[1];
  const local = git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], { allowFail: true });
  return local ? local.slice(remote.length + 1) : 'main';
}

function list(lines, max = 10) {
  const shown = lines.slice(0, max).map((l) => `    ${l}`);
  if (lines.length > max) shown.push(`    ... and ${lines.length - max} more`);
  return shown.join('\n');
}

async function update(opts, interactive) {
  if (git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }) !== 'true') {
    throw new Error(`${repoRoot} is not a git clone. Clone ${opts.url} with git to get updates.`);
  }
  if (git(['rev-parse', '--show-prefix'])) {
    throw new Error(`${repoRoot} is inside another git repository, not a clone of its own. Clone ${opts.url} with git to get updates.`);
  }

  const chosen = await chooseRemote(opts, interactive);
  // A dry run on a fork does not add the remote, so it fetches the URL directly.
  const remote = typeof chosen === 'string' ? chosen : chosen.dryRunUrl;
  const label = typeof chosen === 'string' ? chosen : 'upstream';
  const branch = defaultBranch(remote);
  console.log(`Checking ${typeof chosen === 'string' ? `${remote} (${git(['remote', 'get-url', remote])})` : remote}, branch ${branch} ...`);
  const fetch = spawnSync('git', ['-C', repoRoot, 'fetch', '--quiet', remote, branch], { encoding: 'utf8' });
  if (fetch.status !== 0) throw new Error(`could not fetch ${branch} from ${remote}: ${(fetch.stderr || '').trim().split('\n')[0]}`);
  const target = git(['rev-parse', 'FETCH_HEAD']);

  const current = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true });
  if (!current) throw new Refusal(`HEAD is detached, not on a branch. Switch back first:\n    git switch ${branch}`);
  if (current !== branch) {
    throw new Refusal(
      `You are on branch "${current}"; updates go into "${branch}".\n` +
        `Switch with "git switch ${branch}" and run the updater again. Nothing was changed.`,
    );
  }

  const dirty = (git(['status', '--porcelain']) || '').split('\n').filter(Boolean);
  if (dirty.length) {
    throw new Refusal(
      `This clone has local changes the update could collide with:\n${list(dirty)}\n` +
        'Commit them, or move them out of the clone (your own files belong in gitignored\n' +
        'places such as answers.env), then run the updater again. Nothing was changed.',
    );
  }

  const head = git(['rev-parse', 'HEAD']);
  const short = (rev) => rev.slice(0, 7);
  if (head === target) {
    console.log(`${c.green('✓')} Already up to date (${short(head)}).`);
    return 0;
  }
  const behind = git(['merge-base', '--is-ancestor', 'HEAD', target], { allowFail: true }) !== null;
  const ahead = git(['merge-base', '--is-ancestor', target, 'HEAD'], { allowFail: true }) !== null;
  if (ahead) {
    console.log(`${c.green('✓')} Nothing to take: your ${branch} already contains ${label}/${branch} plus commits of your own.`);
    return 0;
  }
  if (!behind) {
    const mine = git(['log', '--oneline', `${target}..HEAD`]).split('\n').filter(Boolean);
    const theirs = git(['log', '--oneline', `HEAD..${target}`]).split('\n').filter(Boolean);
    throw new Refusal(
      `Your ${branch} has diverged from ${label}/${branch}, so it cannot be fast-forwarded.\n` +
        `Commits only you have (${mine.length}):\n${list(mine, 5)}\n` +
        `Commits only upstream has (${theirs.length}):\n${list(theirs, 5)}\n` +
        'The updater never merges, rebases or discards for you. Safe options, all yours to choose:\n' +
        `  - keep your commits and merge upstream in yourself:  git merge ${label}/${branch}\n` +
        `  - replay your commits on top of upstream yourself:   git rebase ${label}/${branch}\n` +
        '  - or propose your commits to the template as a pull request.\n' +
        'Nothing was changed.',
    );
  }

  // Git overwrites ignored files without asking, so refuse if upstream adds a path you already have.
  const added = git(['diff', '--name-only', '--diff-filter=A', 'HEAD', target]).split('\n').filter(Boolean);
  const clashes = added.filter((f) => fs.existsSync(path.join(repoRoot, f)));
  if (clashes.length) {
    throw new Refusal(
      `The update adds files that already exist here as your own (untracked or gitignored) files:\n${list(clashes)}\n` +
        'Move or rename them, then run the updater again. Nothing was changed.',
    );
  }

  const incoming = git(['log', '--oneline', `HEAD..${target}`]).split('\n').filter(Boolean);
  if (opts['dry-run']) {
    console.log(`Would fast-forward ${branch} ${short(head)}..${short(target)} (${incoming.length} commit(s)):\n${list(incoming)}`);
    return 0;
  }
  git(['merge', '--ff-only', '--quiet', target]);
  console.log(`${c.green('✓')} Updated ${branch} ${short(head)}..${short(target)} (${incoming.length} commit(s)):\n${list(incoming)}`);
  console.log(
    `\nNext: run the installer again (${process.platform === 'win32' ? '.\\install.ps1' : './install.sh'}). ` +
      'Your saved answers are reused and only new questions are asked.',
  );
  return 0;
}

async function main() {
  const { values: opts } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      'non-interactive': { type: 'boolean' },
      'add-upstream': { type: 'boolean' },
      'upstream-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  opts.url = opts['upstream-url'] || TEMPLATE_URL;
  const interactive = !(opts.yes || opts['non-interactive']) && Boolean(process.stdin.isTTY);
  try {
    return await update(opts, interactive);
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    console.log(`${c.yellow('Update refused.')} ${err.message}`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`${c.red('error:')} ${err.message}`);
    process.exit(2);
  },
);
