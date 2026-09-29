#!/usr/bin/env node
// news-digest: a scheduled collector. It reads the sources you list, keeps only the items it
// has not seen before, and writes them as one Markdown digest. When you give it a model
// command, that command reads the new items on stdin and its answer becomes the digest's
// summary; without one, no model is ever called. Written by ai-workstation-setup
// (modules/news-digest); no dependencies, runs on Linux, macOS and Windows with Node 20+.
//
// Usage: news-digest.mjs [--dry-run] [--config FILE]
//   --dry-run   fetch and report counts, write nothing, call no model
//
// Sources file, one per line (# starts a comment):   name | kind | url
//   kind feed  an RSS or Atom feed
//   kind page  a web page; its links with a readable title become items
//
// A file named "off" next to the config turns every run into a no-op, and a lock stops two
// runs from overlapping. Exit status: 0 ok (or nothing new), 1 every source failed or the
// config is broken.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const expandHome = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

export function parseSources(text) {
  const sources = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [name, kind, url] = line.split('|').map((s) => s.trim());
    if (!name || !['feed', 'page'].includes(kind) || !/^https?:\/\//.test(url || '')) {
      throw new Error(`bad source line "${raw.trim()}" (expected: name | feed or page | http(s) url)`);
    }
    sources.push({ name, kind, url });
  }
  return sources;
}

const decode = (s) =>
  String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block, name) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]) : '';
};

// RSS <item> and Atom <entry>: title, link and date.
export function parseFeed(xml, base) {
  const items = [];
  for (const m of String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const block = m[0];
    const href = /<link\b[^>]*href="([^"]+)"/i.exec(block);
    const link = href ? href[1] : tag(block, 'link') || tag(block, 'guid');
    const title = tag(block, 'title');
    if (!title || !link) continue;
    items.push({ title, link: resolve(link, base), date: tag(block, 'pubDate') || tag(block, 'updated') || tag(block, 'published') });
  }
  return items;
}

// A page's links whose text reads like a headline (at least four words).
export function parsePage(html, base) {
  const items = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = decode(m[2]);
    const link = resolve(m[1], base);
    if (!link || title.split(' ').length < 4 || seen.has(link)) continue;
    seen.add(link);
    items.push({ title, link, date: '' });
  }
  return items;
}

function resolve(link, base) {
  try {
    const u = new URL(decode(link), base);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

async function fetchText(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'news-digest (ai-workstation-setup)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function renderDigest(when, groups, summary) {
  const out = [`# Digest ${when}`, ''];
  if (summary) out.push('## Summary', '', summary.trim(), '');
  for (const g of groups) {
    out.push(`## ${g.name}`, '');
    for (const it of g.items) out.push(`- [${it.title.replace(/[[\]]/g, '')}](${it.link})${it.date ? ` (${it.date})` : ''}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const i = argv.indexOf('--config');
  const configFile = i >= 0 ? argv[i + 1] : path.join(HERE, '..', 'config.json');
  const base = path.dirname(configFile);
  const config = loadJson(configFile, null);
  if (!config) throw new Error(`cannot read ${configFile}`);
  const log = (line) => {
    const text = `${new Date().toISOString()} ${line}`;
    console.log(text);
    if (!dryRun) fs.appendFileSync(path.join(base, 'runs.log'), `${text}\n`);
  };

  if (fs.existsSync(path.join(base, 'off'))) {
    log('off (remove the "off" file to turn it back on)');
    return 0;
  }

  const lock = path.join(base, 'run.lock');
  if (!dryRun) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
    } catch {
      // A lock older than two hours belongs to a run that died.
      if (Date.now() - fs.statSync(lock).mtimeMs < 2 * 3600 * 1000) {
        log('skipped: another run holds the lock');
        return 0;
      }
      fs.writeFileSync(lock, String(process.pid));
    }
  }
  try {
    const sources = parseSources(fs.readFileSync(expandHome(config.sourcesFile), 'utf8'));
    if (!sources.length) {
      log(`no sources yet: add them to ${config.sourcesFile}`);
      return 0;
    }
    const stateFile = path.join(base, 'state.json');
    const state = loadJson(stateFile, { seen: [] });
    const seen = new Set(state.seen);
    const limit = config.maxItemsPerSource || 20;
    const groups = [];
    let failed = 0;
    for (const s of sources) {
      try {
        const text = await fetchText(s.url, (config.timeoutSec || 30) * 1000);
        const items = (s.kind === 'feed' ? parseFeed(text, s.url) : parsePage(text, s.url)).slice(0, limit);
        const fresh = items.filter((it) => !seen.has(it.link));
        fresh.forEach((it) => seen.add(it.link));
        if (fresh.length) groups.push({ name: s.name, items: fresh });
        log(`${s.name}: ${items.length} items, ${fresh.length} new`);
      } catch (err) {
        failed += 1;
        log(`${s.name}: FAILED (${err.message})`);
      }
    }
    if (failed === sources.length) {
      log('FAILED: every source failed');
      return 1;
    }
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    if (!count) {
      log('nothing new');
      return 0;
    }
    if (dryRun) {
      log(`dry run: ${count} new items, nothing written`);
      return 0;
    }

    let summary = '';
    if (config.model) {
      const input = groups.map((g) => `${g.name}:\n${g.items.map((it) => `- ${it.title} ${it.link}`).join('\n')}`).join('\n\n');
      const r = spawnSync(config.model, { shell: true, input, encoding: 'utf8', timeout: (config.modelTimeoutSec || 300) * 1000 });
      if (r.status === 0 && r.stdout.trim()) summary = r.stdout;
      else log(`model command failed (${r.error ? r.error.message : `exit ${r.status}`}); the digest has the items only`);
    }
    const outDir = expandHome(config.outDir);
    fs.mkdirSync(outDir, { recursive: true });
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const file = path.join(outDir, `digest-${when.replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1-')}.md`);
    fs.writeFileSync(file, renderDigest(when, groups, summary));
    fs.writeFileSync(stateFile, `${JSON.stringify({ seen: [...seen].slice(-5000) })}\n`);
    const keep = config.keep || 60;
    const old = fs.readdirSync(outDir).filter((f) => /^digest-\d{8}-\d{4}\.md$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - keep))) fs.rmSync(path.join(outDir, f));
    log(`wrote ${file} (${count} new items)`);
    return 0;
  } finally {
    if (!dryRun) fs.rmSync(lock, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`news-digest: ${err.message}`);
      process.exit(1);
    },
  );
}
