// Shared vault reading helpers for bin/*.mjs. Plain extraction only: these functions
// parse frontmatter and walk folders, they never interpret what a note says.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Folders that hold notes but are not life areas. Anything else at the top level
// that holds .md files is treated as a life-area folder, so renaming or adding one
// needs no change here.
export const ENTITY_DIRS = ['projects', 'people', 'decisions', 'meetings', 'reviews', 'journal', 'sources'];
export const NON_NOTE_DIRS = ['bin', 'templates', 'prompts', '.ingest', '.obsidian', '.git', '.trash', 'restricted'];
export const SKIP_FILES = ['README.md', 'MAP.md', 'START-HERE.md', 'AGENTS.md', 'CLAUDE.md'];

export const TYPES = ['source', 'topic', 'person', 'project', 'decision', 'meeting', 'daily', 'review'];
export const STATUSES = ['draft', 'current', 'superseded', 'archived'];
export const STAGES = ['idea', 'active', 'on-hold', 'done'];
export const REQUIRED = ['title', 'type', 'status', 'pillar', 'lang', 'created', 'updated'];
export const SOURCE_KEYS = ['source', 'ingested', 'sha256', 'filetype'];

// One fixed note type per entity folder. Life-area folders always hold topics.
export const FOLDER_TYPE = {
  people: 'person', projects: 'project', decisions: 'decision',
  meetings: 'meeting', journal: 'daily', reviews: 'review', sources: 'source',
};

export const DATED_DIRS = ['meetings', 'journal', 'reviews'];

/** Top-level folders that hold notes, life areas first, then the fixed entity folders. */
export function noteDirs(root) {
  const areas = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !NON_NOTE_DIRS.includes(e.name) && !ENTITY_DIRS.includes(e.name))
    .map((e) => e.name)
    .sort();
  return [...areas, ...ENTITY_DIRS.filter((d) => fs.existsSync(path.join(root, d)))];
}

/** Every note file in a folder, sorted, minus the files that carry no frontmatter. */
export function notesIn(root, dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((f) => f.endsWith('.md') && !SKIP_FILES.includes(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Split a note into its frontmatter fields and its body. Deliberately small: this is
 * the one frontmatter shape the contract allows, not a general YAML parser.
 */
export function parseNote(text) {
  if (!text.startsWith('---')) return { fields: {}, body: text, hasFrontmatter: false };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { fields: {}, body: text, hasFrontmatter: false };
  const fields = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return { fields, body: text.slice(end + 4), hasFrontmatter: true };
}

/** `pillar: [a, b]` as an array. */
export function listValue(raw) {
  if (!raw) return [];
  return raw.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Every [[wikilink]] target in a note body. */
export function wikilinks(body) {
  return [...body.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** The first line of real prose, for the one-line summary in MAP.md. */
export function firstProseLine(body) {
  for (const line of body.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('---') || s.startsWith('|') || s.startsWith('```')) continue;
    return s.replace(/^[-*]\s+/, '').replace(/^\*\*Summary:?\*\*\s*/i, '').replace(/^Summary:\s*/i, '');
  }
  return '';
}

/** Resolve the vault root: argv, then $VAULT_PATH, then the folder above bin/. */
export function vaultRoot(argv = []) {
  const fromArg = argv.find((a) => !a.startsWith('-'));
  return path.resolve(fromArg || process.env.VAULT_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
}
