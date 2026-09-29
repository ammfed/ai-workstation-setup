// Tests for templates/news-digest/bin/news-digest.mjs: the sources format, feed and page
// parsing, and a whole run against a local server, with and without a model command.
// Run: node --test test/news-digest.test.mjs

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFeed, parsePage, parseSources, renderDigest } from '../templates/news-digest/bin/news-digest.mjs';
import { parseHours } from '../modules/news-digest/module.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'templates', 'news-digest', 'bin', 'news-digest.mjs');

const FEED = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[First &amp; best]]></title><link>https://example.org/a</link><pubDate>Mon, 01 Jan 2026</pubDate></item>
<item><title>Second</title><link>/b</link></item>
</channel></rss>`;
const ATOM = '<feed><entry><title>Atom one</title><link href="https://example.org/atom-1"/><updated>2026-01-02</updated></entry></feed>';
const PAGE = '<a href="/story">A headline with enough words</a><a href="/x">Short</a><a href="#top">Back to the top of it</a>';

test('the sources file: comments and blank lines are skipped, bad lines are named', () => {
  assert.deepEqual(parseSources('# a comment\n\nOne | feed | https://example.org/f\nTwo|page|http://example.org/p # trailing\n'), [
    { name: 'One', kind: 'feed', url: 'https://example.org/f' },
    { name: 'Two', kind: 'page', url: 'http://example.org/p' },
  ]);
  assert.throws(() => parseSources('Three | video | https://example.org'), /bad source line/);
  assert.throws(() => parseSources('Four | feed | ftp://example.org'), /bad source line/);
});

test('feeds (RSS and Atom) and pages become titled, absolute links', () => {
  assert.deepEqual(parseFeed(FEED, 'https://example.org/feed'), [
    { title: 'First & best', link: 'https://example.org/a', date: 'Mon, 01 Jan 2026' },
    { title: 'Second', link: 'https://example.org/b', date: '' },
  ]);
  assert.deepEqual(parseFeed(ATOM, 'https://example.org/'), [{ title: 'Atom one', link: 'https://example.org/atom-1', date: '2026-01-02' }]);
  assert.deepEqual(parsePage(PAGE, 'https://example.org/news'), [{ title: 'A headline with enough words', link: 'https://example.org/story', date: '' }]);
  assert.match(renderDigest('2026-01-01 10:00', [{ name: 'S', items: [{ title: 'T', link: 'https://e.org/t', date: '' }] }], 'Sum'), /## Summary\n\nSum\n\n## S\n\n- \[T\]\(https:\/\/e\.org\/t\)/);
});

test('the schedule is a whole number of hours from 1 to 24', () => {
  assert.equal(parseHours('6'), 6);
  assert.throws(() => parseHours('0'));
  assert.throws(() => parseHours('1.5'));
});

test('a run writes only new items, summarises with the given command, and honours "off"', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/feed') return res.end(FEED);
    if (req.url === '/page') return res.end(PAGE);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'news-digest-'));
  const out = path.join(tmp, 'out');
  fs.writeFileSync(path.join(tmp, 'sources.txt'), `Feed | feed | ${url}/feed\nPage | page | ${url}/page\nGone | feed | ${url}/missing\n`);
  const model = `"${process.execPath}" -e "process.stdin.resume();process.stdin.on('end',()=>console.log('two sources'))"`;
  const config = path.join(tmp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ sourcesFile: path.join(tmp, 'sources.txt'), outDir: out, model }));
  try {
    const dry = await runAsync(script, config, ['--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /dry run: 3 new items, nothing written/);
    assert.equal(fs.existsSync(out), false);

    const first = await runAsync(script, config, []);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Gone: FAILED/);
    const [digest] = fs.readdirSync(out);
    assert.match(digest, /^digest-\d{8}-\d{4}\.md$/);
    const text = fs.readFileSync(path.join(out, digest), 'utf8');
    assert.match(text, /## Summary\n\ntwo sources/);
    assert.match(text, /\[First & best\]\(https:\/\/example\.org\/a\)/);

    const second = await runAsync(script, config, []);
    assert.match(second.stdout, /nothing new/);

    fs.writeFileSync(path.join(tmp, 'off'), '');
    assert.match((await runAsync(script, config, [])).stdout, /off/);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Asynchronous, so the server in this process keeps answering while the run fetches.
function runAsync(file, config, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [file, '--config', config, ...args], { encoding: 'utf8', timeout: 60000 }, (err, stdout, stderr) =>
      resolve({ status: err ? (err.code ?? 1) : 0, stdout, stderr }),
    );
  });
}
