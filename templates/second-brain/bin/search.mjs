#!/usr/bin/env node
// Ranked full-text search over the vault's notes (BM25), for when grep finds too much.
//
// Plain extraction only: it reads every note on each run and ranks by the words in the query.
// There is no index to build or keep fresh, no model and no network, so the notes stay the only
// source of truth and a search can never be stale. A title match counts more than a body match.
//
// Usage: node bin/search.mjs [--limit N] [--folder F] [--type T] [--json] QUERY...
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noteDirs, notesIn, parseNote, vaultRoot } from './lib-vault.mjs';

export const tokens = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 1);

/** Rank documents ({ id, title, body }) for a query. Title words count three times. */
export function rank(docs, query, { k1 = 1.2, b = 0.75 } = {}) {
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return [];
  const counted = docs.map((d) => {
    const all = [...tokens(d.title), ...tokens(d.title), ...tokens(d.title), ...tokens(d.body)];
    const tf = new Map();
    for (const t of all) tf.set(t, (tf.get(t) || 0) + 1);
    return { d, tf, len: all.length };
  });
  const avg = counted.reduce((s, c) => s + c.len, 0) / (counted.length || 1);
  const idf = Object.fromEntries(terms.map((t) => {
    const n = counted.filter((c) => c.tf.has(t)).length;
    return [t, Math.log(1 + (counted.length - n + 0.5) / (n + 0.5))];
  }));
  return counted
    .map(({ d, tf, len }) => ({
      ...d,
      score: terms.reduce((s, t) => {
        const f = tf.get(t) || 0;
        return s + (f ? idf[t] * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / (avg || 1)))) : 0);
      }, 0),
    }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
}

/** The first body line that holds a query word, trimmed, for context. */
function snippet(body, query) {
  const terms = tokens(query);
  const line = body.split('\n').find((l) => !l.startsWith('#') && tokens(l).some((t) => terms.includes(t)));
  return (line || '').trim().slice(0, 160);
}

// Run as a script; imported (by a test), it only exports rank and tokens.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const opts = { limit: 10, folder: null, type: null, json: false };
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') opts.limit = Number(argv[(i += 1)]);
    else if (a === '--folder') opts.folder = argv[(i += 1)];
    else if (a === '--type') opts.type = argv[(i += 1)];
    else if (a === '--json') opts.json = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node bin/search.mjs [--limit N] [--folder F] [--type T] [--json] QUERY...');
      process.exit(0);
    } else words.push(a);
  }
  if (!words.length) {
    console.error('search: give a query, for example: node bin/search.mjs budget review');
    process.exit(2);
  }
  const root = vaultRoot([]);
  const query = words.join(' ');
  const docs = noteDirs(root)
    .filter((d) => !opts.folder || d === opts.folder)
    .flatMap((d) => notesIn(root, d))
    .map((rel) => {
      const { fields, body } = parseNote(fs.readFileSync(path.join(root, rel), 'utf8'));
      return { id: rel, title: fields.title || path.basename(rel, '.md'), type: fields.type, body };
    })
    .filter((d) => !opts.type || d.type === opts.type);
  const hits = rank(docs, query).slice(0, opts.limit).map(({ id, title, type, score, body }) => ({ path: id, title, type, score: Number(score.toFixed(3)), line: snippet(body, query) }));
  if (opts.json) console.log(JSON.stringify(hits, null, 2));
  else if (!hits.length) console.log(`no notes match "${query}"`);
  else for (const h of hits) console.log(`${h.score.toFixed(2).padStart(6)}  ${h.path}  ${h.title}${h.line ? `\n        ${h.line}` : ''}`);
}
