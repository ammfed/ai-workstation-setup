#!/usr/bin/env node
// Turn a browser's bookmark export (the "Netscape bookmark file" HTML every major browser
// writes) into markdown: one heading per folder, one `- [title](url) (added YYYY-MM-DD)` line
// per bookmark, in the original order. Plain extraction only, no model and no network.
//
// Write the result into $RAW_DIR and bin/ingest.mjs can then turn it into notes.
//
// Usage: node bin/bookmarks.mjs bookmarks.html [out.md]     (no out.md prints to stdout)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return entities[e.toLowerCase()] ?? m;
});
const clean = (s) => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const escape = (s) => s.replace(/[[\]]/g, '\\$&');

export function bookmarksToMarkdown(html) {
  const out = [];
  let depth = 0;
  const re = /<DL\b[^>]*>|<\/DL>|<H3\b[^>]*>([\s\S]*?)<\/H3>|<A\b([^>]*)>([\s\S]*?)<\/A>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[0].slice(0, 3).toUpperCase();
    if (tag === '<DL') depth += 1;
    else if (tag === '</D') depth = Math.max(0, depth - 1);
    else if (m[1] !== undefined) out.push('', `${'#'.repeat(Math.min(6, depth + 1))} ${clean(m[1])}`, '');
    else {
      const href = /\bHREF="([^"]*)"/i.exec(m[2])?.[1];
      if (!href) continue;
      const added = /\bADD_DATE="(\d+)"/i.exec(m[2])?.[1];
      const day = added ? new Date(Number(added) * 1000).toISOString().slice(0, 10) : null;
      out.push(`- [${escape(clean(m[3]) || decode(href))}](${decode(href)})${day ? ` (added ${day})` : ''}`);
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('Usage: node bin/bookmarks.mjs bookmarks.html [out.md]');
    process.exit(2);
  }
  const md = bookmarksToMarkdown(fs.readFileSync(input, 'utf8'));
  if (output) {
    fs.writeFileSync(output, md);
    console.log(`bookmarks: wrote ${output}`);
  } else process.stdout.write(md);
}
