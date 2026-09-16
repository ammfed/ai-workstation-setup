#!/usr/bin/env node
// Validate the note contract: required frontmatter, allowed values, the fixed type of each
// entity folder, dated filenames, and that every [[wikilink]] resolves to a note that exists.
//
// This is what makes AGENTS.md's contract real rather than merely documented. A note with
// missing or unparseable frontmatter is invisible to every filtered read of the vault, and a
// link to a note that was renamed away is a dead end: both are silent failures, so they get
// a loud gate instead.
//
// Usage: node bin/check.mjs [file...]      (no files means the whole vault)
// Exits non-zero if anything is wrong. Link targets always resolve against the whole vault.
import fs from 'node:fs';
import path from 'node:path';
import {
  noteDirs, notesIn, parseNote, listValue, wikilinks, vaultRoot,
  TYPES, STATUSES, STAGES, REQUIRED, SOURCE_KEYS, FOLDER_TYPE, DATED_DIRS,
} from './lib-vault.mjs';

const args = process.argv.slice(2);
// Args are files to check, never the root: the root comes from $VAULT_PATH or this script's folder.
const root = vaultRoot([]);
const dirs = noteDirs(root);
const allNotes = dirs.flatMap((d) => notesIn(root, d));
const known = new Set(allNotes.map((rel) => path.basename(rel, '.md')));

const targets = args.length
  ? args.map((a) => path.relative(root, path.resolve(a)))
  : allNotes;

const problems = [];
const flag = (rel, msg) => problems.push(`${rel}: ${msg}`);
// A real calendar date, not just the right shape: 2026-13-99 is a typo worth catching.
const isDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

for (const rel of targets) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { flag(rel, 'no such file'); continue; }
  const dir = rel.split(/[/\\]/)[0];
  const { fields, body, hasFrontmatter } = parseNote(fs.readFileSync(file, 'utf8'));

  if (!hasFrontmatter) { flag(rel, 'no frontmatter block'); continue; }

  for (const key of REQUIRED) if (!fields[key]) flag(rel, `missing required field: ${key}`);
  if (fields.type && !TYPES.includes(fields.type)) flag(rel, `type must be one of ${TYPES.join('|')}, got "${fields.type}"`);
  if (fields.status && !STATUSES.includes(fields.status)) flag(rel, `status must be one of ${STATUSES.join('|')}, got "${fields.status}"`);
  if (fields.pillar !== undefined && listValue(fields.pillar).length === 0) flag(rel, 'pillar must be a list with at least one value');
  for (const key of ['created', 'updated']) if (fields[key] && !isDate(fields[key])) flag(rel, `${key} must be YYYY-MM-DD, got "${fields[key]}"`);

  const fixed = FOLDER_TYPE[dir];
  if (fixed && fields.type && fields.type !== fixed) flag(rel, `every note in ${dir}/ must be type: ${fixed}, got "${fields.type}"`);
  if (!fixed && fields.type && fields.type !== 'topic') flag(rel, `a life-area folder holds type: topic, got "${fields.type}"`);

  if (fields.type === 'project' && !STAGES.includes(fields.stage)) flag(rel, `a project needs stage: ${STAGES.join('|')}`);
  if (fields.type === 'source') {
    for (const key of SOURCE_KEYS) if (!fields[key]) flag(rel, `a source note is missing: ${key}`);
    if (fields.ingested && !isDate(fields.ingested)) flag(rel, `ingested must be YYYY-MM-DD, got "${fields.ingested}"`);
  }

  if (DATED_DIRS.includes(dir) && !/^\d{4}-\d{2}-\d{2}/.test(path.basename(rel))) {
    flag(rel, `a filename in ${dir}/ must start with YYYY-MM-DD`);
  }

  for (const link of wikilinks(body)) {
    if (link.startsWith('<')) continue; // an unfilled template placeholder
    if (!known.has(link)) flag(rel, `[[${link}]] does not resolve to any note`);
  }
}

for (const p of problems) console.log(p);
console.log(problems.length
  ? `${problems.length} problem(s) in ${targets.length} note(s)`
  : `ok: ${targets.length} note(s), no problems`);
process.exit(problems.length ? 1 : 0);
