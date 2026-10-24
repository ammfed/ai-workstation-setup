// Tests for the optional vault tools in templates/second-brain/bin: search ranking, capture,
// the bookmark converter, and the garden pass and ingest with stand-in agents. Everything runs in a
// throwaway vault of invented notes.
// Run: node --test test/second-brain.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { rank } from '../templates/second-brain/bin/search.mjs';
import { appendLine } from '../templates/second-brain/bin/capture.mjs';
import { bookmarksToMarkdown } from '../templates/second-brain/bin/bookmarks.mjs';
import { parseStatus } from '../templates/second-brain/bin/garden.mjs';
import { Context, detectPlatform } from '../lib/context.mjs';
import secondBrain, { agentEnv, housekeepingDir, isExistingVault, serviceUnit, writeClaudeFiles, writeUnit } from '../modules/second-brain/module.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VARS = { DEFAULT_PILLAR: 'work', DEFAULT_LANG: 'en' };
const note = (title, type, body, extra = '') => `---\ntitle: ${title}\ntype: ${type}\nstatus: current\n${extra}pillar: [work]\nlang: en\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# ${title}\n\n${body}\n`;

function git(dir, ...args) {
  return spawnSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
}

// A small vault with the scripts installed, tracked by git and committed.
// It is reached through a symlink, as macOS's temporary folder is, so a script that compares
// its own path without resolving links (and then does nothing) fails here on every system.
function vault() {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  const root = `${real}-link`;
  fs.symlinkSync(real, root, 'junction');
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'prompts'));
  for (const f of fs.readdirSync(path.join(repoRoot, 'templates', 'second-brain', 'bin'))) {
    const text = fs.readFileSync(path.join(repoRoot, 'templates', 'second-brain', 'bin', f), 'utf8');
    fs.writeFileSync(path.join(root, 'bin', f), text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => VARS[k] ?? m));
  }
  fs.copyFileSync(path.join(repoRoot, 'templates', 'second-brain', 'prompts', 'garden.md'), path.join(root, 'prompts', 'garden.md'));
  fs.writeFileSync(path.join(root, '.gitignore'), fs.readFileSync(path.join(repoRoot, 'templates', 'second-brain', 'gitignore')));
  for (const d of ['work', 'people', 'journal']) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, 'work', 'Alpha.md'), note('Alpha', 'topic', 'Alpha line (captured by t, 2026-01-01)'));
  fs.writeFileSync(path.join(root, 'work', 'Beta.md'), note('Beta', 'topic', 'Beta line (captured by t, 2026-01-01)'));
  fs.writeFileSync(path.join(root, 'people', 'Sam Example.md'), note('Sam Example', 'person', 'Works on [[Alpha]] (captured by t, 2026-01-01)'));
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'start');
  return root;
}

function removeVault(root) {
  fs.rmSync(fs.realpathSync(root), { recursive: true, force: true });
  fs.rmSync(root, { force: true });
}

// The scripts commit with your own git identity; CI has none, so the tests give an invented one.
const IDENTITY = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
const node = (root, script, args, env = {}) => spawnSync(process.execPath, [path.join(root, 'bin', script), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...IDENTITY, VAULT_PATH: root, ...env } });

test('search: title words outrank body words, and unrelated notes are left out', () => {
  const hits = rank([
    { id: 'a.md', title: 'Garden plans', body: 'tomatoes and beans' },
    { id: 'b.md', title: 'Shopping', body: 'buy a garden hose' },
    { id: 'c.md', title: 'Travel', body: 'trains' },
  ], 'garden');
  assert.deepEqual(hits.map((h) => h.id), ['a.md', 'b.md']);
});

test('capture: a line goes in before the first section and updated: moves', () => {
  const text = '---\ntitle: X\nupdated: 2026-01-01\n---\n\n# X\n\nold line\n\n## Close-out\n- done\n';
  assert.equal(
    appendLine(text, { text: 'new fact', by: 'me', date: '2026-02-02' }),
    '---\ntitle: X\nupdated: 2026-02-02\n---\n\n# X\n\nold line\n\nnew fact (captured by me, 2026-02-02)\n\n## Close-out\n- done\n',
  );
});

test('capture: journal, new note and append are checked and committed; a broken note is undone', () => {
  const root = vault();
  let r = node(root, 'capture.mjs', ['--by', 'me', 'first thing today']);
  assert.equal(r.status, 0, r.stderr);
  const today = new Date().toISOString().slice(0, 10);
  assert.match(fs.readFileSync(path.join(root, 'journal', `${today}.md`), 'utf8'), /first thing today \(captured by me, /);
  r = node(root, 'capture.mjs', ['--type', 'decision', '--title', 'Pick Alpha', '--by', 'me', 'we go with [[Alpha]]']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(root, 'decisions', 'Pick Alpha.md'), 'utf8'), /\*\*Decided:\*\* we go with \[\[Alpha\]\]/);
  r = node(root, 'capture.mjs', ['--to', 'work/Beta.md', '--by', 'me', 'links to [[Nowhere]]']);
  assert.equal(r.status, 2);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'work', 'Beta.md'), 'utf8'), /Nowhere/);
  assert.equal(git(root, 'status', '--porcelain').stdout.trim(), '');
  assert.equal(git(root, 'log', '--format=%s').stdout.split('\n').filter((s) => s.startsWith('capture:')).length, 2);
  removeVault(root);
});

test('bookmarks: folders become headings and links keep their added date', () => {
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<H1>Bookmarks</H1>\n<DL><p>\n<DT><H3>Reading &amp; notes</H3>\n<DL><p>\n<DT><A HREF="https://example.org/a" ADD_DATE="1767225600">Article [one]</A>\n</DL><p>\n<DT><A HREF="https://example.org/b">B</A>\n</DL>\n';
  assert.equal(bookmarksToMarkdown(html), '## Reading & notes\n\n- [Article \\[one\\]](https://example.org/a) (added 2026-01-01)\n- [B](https://example.org/b)\n');
});

test('garden: helpers split git status and the agent command', () => {
  assert.deepEqual(parseStatus(' M work/A.md\0?? new file.md\0R  b.md\0a.md\0'), ['work/A.md', 'new file.md', 'b.md', 'a.md']);
  assert.deepEqual(agentEnv('  my-agent --print  --quiet '), { AGENT_CLI: 'my-agent', AGENT_CLI_ARGS: '--print --quiet' });
  assert.equal(agentEnv(''), null);
});

// A stand-in agent: edits the first note of the slice it is given, and also misbehaves outside it.
function fakeAgent(root, { breakNote = false } = {}) {
  const file = path.join(root, '..', `agent-${path.basename(root)}.mjs`);
  fs.writeFileSync(file, `
import fs from 'node:fs';
const prompt = fs.readFileSync(0, 'utf8');
const first = /- \`([^\`]+)\`/.exec(prompt)[1];
const text = fs.readFileSync(first, 'utf8');
fs.writeFileSync(first, text.replace('line (captured', ${breakNote ? "'line [[Missing]] (captured'" : "'line, tidied (captured'"}));
fs.appendFileSync('people/Sam Example.md', 'agent edit outside the slice\\n');
fs.writeFileSync('stray.md', 'scratch');
fs.appendFileSync('mine.txt', ' and the agent');
`);
  return { AGENT_CLI: process.execPath, AGENT_CLI_ARGS: file };
}

test('garden: a good pass commits only its slice and puts everything else back', () => {
  const root = vault();
  fs.writeFileSync(path.join(root, 'mine.txt'), 'my uncommitted work');
  const removed = fs.mkdtempSync(path.join(os.tmpdir(), 'removed-'));
  const r = node(root, 'garden.mjs', ['--size', '2'], { ...fakeAgent(root), VAULT_REMOVED_DIR: removed });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(root, 'work', 'Alpha.md'), 'utf8'), /Alpha line, tidied/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'people', 'Sam Example.md'), 'utf8'), /agent edit/);
  assert.equal(fs.readFileSync(path.join(root, 'mine.txt'), 'utf8'), 'my uncommitted work');
  assert.equal(fs.existsSync(path.join(root, 'stray.md')), false);
  assert.equal(fs.readdirSync(removed).length, 1);
  assert.match(git(root, 'log', '-1', '--format=%s').stdout, /^garden: work\/1 /);
  assert.deepEqual(git(root, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').sort(), ['MAP.md', 'work/Alpha.md']);
  assert.equal(fs.readFileSync(path.join(root, '.ingest', 'garden-cursor'), 'utf8').trim(), '1');
  assert.equal(fs.existsSync(path.join(root, '.ingest', 'lock')), false);
  removeVault(root);
  fs.rmSync(removed, { recursive: true, force: true });
});

test('garden: a pass that breaks the contract is discarded; a slice with your edits is skipped', () => {
  const root = vault();
  const head = git(root, 'rev-parse', 'HEAD').stdout;
  const removed = fs.mkdtempSync(path.join(os.tmpdir(), 'removed-'));
  let r = node(root, 'garden.mjs', ['--size', '2'], { ...fakeAgent(root, { breakNote: true }), VAULT_REMOVED_DIR: removed });
  assert.match(r.stdout, /check-failed on work\/1/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'work', 'Alpha.md'), 'utf8'), /Missing/);
  assert.equal(git(root, 'rev-parse', 'HEAD').stdout, head);

  fs.writeFileSync(path.join(root, 'people', 'Sam Example.md'), note('Sam Example', 'person', 'my edit in progress'));
  r = node(root, 'garden.mjs', ['--size', '2'], { ...fakeAgent(root), VAULT_REMOVED_DIR: removed });
  assert.match(r.stdout, /skipped: you have uncommitted changes in this slice/);
  assert.match(fs.readFileSync(path.join(root, 'people', 'Sam Example.md'), 'utf8'), /my edit in progress/);
  removeVault(root);
  fs.rmSync(removed, { recursive: true, force: true });
});

// A stand-in ingest agent: it hangs on a file whose name has "stuck" in it and finishes any other.
function ingestAgent(root) {
  const file = path.join(root, '..', `ingest-agent-${path.basename(root)}.mjs`);
  fs.writeFileSync(file, `
import fs from 'node:fs';
if (/stuck/.test(fs.readFileSync(0, 'utf8'))) setTimeout(() => {}, 60000);
`);
  return { AGENT_CLI: process.execPath, AGENT_CLI_ARGS: file };
}

function rawFiles(...names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-'));
  for (const name of names) fs.writeFileSync(path.join(dir, name), `${name}\n`);
  return dir;
}

const ledgerRows = (root) => {
  const file = path.join(root, '.ingest', 'ledger.tsv');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => l.split('\t')).map((c) => `${c[4]} ${c[3]}`) : [];
};

test('ingest: a stuck file is stopped, ledgered as failed in one line, and the run goes on', () => {
  const root = vault();
  fs.writeFileSync(path.join(root, 'prompts', 'ingest.md'), 'Ingest {{FILENAME}}\n');
  const raw = rawFiles('a.md', 'b-stuck.md', 'c.md');
  const r = node(root, 'ingest.mjs', ['--timeout', '0.02'], { ...ingestAgent(root), RAW_DIR: raw });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^agent failed on: b-stuck\.md \(stopped after 0\.02 min\)$/m);
  assert.deepEqual(ledgerRows(root), ['a.md ingested', 'b-stuck.md failed', 'c.md ingested']);
  removeVault(root);
  fs.rmSync(raw, { recursive: true, force: true });
});

test('ingest: a past deadline starts no file, and a file cut off by the deadline is taken again next run', () => {
  const root = vault();
  fs.writeFileSync(path.join(root, 'prompts', 'ingest.md'), 'Ingest {{FILENAME}}\n');
  const raw = rawFiles('a-stuck.md', 'b.md');
  let r = node(root, 'ingest.mjs', [], { ...ingestAgent(root), RAW_DIR: raw, INGEST_DEADLINE: String(Math.floor(Date.now() / 1000) - 1) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ingest: 0 file\(s\) handled\ningest: stopped at the deadline; the rest wait for the next run/);
  assert.deepEqual(ledgerRows(root), []);

  r = node(root, 'ingest.mjs', ['--deadline', String(Math.floor(Date.now() / 1000) + 2)], { ...ingestAgent(root), RAW_DIR: raw });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /ingest: a-stuck\.md was cut off at the deadline; the next run takes it again/);
  assert.match(r.stdout, /stopped at the deadline/);
  assert.deepEqual(ledgerRows(root), [], 'the cut-off file is not ledgered');
  removeVault(root);
  fs.rmSync(raw, { recursive: true, force: true });
});

// The Obsidian app comes with the notes folder by default, on every system that can run it.
// A real Linux run only plans the flatpak install when flatpak is there, and a CI runner has none,
// so the run gets a stand-in that is not installed Obsidian.
function dryRun(platform, ...args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const bin = path.join(home, 'stub-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'flatpak'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const r = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', platform, '--modules', 'second-brain', ...args],
    { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', PATH: `${bin}${path.delimiter}${process.env.PATH}` }, stdin: 'ignore' },
  );
  fs.rmSync(home, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('the Obsidian app is installed with the notes folder on Linux, Mac and Windows by default', { skip: process.platform === 'win32' && 'simulates other systems' }, () => {
  const want = {
    linux: /would run: flatpak install -y flathub md\.obsidian\.Obsidian/,
    macos: /would run: brew install --cask obsidian/,
    windows: /would run: winget install --id Obsidian\.Obsidian -e/,
    wsl: /to do: install Obsidian on the Windows side/,
  };
  for (const [platform, re] of Object.entries(want)) {
    const { code, out } = dryRun(platform);
    assert.equal(code, 0, out);
    assert.match(out, re, platform);
  }
  const { out } = dryRun('macos', '--answers', path.join(repoRoot, 'answers.example.env'));
  assert.match(out, /brew install --cask obsidian/, 'the example answers keep it on');
});

test('a saved "no" for the Obsidian app still wins', { skip: process.platform === 'win32' && 'simulates other systems' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answers-'));
  const file = path.join(dir, 'answers.env');
  fs.writeFileSync(file, 'VAULT_APP=no\n');
  const { code, out } = dryRun('macos', '--answers', file);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /cask obsidian/);
  assert.doesNotMatch(out, /with the Obsidian app/);
});

const hasAnalyze = spawnSync('systemd-analyze', ['--version'], { stdio: 'ignore' }).status === 0;

test('the systemd service writes WorkingDirectory as a bare path that systemd accepts', { skip: !hasAnalyze && 'systemd-analyze is not available here' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-'));
  const vaultDir = path.join(dir, 'my vault');
  fs.mkdirSync(vaultDir);
  const script = path.join(dir, 'housekeeping.mjs');
  fs.writeFileSync(script, '');
  const unit = serviceUnit({ about: 'check the vault', vault: vaultDir, script, all: { PATH: process.env.PATH, VAULT_PATH: vaultDir } });
  assert.match(unit, new RegExp(`^WorkingDirectory=${vaultDir}$`, 'm'));
  const file = path.join(dir, 'second-brain-housekeeping.service');
  fs.writeFileSync(file, unit);
  const r = spawnSync('systemd-analyze', ['--user', 'verify', file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.doesNotMatch(r.stdout + r.stderr, /WorkingDirectory|not absolute|fatal/i, r.stdout + r.stderr);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// Writes the Claude Code rules file and skill for real into a temporary home.
async function claudeFilesInto(home, given = {}, root = repoRoot) {
  const answers = new Map(Object.entries({ VAULT_PATH: path.join(home, 'my vault'), VAULT_TOOLS: 'search,capture', ...given }));
  const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun: false, interactive: false, answers, prompter: null, repoRoot: root });
  ctx.beginModule('second-brain');
  for (const q of secondBrain.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await writeClaudeFiles(ctx, ctx.get('VAULT_PATH'), ['work', 'home']);
  } finally {
    console.log = log;
  }
  return { out: lines.join('\n'), vault: ctx.get('VAULT_PATH') };
}

test('claude files: the rules file and skill land with the vault path filled in, and an edited copy is left alone', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-claude-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const { out, vault } = await claudeFilesInto(home);
    const rules = path.join(home, '.claude', 'rules', 'second-brain.md');
    const skill = path.join(home, '.claude', 'skills', 'second-brain', 'SKILL.md');
    for (const file of [rules, skill]) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(text.includes(vault), `${file} names the vault`);
      assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/, `${file} has no unfilled placeholder`);
      assert.match(text, /never (goes|send its content) to an outside model or service|outside\s+model or service/);
      assert.doesNotMatch(text, /—/, 'no em dashes');
    }
    const skillText = fs.readFileSync(skill, 'utf8');
    assert.match(skillText, /^---\nname: second-brain\ndescription: .+\n---\n/);
    assert.ok(skillText.includes(path.join(vault, 'bin', 'search.mjs')) && skillText.includes(path.join(vault, 'bin', 'capture.mjs')));
    assert.match(skillText, /`work\/`, `home\/`/);
    assert.match(out, /wrote .*second-brain\.md/);

    // A rerun with the same answers changes nothing; a local edit survives a rerun.
    assert.equal((await claudeFilesInto(home)).out.match(/is already up to date/g).length, 2);
    fs.appendFileSync(rules, '- My own line.\n');
    const again = (await claudeFilesInto(home)).out;
    assert.match(again, /second-brain\.md exists with different content \(a local edit, not a version this setup shipped\); left untouched/);
    assert.match(fs.readFileSync(rules, 'utf8'), /My own line/);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('claude files: only the scripts that were installed are named', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-claude-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    await claudeFilesInto(home, { VAULT_TOOLS: '' });
    const skill = fs.readFileSync(path.join(home, '.claude', 'skills', 'second-brain', 'SKILL.md'), 'utf8');
    assert.doesNotMatch(skill, /search\.mjs|capture\.mjs/);
    assert.match(skill, /MAP\.md/);
    fs.rmSync(path.join(home, '.claude'), { recursive: true });
    await claudeFilesInto(home, { VAULT_SCRIPTS: 'no' });
    for (const file of [path.join('rules', 'second-brain.md'), path.join('skills', 'second-brain', 'SKILL.md')]) {
      assert.doesNotMatch(fs.readFileSync(path.join(home, '.claude', file), 'utf8'), /bin\/|MAP\.md/, file);
    }
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

const claudeFile = (home, ...parts) => path.join(home, '.claude', ...parts);

test('claude files: by default both say vault content never goes to an outside model or service', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-claude-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    await claudeFilesInto(home);
    const rules = fs.readFileSync(claudeFile(home, 'rules', 'second-brain.md'), 'utf8');
    const skill = fs.readFileSync(claudeFile(home, 'skills', 'second-brain', 'SKILL.md'), 'utf8');
    assert.match(rules, /^- Vault content never goes to an outside model or service\.$/m);
    assert.match(skill, /never send its content to an\noutside model or service/);
    for (const text of [rules, skill]) {
      assert.doesNotMatch(text, /may go to an outside model|private chats/i);
      assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/);
    }
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('claude files: VAULT_OUTSIDE_MODELS=yes allows an outside model and workspace exports but keeps private chats local', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-claude-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    await claudeFilesInto(home, { VAULT_OUTSIDE_MODELS: 'yes' });
    for (const file of [claudeFile(home, 'rules', 'second-brain.md'), claudeFile(home, 'skills', 'second-brain', 'SKILL.md')]) {
      const text = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ');
      assert.match(text, /may go to an outside model through an agent CLI you chose/, file);
      assert.match(text, /because you have removed sensitive content/, file);
      assert.match(text, /Files that agent workspaces write and export \(reports, progress notes, memory archives, your answers\) count as raw files and may go too\./, file);
      assert.match(text, /Private chats themselves never go to an outside model or service\./, file);
      assert.doesNotMatch(text, /captures of your own agent sessions/, file);
      assert.doesNotMatch(text, /never send its content|Vault content never goes/, file);
      assert.doesNotMatch(text, /—|\{\{[A-Z_]+\}\}/, file);
    }
    assert.equal(secondBrain.questions.find((x) => x.key === 'VAULT_OUTSIDE_MODELS').default, false);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// The rules file and skill as PR 56 shipped them, before the outside-models answer existed.
const SHIPPED_RULES = `# Second brain

Your knowledge vault is \`{{VAULT_PATH}}\`: plain Markdown notes on your work and life
(projects, people, decisions, meetings, sources). It is private.

- Look there first for past decisions, project history, people and earlier findings. The
  \`second-brain\` skill has the read routes.
{{FIND_RULE}}
{{EDIT_RULE}}
- Vault content never goes to an outside model or service.
`;
const SHIPPED_SKILL = fs.readFileSync(path.join(repoRoot, 'templates', 'second-brain', 'claude', 'SKILL.md'), 'utf8')
  .replace('{{OUTSIDE_NOTE}}', 'It is private: never send its content to an\noutside model or service. Read it; do not edit notes by hand.');

test('claude files: a copy shipped before this answer existed is replaced on a rerun, an edited one is not', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-claude-'));
  const home = path.join(tmp, 'home');
  const clone = path.join(tmp, 'clone');
  const git = (...args) => {
    const r = spawnSync('git', ['-C', clone, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    // A throwaway clone whose history shipped the old wording, then the current template.
    const dir = path.join(clone, 'templates', 'second-brain', 'claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(home);
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'rules.md'), SHIPPED_RULES);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), SHIPPED_SKILL);
    git('add', '.');
    git('commit', '-qm', 'old');
    for (const f of ['rules.md', 'SKILL.md']) fs.copyFileSync(path.join(repoRoot, 'templates', 'second-brain', 'claude', f), path.join(dir, f));
    git('commit', '-qam', 'new');

    // The old files on a machine, written the way the old installer wrote them (no shipped record).
    const vault = path.join(home, 'my vault');
    const rulesFile = claudeFile(home, 'rules', 'second-brain.md');
    const skillFile = claudeFile(home, 'skills', 'second-brain', 'SKILL.md');
    const oldRules = SHIPPED_RULES
      .replace('{{VAULT_PATH}}', vault)
      .replace('{{FIND_RULE}}', `- Read \`${path.join(vault, 'MAP.md')}\` to find a note, then \`bin/search.mjs\` in that folder, or \`rg\`.`)
      .replace('{{EDIT_RULE}}', `- Do not edit vault notes by hand. Its own scripts (\`bin/ingest.mjs\`, \`bin/capture.mjs\`) write it; follow\n  \`${path.join(vault, 'AGENTS.md')}\` if a task needs a change there.`);
    fs.mkdirSync(path.dirname(rulesFile), { recursive: true });
    fs.writeFileSync(rulesFile, oldRules);

    const out = (await claudeFilesInto(home, { VAULT_OUTSIDE_MODELS: 'yes' }, clone)).out;
    assert.match(out, /replaced .*rules[\\/]second-brain\.md \(it was an older version this setup shipped\)/);
    const rules = fs.readFileSync(rulesFile, 'utf8');
    assert.match(rules, /may go to an outside model/);
    assert.doesNotMatch(rules, /^- Vault content never goes/m);
    assert.ok(fs.readdirSync(path.dirname(rulesFile)).some((f) => f.startsWith('second-brain.md.bak-')), 'the old file is backed up');

    // A local edit to an old copy is left alone.
    fs.writeFileSync(rulesFile, `${oldRules}- My own line.\n`);
    const kept = (await claudeFilesInto(home, { VAULT_OUTSIDE_MODELS: 'yes' }, clone)).out;
    assert.match(kept, /second-brain\.md exists with different content \(a local edit/);
    assert.match(fs.readFileSync(rulesFile, 'utf8'), /My own line/);
    assert.ok(fs.existsSync(skillFile));
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The yes wording as PR 59 shipped it, for a copy on a machine with no shipped record.
const PR59_RULE = `- Vault content and raw source files may go to an outside model through an agent CLI you
  chose, because you have removed sensitive content from them. Private chats and captures of
  your own agent sessions never go to an outside model or service.`;
const PR59_NOTE = `It is private. Its content and the raw source files may go to an outside
model through an agent CLI you chose, because you have removed sensitive content from them.
Private chats and captures of your own agent sessions never go to an outside model or
service. Read it; do not edit notes by hand.`;

test('claude files: a copy rendered from the PR 59 yes wording is replaced on a rerun, an edited one is not', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-claude-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    await claudeFilesInto(home, { VAULT_OUTSIDE_MODELS: 'yes' });
    const rulesFile = claudeFile(home, 'rules', 'second-brain.md');
    const skillFile = claudeFile(home, 'skills', 'second-brain', 'SKILL.md');
    const current = {
      rules: fs.readFileSync(rulesFile, 'utf8'),
      skill: fs.readFileSync(skillFile, 'utf8'),
    };
    const outsideRule = current.rules.slice(current.rules.indexOf('- Vault content and raw source files'));
    assert.match(current.skill, /Files that agent workspaces write and export/);
    const old = {
      rules: current.rules.replace(outsideRule, `${PR59_RULE}\n`),
      skill: current.skill.replace(/It is private\. Its content[\s\S]*?edit notes by hand\./, PR59_NOTE),
    };
    assert.notEqual(old.rules, current.rules);
    assert.notEqual(old.skill, current.skill);
    fs.writeFileSync(rulesFile, old.rules);
    fs.writeFileSync(skillFile, old.skill);
    fs.rmSync(path.join(home, '.config'), { recursive: true, force: true }); // no shipped record

    const out = (await claudeFilesInto(home, { VAULT_OUTSIDE_MODELS: 'yes' })).out;
    assert.match(out, /replaced .*rules[\\/]second-brain\.md \(it was an older version this setup shipped\)/);
    assert.match(out, /replaced .*skills[\\/]second-brain[\\/]SKILL\.md \(it was an older version this setup shipped\)/);
    assert.equal(fs.readFileSync(rulesFile, 'utf8'), current.rules);
    assert.equal(fs.readFileSync(skillFile, 'utf8'), current.skill);

    // A local edit to the PR 59 copy is left alone.
    fs.writeFileSync(rulesFile, `${old.rules}- My own line.\n`);
    fs.rmSync(path.join(home, '.config'), { recursive: true, force: true });
    const kept = (await claudeFilesInto(home, { VAULT_OUTSIDE_MODELS: 'yes' })).out;
    assert.match(kept, /second-brain\.md exists with different content \(a local edit/);
    assert.match(fs.readFileSync(rulesFile, 'utf8'), /My own line/);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// Runs the module's install for real into a temporary home; only the vault files are in play.
async function installInto(home, vaultDir, given = {}, platform = {}) {
  const answers = new Map(Object.entries({
    VAULT_PATH: vaultDir,
    VAULT_RAW_DIR: path.join(home, 'raw'),
    VAULT_PILLARS: 'work,home',
    VAULT_TOOLS: 'search',
    VAULT_GIT: 'no',
    VAULT_AGENT_ACCESS: 'no',
    VAULT_APP: 'no',
    ...given,
  }));
  const ctx = new Context({ platform: { ...detectPlatform(), home, ...platform }, dryRun: false, interactive: false, answers, prompter: null, repoRoot });
  ctx.beginModule('second-brain');
  for (const q of secondBrain.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await secondBrain.install(ctx);
  } finally {
    console.log = log;
  }
  return lines.join('\n');
}

const STARTER_FILES = ['work/README.md', 'people/README.md', 'templates/topic.md', 'bin/index.mjs', 'bin/ingest.mjs', 'bin/search.mjs', 'prompts/ingest.md'];

test('starter files: a fresh folder gets them, and it is not an existing vault', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-install-'));
  const dir = path.join(home, 'vault');
  try {
    assert.equal(isExistingVault(dir), false);
    const out = await installInto(home, dir);
    for (const f of STARTER_FILES) assert.ok(fs.existsSync(path.join(dir, f)), `${f} is written`);
    assert.doesNotMatch(out, /existing vault/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('starter files: a git folder with a commit gets none, and the skip is said', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-install-'));
  const dir = path.join(home, 'vault');
  try {
    fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'work', 'Alpha.md'), note('Alpha', 'topic', 'Alpha line'));
    git(dir, 'init', '-q');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'start');
    assert.equal(isExistingVault(dir), true);
    const out = await installInto(home, dir);
    for (const f of STARTER_FILES) assert.ok(!fs.existsSync(path.join(dir, f)), `${f} is left out`);
    for (const step of ['folder readmes', 'note templates', 'vault scripts', 'vault tools']) {
      assert.ok(out.includes(`skipped: ${step}: ${dir} is an existing vault; starter files left out`), `${step} says it was skipped`);
    }
    assert.match(out, /VAULT_REFRESH=yes/);
    assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=all').stdout.includes('README.md'), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('starter files: a git folder with no commit yet is still set up', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-install-'));
  const dir = path.join(home, 'vault');
  try {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    assert.equal(isExistingVault(dir), false);
    await installInto(home, dir);
    for (const f of STARTER_FILES) assert.ok(fs.existsSync(path.join(dir, f)), `${f} is written`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('starter files: VAULT_REFRESH=yes writes the missing ones into an existing vault', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-install-'));
  const dir = path.join(home, 'vault');
  try {
    fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'work', 'README.md'), 'my own readme\n');
    git(dir, 'init', '-q');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'start');
    const out = await installInto(home, dir, { VAULT_REFRESH: 'yes' });
    for (const f of STARTER_FILES.filter((f) => f !== 'work/README.md')) assert.ok(fs.existsSync(path.join(dir, f)), `${f} is written`);
    assert.equal(fs.readFileSync(path.join(dir, 'work', 'README.md'), 'utf8'), 'my own readme\n', 'an existing file is untouched');
    assert.doesNotMatch(out, /starter files left out/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('housekeeping: checks the vault and leaves MAP.md and every other file as it was', () => {
  const root = vault();
  try {
    const map = path.join(root, 'MAP.md');
    fs.writeFileSync(map, '# a map in my own format\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'map');
    const r = node(root, 'housekeeping.mjs', []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /contract ok/);
    assert.equal(fs.readFileSync(map, 'utf8'), '# a map in my own format\n');
    assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all').stdout, '');
  } finally {
    removeVault(root);
  }
});

test('housekeeping: a project with no stage is a warning and exits 0', () => {
  const root = vault();
  try {
    fs.mkdirSync(path.join(root, 'projects'));
    fs.writeFileSync(path.join(root, 'projects', 'Roadmap.md'), note('Roadmap', 'project', 'Plans (captured by t, 2026-01-01)'));
    const r = node(root, 'housekeeping.mjs', ['--quiet']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /projects[\\/]Roadmap\.md: warning: a project needs stage/);
    assert.match(r.stdout, /contract ok, 1 warning\(s\)/);
    assert.equal(node(root, 'check.mjs', []).status, 1, 'the checker on its own still flags it');
  } finally {
    removeVault(root);
  }
});

test('housekeeping: a real contract problem still exits non-zero', () => {
  const root = vault();
  try {
    fs.mkdirSync(path.join(root, 'projects'));
    fs.writeFileSync(path.join(root, 'projects', 'Odd.md'), note('Odd', 'project', 'Plans', 'stage: someday\n'));
    fs.writeFileSync(path.join(root, 'work', 'Gamma.md'), note('Gamma', 'topic', 'See [[Nowhere]]'));
    const r = node(root, 'housekeeping.mjs', ['--quiet']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /projects[\\/]Odd\.md: a project needs stage/);
    assert.match(r.stdout, /\[\[Nowhere\]\] does not resolve/);
    assert.match(r.stdout, /contract FAILING/);
  } finally {
    removeVault(root);
  }
});

// A research track: notes in research/notes/, plus its own queue files at the top of research/.
function addResearchTrack(root) {
  fs.mkdirSync(path.join(root, 'research', 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'research', 'notes', 'some-slug.md'), note('Slug', 'source', 'A finding',
    'source: https://example.com\ningested: 2026-01-01\nsha256: abc\nfiletype: html\n'));
  fs.writeFileSync(path.join(root, 'research', 'IDEAS.md'), note('Ideas', 'source', '- [[research/notes/some-slug]]'));
  fs.writeFileSync(path.join(root, 'research', 'reading-list.md'), '| url | kind | status |\n|---|---|---|\n');
  fs.writeFileSync(path.join(root, 'research', 'topics.md'), '| topic | status |\n|---|---|\n');
}

test('check: links to a research note resolve by path and by bare name', () => {
  const root = vault();
  try {
    addResearchTrack(root);
    fs.writeFileSync(path.join(root, 'work', 'Gamma.md'), note('Gamma', 'topic', 'See [[research/notes/some-slug]] and [[some-slug]]'));
    const r = node(root, 'check.mjs', []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /does not resolve/);
  } finally {
    removeVault(root);
  }
});

test('check: the research track\'s own files are not flagged', () => {
  const root = vault();
  try {
    addResearchTrack(root);
    const r = node(root, 'check.mjs', []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /research/);
  } finally {
    removeVault(root);
  }
});

test('check: a link to a missing research note still fails', () => {
  const root = vault();
  try {
    addResearchTrack(root);
    fs.writeFileSync(path.join(root, 'work', 'Gamma.md'), note('Gamma', 'topic', 'See [[research/notes/gone]]'));
    const r = node(root, 'check.mjs', []);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /work[\\/]Gamma\.md: \[\[research\/notes\/gone\]\] does not resolve to any note/);
  } finally {
    removeVault(root);
  }
});

test('housekeeping timer: it runs a copy kept outside the vault, and an existing vault gets nothing written', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-install-'));
  const dir = path.join(home, 'vault');
  try {
    fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'work', 'Alpha.md'), note('Alpha', 'topic', 'Alpha line'));
    fs.writeFileSync(path.join(dir, 'MAP.md'), 'my map\n');
    git(dir, 'init', '-q');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'start');
    const out = await installInto(home, dir, { VAULT_TIMERS: 'housekeeping' }, { os: 'linux', simulated: true });
    const script = path.join(housekeepingDir(home), 'housekeeping.mjs');
    assert.ok(out.includes(`would run ${script} every 3 hours`), out);
    for (const f of ['housekeeping.mjs', 'check.mjs', 'lib-vault.mjs']) assert.ok(fs.existsSync(path.join(housekeepingDir(home), f)), `${f} is shipped`);
    assert.ok(!fs.existsSync(path.join(dir, 'bin')), 'nothing is written into the vault');
    const before = git(dir, 'status', '--porcelain', '--untracked-files=all').stdout;
    const r = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: { ...process.env, VAULT_PATH: dir } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ok: 1 note\(s\)/);
    assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=all').stdout, before);
    assert.equal(fs.readFileSync(path.join(dir, 'MAP.md'), 'utf8'), 'my map\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('housekeeping timer: a unit an earlier version wrote is replaced, an edited one is kept', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-unit-'));
  try {
    const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun: false, interactive: false, answers: new Map(), prompter: null, repoRoot });
    ctx.beginModule('second-brain');
    const dir = path.join(home, 'vault');
    const old = serviceUnit({ about: 'check the vault and regenerate MAP.md', vault: dir, script: path.join(dir, 'bin', 'housekeeping.mjs'), all: { PATH: '/old/bin', VAULT_PATH: dir } });
    const fresh = serviceUnit({ about: 'check the vault and report problems', vault: dir, script: path.join(housekeepingDir(home), 'housekeeping.mjs'), all: { PATH: '/new/bin', VAULT_PATH: dir } });
    const earlier = serviceUnit({ about: 'check the vault and regenerate MAP.md', vault: dir, script: path.join(dir, 'bin', 'housekeeping.mjs'), all: { PATH: '/new/bin', VAULT_PATH: dir } });
    const file = path.join(home, 'second-brain-housekeeping.service');
    const log = console.log;
    console.log = () => {};
    try {
      fs.writeFileSync(file, old);
      assert.equal(await writeUnit(ctx, file, fresh, [earlier]), true);
      assert.equal(fs.readFileSync(file, 'utf8'), fresh);
      fs.writeFileSync(file, `${old}# my own line\n`);
      assert.equal(await writeUnit(ctx, file, fresh, [earlier]), false);
      assert.match(fs.readFileSync(file, 'utf8'), /# my own line/);
    } finally {
      console.log = log;
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
