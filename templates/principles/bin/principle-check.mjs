#!/usr/bin/env node
// principle-check: the script rows of the principle check list (../checks.md), run on the
// files of a page, a prototype or a text before it goes to anyone. Written by
// ai-workstation-setup (modules/skills, beside the workflow-playbook skill); no dependencies,
// runs on Linux, macOS and Windows with Node 20+.
//
// Usage: principle-check.mjs [--phone] <file or folder>...
//   Reads .html, .htm, .md and .txt files; a folder is read whole, without .git and node_modules.
//   --phone   also check the 390 px rows (L7): for anything built for other people
//
// Checks today: A6, W5, W6, L3, L5, L7 (viewport tag and text size, with --phone), L10, N1,
// N4 and N8. It prints one line per finding: "file:line  ID  what is wrong, the fix".
// A "fail" line breaks a rule. A "check" line (W6, N4, N8) is a likely slip a reviewer
// decides on; it does not change the exit status.
//
// Exit status: 0 nothing failed, 1 at least one check failed, 2 usage error or unreadable path.
// It reads static files only; the rows marked "script later" in checks.md need a browser.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const READS = new Set(['.html', '.htm', '.md', '.txt']);
const SKIP_DIRS = new Set(['.git', 'node_modules']);
// Elements that hold running body text, for the text size and line height rows.
const BODY_TEXT = new Set(['*', 'html', 'body', ':root', 'p', 'li', 'dd', 'td', 'blockquote', 'main', 'article']);
const LABELS = ['button', 'label', 'option', 'legend', 'summary', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const ROUND_CHARTS = /\btype\s*:\s*['"](pie|doughnut|donut|radar|polarArea|gauge|bubble|sunburst|scatterpolar|barpolar|indicator|scatter3d|surface|mesh3d)['"]/g;

const blank = (s) => s.replace(/[^\n]/g, ' ');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};
const hasAttr = (attrs, name) => new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|$)`, 'i').test(attrs);
const hasName = (s) => /[\p{L}\p{N}]/u.test(s.replace(/&#?\w+;/g, ' '));

/** The parts of an HTML file a reader sees as text, with everything else blanked so offsets and lines stay put. */
export function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, blank)
    .replace(/<[^>]*>/g, blank)
    .replace(/&nbsp;/g, '      ');
}

/** A Markdown file without its code: fenced blocks and inline code spans are blanked. */
export function proseText(md) {
  return md.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, blank).replace(/`[^`\n]*`/g, blank);
}

/** Every CSS rule in the file's style blocks and style attributes: { selector, body, index }. */
export function cssRules(html) {
  const rules = [];
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const start = block.index + block[0].indexOf(block[1]);
    const css = block[1].replace(/\/\*[\s\S]*?\*\//g, blank);
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ selector: m[1].trim(), body: m[2], index: start + m.index });
  }
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*?)\sstyle\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    rules.push({ selector: m[1].toLowerCase(), body: m[4] ?? m[5], index: m.index });
  }
  return rules;
}

// True when one part of the selector list ends on an element that holds body text.
function isBodyText(selector) {
  return selector.split(',').some((part) => {
    const last = part.trim().split(/[\s>+~]+/).pop() || '';
    const tag = (last.match(/^(:root|[a-zA-Z][\w-]*|\*)/) || [''])[0].toLowerCase();
    return BODY_TEXT.has(tag);
  });
}

function decl(body, name) {
  const m = body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`, 'i'));
  return m ? m[1].trim() : null;
}

// A font size in px, or null when it cannot be told from the value alone.
function px(value) {
  const m = String(value).match(/^(\d*\.?\d+)(px|rem|em|pt)\b/);
  if (m) return Number(m[1]) * { px: 1, rem: 16, em: 16, pt: 4 / 3 }[m[2]];
  return { 'xx-small': 9, 'x-small': 10, small: 13 }[String(value).trim()] ?? null;
}

function fontSizeOf(body) {
  const size = decl(body, 'font-size');
  if (size) return size;
  const font = decl(body, 'font');
  const m = font && font.match(/(?:^|\s)(\d*\.?\d+(?:px|rem|em|pt))(?:\/|\s|$)/);
  return m ? m[1] : null;
}

function lineHeightOf(body) {
  const lh = decl(body, 'line-height') ?? ((decl(body, 'font') || '').match(/\/\s*([\d.]+[a-z%]*)/) || [])[1];
  if (!lh) return null;
  const m = lh.match(/^(\d*\.?\d+)(%|px|rem|em)?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!m[2]) return n;
  if (m[2] === '%') return n / 100;
  if (m[2] === 'em') return n;
  const size = px(fontSizeOf(body) || '');
  return size ? (m[2] === 'rem' ? n * 16 : n) / size : null;
}

function checkHtml(text, phone, report) {
  const seen = visibleText(text);
  const rules = cssRules(text);
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => ({ code: m[1], index: m.index }));

  // A6: no autoplay, no blinking, and motion only with a reduced-motion rule.
  for (const m of text.matchAll(/<(video|audio)\b[^>]*\sautoplay\b[^>]*>/gi)) report('fail', 'A6', lineAt(text, m.index), `<${m[1].toLowerCase()}> plays on its own; remove autoplay and let the reader start it`);
  for (const m of text.matchAll(/<(marquee|blink)\b/gi)) report('fail', 'A6', lineAt(text, m.index), `<${m[1].toLowerCase()}> moves on an idle screen; remove it`);
  for (const m of text.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["'][^"']*[?&]autoplay=1/gi)) report('fail', 'A6', lineAt(text, m.index), 'the embedded player starts on its own; drop autoplay=1');
  if (!/prefers-reduced-motion/i.test(text)) {
    const motion = [
      ...rules.filter((r) => /(?:^|[;\s])animation(?:-name)?\s*:\s*(?!\s*none\b)/i.test(r.body)).map((r) => r.index),
      ...[...text.matchAll(/@keyframes\b/gi)].map((m) => m.index),
      ...scripts.filter((s) => /\.animate\s*\(/.test(s.code)).map((s) => s.index),
    ];
    if (motion.length) report('fail', 'A6', lineAt(text, Math.min(...motion)), 'animation with no prefers-reduced-motion rule; add a @media (prefers-reduced-motion: reduce) block that turns it off');
  }

  // W5: slash-joined alternatives in labels (the em dash part runs on every file type).
  for (const tag of LABELS) {
    for (const m of text.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi'))) {
      const words = visibleText(m[1]);
      const slash = words.match(/(?<![\w/.:@-])([A-Za-z]{2,})\/([A-Za-z]{2,})(?![\w/.])/);
      if (slash) report('fail', 'W5', lineAt(text, m.index), `"${slash[0]}" in a <${tag}> label; pick one word or write both out`);
    }
  }
  for (const m of text.matchAll(/\s(?:aria-label|placeholder|title)\s*=\s*"([^"]*)"/gi)) {
    const slash = m[1].match(/(?<![\w/.:@-])([A-Za-z]{2,})\/([A-Za-z]{2,})(?![\w/.])/);
    if (slash) report('fail', 'W5', lineAt(text, m.index), `"${slash[0]}" in a label; pick one word or write both out`);
  }

  // L3: a placeholder is never the label.
  const labelled = new Set([...text.matchAll(/<label\b[^>]*\bfor\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]));
  let insideLabel = 0;
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const tag = m[2].toLowerCase();
    if (tag === 'label') insideLabel = Math.max(0, insideLabel + (m[1] ? -1 : 1));
    if (m[1] || !['input', 'textarea'].includes(tag) || !hasAttr(m[3], 'placeholder')) continue;
    if (/^(hidden|submit|button|reset|image|checkbox|radio)$/i.test(attr(m[3], 'type') || '')) continue;
    const id = attr(m[3], 'id');
    if (insideLabel || hasAttr(m[3], 'aria-labelledby') || (id && labelled.has(id))) continue;
    report('fail', 'L3', lineAt(text, m.index), `<${tag}> has a placeholder but no visible label; add a <label for> that stays on screen`);
  }

  // L5: every button has a name.
  for (const m of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi)) {
    if (['aria-label', 'aria-labelledby', 'title'].some((a) => hasAttr(m[1], a))) continue;
    if (hasName(visibleText(m[2])) || /<img\b[^>]*\balt\s*=\s*["'][^"']*[\p{L}\p{N}]/u.test(m[2]) || /<title\b[^>]*>[^<]*[\p{L}\p{N}]/u.test(m[2])) continue;
    report('fail', 'L5', lineAt(text, m.index), 'an icon-only button with no name; add visible text, or at least aria-label');
  }
  for (const m of text.matchAll(/<input\b([^>]*)>/gi)) {
    const type = (attr(m[1], 'type') || '').toLowerCase();
    if (!['button', 'submit', 'reset', 'image'].includes(type)) continue;
    const name = attr(m[1], type === 'image' ? 'alt' : 'value') || attr(m[1], 'aria-label') || '';
    if (!hasName(name) && type !== 'submit' && type !== 'reset') report('fail', 'L5', lineAt(text, m.index), `an <input type="${type}"> with no name; give it a ${type === 'image' ? 'alt' : 'value'}`);
  }

  // L7, static part, only for screens built for a 390 px phone.
  if (phone) {
    if (!/<meta\b[^>]*name\s*=\s*["']?viewport[^>]*width\s*=\s*device-width/i.test(text)) report('fail', 'L7', 1, 'no <meta name="viewport" content="width=device-width, initial-scale=1">; a phone shows the page zoomed out');
    for (const r of rules) {
      if (!isBodyText(r.selector)) continue;
      const size = px(fontSizeOf(r.body) || '');
      if (size !== null && size < 14) report('fail', 'L7', lineAt(text, r.index), `body text in "${r.selector}" is ${Math.round(size * 10) / 10} px; use at least 14 px`);
    }
  }

  // L10: never justified, body line height at least 1.5.
  for (const r of rules) {
    if (/text-align\s*:\s*justify/i.test(r.body)) report('fail', 'L10', lineAt(text, r.index), `"${r.selector}" justifies text; use text-align: start`);
  }
  for (const m of text.matchAll(/<[a-zA-Z][^>]*\salign\s*=\s*["']?justify/gi)) report('fail', 'L10', lineAt(text, m.index), 'justified text; remove align="justify"');
  const heights = rules.filter((r) => isBodyText(r.selector)).map((r) => ({ r, lh: lineHeightOf(r.body) })).filter((x) => x.lh !== null);
  for (const { r, lh } of heights) {
    if (lh < 1.5) report('fail', 'L10', lineAt(text, r.index), `body line height in "${r.selector}" is ${Math.round(lh * 100) / 100}; use at least 1.5`);
  }
  const styled = /<style\b|\sstyle\s*=/i.test(text) && !/<link\b[^>]*rel\s*=\s*["']?stylesheet/i.test(text);
  if (styled && !heights.length && hasName(seen)) report('fail', 'L10', 1, 'no line height is set for body text, so it is about 1.2; set body { line-height: 1.5 }');

  checkCharts(text, report);
  checkWords(seen, report);
}

// N1: values to compare sit on one shared scale, so no round or radial chart types.
function checkCharts(code, report) {
  for (const m of code.matchAll(ROUND_CHARTS)) report('fail', 'N1', lineAt(code, m.index), `a ${m[1]} chart; show the values as bars or dots on one shared scale`);
  for (const m of code.matchAll(/\bd3\.(pie|arc)\s*\(/g)) report('fail', 'N1', lineAt(code, m.index), `d3.${m[1]}() draws a round chart; use bars or dots on one shared scale`);
  for (const m of code.matchAll(/"mark"\s*:\s*(?:"arc"|\{[^}]*"type"\s*:\s*"arc")/g)) report('fail', 'N1', lineAt(code, m.index), 'an arc mark draws a pie or donut; use bars or dots on one shared scale');
  for (const m of code.matchAll(/^(?:```|~~~)\s*mermaid[^\n]*\n\s*(pie|radar-beta|radar)\b/gm)) report('fail', 'N1', lineAt(code, m.index), `a mermaid ${m[1]} chart; use a bar chart on one shared scale`);
}

// W6, N4 and N8 on the text a reader sees. Each line is a likely slip; a reviewer decides.
function checkWords(seen, report) {
  for (const m of seen.matchAll(/(?<![\p{L}\p{N}'’-])I(?:['’](?:m|ll|ve|d))?(?![\p{L}\p{N}'’-])/gu)) {
    report('check', 'W6', lineAt(seen, m.index), `"${m[0]}" in the text; if an assistant in the product says it, make the action the subject`);
  }
  const lines = seen.split('\n');
  lines.forEach((line, i) => {
    if (/(?<![\d.])\d+(?:\.\d+)?\s?(?:%|percent\b)/.test(line) && !/\b\d+\s+(?:of|in|out of)\s+(?:every\s+)?\d+/.test(line)) {
      report('check', 'N4', i + 1, 'a bare percentage; lead with a natural frequency ("3 of 10")');
    }
    for (const m of line.matchAll(/(?<![\d.])\d+\.(\d+)(\s?%)?(?!\d|\.\d)/g)) {
      if (m[1].length >= 3 || (m[2] && m[1].length >= 2)) report('check', 'N8', i + 1, `${m[0].trim()} has more decimals than most data supports; round it`);
    }
  });
}

// W5, em dash part: in any file type, as a character or an HTML or JavaScript escape.
function checkDashes(text, report) {
  for (const m of text.matchAll(/—|&mdash;|&#8212;|&#x2014;|\\u2014/gi)) report('fail', 'W5', lineAt(text, m.index), 'an em dash; use a period, a comma or a plain conjunction');
}

function checkMarkdown(text, report) {
  const prose = proseText(text);
  for (const m of prose.matchAll(/^#{1,6}\s[^\n]*$/gm)) {
    const slash = m[0].match(/(?<![\w/.:@-])([A-Za-z]{2,})\/([A-Za-z]{2,})(?![\w/.])/);
    if (slash) report('fail', 'W5', lineAt(text, m.index), `"${slash[0]}" in a heading; pick one word or write both out`);
  }
  checkCharts(text, report);
  checkWords(prose.replace(/\]\([^)\n]*\)/g, blank), report);
}

/**
 * Checks one file's text. kind is its extension (".html", ".md" or ".txt").
 * Returns the findings in line order: { level: 'fail' | 'check', id, line, message }.
 */
export function checkText(text, kind, { phone = false } = {}) {
  const findings = [];
  const report = (level, id, line, message) => findings.push({ level, id, line, message });
  checkDashes(text, report);
  if (kind === '.html' || kind === '.htm') checkHtml(text, phone, report);
  else if (kind === '.md') checkMarkdown(text, report);
  else checkWords(text, report);
  return findings.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
}

/** Every file the checker reads under the given paths, in a stable order. Throws on a missing path. */
export function listFiles(paths) {
  const out = [];
  const walk = (p) => {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) if (!SKIP_DIRS.has(name)) walk(path.join(p, name));
    } else if (READS.has(path.extname(p).toLowerCase())) out.push(p);
  };
  for (const p of paths) walk(p);
  return out;
}

export function main(argv, out = process.stdout, err = process.stderr) {
  const phone = argv.includes('--phone');
  const paths = argv.filter((a) => !a.startsWith('--'));
  const unknown = argv.filter((a) => a.startsWith('--') && a !== '--phone' && a !== '--help');
  if (argv.includes('--help') || !paths.length || unknown.length) {
    if (unknown.length) err.write(`principle-check: unknown option ${unknown.join(' ')}\n`);
    err.write('usage: principle-check.mjs [--phone] <file or folder>...\n');
    return argv.includes('--help') && !unknown.length ? 0 : 2;
  }
  let files;
  try {
    files = listFiles(paths);
  } catch (e) {
    err.write(`principle-check: cannot read ${e.path || paths.join(' ')}\n`);
    return 2;
  }
  let failed = 0;
  let flagged = 0;
  for (const file of files) {
    for (const f of checkText(fs.readFileSync(file, 'utf8'), path.extname(file).toLowerCase(), { phone })) {
      if (f.level === 'fail') failed++;
      else flagged++;
      out.write(`${file}:${f.line}  ${f.id} ${f.level}  ${f.message}\n`);
    }
  }
  const checked = `${files.length} file${files.length === 1 ? '' : 's'}${phone ? ', phone rows on' : ''}`;
  const toCheck = flagged ? `, ${flagged} for a reviewer to decide` : '';
  out.write(failed ? `principle-check: ${failed} failed${toCheck} (${checked})\n` : `principle-check: nothing failed${toCheck} (${checked})\n`);
  return failed ? 1 : 0;
}

// Run directly, not imported by a test. Real paths on both sides: a symlinked folder (such as
// macOS's /var -> /private/var) would otherwise make the two differ and the script do nothing.
function runAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runAsScript()) {
  process.exitCode = main(process.argv.slice(2));
}
