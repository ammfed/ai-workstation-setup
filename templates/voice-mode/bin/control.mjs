// Hands-free control: keys, shortcuts, the mouse, windows, browser tabs and moving files,
// for someone who cannot touch the keyboard or the mouse. A spoken command is read here by
// plain code (`controlPick`), with no model call; the decision model only sees the fixed
// items (press Enter, copy, next tab...) for phrasing these patterns do not cover.
// Keys and the mouse go through ydotool (the same daemon the "type" action uses); windows
// through a KWin script; files through Node's own fs, inside the person's common folders.
// Nothing here deletes for good: a delete goes to the trash, and only after a spoken yes,
// as does a move. Shortcuts that wipe for good (Shift+Delete) are never pressed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { excluded } from './config.mjs';

// ------------------------------------------------------------------ keys

// Linux input key codes (linux/input-event-codes.h), as ydotool takes them.
const CODE = {
  esc: 1, minus: 12, equal: 13, backspace: 14, tab: 15, enter: 28, ctrl: 29, shift: 42, alt: 56, space: 57, capslock: 58,
  semicolon: 39, apostrophe: 40, grave: 41, backslash: 43, comma: 51, dot: 52, slash: 53, leftbrace: 26, rightbrace: 27,
  home: 102, up: 103, pageup: 104, left: 105, right: 106, end: 107, down: 108, pagedown: 109, insert: 110, delete: 111,
  print: 99, menu: 127, meta: 125,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64, f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88,
};
'qwertyuiop'.split('').forEach((c, i) => (CODE[c] = 16 + i));
'asdfghjkl'.split('').forEach((c, i) => (CODE[c] = 30 + i));
'zxcvbnm'.split('').forEach((c, i) => (CODE[c] = 44 + i));
'1234567890'.split('').forEach((c, i) => (CODE[c] = 2 + i));
const MODS = new Set(['ctrl', 'shift', 'alt', 'meta']);

// How people say a key (and how speech-to-text writes it) → the key's name above.
const SAID = {
  control: 'ctrl', ctrl: 'ctrl', ctl: 'ctrl', contrl: 'ctrl', shift: 'shift', alt: 'alt', alternate: 'alt', option: 'alt',
  super: 'meta', meta: 'meta', windows: 'meta', win: 'meta', 'windows key': 'meta',
  enter: 'enter', return: 'enter', escape: 'esc', esc: 'esc', tab: 'tab', space: 'space', spacebar: 'space', 'space bar': 'space',
  backspace: 'backspace', 'back space': 'backspace', delete: 'delete', del: 'delete', insert: 'insert', home: 'home', end: 'end',
  'page up': 'pageup', pageup: 'pageup', 'page down': 'pagedown', pagedown: 'pagedown', 'caps lock': 'capslock', capslock: 'capslock',
  'print screen': 'print', menu: 'menu',
  up: 'up', down: 'down', left: 'left', right: 'right', 'up arrow': 'up', 'down arrow': 'down', 'left arrow': 'left', 'right arrow': 'right',
  'arrow up': 'up', 'arrow down': 'down', 'arrow left': 'left', 'arrow right': 'right',
  minus: 'minus', dash: 'minus', hyphen: 'minus', equals: 'equal', equal: 'equal', slash: 'slash', 'forward slash': 'slash', backslash: 'backslash',
  comma: 'comma', period: 'dot', dot: 'dot', 'full stop': 'dot', semicolon: 'semicolon', apostrophe: 'apostrophe', quote: 'apostrophe',
  backtick: 'grave', 'left bracket': 'leftbrace', 'right bracket': 'rightbrace',
  // Letters as speech-to-text sometimes hears them.
  see: 'c', sea: 'c', bee: 'b', dee: 'd', tee: 't', tea: 't', vee: 'v', ex: 'x', zed: 'z', zee: 'z', why: 'y', are: 'r', oh: 'o', queue: 'q', cue: 'q', jay: 'j', kay: 'k', el: 'l', em: 'm', en: 'n', pee: 'p', you: 'u', eye: 'i',
};
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, to: 2, too: 2, for: 4 };
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, last: 9 };
const FILLER = new Set(['the', 'key', 'keys', 'button', 'plus', 'and', 'with', 'together', 'at', 'once', 'combination', 'shortcut', 'keyboard']);

/** The spoken name of one key, as people say it ("Control", "F5", "Enter"). */
export function keyLabel(name) {
  if (/^f\d+$/.test(name)) return name.toUpperCase();
  const plain = { ctrl: 'Control', esc: 'Escape', pageup: 'Page Up', pagedown: 'Page Down', capslock: 'Caps Lock', meta: 'Super', print: 'Print Screen', dot: 'Period', equal: 'Equals', leftbrace: 'Left Bracket', rightbrace: 'Right Bracket', grave: 'Backtick' };
  return plain[name] || (name.length === 1 ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1));
}

/**
 * Spoken keys → a list of chords, each a list of key names with its modifiers first:
 * "control shift t" → [[ctrl, shift, t]]; "tab then enter" → [[tab], [enter]]; "alt f4" →
 * [[alt, f4]]. Several plain keys without a modifier are pressed one after another. Returns
 * null when any word is not a key, or a chord has more than one key besides its modifiers.
 */
export function parseKeys(said) {
  const s = String(said || '').toLowerCase().replace(/[’`]/g, "'").replace(/\b(\w)\s*\+\s*/g, '$1 ').replace(/\+/g, ' ').replace(/[.!?]+$/, '').trim();
  if (!s) return null;
  const out = [];
  for (const part of s.split(/\s*,\s*|\s+(?:and then|then|followed by|after that)\s+/)) {
    const w = part.replace(/(?<=[a-z])-(?=[a-z0-9])/g, ' ').split(/\s+/).filter(Boolean);
    const names = [];
    for (let i = 0; i < w.length; i++) {
      const two = `${w[i]} ${w[i + 1] || ''}`;
      if (w[i] === 'f' && w[i + 1] && (/^\d+$/.test(w[i + 1]) || w[i + 1] in NUM)) {
        names.push(`f${/^\d+$/.test(w[i + 1]) ? w[i + 1] : NUM[w[i + 1]]}`);
        i++;
      } else if (/^f\d{1,2}$/.test(w[i])) names.push(w[i]);
      else if (SAID[two]) {
        names.push(SAID[two]);
        i++;
      } else if (SAID[w[i]]) names.push(SAID[w[i]]);
      else if (/^[a-z0-9]$/.test(w[i])) names.push(w[i]);
      else if (w[i] in NUM && NUM[w[i]] < 10 && !['to', 'too', 'for'].includes(w[i])) names.push(String(NUM[w[i]]));
      else if (FILLER.has(w[i])) continue;
      else return null;
    }
    if (!names.length || names.some((n) => !(n in CODE))) return null;
    const mods = names.filter((n) => MODS.has(n));
    const keys = names.filter((n) => !MODS.has(n));
    if (!mods.length) for (const k of keys) out.push([k]);
    else if (keys.length <= 1) out.push([...new Set(mods), ...keys]);
    else return null;
  }
  return out.length ? out : null;
}

/** ydotool's key arguments: each chord pressed in order and let go in reverse, `times` over. */
export function keyArgs(chords, times = 1) {
  const ev = [];
  for (let t = 0; t < times; t++) for (const c of chords) ev.push(...c.map((k) => `${CODE[k]}:1`), ...[...c].reverse().map((k) => `${CODE[k]}:0`));
  return ev;
}

export const chordLabel = (chords) => chords.map((c) => c.map(keyLabel).join('+')).join(', then ');

// Shortcuts that wipe for good, or end the session: never pressed.
const NEVER = [
  { mods: ['shift'], key: 'delete', why: 'Shift+Delete deletes for good, so it is never pressed; "press delete" sends the selection to the trash instead' },
  { mods: ['ctrl', 'alt'], key: 'delete', why: 'Control+Alt+Delete ends the session' },
  { mods: ['ctrl', 'alt'], key: 'backspace', why: 'Control+Alt+Backspace can end the session' },
];
// Shortcuts that usually send something (Control+Enter sends a message or an email): pressed after a spoken yes.
const ASK = [{ mods: ['ctrl'], key: 'enter', why: 'usually sends the message' }];

const sameChord = (c, rule) => c[c.length - 1] === rule.key && rule.mods.every((m) => c.includes(m)) && c.length - 1 === rule.mods.length;

/** Why these keys are never pressed, or '' . */
export function refusedKeys(chords) {
  for (const c of chords || []) for (const r of NEVER) if (sameChord(c, r)) return r.why;
  return '';
}

/** Why these keys wait for a spoken yes, or ''. */
export function askKeys(chords) {
  for (const c of chords || []) for (const r of ASK) if (sameChord(c, r)) return `${chordLabel([c])} ${r.why}`;
  return '';
}

// ------------------------------------------------------------------ the fixed items

// Each one is a single shortcut or key in the window in front; `say` is the phrasing read here
// with no model call. `name` is what the decision model sees.
const K = (id, keys, name, done, say) => ({ id, keys: parseKeys(keys), name, done, say });
export const SHORTCUTS = [
  K('key:enter', 'enter', 'Press the Enter key in the window in front', 'pressed Enter'),
  K('key:escape', 'escape', 'Press the Escape key in the window in front (cancel, close a menu or dialog)', 'pressed Escape'),
  K('key:tab', 'tab', 'Press Tab: go to the next field or button', 'pressed Tab', /^(?:go to )?(?:the )?next (?:field|box|button|item)$/),
  K('key:shift-tab', 'shift tab', 'Press Shift+Tab: go back to the previous field or button', 'pressed Shift+Tab', /^(?:go (?:back )?to )?(?:the )?previous (?:field|box|button|item)$/),
  K('key:backspace', 'backspace', 'Press Backspace: delete the character before the text cursor', 'pressed Backspace', /^(?:delete|erase|remove) (?:the )?(?:last|previous) (?:letter|character)$/),
  K('key:delete', 'delete', 'Press the Delete key (in a file manager it moves the selected file to the trash)', 'pressed Delete'),
  K('key:space', 'space', 'Press the space bar', 'pressed Space'),
  K('key:up', 'up', 'Press the Up arrow key', 'pressed Up'),
  K('key:down', 'down', 'Press the Down arrow key', 'pressed Down'),
  K('key:left', 'left', 'Press the Left arrow key', 'pressed Left'),
  K('key:right', 'right', 'Press the Right arrow key', 'pressed Right'),
  K('key:page-up', 'page up', 'Press Page Up', 'pressed Page Up'),
  K('key:page-down', 'page down', 'Press Page Down', 'pressed Page Down'),
  K('key:home', 'home', 'Press Home: go to the start of the line', 'pressed Home'),
  K('key:end', 'end', 'Press End: go to the end of the line', 'pressed End'),
  K('edit:clear', 'ctrl a, backspace', 'Clear the field or text box: select all of it and delete it', 'cleared the field', /^(?:clear|empty|erase|wipe)(?: (?:out )?(?:the |this |that |all (?:the )?)?(?:field|box|text|line|input|address bar|url bar|search bar|search box|it|everything|all))?$|^(?:delete|erase|remove) (?:all|everything)(?: (?:the |of the )?text)?(?: in (?:the |this )?(?:field|box))?$|^select all and delete$/),
  K('edit:delete-word', 'ctrl backspace', 'Delete the word before the text cursor (Control+Backspace)', 'deleted the last word', /^(?:delete|erase|remove) (?:the )?(?:last|previous) word$/),
  K('edit:select-word', 'ctrl shift left', 'Select the word before the text cursor', 'selected the last word', /^select (?:the )?(?:last|previous) word$/),
  K('edit:select-line', 'shift home', 'Select from the text cursor to the start of the line', 'selected to the start of the line', /^select (?:the |this )?line$|^select to the (?:start|beginning) of the line$/),
  K('edit:select-to-end', 'shift end', 'Select from the text cursor to the end of the line', 'selected to the end of the line', /^select to the end(?: of the line)?$/),
  K('nav:address-bar', 'ctrl l', 'Go to the browser address bar (Control+L)', 'went to the address bar', /^(?:go to|focus|select|click(?: on)?|open|jump to) (?:the )?(?:address|url|location) bar$/),
  K('key:new-line', 'shift enter', 'Start a new line without sending (Shift+Enter)', 'started a new line', /^(?:new line|next line|line break|add a new line)$/),
  K('view:fullscreen', 'f11', 'Full screen on or off (F11)', 'pressed F11 for full screen', /^(?:go |make (?:it |this )?)?full ?screen$|^(?:exit|leave|toggle) full ?screen$/),
  K('edit:copy', 'ctrl c', 'Copy the selected text or item (Control+C)', 'copied', /^copy(?: (?:that|it|this|(?:the )?(?:selection|selected (?:text|item|file)s?|text)))?$/),
  K('edit:cut', 'ctrl x', 'Cut the selected text or item (Control+X)', 'cut the selection', /^cut(?: (?:that|it|this|(?:the )?(?:selection|selected (?:text|item|file)s?|text)))?$/),
  K('edit:paste', 'ctrl v', 'Paste (Control+V)', 'pasted', /^paste(?: (?:that|it|this|here|(?:the )?(?:text|clipboard|copied text)))?(?: here)?$/),
  K('edit:select-all', 'ctrl a', 'Select all (Control+A)', 'selected all', /^(?:select|highlight|mark) (?:all|everything)(?: (?:the )?text)?$|^select all$/),
  K('edit:undo', 'ctrl z', 'Undo the last change (Control+Z)', 'undid the last change', /^undo(?: (?:that|it|this|the last (?:thing|change|action)))?$/),
  K('edit:redo', 'ctrl shift z', 'Redo (Control+Shift+Z)', 'redid the change', /^redo(?: (?:that|it|this))?$/),
  K('edit:save', 'ctrl s', 'Save the file or document in the window in front (Control+S)', 'pressed Control+S to save', /^save(?: (?:the |this |my )?(?:file|document|work|it|changes|that))?$/),
  K('edit:find', 'ctrl f', 'Find text in the window in front or on the page (Control+F)', 'opened find', /^(?:find|search) (?:in|on) (?:the |this )?(?:page|document|file)$|^open (?:the )?find(?: bar)?$/),
  K('tab:new', 'ctrl t', 'Open a new tab in the browser or app in front (Control+T)', 'opened a new tab', /^(?:open |make |create )?(?:a )?new tab$/),
  K('tab:close', 'ctrl w', 'Close the current tab in the browser or app in front (Control+W)', 'closed the tab', /^close (?:the |this |current |that )?(?:current )?tab$/),
  K('tab:next', 'ctrl tab', 'Go to the next tab (Control+Tab)', 'went to the next tab', /^(?:go to |switch to |move to |change to )?(?:the )?next tab$|^(?:switch|change) tabs?$|^tab (?:right|forward)$/),
  K('tab:previous', 'ctrl shift tab', 'Go to the previous tab (Control+Shift+Tab)', 'went to the previous tab', /^(?:go (?:back )?to |switch (?:back )?to |move to )?(?:the )?previous tab$|^(?:prev tab|tab (?:left|back))$/),
  K('tab:reopen', 'ctrl shift t', 'Reopen the tab that was closed last (Control+Shift+T)', 'reopened the closed tab', /^(?:re-?open|bring back|restore|undo close|open again)(?: the)?(?: last)?(?: closed)? tab(?: again)?$|^(?:re-?open|bring back) (?:the )?(?:last )?closed tab$/),
  K('page:refresh', 'f5', 'Reload the page (F5)', 'reloaded the page', /^(?:refresh|reload)(?: (?:the |this )?(?:page|tab|window))?$/),
  K('page:go-back', 'alt left', 'Go back a page (Alt+Left)', 'went back', /^go back(?: a page| one page| to the (?:previous|last) page)?$/),
  K('page:go-forward', 'alt right', 'Go forward a page (Alt+Right)', 'went forward', /^go forward(?: a page| one page)?$/),
  K('view:zoom-in', 'ctrl equals', 'Zoom in (Control+Plus)', 'zoomed in', /^zoom in$|^make (?:it|the text|this) bigger$/),
  K('view:zoom-out', 'ctrl minus', 'Zoom out (Control+Minus)', 'zoomed out', /^zoom out$|^make (?:it|the text|this) smaller$/),
  K('view:zoom-reset', 'ctrl 0', 'Reset the zoom (Control+0)', 'reset the zoom', /^(?:reset|normal) (?:the )?zoom$/),
  K('view:top', 'ctrl home', 'Go to the very top (Control+Home)', 'went to the top', /^(?:scroll|go|jump) to the (?:very )?top(?: of the (?:page|document))?$/),
  K('view:bottom', 'ctrl end', 'Go to the very bottom (Control+End)', 'went to the bottom', /^(?:scroll|go|jump) to the (?:very )?(?:bottom|end)(?: of the (?:page|document))?$/),
];

// The mouse at the pointer (ydotool). Distances are rough: pointer acceleration applies.
const STEP = { little: 40, normal: 150, lot: 500 };
export const MOUSE = [
  { id: 'mouse:click', name: 'Click the left mouse button where the pointer is', done: 'clicked', click: ['0xC0'], say: /^(?:left )?click(?: (?:here|it|that|there|now|once|the mouse|the left (?:mouse )?button|on (?:it|that|this)))?$|^press the (?:left )?mouse(?: button)?$/ },
  { id: 'mouse:double-click', name: 'Double-click where the pointer is', done: 'double-clicked', click: ['--repeat', '2', '--next-delay', '40', '0xC0'], say: /^double[- ]?click(?: (?:here|it|that|there|on (?:it|that|this)))?$/ },
  { id: 'mouse:right-click', name: 'Right-click where the pointer is (opens the context menu)', done: 'right-clicked', click: ['0xC1'], say: /^right[- ]?click(?: (?:here|it|that|there|on (?:it|that|this)))?$|^open the (?:context|right[- ]click) menu$/ },
  { id: 'mouse:middle-click', name: 'Middle-click where the pointer is', done: 'middle-clicked', click: ['0xC2'], say: /^middle[- ]?click(?: (?:here|it|that|there))?$/ },
  { id: 'mouse:scroll-up', name: 'Scroll up where the pointer is', done: 'scrolled up', wheel: [0, 1] },
  { id: 'mouse:scroll-down', name: 'Scroll down where the pointer is', done: 'scrolled down', wheel: [0, -1] },
  { id: 'mouse:move-up', name: 'Move the mouse pointer up', done: 'moved the pointer up', move: [0, -1] },
  { id: 'mouse:move-down', name: 'Move the mouse pointer down', done: 'moved the pointer down', move: [0, 1] },
  { id: 'mouse:move-left', name: 'Move the mouse pointer left', done: 'moved the pointer left', move: [-1, 0] },
  { id: 'mouse:move-right', name: 'Move the mouse pointer right', done: 'moved the pointer right', move: [1, 0] },
];

// Windows, through KWin (Plasma's window manager). Minimize, maximize and show the desktop are
// the desktop's own shortcuts (desk.mjs SYSTEM); these need a script.
export const WINDOWS = [
  { id: 'window:close', name: 'Close the window in front, the way its close button does (it still asks about unsaved work)', done: 'closed the window in front', final: true, say: /^close (?:the |this |current |that )?(?:current )?(?:window|app|application|program)(?: in front)?$|^close (?:it|this|that)$/ },
  { id: 'window:next', name: 'Switch to the next window (like Alt+Tab)', done: 'switched to the next window', say: /^(?:switch|change|go|move|flip)(?: (?:to|over to))? (?:the )?(?:next|other|previous|last) (?:window|app|application)$|^(?:next|other|previous) window$|^switch (?:windows|apps|applications)$|^alt tab$/ },
  { id: 'window:restore', name: 'Restore a window: bring back the last minimized window, or un-maximize the one in front', done: 'restored the window', say: /^(?:restore|un-?minimi[sz]e|un-?maximi[sz]e)(?: (?:the |this |that |my |last )?(?:window|app))?$|^bring (?:the |that |my )?window back$|^make (?:the )?window smaller$/ },
];

// The few desktop shortcuts from desk.mjs SYSTEM that are also said plainly; the catalog decides whether they are there.
const SYSTEM_SAY = [
  ['system:window-minimize', /^minimi[sz]e(?: (?:the |this |that |current )?(?:window|app|it|this|that)(?: in front)?)?$|^hide (?:this|the) window$/],
  ['system:window-maximize', /^maximi[sz]e(?: (?:the |this |that |current )?(?:window|app|it|this|that)(?: in front)?)?$|^make (?:the |this )?window (?:full screen|bigger)$/],
  ['system:show-desktop', /^(?:show|go to) (?:the |my )?desktop$/],
  ['system:window-tile-left', /^(?:snap|tile|move|put) (?:the |this )?(?:window|it|this)(?: to the)? left(?: half| side)?$|^(?:snap|tile) left$/],
  ['system:window-tile-right', /^(?:snap|tile|move|put) (?:the |this )?(?:window|it|this)(?: to the)? right(?: half| side)?$|^(?:snap|tile) right$/],
];

/**
 * The hands-free items for the catalog. Keys and the mouse need ydotool, windows KWin; files
 * need only the common folders. Items marked `local` take words only plain code reads (a key
 * combination, a tab number, a file name) and are never offered to the decision model.
 */
export function handsFreeItems({ keys = true, kwin = true, files = true, trash = true } = {}) {
  const out = [];
  if (keys) {
    for (const s of SHORTCUTS) out.push([s.id, { kind: 'keys', name: s.name, done: s.done, keys: s.keys, final: true, handsFree: true }]);
    out.push(['keys:combo', { kind: 'keys', combo: true, name: 'Press the keys or keyboard shortcut they name', local: true, final: true }]);
    out.push(['tab:go', { kind: 'keys', tabNumber: true, name: 'Go to the tab with the number they say', local: true, final: true }]);
    for (const m of MOUSE) out.push([m.id, { kind: 'mouse', name: m.name, done: m.done, click: m.click, wheel: m.wheel, move: m.move, final: true, handsFree: true }]);
  }
  if (kwin) for (const w of WINDOWS) out.push([w.id, { kind: 'window', name: w.name, done: w.done, op: w.id.slice(7), final: true, handsFree: true }]);
  if (files) {
    out.push(['files:move', { kind: 'files', op: 'move', name: 'Move a file or folder they name to another folder', local: true, final: true, ask: true }]);
    out.push(['files:copy', { kind: 'files', op: 'copy', name: 'Copy a file or folder they name to another folder', local: true, final: true }]);
    if (trash) out.push(['files:trash', { kind: 'files', op: 'trash', name: 'Move a file or folder they name to the trash', local: true, final: true, ask: true }]);
  }
  return out;
}

// ------------------------------------------------------------------ reading a spoken command

const WORDNUM = { once: 1, twice: 2, thrice: 3, ...NUM, few: 3, couple: 2 };

/** "press down three times" → { rest: 'press down', times: 3 }; at most 50. */
export function repeats(t) {
  const m = t.match(/^(.*?)(?:,)?\s+(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a few|a couple of) times|(twice|thrice))$/);
  if (!m) return { rest: t, times: 1 };
  const n = m[3] ? WORDNUM[m[3]] : /^\d+$/.test(m[2]) ? Number(m[2]) : WORDNUM[m[2].replace(/^a (?:few|couple of)$/, (x) => (x.includes('few') ? 'few' : 'couple'))];
  return n >= 1 ? { rest: m[1].trim(), times: Math.min(n, 50) } : { rest: t, times: 1 };
}

const PLACE_WORDS = { home: 'home', 'home folder': 'home', downloads: 'downloads', download: 'downloads', documents: 'documents', document: 'documents', docs: 'documents', desktop: 'desktop', pictures: 'pictures', picture: 'pictures', photos: 'pictures', music: 'music', videos: 'videos', video: 'videos' };
const PLACE_RE = `(?:the |my )?(home folder|home|downloads?|documents?|docs|desktop|pictures?|photos|music|videos?)(?: folder| directory)?`;

/** A spoken file command → { op, name, from, to } (places are home, downloads, documents...), or null. */
export function parseFileCommand(t) {
  const s = String(t || '').toLowerCase().replace(/[’`]/g, "'").replace(/[?!]+/g, '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  let m = s.match(new RegExp(`^(move|copy|put) (?:the )?(?:(?:file|folder|document|picture|photo) )?(?:called |named )?(.+?)(?: (?:from|in|out of) ${PLACE_RE})? (?:in)?to ${PLACE_RE}$`));
  if (m) return { op: m[1] === 'copy' ? 'copy' : 'move', name: m[2].trim(), from: m[3] ? PLACE_WORDS[m[3]] : '', to: PLACE_WORDS[m[4]] };
  m = s.match(new RegExp(`^(?:delete|trash|remove|throw away|bin) (?:the )?(?:(?:file|folder|document|picture|photo) )?(?:called |named )?(.+?)(?: (?:from|in) ${PLACE_RE})?(?: to the (?:trash|bin))?$`));
  if (m && !/\b(?:everything|else|except|keep|only)\b/.test(m[1]) && !/^(?:it|that|this|everything|all|trash|bin|(?:the )?(?:last|previous|next) (?:letter|character|word|line)s?|(?:the )?(?:letter|character|word|line|text|selection)|(?:the )?(?:last )?\w+ (?:words?|letters?|characters?|lines?))$/.test(m[1].trim())) return { op: 'trash', name: m[1].trim(), from: m[2] ? PLACE_WORDS[m[2]] : '', to: '' };
  return null;
}

/**
 * A spoken command, already lower case with the leading "can you", "please" and the like
 * removed, → { key, slot } for the catalog, or null for anything else.
 */
export function controlPick(t, has) {
  if (!t) return null;
  // Files first: "copy report to documents" is a file, "copy" alone is the shortcut.
  const f = parseFileCommand(t);
  if (f) return has(`files:${f.op}`) ? { key: `files:${f.op}`, slot: t } : null;
  const { rest, times } = repeats(t);
  const slot = times > 1 ? `${times}` : '';
  // With the assistant's own browser page on offer (browser.mjs), scrolling and going back or
  // forward are that page's: the chooser decides, as before.
  if (has('page:scroll-down') && /^(?:scroll|go back|go forward)\b/.test(rest)) return null;
  for (const s of SHORTCUTS) if (s.say && s.say.test(rest) && has(s.id)) return { key: s.id, ...(slot ? { slot } : {}) };
  for (const w of WINDOWS) if (w.say.test(rest) && has(w.id)) return { key: w.id };
  for (const [key, re] of SYSTEM_SAY) if (re.test(rest) && has(key)) return { key };
  for (const m of MOUSE) if (m.say && m.say.test(rest) && has(m.id)) return { key: m.id };
  let m;
  // "delete the last 3 words", "delete five letters", "backspace 10 times".
  if ((m = rest.match(/^(?:delete|erase|remove) (?:the )?(?:last )?(\w+) (words?|letters?|characters?)$/))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]];
    const key = /^word/.test(m[2]) ? 'edit:delete-word' : 'key:backspace';
    if (n >= 1 && has(key)) return { key, ...(n > 1 ? { slot: String(Math.min(n, 50)) } : {}) };
  }
  // "go to tab 3", "switch to the second tab", "last tab".
  if ((m = rest.match(/^(?:go to|switch to|open|show|jump to)? ?(?:the )?(?:tab (?:number )?(\w+)|(\w+) tab)$/))) {
    const w = m[1] || m[2];
    const n = /^\d+$/.test(w) ? Number(w) : m[1] ? NUM[w] : ORDINAL[w];
    if (n >= 1 && n <= 9 && has('tab:go')) return { key: 'tab:go', slot: String(n) };
  }
  // "scroll down", "scroll up a lot", "scroll down three times".
  if ((m = rest.match(/^scroll (up|down)(?: (a (?:little|bit)|a lot|more|some more|further))?$/))) {
    const key = `mouse:scroll-${m[1]}`;
    const amount = (m[2] || '').includes('lot') ? 3 : /little|bit/.test(m[2] || '') ? 1 : 2;
    return has(key) ? { key, slot: String(Math.min(amount * times, 30)) } : null;
  }
  // "move the mouse left", "move the pointer up a lot", "mouse down a little".
  if ((m = rest.match(/^(?:move )?(?:the )?(?:mouse|pointer|cursor|mouse pointer|mouse cursor)(?: (a (?:little|bit)|a lot))? (up|down|left|right)(?: (a (?:little|bit)|a lot|more|further))?$/))) {
    const key = `mouse:move-${m[2]}`;
    const how = `${m[1] || ''} ${m[3] || ''}`;
    const px = /lot/.test(how) ? STEP.lot : /little|bit/.test(how) ? STEP.little : STEP.normal;
    return has(key) ? { key, slot: String(Math.min(px * times, 2000)) } : null;
  }
  // "press enter", "hit control shift t", "press tab twice", and a key named on its own ("escape", "control c").
  m = rest.match(/^(?:press|hit|push|tap|use) (.+)$/);
  const said = m ? m[1].replace(/ (?:key|keys|button)$/, '') : rest;
  const chords = parseKeys(said);
  if (!chords) return null;
  // On its own (no "press"), only a named key or a combination counts: never one letter or a
  // number word, and never Delete (in a file manager it trashes the selection).
  if (!m && (/^the /.test(rest) || chords.every((c) => c.length === 1 && (/^[a-z0-9]$/.test(c[0]) || c[0] === 'delete')))) return null;
  const one = chords.length === 1 && SHORTCUTS.find((s) => s.keys.length === 1 && s.keys[0].join() === chords[0].join() && has(s.id));
  if (one) return { key: one.id, ...(slot ? { slot } : {}) };
  return has('keys:combo') ? { key: 'keys:combo', slot: times > 1 ? `${said} ${times} times` : said } : null;
}

// ------------------------------------------------------------------ the common folders

/** The person's common folders by spoken name, from ~/.config/user-dirs.dirs when there is one. */
export function places(home = os.homedir(), env = process.env) {
  const out = { home, downloads: path.join(home, 'Downloads'), documents: path.join(home, 'Documents'), desktop: path.join(home, 'Desktop'), pictures: path.join(home, 'Pictures'), music: path.join(home, 'Music'), videos: path.join(home, 'Videos') };
  const file = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'user-dirs.dirs');
  try {
    const key = { DOWNLOAD: 'downloads', DOCUMENTS: 'documents', DESKTOP: 'desktop', PICTURES: 'pictures', MUSIC: 'music', VIDEOS: 'videos' };
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/^XDG_([A-Z]+)_DIR="([^"]+)"/gm)) {
      const dir = m[2].replace(/^\$HOME/, home);
      if (key[m[1]] && path.isAbsolute(dir) && dir !== home) out[key[m[1]]] = dir;
    }
  } catch {}
  return out;
}

const PLACE_NAME = { home: 'your home folder', downloads: 'Downloads', documents: 'Documents', desktop: 'the Desktop', pictures: 'Pictures', music: 'Music', videos: 'Videos' };
export const placeName = (p) => PLACE_NAME[p] || p;

// "report dot pdf", "Report_final-2.PDF" and "report final 2" all read the same.
const plainName = (s) => String(s).toLowerCase().replace(/\s+dot\s+/g, '.').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const stem = (n) => (n.includes('.') && !n.startsWith('.') ? n.slice(0, n.lastIndexOf('.')) : n);

/**
 * The spoken file command as a plan: exactly one file or folder by that name in the named
 * folder (or, with none named, in one of the common folders), a destination with nothing of
 * that name in it yet. Anything unclear throws a plain reason and nothing is done.
 */
export function planFiles(cmd, { home = os.homedir(), env = process.env, exclude = [] } = {}) {
  if (!cmd) throw new Error('that is not a file command');
  const dirs = places(home, env);
  const want = plainName(cmd.name.replace(/^(?:my |the )/, ''));
  if (!want) throw new Error('no file name was said');
  const where = cmd.from ? [cmd.from] : ['downloads', 'documents', 'desktop', 'pictures', 'music', 'videos', 'home'];
  const protectedDirs = new Set([home, ...Object.values(dirs)].map((d) => path.resolve(d)));
  const hits = [];
  for (const p of where) {
    let entries = [];
    try {
      entries = fs.readdirSync(dirs[p], { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || !(e.isFile() || e.isDirectory())) continue;
      const full = path.join(dirs[p], e.name);
      if (protectedDirs.has(path.resolve(full)) || excluded(full, exclude, [dirs[p]])) continue;
      const exact = plainName(e.name) === want || plainName(stem(e.name)) === want;
      const part = !exact && ` ${plainName(stem(e.name))} `.includes(` ${want} `);
      if (exact || part) hits.push({ place: p, path: full, name: e.name, dir: e.isDirectory(), exact });
    }
  }
  const exact = hits.filter((h) => h.exact);
  const found = exact.length ? exact : hits;
  const from = cmd.from ? placeName(cmd.from) : 'your common folders';
  if (!found.length) throw new Error(`there is no file or folder called "${cmd.name}" in ${from}`);
  if (found.length > 1) throw new Error(`${found.length} things in ${from} match "${cmd.name}" (${found.slice(0, 3).map((h) => h.name).join(', ')}${found.length > 3 ? '...' : ''}); say the full name`);
  const src = found[0];
  const plan = { op: cmd.op, src: src.path, name: src.name, dir: src.dir, from: src.place };
  if (cmd.op === 'trash') return plan;
  const to = dirs[cmd.to];
  if (cmd.to === src.place || path.resolve(to) === path.resolve(path.dirname(src.path))) throw new Error(`"${src.name}" is already in ${placeName(cmd.to)}`);
  const dst = path.join(to, src.name);
  if (path.resolve(dst).startsWith(path.resolve(src.path) + path.sep)) throw new Error('a folder cannot go inside itself');
  if (fs.existsSync(dst)) throw new Error(`${placeName(cmd.to)} already has something called "${src.name}", so nothing was ${cmd.op === 'copy' ? 'copied' : 'moved'}`);
  return { ...plan, to: cmd.to, dst };
}

/** What a plan does, said aloud: 'move "report.pdf" from Downloads to Documents'. */
export function planText(plan) {
  const what = `${plan.dir ? 'the folder ' : ''}"${plan.name}"`;
  if (plan.op === 'trash') return `move ${what} from ${placeName(plan.from)} to the trash`;
  return `${plan.op} ${what} from ${placeName(plan.from)} to ${placeName(plan.to)}`;
}

// The real file operations; a dry run swaps these for ones that only record.
export const FILE_OPS = {
  async move(plan) {
    if (fs.existsSync(plan.dst)) throw new Error(`"${plan.name}" is already there`);
    try {
      fs.renameSync(plan.src, plan.dst);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      // Another disk: copy, and remove the original only once the copy is whole.
      fs.cpSync(plan.src, plan.dst, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      fs.rmSync(plan.src, { recursive: true });
    }
  },
  async copy(plan) {
    fs.cpSync(plan.src, plan.dst, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  },
  async trash(plan, run) {
    // The desktop's own trash (restorable from the file manager), never a delete for good.
    await run(['gio', 'trash', '--', plan.src], undefined, { waitMs: 15000 });
  },
};

// ------------------------------------------------------------------ carrying it out

const ydotoolEnv = () => {
  const sock = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', '.ydotool_socket');
  return fs.existsSync(sock) ? { YDOTOOL_SOCKET: sock } : undefined;
};

/** The keys an item presses with its words: the item's own, a tab number, or the spoken combination. */
export function keysOf(item, slot = '') {
  if (item.keys) return { chords: item.keys, times: Math.max(1, Math.min(Number(slot) || 1, 50)) };
  if (item.tabNumber) {
    const n = Number(slot);
    if (!(n >= 1 && n <= 9)) throw new Error('say a tab number from 1 to 9');
    return { chords: [['ctrl', String(n)]], times: 1 };
  }
  const { rest, times } = repeats(String(slot).toLowerCase());
  const chords = parseKeys(rest);
  if (!chords) throw new Error(`"${slot}" is not a key or shortcut I know`);
  return { chords, times };
}

/** The KWin script that brings the window used before the one in front to the front (Alt+Tab once). */
export function nextWindowScript() {
  return `const a = workspace.activeWindow;
const here = (w) => w.onAllDesktops || !w.desktops || w.desktops.indexOf(workspace.currentDesktop) >= 0;
const ws = workspace.stackingOrder.filter((w) => w.normalWindow && !w.minimized && !w.skipTaskbar && w !== a && here(w));
if (ws.length) workspace.activeWindow = ws[ws.length - 1];
`;
}

/** The KWin script that un-maximizes the window in front, or else brings back the last minimized window. */
export function restoreScript() {
  return `const a = workspace.activeWindow;
if (a && a.normalWindow && a.maximizeMode) a.setMaximize(false, false);
else {
  const ws = workspace.stackingOrder.filter((w) => w.normalWindow && w.minimized && !w.skipTaskbar);
  if (ws.length) { const w = ws[ws.length - 1]; w.minimized = false; workspace.activeWindow = w; }
}
`;
}

/** The KWin script that closes the window in front as its close button does; never the desktop or a panel. */
export function closeFrontScript() {
  return `const a = workspace.activeWindow;
if (a && a.normalWindow && a.closeable) a.closeWindow();
`;
}

/**
 * Carry out one hands-free item. `run` starts a program and waits for it, `kwin` runs a
 * KWin script, `fileOps` moves, copies or trashes (FILE_OPS, or a dry run's stand-ins).
 */
export async function performControl(item, { run, kwin, slot = '', plan, fileOps = FILE_OPS, home, env, exclude = [] } = {}) {
  const wait = { waitMs: 15000 };
  switch (item.kind) {
    case 'keys': {
      const { chords, times } = keysOf(item, slot);
      const never = refusedKeys(chords);
      if (never) throw new Error(never);
      return run(['ydotool', 'key', '--key-delay', '20', ...keyArgs(chords, times)], ydotoolEnv(), wait);
    }
    case 'mouse': {
      if (item.click) return run(['ydotool', 'click', ...item.click], ydotoolEnv(), wait);
      const n = Math.max(1, Number(slot) || (item.wheel ? 2 : STEP.normal));
      if (item.wheel) {
        const [x, y] = item.wheel;
        // One wheel notch per event, so apps scroll their usual step each time.
        for (let i = 0; i < Math.min(n, 30); i++) await run(['ydotool', 'mousemove', '--wheel', '--', String(x), String(y)], ydotoolEnv(), wait);
        return;
      }
      const [dx, dy] = item.move;
      return run(['ydotool', 'mousemove', '--', String(dx * n), String(dy * n)], ydotoolEnv(), wait);
    }
    case 'window':
      return kwin(item.op === 'next' ? nextWindowScript() : item.op === 'restore' ? restoreScript() : closeFrontScript());
    case 'files': {
      const p = plan || planFiles(parseFileCommand(slot), { home, env, exclude });
      return fileOps[p.op](p, run);
    }
    default:
      throw new Error(`unknown hands-free kind ${item.kind}`);
  }
}

/** What was done, said back in a few words; a file action says what moved only from its plan. */
export function describeControl(item, slot = '', { words = true, plan } = {}) {
  if (item.kind === 'keys') {
    try {
      const { chords, times } = keysOf(item, slot);
      const base = item.done || `pressed ${chordLabel(chords)}`;
      return times > 1 ? `${base} ${times} times` : base;
    } catch {
      return 'pressed keys';
    }
  }
  if (item.kind === 'files') {
    const did = item.op === 'trash' ? 'moved to the trash' : item.op === 'copy' ? 'copied' : 'moved';
    if (!words || !plan) return `${did} a ${plan?.dir ? 'folder' : 'file'}`;
    return `${plan.op === 'copy' ? 'copied' : 'moved'} ${planText(plan).replace(/^\w+ /, '')}`;
  }
  return item.done;
}

/**
 * What a hands-free pick needs before it runs: a file action's plan (which throws a plain
 * reason when the file is not found, unclear or the destination is taken), and what waits
 * for a spoken yes: a move, a trash, or a shortcut that usually sends. `word` is the word
 * the voice's question must use for a yes to count.
 */
export function prepare(item, slot = '', { exclude = [], home, env } = {}) {
  if (item.kind === 'files') {
    const plan = planFiles(parseFileCommand(slot), { exclude, home, env });
    return { plan, hold: item.ask ? planText(plan) : '', word: plan.op === 'trash' ? 'trash' : 'move' };
  }
  if (item.kind === 'keys') {
    try {
      const { chords } = keysOf(item, slot);
      const why = askKeys(chords);
      if (why) return { hold: `press ${chordLabel(chords)} (${why.replace(/^\S+ /, '')})`, word: 'press' };
    } catch {}
  }
  return { hold: '' };
}
