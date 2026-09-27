// Browser actions: the current page of the assistant's own browser window, as a short list
// of choices, and plain code that carries a pick out.
//
// A snapshot (a small script run in an isolated world of the page, over the Chrome DevTools
// Protocol) lists the links, buttons and fields in view; plain code turns them into catalog
// items. The decision model picks one item, and for a field which span of the user's own
// words to type; it never produces a selector, a URL or a command. Plain code then clicks
// (a real mouse click at the element, once it is checked to be the element on top), types
// (inserted text, never Enter), scrolls, goes back or forward, switches or closes a tab, or
// reads the page briefly for the voice.
//
// Safety, all in plain code here: a control that sends, submits, posts, deletes, buys, pays,
// confirms, signs in or grants access is marked `risky` and is never pressed on a pick (the
// session waits for a spoken yes); password, payment and identity fields are never typed
// into; download links are not offered and downloads are denied while an action runs; only
// a loopback endpoint is used, and tabs matching `ignore` are never read, switched to or closed.

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/;

// ------------------------------------------------------------------ classification

// Words on a control that mean it changes something for real. English and Arabic.
const RISKY = [
  [/\b(send|sent|reply|reply all|forward|post|publish|tweet|comment|submit|share|invite)\b/i, 'sends or posts'],
  [/\b(delete|remove|trash|discard|erase|destroy|archive|unsubscribe|close (issue|pull request|account)|revoke|leave)\b/i, 'deletes or removes'],
  [/\b(buy|purchase|order|checkout|check out|pay|payment|donate|subscribe|upgrade|place order|add to cart|book now)\b/i, 'buys or pays'],
  // Following a link only loads a page, so these count for buttons only.
  [/\b(confirm|approve|accept|agree|merge|transfer|save|apply|update|install|deploy|run|restart|reset)\b/i, 'confirms or changes something', 'button'],
  [/\b(sign ?in|log ?in|sign ?up|log ?out|sign ?out|register|continue with|authori[sz]e|allow|grant|connect|verify|link account)\b/i, 'signs in or grants access'],
  [/(إرسال|ارسال|أرسل|نشر|حذف|إزالة|شراء|دفع|تأكيد|موافق|أوافق|تسجيل الدخول|تسجيل الخروج|اشتراك|حفظ)/, 'changes something for real'],
];

/** Why pressing this control needs a spoken yes, or null when one pick is enough. */
export function riskOf(el) {
  if (el.kind === 'field') return null;
  if (el.submit) return 'submits a form';
  const words = `${el.name} ${el.title || ''}`;
  // A long link name is content (a message subject, a headline), not a control's label.
  if (el.kind === 'link' && String(el.name).trim().split(/\s+/).length > 5) return null;
  for (const [re, why, only] of RISKY) if ((!only || el.kind !== 'link') && re.test(words)) return why;
  return null;
}

// Fields never typed into: passwords, one-time codes, payment and identity details.
const SENSITIVE_TYPES = new Set(['password']);
const SENSITIVE_AUTOCOMPLETE = /(password|one-time-code|cc-|card|bday|birth|tax|ssn)/i;
const SENSITIVE_NAME =
  /(pass ?word|passcode|\bpin\b|one[- ]time|\botp\b|verification code|security code|2fa|card ?number|\bcc-?(num|number|csc|cvc|exp)|credit card|debit card|\bcvv|\bcvc|\bcsc\b|expir|\biban\b|swift|routing|account number|sort code|\bssn\b|social security|passport|national id|identity|id number|emirates id|driver'?s? licen[cs]e|date of birth|birth ?date|\bdob\b|tax id|كلمة المرور|كلمة السر|رقم البطاقة|الهوية|جواز السفر|تاريخ الميلاد)/i;

/** Why typing into this field is refused, or null. */
export function sensitiveField(el) {
  if (el.kind !== 'field') return null;
  if (SENSITIVE_TYPES.has(String(el.type).toLowerCase())) return 'a password field';
  if (SENSITIVE_AUTOCOMPLETE.test(el.autocomplete || '')) return 'a password, payment or identity field';
  if (SENSITIVE_NAME.test(`${el.name} ${el.attr || ''}`)) return 'a password, payment or identity field';
  return null;
}

// Links that download a file are not offered at all.
const DOWNLOAD_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|exe|msi|dmg|pkg|deb|rpm|apk|appimage|iso|img|bin|jar|csv|xlsx?|docx?|pptx?|ics|vcf|torrent)(\?|#|$)/i;
export const isDownload = (el) => !!el.download || (el.kind === 'link' && DOWNLOAD_EXT.test(el.href || ''));

const trimName = (s, n = 70) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

// Page-level actions, always offered while a page is open.
const PAGE_ACTIONS = [
  ['page:scroll-down', { op: 'scroll', dir: 1, name: 'Scroll the browser page down', done: 'scrolled the page down' }],
  ['page:scroll-up', { op: 'scroll', dir: -1, name: 'Scroll the browser page up', done: 'scrolled the page up' }],
  ['page:scroll-top', { op: 'scroll', dir: -100, name: 'Scroll to the top of the browser page', done: 'scrolled to the top' }],
  ['page:scroll-bottom', { op: 'scroll', dir: 100, name: 'Scroll to the bottom of the browser page', done: 'scrolled to the bottom' }],
  ['page:back', { op: 'history', dir: -1, name: 'Go back to the previous page in the browser', done: 'went back a page' }],
  ['page:forward', { op: 'history', dir: 1, name: 'Go forward a page in the browser', done: 'went forward a page' }],
  ['page:read', { op: 'read', name: 'Read the current browser page: say what this page says, read it out or summarise it', done: 'read the page' }],
];

/**
 * The browser part of the catalog from one snapshot: [key, item] pairs. Every item carries
 * what plain code needs to act and to check again at the moment of acting (the index in
 * the snapshot, the element's kind and name, the tab and its URL).
 */
export function pageCatalog(snap, { maxItems = 60 } = {}) {
  const out = [];
  if (!snap) return out;
  const tab = { id: snap.tab.id, url: snap.tab.url, title: snap.tab.title };
  for (const [key, it] of PAGE_ACTIONS) out.push([key, { kind: 'page', ...it, tab }]);
  const seen = new Set();
  let n = 0;
  for (const el of snap.elements || []) {
    if (n >= maxItems) break;
    const name = trimName(el.name);
    if (!name || isDownload(el)) continue;
    const id = `${el.kind}|${name.toLowerCase()}`;
    // Two controls with the same name and kind cannot be told apart by voice: the first in view.
    if (seen.has(id)) continue;
    seen.add(id);
    n++;
    const base = { kind: 'page', index: el.i, el: el.kind, label: name, tab };
    if (el.kind === 'field') {
      const why = sensitiveField(el);
      if (why) out.push([`page:refuse:${el.i}`, { ...base, op: 'refuse', why, name: `Type into the field "${name}"`, done: `refused to type into "${name}" (${why})` }]);
      else out.push([`page:field:${el.i}`, { ...base, kind: 'field', op: 'type', name: `Type dictated words into the "${name}" box (a field) on the browser page`, done: `typed into "${name}"`, final: true }]);
      continue;
    }
    const risky = riskOf(el);
    const what = el.kind === 'link' ? `Click the link "${name}"` : el.kind === 'tab' ? `Open the "${name}" tab on the page` : el.kind === 'check' ? `Tick or untick "${name}"` : `Press the button "${name}"`;
    out.push([`page:click:${el.i}`, { ...base, op: 'click', risky, name: `${what} on the browser page`, done: `clicked "${name}"` }]);
  }
  for (const t of snap.tabs || []) {
    const title = trimName(t.title || t.url, 60);
    if (t.id !== snap.tab.id) out.push([`tab:switch:${t.id}`, { kind: 'page', op: 'switch', target: t.id, url: t.url, label: title, name: `Switch to the browser tab "${title}"`, done: `switched to the tab "${title}"` }]);
    out.push([
      `tab:close:${t.id}`,
      { kind: 'page', op: 'close', target: t.id, url: t.url, label: title, name: t.id === snap.tab.id ? `Close this browser tab ("${title}")` : `Close the browser tab "${title}"`, done: `closed the tab "${title}"`, final: true },
    ]);
  }
  return out;
}

// ------------------------------------------------------------------ in-page script

// Runs in an isolated world: page scripts cannot see the element list or change the
// functions it uses. Returns what is in view and keeps the elements for the actions below.
export const SNAPSHOT_JS = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const q = 'a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio],[role=option],[role=textbox],[role=searchbox],[role=combobox],[contenteditable=""],[contenteditable=true]';
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll(q)) all.push(el);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  const text = (el) => (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
  const labelOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\\s+/).map((id) => text(document.getElementById(id))).join(' ').trim(); if (t) return t; }
    const aria = el.getAttribute('aria-label'); if (aria) return aria;
    if (el.labels && el.labels.length) return text(el.labels[0]);
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (/^(submit|button|reset)$/i.test(el.type)) return el.value || '';
      return el.placeholder || el.title || el.name || '';
    }
    const t = text(el); if (t) return t;
    const img = el.querySelector && el.querySelector('img[alt],svg[aria-label]');
    return el.title || (img && (img.getAttribute('alt') || img.getAttribute('aria-label'))) || '';
  };
  const kindOf = (el) => {
    const role = el.getAttribute('role'), tag = el.tagName, type = (el.type || '').toLowerCase();
    if (tag === 'SELECT' || role === 'option') return '';
    if (tag === 'TEXTAREA' || el.isContentEditable || role === 'textbox' || role === 'searchbox' || role === 'combobox') return 'field';
    if (tag === 'INPUT') {
      if (/^(checkbox|radio)$/.test(type)) return 'check';
      if (/^(submit|button|reset|image)$/.test(type)) return 'button';
      if (/^(hidden|file|range|color)$/.test(type)) return '';
      return 'field';
    }
    if (role === 'checkbox' || role === 'switch' || role === 'radio') return 'check';
    if (role === 'tab') return 'tab';
    if (tag === 'A' || role === 'link') return 'link';
    return 'button';
  };
  const els = [], out = [];
  for (const el of all) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-hidden') === 'true') continue;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
    const kind = kindOf(el); if (!kind) continue;
    const name = labelOf(el).replace(/\\s+/g, ' ').trim().slice(0, 120);
    if (!name) continue;
    const i = els.push(el) - 1;
    const type = (el.type || '').toLowerCase();
    out.push({ i, kind, name, type, title: el.title || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      attr: [el.name, el.id, el.getAttribute('inputmode')].filter(Boolean).join(' '),
      href: el.href ? String(el.href).slice(0, 300) : '',
      download: el.hasAttribute && el.hasAttribute('download'),
      submit: (el.tagName === 'BUTTON' && (!el.getAttribute('type') || type === 'submit') && !!el.form) || (el.tagName === 'INPUT' && /^(submit|image)$/.test(type)) });
  }
  globalThis.__voiceEls = els;
  return { url: location.href, title: document.title, visible: document.visibilityState === 'visible', elements: out };
})()`;

// The element again, checked: still in the page, same kind and name, and on top at its centre.
const FIND_JS = (i, name) => `(() => {
  const el = (globalThis.__voiceEls || [])[${Number(i)}];
  if (!el || !el.isConnected) return { error: 'that is no longer on the page' };
  const label = ${JSON.stringify(name)};
  const now = (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.value || el.placeholder || el.title || el.name || '').replace(/\\s+/g, ' ').trim();
  if (!now.toLowerCase().startsWith(label.toLowerCase().replace(/\\.\\.\\.$/, '').slice(0, 30))) return { error: 'the page changed' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  let top = document.elementFromPoint(x, y);
  while (top && top.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; }
  let n = top, ok = false;
  while (n) { if (n === el) { ok = true; break; } n = n.parentNode || n.host; }
  if (!ok && !(top && el.contains(top))) return { error: 'something covers it on the page' };
  return { x, y, type: (el.type || '').toLowerCase(), autocomplete: el.getAttribute('autocomplete') || '', attr: [el.name, el.id, el.getAttribute('inputmode')].filter(Boolean).join(' ') };
})()`;

const FOCUS_JS = (i) => `(() => {
  const el = (globalThis.__voiceEls || [])[${Number(i)}];
  if (!el || !el.isConnected) return false;
  el.focus();
  if (el.setSelectionRange && typeof el.value === 'string') { try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }
  const a = document.activeElement;
  return a === el || el.contains(a) || (a && a.shadowRoot && a.contains(el));
})()`;

const READ_JS = `(() => {
  const root = document.querySelector('main,[role=main],article') || document.body;
  const t = (root.innerText || '').replace(/[ \\t]+/g, ' ').replace(/\\n\\s*\\n+/g, '\\n').trim();
  return { title: document.title, text: t.slice(0, 1500) };
})()`;

// ------------------------------------------------------------------ DevTools protocol

/** A minimal Chrome DevTools Protocol client over Node's built-in WebSocket. */
export class Cdp {
  static async open(url, { timeoutMs = 3000 } = {}) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('the browser did not answer')), timeoutMs);
      ws.addEventListener('open', () => (clearTimeout(t), resolve()), { once: true });
      ws.addEventListener('error', () => (clearTimeout(t), reject(new Error('could not connect to the browser'))), { once: true });
    });
    return new Cdp(ws, timeoutMs);
  }

  constructor(ws, timeoutMs) {
    this.ws = ws;
    this.timeoutMs = timeoutMs;
    this.next = 0;
    this.waiting = new Map();
    this.closed = false;
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data));
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message));
      else w.resolve(m.result);
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const w of this.waiting.values()) w.reject(new Error('the browser connection closed'));
      this.waiting.clear();
    });
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('the browser connection closed'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.timeoutMs);
      this.waiting.set(id, { resolve: (r) => (clearTimeout(t), resolve(r)), reject: (e) => (clearTimeout(t), reject(e)) });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.closed = true;
    try {
      this.ws.close();
    } catch {}
  }
}

// ------------------------------------------------------------------ the browser

/**
 * The assistant's own browser window, reached at a loopback DevTools endpoint. `ignore`
 * lists URL prefixes of tabs that are left alone. Everything goes through `http` (the
 * endpoint's JSON list) and `connect` (a page's protocol socket), so tests pass fakes.
 */
export class Browser {
  constructor(cfg, { fetchImpl = fetch, connect = (url) => Cdp.open(url, { timeoutMs: cfg.timeoutMs || 3000 }) } = {}) {
    this.cfg = cfg;
    this.endpoint = String(cfg.endpoint || '').replace(/\/+$/, '');
    if (!LOOPBACK.test(this.endpoint)) throw new Error(`browser.endpoint must be a loopback address like http://127.0.0.1:9222 (got "${cfg.endpoint}")`);
    this.fetch = fetchImpl;
    this.connectImpl = connect;
    this.pages = new Map();
    this.last = null;
  }

  ignored(url) {
    return (this.cfg.ignore || []).some((p) => String(url).startsWith(p));
  }

  async http(route) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs || 3000);
    try {
      const res = await this.fetch(`${this.endpoint}${route}`, { signal: ctrl.signal, method: route.startsWith('/json/new') ? 'PUT' : 'GET' });
      if (!res.ok) throw new Error(`the browser said ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } finally {
      clearTimeout(t);
    }
  }

  /** Open tabs, most recently used first, without the ignored ones and the browser's own pages. */
  async tabs() {
    const list = await this.http('/json/list');
    return list.filter((t) => t.type === 'page' && /^(https?|file):/.test(t.url) && !this.ignored(t.url)).map((t) => ({ id: t.id, url: t.url, title: t.title, ws: t.webSocketDebuggerUrl }));
  }

  /** A protocol session on a tab, with an isolated world the page's own scripts cannot reach. */
  async page(tab) {
    let p = this.pages.get(tab.id);
    if (p && !p.cdp.closed) return p;
    const cdp = await this.connectImpl(tab.ws);
    p = { cdp, world: null };
    this.pages.set(tab.id, p);
    return p;
  }

  async evaluate(tab, expression) {
    const p = await this.page(tab);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!p.world) {
        const { frameTree } = await p.cdp.send('Page.getFrameTree');
        const w = await p.cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'voice-mode', grantUniveralAccess: false });
        p.world = w.executionContextId;
      }
      try {
        const r = await p.cdp.send('Runtime.evaluate', { expression, contextId: p.world, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'the page script failed');
        return r.result.value;
      } catch (err) {
        // A navigation replaces the world; make a new one once.
        if (attempt || !/context|Cannot find/i.test(err.message)) throw err;
        p.world = null;
      }
    }
  }

  /** The current page (the visible tab, most recently used) and what is in view on it. */
  async snapshot() {
    const tabs = await this.tabs();
    let first = null;
    // The list is most recently used first; the visible one is the page in front.
    for (const tab of tabs.slice(0, 4)) {
      const s = await this.evaluate(tab, SNAPSHOT_JS);
      const snap = { tab: { id: tab.id, url: s.url, title: s.title, ws: tab.ws }, elements: s.elements, tabs: tabs.map(({ id, url, title }) => ({ id, url, title })) };
      first ||= snap;
      if (s.visible) {
        first = snap;
        break;
      }
    }
    this.last = first;
    return first;
  }

  async browserSession() {
    if (this.root && !this.root.closed) return this.root;
    const v = await this.http('/json/version');
    this.root = await this.connectImpl(v.webSocketDebuggerUrl);
    return this.root;
  }

  /** Downloads are denied while an action runs, then the browser's own behaviour is back. */
  async noDownloads(fn) {
    let root = null;
    try {
      root = await this.browserSession();
      await root.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    } catch {
      root = null;
    }
    try {
      return await fn();
    } finally {
      if (root) {
        clearTimeout(this.restoreTimer);
        this.restoreTimer = setTimeout(() => this.allowDownloads(), this.cfg.downloadGuardMs ?? 3000);
      }
    }
  }

  allowDownloads() {
    this.restoreTimer = null;
    return this.root?.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {});
  }

  /** The tab the item was taken from, still open, still on the same page. */
  async sameTab(item) {
    const tab = (await this.tabs()).find((t) => t.id === item.tab.id);
    if (!tab) throw new Error('that tab is no longer open');
    if (tab.url.split('#')[0] !== String(item.tab.url).split('#')[0]) throw new Error('the page changed');
    return { ...tab, ws: tab.ws || item.tab.ws };
  }

  async click(item) {
    if (item.risky && !item.confirmed) throw new Error(`"${item.label}" ${item.risky}: it needs a spoken yes first`);
    const tab = await this.sameTab(item);
    const at = await this.evaluate(tab, FIND_JS(item.index, item.label));
    if (at.error) throw new Error(at.error);
    const { cdp } = await this.page(tab);
    const mouse = (type) => cdp.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    return this.noDownloads(async () => {
      await mouse('mouseMoved');
      await mouse('mousePressed');
      await mouse('mouseReleased');
    });
  }

  async type(item, text) {
    const words = String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/  +/g, ' ').trim();
    if (!words) throw new Error('nothing to type');
    const tab = await this.sameTab(item);
    const at = await this.evaluate(tab, FIND_JS(item.index, item.label));
    if (at.error) throw new Error(at.error);
    // Checked again on the live element: a field can turn into a password field.
    const why = sensitiveField({ kind: 'field', name: item.label, type: at.type, autocomplete: at.autocomplete, attr: at.attr });
    if (why) throw new Error(`"${item.label}" is ${why}; voice mode never types there`);
    if (!(await this.evaluate(tab, FOCUS_JS(item.index)))) throw new Error('could not put the cursor in that field');
    const { cdp } = await this.page(tab);
    await cdp.send('Input.insertText', { text: words });
  }

  async scroll(item) {
    const tab = await this.sameTab(item);
    const { cdp } = await this.page(tab);
    const size = await this.evaluate(tab, '({ w: innerWidth, h: innerHeight })');
    const deltaY = Math.abs(item.dir) > 1 ? item.dir * 1000 * size.h : Math.round(item.dir * size.h * 0.8);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(size.w / 2), y: Math.round(size.h / 2), deltaX: 0, deltaY });
  }

  async history(item) {
    const tab = await this.sameTab(item);
    const { cdp } = await this.page(tab);
    const h = await cdp.send('Page.getNavigationHistory');
    const entry = h.entries[h.currentIndex + item.dir];
    if (!entry) throw new Error(item.dir < 0 ? 'there is no page to go back to' : 'there is no page to go forward to');
    if (this.ignored(entry.url)) throw new Error('that page is one voice mode leaves alone');
    this.pages.get(tab.id).world = null;
    await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  async read(item) {
    const tab = await this.sameTab(item);
    return this.evaluate(tab, READ_JS);
  }

  async switchTo(item) {
    const tab = (await this.tabs()).find((t) => t.id === item.target);
    if (!tab) throw new Error('that tab is no longer open');
    await this.http(`/json/activate/${encodeURIComponent(tab.id)}`);
  }

  async closeTab(item) {
    const tab = (await this.tabs()).find((t) => t.id === item.target);
    if (!tab) throw new Error('that tab is no longer open');
    this.pages.get(tab.id)?.cdp.close();
    this.pages.delete(tab.id);
    await this.http(`/json/close/${encodeURIComponent(tab.id)}`);
  }

  /** Open a link from the catalog (a listed site, a web search) in a new tab of this window. */
  async open(url) {
    if (!/^https?:\/\//.test(url)) throw new Error('only http and https links are opened');
    if (this.ignored(url)) throw new Error('that page is one voice mode leaves alone');
    return this.noDownloads(() => this.http(`/json/new?${encodeURIComponent(url)}`));
  }

  /** Closes the connections; downloads denied for an action that just ran are allowed again first. */
  async close() {
    for (const p of this.pages.values()) p.cdp.close();
    this.pages.clear();
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      await this.allowDownloads();
    }
    this.root?.close();
  }
}

/**
 * Carry out one browser item. A risky click must carry `confirmed` (set only after a spoken
 * yes); a refused field never types. Returns what the voice should be told, if anything.
 */
export async function performPage(browser, item, { slot = '' } = {}) {
  switch (item.op) {
    case 'click':
      return browser.click(item);
    case 'type':
      return browser.type(item, slot);
    case 'refuse':
      throw new Error(`"${item.label}" is ${item.why}; voice mode never types there`);
    case 'scroll':
      return browser.scroll(item);
    case 'history':
      return browser.history(item);
    case 'read':
      return browser.read(item);
    case 'switch':
      return browser.switchTo(item);
    case 'close':
      return browser.closeTab(item);
    default:
      throw new Error(`unknown browser action ${item.op}`);
  }
}

// ------------------------------------------------------------------ the spoken yes

// Whole words, in English and Arabic (\b knows only Latin letters).
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|confirm(ed)?|do it|go ahead|press it|send it|please do|affirmative|نعم|أيوه|ايوه|تمام)(?=\s|$)/i;
const NO = /(^|\s)(no|nope|not|don'?t|do not|wait|stop|cancel|hold on|never ?mind|لا|انتظر|وقف|الغ)(?=\s|$)/i;

/**
 * Whether the user's words are a clear yes: short, starting with a yes word, with no no,
 * not or wait anywhere. Anything else is not a yes, so nothing is pressed.
 */
export function isYes(text) {
  const t = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 6) return false;
  return YES.test(t) && !NO.test(t);
}

/**
 * Whether the voice's reply asked the user about this button: it names it (every word of
 * three letters or more in the button's name) and asks a question. Only then can a yes be
 * taken as an answer to it.
 */
export function asksAbout(reply, label) {
  const r = String(reply || '').toLowerCase();
  if (!/[?؟]/.test(r)) return false;
  const words = String(label).toLowerCase().replace(/\.\.\.$/, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return words.length > 0 && words.every((w) => r.includes(w));
}
