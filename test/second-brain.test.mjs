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
import { agentEnv } from '../modules/second-brain/module.mjs';

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
