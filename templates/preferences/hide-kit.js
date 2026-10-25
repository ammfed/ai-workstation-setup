// hide-kit.js: pick parts of a Lavish page, hide or unhide them, and send the hidden list to the
// agent as one "remove these" prompt. Installed by ai-workstation-setup (preferences module) at
// ~/.config/ai-workstation-setup/hide-kit.js. No dependencies.
//
// Lavish serves a page from its own folder, so paste this file into a script element at the end
// of the page body, then attach it. Keep closing body, head and script tags out of this file:
// Lavish inserts its own script at the first closing body tag it finds, even inside a comment.
//
//   HideKit.attach(document.body)                          // a prototype, slide or doc page
//   HideKit.attach(rootElement, { mode: 'vanish', ... })   // options below
//
// Ways to hide: hover a part and press H (like Chrome and Firefox DevTools), or switch on Pick in
// the tray and click. A hidden part stays in place, faint with a dashed outline ('ghost', the
// default); press H on it again, or Unhide in the tray, to bring it back. mode 'vanish' takes it
// out of the page instead. Send to agent queues the list through window.lavish.queuePrompt with
// tag 'hide-list'; without Lavish it copies the list. The hidden list survives a reload through
// Lavish's replay of data-lavish-question fields. Alt is left alone: an open Lavish pull request
// makes holding Alt mean "explore". Press Escape to leave Pick.
//
// Options: mode ('ghost' | 'vanish'), id (names the saved list), trayParent (an element to dock
// the tray in), ignore (a selector whose parts are never hidden), scope (a function returning the
// current view, such as a card and option, so a list is kept per view; call refresh() after
// redrawing), persist (false to keep nothing), onChange(count), onSend(prompt, items).
(function () {
  const STYLE = `
[data-hk-hidden="vanish"]{display:none!important}
[data-hk-hidden="ghost"]{opacity:.18!important;outline:2px dashed #B68A35!important;outline-offset:2px}
[data-hk-hover]{outline:2px dashed #C0392B!important;outline-offset:2px;cursor:crosshair!important}
.hk-tray{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:280px;max-height:50vh;overflow:auto;background:#fff;color:#1B1D21;border:1px solid #E1E3E5;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.18);font:14px/1.4 system-ui,sans-serif;padding:12px}
.hk-tray[data-docked]{position:static;width:auto;max-height:none;box-shadow:none}
:root[data-theme="dark"] .hk-tray{background:#1F2125;color:#ECEEF1;border-color:#33363C}
:root[data-theme="dark"] .hk-tray li{border-color:#33363C}
:root[data-theme="dark"] .hk-tray button{background:#16171A;color:#ECEEF1;border-color:#33363C}
:root[data-theme="dark"] .hk-tray button[aria-pressed="true"]{background:#2B2618;border-color:#B68A35;color:#E6C887}
:root[data-theme="dark"] .hk-tray .hk-send{background:#B68A35;border-color:#B68A35;color:#16171A}
:root[data-theme="dark"] .hk-tray .hk-empty{color:#A0A5AD}
:root[data-theme="dark"] .hk-tray .hk-msg{color:#7FD49A}
.hk-tray h3{font-size:14px;margin:0 0 8px;font-weight:700;display:flex;justify-content:space-between;align-items:center;color:inherit}
.hk-tray ul{list-style:none;margin:0 0 8px;padding:0}
.hk-tray li{display:flex;gap:6px;align-items:center;border-top:1px solid #E1E3E5;padding:5px 0}
.hk-tray li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hk-tray li span.hk-away{opacity:.6}
.hk-tray button{font:inherit;font-size:14px;border:1px solid #E1E3E5;background:#fff;color:#1B1D21;border-radius:999px;padding:3px 10px;cursor:pointer}
.hk-tray button:disabled{opacity:.45;cursor:not-allowed}
.hk-tray button[aria-pressed="true"]{background:#F9F7ED;border-color:#B68A35;color:#7C5E24}
.hk-tray .hk-send{background:#B68A35;border-color:#B68A35;color:#fff}
.hk-tray .hk-row{display:flex;gap:6px;flex-wrap:wrap}
.hk-tray .hk-msg{color:#2F663C;font-size:14px;margin-top:6px}
.hk-tray .hk-msg:empty{display:none}
.hk-tray .hk-empty{color:#5F646D;font-size:14px;margin:0 0 8px}`;

  function ensureStyle() {
    if (document.getElementById('hk-style')) return;
    const s = document.createElement('style');
    s.id = 'hk-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // How the selector of a part names the kit root: its id, or body, else nothing (then the path is
  // read relative to the root).
  const rootName = (root) => (root.id ? '#' + CSS.escape(root.id) : root === document.body ? 'body' : '');

  // A short, stable CSS path: stop at an id or at the kit root.
  function selectorFor(el, root) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== root && parts.length < 6) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    const name = root && rootName(root);
    if (name && !parts[0]?.startsWith('#')) parts.unshift(name);
    return parts.join(' > ');
  }

  function find(sel, root) {
    try {
      if (sel.startsWith('#') || sel === 'body' || sel.startsWith('body >')) return document.querySelector(sel);
      return root.querySelector(':scope > ' + sel);
    } catch (e) {
      return null;
    }
  }

  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const editable = (el) => el instanceof Element && el.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');

  function attach(root = document.body, opts = {}) {
    ensureStyle();
    const mode = opts.mode || 'ghost';
    const kitId = opts.id || root.id || 'page';
    const scopeOf = () => (opts.scope ? String(opts.scope() ?? '') : '');
    // Each item: { scope, selector, tag, text, el }; el is null while its view is not on screen.
    const hidden = [];
    let picking = false;
    let hover = null;

    // Persistence: Lavish replays data-lavish-question fields after a reload, so the hidden list
    // rides in a hidden textarea inside one. The frame has an opaque origin, so localStorage is not
    // dependable there.
    const persist = opts.persist !== false;
    const store = document.createElement('div');
    store.hidden = true;
    store.setAttribute('data-lavish-question', 'hide-kit-' + kitId);
    store.innerHTML = '<textarea name="hidden-list" aria-hidden="true" tabindex="-1"></textarea>';
    if (persist) document.body.appendChild(store);
    const storeField = store.querySelector('textarea');

    const tray = document.createElement('div');
    tray.className = 'hk-tray';
    tray.setAttribute('role', 'region');
    tray.setAttribute('aria-label', 'Hidden parts');
    tray.setAttribute('data-lavish-action', 'hide-kit');
    tray.setAttribute('data-hk-ui', '');
    // data-lavish-ui keeps the tray out of Lavish's own hover, click and DOM snapshot.
    tray.setAttribute('data-lavish-ui', '');
    if (opts.trayParent) tray.setAttribute('data-docked', '');
    (opts.trayParent || document.body).appendChild(tray);

    const skip = (el) => !el || el === root || !root.contains(el) || el.closest('[data-hk-ui]') || (opts.ignore && el.closest(opts.ignore));

    function save() {
      if (!persist) return;
      storeField.value = JSON.stringify(hidden.map(({ scope, selector, tag, text }) => ({ scope, selector, tag, text })));
      storeField.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function hide(el, quiet) {
      if (skip(el)) return;
      if (el.hasAttribute('data-hk-hidden')) return unhide(el);
      el.setAttribute('data-hk-hidden', mode);
      hidden.push({ scope: scopeOf(), selector: selectorFor(el, root), tag: el.tagName.toLowerCase(), text: textOf(el), el });
      if (!quiet) { save(); draw(); }
    }

    function drop(i) {
      hidden[i].el?.removeAttribute('data-hk-hidden');
      hidden.splice(i, 1);
      save();
      draw();
    }

    function unhide(el) {
      const i = hidden.findIndex((h) => h.el === el);
      if (i >= 0) drop(i);
    }

    // Match every item of the current view to the element now on screen. Call after a redraw.
    function refresh() {
      const scope = scopeOf();
      for (const h of hidden) {
        h.el = h.scope === scope ? find(h.selector, root) : null;
        h.el?.setAttribute('data-hk-hidden', mode);
      }
      draw();
    }

    function restore() {
      let list = [];
      try { list = JSON.parse(storeField.value || '[]'); } catch (e) { return; }
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item.selector !== 'string') continue;
        if (hidden.some((h) => h.scope === (item.scope || '') && h.selector === item.selector)) continue;
        hidden.push({ scope: item.scope || '', selector: item.selector, tag: item.tag || '', text: item.text || '', el: null });
      }
      refresh();
    }

    function setHover(el) {
      if (hover) hover.removeAttribute('data-hk-hover');
      hover = el;
      if (hover && picking) hover.setAttribute('data-hk-hover', '');
    }

    function message(text) {
      const m = tray.querySelector('.hk-msg');
      if (m) m.textContent = text;
    }

    function send() {
      if (!hidden.length) return;
      const items = hidden.map((h, i) => ({ n: i + 1, scope: h.scope || undefined, selector: h.selector, tag: h.tag, text: h.text }));
      const lines = items.map((it) => `${it.n}. ${it.scope ? `[${it.scope}] ` : ''}${it.selector}${it.text ? ` ("${it.text}")` : ''}`).join('\n');
      const many = items.length > 1 ? 's' : '';
      const prompt = `I hid ${items.length} part${many} of this page. Remove them from the artifact, then tell me what you removed:\n${lines}`;
      if (window.lavish?.queuePrompt) {
        window.lavish.queuePrompt(prompt, { tag: 'hide-list', text: `Remove ${items.length} hidden part${many}`, queueKey: 'hide-list-' + kitId, element: root, data: { items } });
        message('Queued. Press Send in Lavish to send it.');
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(prompt).then(() => message('No agent is listening. The list is copied.'), () => message('No agent is listening.'));
      } else {
        message('No agent is listening.');
      }
      opts.onSend?.(prompt, items);
    }

    function draw() {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const msg = tray.querySelector('.hk-msg')?.textContent || '';
      tray.innerHTML = `<h3>Hidden (${hidden.length})<button type="button" class="hk-pick" aria-pressed="${picking}">Pick</button></h3>
        ${hidden.length ? `<ul>${hidden.map((h, i) => `<li><span${h.el ? '' : ' class="hk-away"'} title="${esc((h.scope ? h.scope + ': ' : '') + h.selector)}">${esc(h.text || h.selector)}</span><button type="button" data-i="${i}">Unhide</button></li>`).join('')}</ul>` : '<p class="hk-empty">Press Pick, or hover a part and press H.</p>'}
        <div class="hk-row"><button type="button" class="hk-all"${hidden.length ? '' : ' disabled'}>Unhide all</button><button type="button" class="hk-send"${hidden.length ? '' : ' disabled'}>Send to agent</button></div>
        <div class="hk-msg" role="status">${esc(msg)}</div>`;
      tray.querySelector('.hk-pick').onclick = () => { picking = !picking; setHover(null); draw(); };
      tray.querySelectorAll('li button').forEach((b) => { b.onclick = () => drop(Number(b.dataset.i)); });
      tray.querySelector('.hk-all').onclick = () => { hidden.forEach((h) => h.el?.removeAttribute('data-hk-hidden')); hidden.length = 0; save(); draw(); };
      tray.querySelector('.hk-send').onclick = send;
      opts.onChange?.(hidden.length);
    }

    // Window capture runs before Lavish's document-capture click handler, so a hide click never
    // also opens an annotation card.
    window.addEventListener('click', (e) => {
      if (!picking) return;
      const t = e.target;
      if (!(t instanceof Element) || skip(t)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      hide(t);
    }, true);
    window.addEventListener('mouseover', (e) => {
      const t = e.target;
      setHover(t instanceof Element && !skip(t) ? t : null);
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && picking) { picking = false; setHover(null); draw(); return; }
      if (e.key.toLowerCase() !== 'h' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!hover || editable(e.target)) return;
      e.preventDefault();
      const el = hover;
      setHover(null);
      hide(el);
    }, true);
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'lavish:restoreReviewState') setTimeout(restore, 0);
    });

    draw();
    restore();
    return {
      hide,
      unhide,
      refresh,
      send,
      list: () => hidden.map(({ scope, selector, tag, text }) => ({ scope, selector, tag, text })),
      setPicking: (v) => { picking = !!v; setHover(null); draw(); },
    };
  }

  window.HideKit = { attach, selectorFor };
})();
