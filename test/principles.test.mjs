// Tests for templates/principles: the checker's script rows, each with a page that passes and
// one that fails, its exit codes and --phone, and the shipped check list itself.
// Run: node --test test/principles.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkText, listFiles } from '../templates/principles/bin/principle-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'templates', 'principles', 'bin', 'principle-check.mjs');
const checksFile = path.join(repoRoot, 'templates', 'principles', 'checks.md');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'principles-test-'));

const DASH = String.fromCharCode(0x2014);
const HEAD = '<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-size:16px;line-height:1.6}</style>';
const page = (body, head = HEAD) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ids = (text, kind = '.html', opts) => checkText(text, kind, opts).map((f) => `${f.id} ${f.level}`);
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

function write(name, text) {
  const file = path.join(tmp, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// One page that meets each script row and one that breaks it. The failing page must report the
// row; the passing page must report nothing at all, so a fixture never hides a second slip.
const ROWS = [
  {
    id: 'A6',
    pass: page('<video src="a.mp4" controls></video>', `${HEAD}<style>.in{animation:fade 1s}@keyframes fade{from{opacity:0}}@media (prefers-reduced-motion: reduce){.in{animation:none}}</style>`),
    fail: page('<video src="a.mp4" autoplay muted></video>'),
  },
  { id: 'A6', pass: page('<p>Still.</p>'), fail: page('<p class="in">Moving.</p>', `${HEAD}<style>.in{animation:spin 2s infinite}@keyframes spin{to{rotate:1turn}}</style>`) },
  { id: 'W5', pass: page('<p>Ready, then send.</p>'), fail: page(`<p>Ready ${DASH} then send.</p>`) },
  { id: 'W5', pass: page('<p>Ready &amp; waiting.</p>'), fail: page('<p>Ready &mdash; then send.</p>') },
  { id: 'W5', pass: page('<button>Accept</button> <a href="docs/a/b">docs</a>'), fail: page('<button>Accept/Reject</button>') },
  { id: 'L3', pass: page('<label for="q">Search</label><input id="q" placeholder="A city">'), fail: page('<input id="q" placeholder="Search">') },
  { id: 'L3', pass: page('<label>Note <textarea placeholder="Optional"></textarea></label>'), fail: page('<textarea aria-label="Note" placeholder="Note"></textarea>') },
  { id: 'L5', pass: page('<button aria-label="Close">&times;</button><button><svg><title>Menu</title></svg></button>'), fail: page('<button><svg viewBox="0 0 8 8"><path d="M0 0"/></svg></button>') },
  { id: 'L5', pass: page('<button>Send report</button>'), fail: page('<button class="x">&#10005;</button>') },
  { id: 'L10', pass: page('<p>Text.</p>'), fail: page('<p>Text.</p>', `${HEAD}<style>p{text-align:justify}</style>`) },
  { id: 'L10', pass: page('<p>Text.</p>', '<style>p{font-size:16px;line-height:24px}</style>'), fail: page('<p>Text.</p>', '<style>body{line-height:1.3}</style>') },
  { id: 'L10', pass: page('<h1>Title</h1><p>Text.</p>', `${HEAD}<style>h1{line-height:1.1}</style>`), fail: page('<p>Text.</p>', '<style>body{margin:0}</style>') },
  { id: 'N1', pass: page('<script>new Chart(el, { type: "bar", data })</script>'), fail: page("<script>new Chart(el, { type: 'doughnut', data })</script>") },
  { id: 'N1', pass: page('<script>const x = d3.scaleBand();</script>'), fail: page('<script>const p = d3.pie()(values);</script>') },
];

for (const [i, row] of ROWS.entries()) {
  test(`${row.id} (${i + 1}): a page that meets the row passes, a page that breaks it fails`, () => {
    assert.deepEqual(ids(row.pass), [], 'the passing page reports nothing');
    assert.ok(ids(row.fail).includes(`${row.id} fail`), `the failing page reports ${row.id}: ${ids(row.fail).join(', ')}`);
  });
}

test('W6, N4 and N8 are flagged for a reviewer and never fail on their own', () => {
  const clean = page('<p>Saved the report. 3 of 10 sources are older than a year (30%). Average 4.2 days.</p>');
  assert.deepEqual(ids(clean), []);
  const slips = page("<p>I'm saving the report.</p>\n<p>Done: 37%</p>\n<p>Mean 4.2817 days.</p>\n<p>Up 12.55%.</p>");
  assert.deepEqual(ids(slips).sort(), ['N4 check', 'N4 check', 'N8 check', 'N8 check', 'W6 check']);
  assert.deepEqual(ids('I will check it.\nVersion 1.2.3 runs on 127.0.0.1.\n', '.txt'), ['W6 check'], 'versions and addresses are not decimals');
});

test('L7 runs only with --phone: a viewport tag and body text of at least 14 px', () => {
  const small = page('<p>Text.</p>', '<style>body{line-height:1.6}p{font-size:12px}.tag{font-size:11px}</style>');
  assert.deepEqual(ids(small), [], 'off by default, and a small tag is not body text');
  assert.deepEqual(ids(small, '.html', { phone: true }), ['L7 fail', 'L7 fail'], 'no viewport tag, and 12 px body text');
  assert.deepEqual(ids(page('<p style="font-size:0.75rem">Text.</p>'), '.html', { phone: true }), ['L7 fail'], 'an inline style counts too');
  assert.deepEqual(ids(page('<p>Text.</p>'), '.html', { phone: true }), [], 'a page with the tag and 16 px text passes');
});

test('Markdown: code is skipped, headings are labels, and a mermaid pie chart fails', () => {
  const md = '# Accept or reject\n\nSent today.\n\n```sh\nnode run.mjs --rate 99.123%\n```\n\nSee `a/b` and [the guide](docs/a/b.md).\n';
  assert.deepEqual(ids(md, '.md'), []);
  assert.deepEqual(ids('# Accept/Reject\n', '.md'), ['W5 fail']);
  assert.deepEqual(ids(`Sent ${DASH} today.\n`, '.md'), ['W5 fail']);
  assert.deepEqual(ids('```mermaid\npie title Share\n  "A" : 3\n```\n', '.md'), ['N1 fail']);
});

test('each finding names the line it is on', () => {
  const [f] = checkText(`one\ntwo\nthree ${DASH} four\n`, '.txt');
  assert.deepEqual({ id: f.id, line: f.line, level: f.level }, { id: 'W5', line: 3, level: 'fail' });
});

test('the command exits 1 on a failure, 0 when nothing failed, 2 on a usage error', () => {
  const good = write('site/index.html', page('<button>Send report</button>'));
  const bad = write('site/broken.html', page('<button><svg></svg></button>'));
  write('site/notes.md', 'I checked it.\n');
  write('site/node_modules/dep/x.html', page(`<p>${DASH}</p>`));
  write('site/app.js', `// ${DASH}`);

  const ok = run(good);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /nothing failed \(1 file\)/);

  const fail = run(bad);
  assert.equal(fail.status, 1, fail.stdout);
  assert.match(fail.stdout, /broken\.html:1 {2}L5 fail {2}an icon-only button/);

  const folder = run(path.join(tmp, 'site'));
  assert.equal(folder.status, 1);
  assert.match(folder.stdout, /1 failed, 1 for a reviewer to decide \(3 files\)/, 'node_modules and .js files are not read');
  assert.deepEqual(listFiles([path.join(tmp, 'site')]).map((f) => path.basename(f)), ['broken.html', 'index.html', 'notes.md']);

  assert.equal(run().status, 2, 'no path');
  assert.equal(run('--nope', good).status, 2, 'unknown option');
  assert.equal(run(path.join(tmp, 'missing.html')).status, 2, 'missing path');
  assert.equal(run('--help').status, 0);
});

test('--phone on the command adds the 390 px rows', () => {
  const file = write('phone.html', page('<p>Text.</p>', '<style>body{line-height:1.6}</style>'));
  assert.equal(run(file).status, 0);
  const phone = run('--phone', file);
  assert.equal(phone.status, 1);
  assert.match(phone.stdout, /L7 fail {2}no <meta name="viewport"/);
  assert.match(phone.stdout, /phone rows on/);
});

test('the shipped check list and playbook pass the checker, and every check cites a public source type', () => {
  const playbook = path.join(repoRoot, 'templates', 'skills', 'workflow-playbook', 'SKILL.md');
  const r = run(checksFile, playbook);
  assert.equal(r.status, 0, r.stdout);

  const text = fs.readFileSync(checksFile, 'utf8');
  const rows = text.split('\n').filter((l) => /^\| [A-Z]\d+ \|/.test(l));
  assert.ok(rows.length >= 40, `the list has its rows (${rows.length})`);
  const listed = ['A6', 'W5', 'W6', 'L3', 'L5', 'L7', 'L10', 'N1', 'N4', 'N8'];
  for (const id of listed) assert.match(text, new RegExp(`\\b${id}\\b[^\\n]*\\n?`), `${id} is in the list`);
  assert.match(text, /checks A6, W5, W6, L3, L5, L7 \(viewport tag and text size\), L10, N1, N4 and N8/, 'the coverage line names exactly the rows the checker runs');
  for (const row of rows) {
    const source = row.split('|').at(-2).trim();
    assert.ok(/\((standards body|peer-reviewed|UX research org|government design system|official vendor guideline|book|peer-reviewed meta-analyses)\)|^House( writing)? rule|house rule/.test(source), `a public source type or house rule: ${row}`);
    assert.ok(!/\.md\b|report|vault|memory|captain|\/home\/|~\//i.test(source), `no private source: ${row}`);
  }
});

test('the shipped card template and ledger board pass the checker with --phone', () => {
  const cards = path.join(repoRoot, 'templates', 'preferences', 'decision-cards.html');
  const board = path.join(repoRoot, 'templates', 'ledger', 'bin', 'board.html');
  for (const file of [cards, board]) {
    const r = run('--phone', file);
    assert.equal(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /\b(L3|L10) fail/, path.relative(repoRoot, file));
  }
});

test('the playbook and the route name each owner-only skill only with the note that the owner starts it', () => {
  // These skills set disable-model-invocation upstream, so no agent can start them.
  const ownerOnly = ['wayfinder', 'to-spec', 'to-tickets', 'to-questionnaire', 'teach'];
  const files = [
    { file: path.join(repoRoot, 'templates', 'skills', 'workflow-playbook', 'SKILL.md'), note: 'owner starts it', rule: /start only when the owner types/, skills: ownerOnly },
    { file: path.join(repoRoot, 'docs', 'route.md'), note: 'you start it', rule: /start only when you type/, skills: ['wayfinder', 'to-spec', 'to-tickets'] },
  ];
  for (const { file, note, rule, skills } of files) {
    const text = fs.readFileSync(file, 'utf8');
    const ruleText = text.split('\n\n').find((p) => rule.test(p));
    assert.ok(ruleText, `${path.relative(repoRoot, file)} has the owner-only rule`);
    for (const name of skills) {
      assert.ok(ruleText.includes(`\`/${name}\``), `the rule names /${name}`);
      for (const line of text.split('\n').filter((l) => l.startsWith('|'))) {
        const named = line.match(new RegExp(`(?<![\\w/-])${name}(?![\\w-])`, 'g')) ?? [];
        const noted = line.match(new RegExp(`(?<![\\w/-])${name} \\(${note}\\)`, 'g')) ?? [];
        assert.equal(noted.length, named.length, `${name} carries "(${note})": ${line}`);
      }
    }
  }
});
