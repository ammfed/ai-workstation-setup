// Tests for the optional vault tools in templates/second-brain/bin: search ranking, capture,
// the bookmark converter, and the garden pass with a stand-in agent. Everything runs in a
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
function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
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

const node = (root, script, args, env = {}) => spawnSync(process.execPath, [path.join(root, 'bin', script), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, VAULT_PATH: root, ...env } });

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
  fs.rmSync(root, { recursive: true, force: true });
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
  fs.rmSync(root, { recursive: true, force: true });
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
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(removed, { recursive: true, force: true });
});
