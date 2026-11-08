// Seeing the window in front, for someone who cannot touch the keyboard or the mouse: press a
// button or link by its name anywhere on the desktop ("click Accept"), and read the window in
// front aloud ("what does this say"). Everything runs on this computer.
//
// The accessibility tree (AT-SPI, the desktop's own interface for screen readers) comes
// first: it names every button and presses it the way a screen reader does, with no pointer
// move. Only when the window in front shows nothing there (an app without accessibility) is a
// screenshot of that window read with tesseract, a local OCR engine; the screenshot lives in
// a private folder and is deleted as soon as it is read. Text read from the screen goes only
// into the voice's reply; logs get its length, never the text.
//
// A button whose name sends, deletes, buys, confirms or signs out is never pressed on the
// spoken command alone: the session waits for a spoken yes (control.mjs prepare), as the
// browser helper does.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

// The AT-SPI side, in Python with the desktop's own bindings (python3-gi, gir1.2-atspi-2.0):
// `find` lists the buttons and links with a name in the window in front, `click` presses one
// (checked to be the same one), `read` gathers the window's text. Prints one JSON line.
export const ATSPI = String.raw`
import json, re, sys, unicodedata, warnings
warnings.filterwarnings('ignore')
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

S = Atspi.StateType
CLICK = {'push button', 'toggle button', 'check box', 'radio button', 'link', 'menu item', 'check menu item', 'radio menu item',
         'page tab', 'list item', 'tree item', 'combo box', 'button', 'push button menu', 'switch', 'menu', 'icon'}
TEXTY = {'label', 'static', 'heading', 'paragraph', 'text', 'caption', 'document text', 'article', 'block quote',
         'description term', 'description value', 'list item', 'table cell', 'notification', 'alert'}
BUTTONS = {'push button', 'button', 'toggle button'}
LIMIT = 8000

def plain(s):
    s = unicodedata.normalize('NFKC', str(s or '')).replace('&', '').lower()
    return ' '.join(re.sub(r'[^\w\s]', ' ', s).split())

def states(o):
    try:
        return o.get_state_set()
    except Exception:
        return None

def front(pid, caption):
    d = Atspi.get_desktop(0)
    best = None
    for i in range(d.get_child_count()):
        a = d.get_child_at_index(i)
        if a is None:
            continue
        try:
            if pid and a.get_process_id() != pid:
                continue
        except Exception:
            continue
        for j in range(a.get_child_count()):
            w = a.get_child_at_index(j)
            if w is None:
                continue
            st = states(w)
            active = bool(st and st.contains(S.ACTIVE))
            if pid and caption and plain(w.get_name()) == plain(caption):
                return w
            if active:
                if not pid:
                    return w
                best = w
            elif pid and best is None and st is not None and st.contains(S.SHOWING):
                best = w
    return best

def walk(root):
    seen = 0
    stack = [(root, 0)]
    while stack and seen < LIMIT:
        o, depth = stack.pop()
        seen += 1
        yield o
        if depth > 80:
            continue
        try:
            n = o.get_child_count()
        except Exception:
            continue
        kids = []
        for i in range(min(n, 2000)):
            try:
                c = o.get_child_at_index(i)
            except Exception:
                c = None
            if c is None:
                continue
            st = states(c)
            if st is not None and not st.contains(S.SHOWING):
                continue
            kids.append((c, depth + 1))
        stack.extend(reversed(kids))

def box(o):
    try:
        e = o.get_extents(Atspi.CoordType.WINDOW)
        return [e.x, e.y, e.width, e.height]
    except Exception:
        return [0, 0, 0, 0]

def actions(o):
    try:
        a = o.get_action_iface()
        return [a.get_action_name(i) for i in range(a.get_n_actions())] if a else []
    except Exception:
        return []

def label(o):
    return ' '.join((o.get_name() or '').replace('&', '').split())

def matches(root, want):
    exact, part = [], []
    w = plain(want)
    for o in walk(root):
        role = o.get_role_name()
        if role not in CLICK:
            continue
        st = states(o)
        if st is not None and not st.contains(S.VISIBLE):
            continue
        name = plain(o.get_name())
        if not name:
            continue
        hit = {'o': o, 'name': label(o), 'role': role, 'box': box(o), 'enabled': not (st is not None and not st.contains(S.SENSITIVE)), 'actions': actions(o)}
        if name == w:
            exact.append(hit)
        elif len(name.split()) <= 8 and (' ' + w + ' ') in (' ' + name + ' '):
            part.append(hit)
    out = []
    for h in exact or part:
        same = [g for g in out if g['name'] == h['name'] and g['box'] == h['box']]
        if same:
            if h['actions'] and not same[0]['actions']:
                out[out.index(same[0])] = h
            continue
        out.append(h)
    out.sort(key=lambda h: (h['box'][1], h['box'][0]))
    return out

def press(h):
    acts = [a.lower() for a in h['actions']]
    for want in ('click', 'press', 'activate', 'jump', 'toggle', 'select', 'open'):
        for i, a in enumerate(acts):
            if a.startswith(want):
                return bool(h['o'].get_action_iface().do_action(i)), h['actions'][i]
    return False, ''

def read(root):
    parts, buttons, seen = [], [], set()
    for o in walk(root):
        role = o.get_role_name()
        if role == 'password text' or role == 'entry':
            continue
        if role in BUTTONS:
            if label(o):
                buttons.append(label(o))
            continue
        text = ''
        try:
            if o.get_text_iface() is not None:
                text = Atspi.Text.get_text(o, 0, -1) or ''
        except Exception:
            text = ''
        text = ' '.join(text.replace('￼', ' ').split())
        if not text and role in TEXTY:
            text = label(o)
        if text and text not in seen:
            seen.add(text)
            parts.append(text)
        if sum(len(p) for p in parts) > 6000:
            break
    return parts, buttons

def main():
    mode = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    root = front(args.get('pid') or 0, args.get('caption') or '')
    if root is None:
        print(json.dumps({'window': None}))
        return
    out = {'window': label(root)}
    if mode == 'find':
        out['matches'] = [{k: v for k, v in h.items() if k != 'o'} for h in matches(root, args['name'])][:20]
    elif mode == 'click':
        want = args.get('expect') or {}
        hs = [h for h in matches(root, args['name']) if h['name'] == want.get('name') and h['role'] == want.get('role') and h['box'] == want.get('box')]
        if len(hs) != 1:
            out['changed'] = True
        else:
            ok, how = press(hs[0])
            out.update({'pressed': ok, 'how': how})
    elif mode == 'read':
        out['text'], out['buttons'] = read(root)
    print(json.dumps(out))

main()
`;

// ------------------------------------------------------------------ reading a spoken command

const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, last: -1, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6 };
// Words that are not a button's name: "click it" is a click where the pointer is.
const NOT_A_NAME = /^(?:it|that|this|here|there|them|now|again|once|twice|me|on|off|up|down|left|right|middle|all|everything|anything|something|button|link|mouse|the mouse|pointer|cursor|screen|window)$/;
const INSTRUCTION = /\b(?:till|until|unless|while|whenever|if|so that|because|again and again|repeatedly|keys?|times)\b/;
const KINDS = '(?:button|link|tab|option|item|menu item|menu|check ?box|radio button|icon|entry|toggle|switch)';

/**
 * "click Accept", "press the OK button", "click on the second Reply link", "select Downloads
 * in the window" → { name, nth } (nth 0: the only one; -1: the last), or null. Read only
 * after keys, shortcuts and the mouse had their turn (control.mjs controlPick).
 */
export function parseClick(t) {
  const s = String(t || '').trim().replace(/[.!?]+$/, '');
  const m = s.match(new RegExp(`^(?:click|press|tap|hit|push|select|choose|activate)(?: on)? (?:the |a |an )?(?:(first|second|third|fourth|fifth|sixth|last|[1-6](?:st|nd|rd|th)) (?:one called |one named )?)?(.+?)(?: ${KINDS})?(?: (?:in|on|at) (?:the |this )?(?:window|screen|dialog|pop-? ?up|app)(?: in front)?)?$`));
  if (!m) return null;
  const name = m[2].replace(/^(?:called|named|labell?ed|that says|saying) /, '').replace(/^["'“”]+|["'“”]+$/g, '').replace(/^(?:the|a|an) /, '').trim();
  // A name is a few words, not an instruction ("press backspace till only google.com is left").
  if (!name || NOT_A_NAME.test(name) || new RegExp(`^${KINDS}$`).test(name) || name.split(/\s+/).length > 5 || INSTRUCTION.test(name)) return null;
  return { name, nth: m[1] ? ORDINAL[m[1]] : 0 };
}

const READ_SAY = new RegExp(
  [
    "^what (?:does|did) (?:this|that|it|the (?:screen|window|dialog(?:ue)?|message|pop-? ?up|box|notification|error|warning)(?: in front)?) say$",
    "^what(?:'s| is| does it say) (?:on|in) (?:the |this |my )?(?:screen|window|dialog(?:ue)?|pop-? ?up|message|box)(?: in front)?$",
    "^what(?:'s| is) (?:the |this )?(?:message|error|warning|pop-? ?up|dialog(?:ue)?)(?: (?:saying|about))?$",
    '^read (?:me )?(?:out )?(?:this|that|it|the (?:screen|window|dialog(?:ue)?|message|pop-? ?up|box|text|error|warning|notification)(?: in front)?)(?: (?:out|aloud|to me|out loud|for me))*$',
    '^read (?:out |aloud )?what(?:\'s| is| it says) (?:on|in) (?:the |this |my )?(?:screen|window)$',
    '^read (?:me )?what (?:this|it|the (?:screen|window)) says$',
  ].join('|'),
);

/** Whether the words ask to read the window in front aloud ("what does this say", "read the screen"). */
export const isReadScreen = (t) => READ_SAY.test(String(t || '').trim().replace(/[.!?]+$/, ''));

// Words on a button that mean it changes something for real (English and Arabic). Plainer
// than the browser's list (browser.mjs): on the desktop, Accept, OK, Save and Apply are the
// everyday answers to a dialog and are pressed on the spoken command alone.
const RISKY = [
  [/\b(send|reply|reply all|forward|post|publish|submit|share|invite)\b/i, 'sends or posts'],
  [/\b(delete|remove|trash|discard|erase|destroy|wipe|uninstall|format|empty (?:the )?trash|revoke|unsubscribe)\b/i, 'deletes or removes'],
  [/\b(buy|purchase|order|checkout|check out|pay|payment|donate|subscribe|upgrade|place order|add to cart|book now)\b/i, 'buys or pays'],
  [/\b(confirm|approve|transfer|merge|install|deploy|reset|overwrite|replace)\b/i, 'confirms or changes something'],
  [/\b(sign ?in|log ?in|sign ?up|log ?out|sign ?out|log ?off|authori[sz]e|allow|grant|verify)\b/i, 'signs in, signs out or grants access'],
  [/\b(shut ?down|power off|restart|reboot|end session|force quit|kill)\b/i, 'ends something'],
  [/(إرسال|ارسال|أرسل|نشر|حذف|إزالة|شراء|دفع|تأكيد|تسجيل الدخول|تسجيل الخروج|اشتراك)/, 'changes something for real'],
];

/** Why pressing a button with this name waits for a spoken yes, or ''. A link only opens a page, unless it deletes, pays or signs out. */
export function screenRisk(name, role = 'button') {
  const link = /link/.test(role);
  for (const [re, why] of RISKY) if (re.test(String(name)) && !(link && why === 'confirms or changes something')) return why;
  return '';
}

// ------------------------------------------------------------------ OCR (the fallback)

/** tesseract's TSV → its words, each with its box, line and confidence. The first row (the page) gives the image size. */
export function ocrWords(tsv) {
  const words = [];
  let page = null;
  for (const line of String(tsv || '').split('\n').slice(1)) {
    const c = line.split('\t');
    if (c.length < 12) continue;
    const [level, , block, par, ln, , left, top, width, height, conf, ...rest] = c;
    if (level === '1') page = { w: Number(width), h: Number(height) };
    if (level !== '5') continue;
    const text = rest.join('\t').trim();
    if (!text || Number(conf) < 30) continue;
    words.push({ text, line: `${block}.${par}.${ln}`, box: [Number(left), Number(top), Number(width), Number(height)] });
  }
  return { page, words };
}

const plain = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/&/g, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * The places where the spoken name stands as words on one line, each with the box around
 * them, in reading order: a whole line that is the name first, any line holding it next.
 */
export function ocrFind(words, name) {
  const want = plain(name).split(' ').filter(Boolean);
  if (!want.length) return [];
  const lines = new Map();
  for (const w of words) for (const p of plain(w.text).split(' ').filter(Boolean)) (lines.get(w.line) || lines.set(w.line, []).get(w.line)).push({ t: p, box: w.box });
  const whole = [];
  const part = [];
  for (const ws of lines.values()) {
    for (let i = 0; i + want.length <= ws.length; i++) {
      if (!want.every((t, k) => ws[i + k].t === t)) continue;
      const bs = ws.slice(i, i + want.length).map((w) => w.box);
      const x = Math.min(...bs.map((b) => b[0]));
      const y = Math.min(...bs.map((b) => b[1]));
      const box = [x, y, Math.max(...bs.map((b) => b[0] + b[2])) - x, Math.max(...bs.map((b) => b[1] + b[3])) - y];
      (ws.length === want.length ? whole : part).push({ name: ws.slice(i, i + want.length).map((w) => w.t).join(' '), box });
    }
  }
  return (whole.length ? whole : part).sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}

// ------------------------------------------------------------------ the voice's short answer

/** What the window says, short enough to say in a sentence or two: its title, the text, then its buttons. */
export function sayable({ window = '', text = [], buttons = [] } = {}, max = 1200) {
  const body = text.filter((t) => t && t !== window).join(' | ');
  let out = [window && `Window "${window}"`, body].filter(Boolean).join(': ');
  if (out.length > max) out = `${out.slice(0, max).replace(/\s+\S*$/, '')} ...`;
  const b = [...new Set(buttons)].slice(0, 8);
  return b.length ? `${out}${!out ? '' : /[.!?:]$/.test(out) ? ' ' : '. '}Buttons: ${b.join(', ')}.` : out;
}

// ------------------------------------------------------------------ the helper

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a program and collect what it prints; fails on a non-zero exit or after `timeout` ms. */
export const output = (argv, { timeout = 10000, env } = {}) =>
  new Promise((resolve, reject) =>
    execFile(argv[0], argv.slice(1), { timeout, maxBuffer: 8 << 20, env: env ? { ...process.env, ...env } : undefined }, (err, out, errOut) =>
      err ? reject(new Error(`${path.basename(argv[0])}: ${String(errOut || err.message).trim().split('\n').pop().slice(0, 200)}`)) : resolve(String(out)),
    ),
  );

const YDOTOOL = () => {
  const sock = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', '.ydotool_socket');
  return fs.existsSync(sock) ? { YDOTOOL_SOCKET: sock } : undefined;
};

// The window in front from KWin: its process, title and the inside of its frame on screen.
const FRONT_JS = `(function () { const a = workspace.activeWindow; if (!a || !a.normalWindow && !a.dialog) return ''; const g = a.clientGeometry; return JSON.stringify({ pid: a.pid, caption: String(a.caption), cls: String(a.resourceClass), x: g.x, y: g.y, w: g.width, h: g.height }); })()`;
const POINTER_JS = 'workspace.cursorPos.x + " " + workspace.cursorPos.y';

/**
 * The window in front, read and pressed. `ask` evaluates a KWin script expression and returns
 * what it printed (desk.mjs kwinAsk); `exec` runs a program and returns its output; `run`
 * runs one and waits. Without KWin (another desktop), AT-SPI's own "active" window is used,
 * and the OCR fallback, which needs the window's place on screen, is not offered.
 */
export class Screen {
  constructor({ ask = null, exec = output, run = null, ocr = true, tmp = process.env.XDG_RUNTIME_DIR || os.tmpdir(), log = () => {} } = {}) {
    this.ask = ask;
    this.canOcr = !!(ocr && ask);
    this.exec = exec;
    this.run = run || ((argv, env) => exec(argv, { env }));
    this.tmp = tmp;
    this.log = log;
  }

  /** A KWin answer, parsed. It comes through the journal and now and then is missed, so it is asked again, up to three times. */
  async kwin(expr, parse) {
    if (!this.ask) return null;
    for (let i = 0; i < 3; i++) {
      const out = await this.ask(expr).catch(() => '');
      try {
        const v = out ? parse(out) : null;
        if (v) return v;
      } catch {}
    }
    return null;
  }

  front() {
    return this.kwin(FRONT_JS, JSON.parse);
  }

  /**
   * Apps show their buttons to AT-SPI only while the desktop's accessibility switch is on
   * (what a screen reader turns on). Off, it is turned on once, and the apps get a moment to
   * show themselves. The installer turns it on for good.
   */
  async accessible() {
    if (this.a11y) return this.a11y;
    const call = ['gdbus', 'call', '--session', '--dest', 'org.a11y.Bus', '--object-path', '/org/a11y/bus', '--method'];
    this.a11y = (async () => {
      const on = await this.exec([...call, 'org.freedesktop.DBus.Properties.Get', 'org.a11y.Status', 'IsEnabled'], { timeout: 3000 }).catch(() => '');
      if (/true/.test(on)) return true;
      await this.exec([...call, 'org.freedesktop.DBus.Properties.Set', 'org.a11y.Status', 'IsEnabled', '<true>'], { timeout: 3000 });
      this.log({ event: 'atspi-enabled' });
      await wait(1500);
      return true;
    })().catch(() => (this.a11y = null));
    return this.a11y;
  }

  async atspi(mode, args) {
    await this.accessible();
    const out = await this.exec(['python3', '-I', '-c', ATSPI, mode, JSON.stringify(args)], { timeout: 15000 });
    return JSON.parse(out.trim().split('\n').pop());
  }

  /** A screenshot of the window in front, read by tesseract; the picture is deleted before this returns. */
  async ocr(tsv = true) {
    const dir = fs.mkdtempSync(path.join(this.tmp, 'voice-screen-'));
    const file = path.join(dir, 'front.png');
    try {
      await this.exec(['spectacle', '--background', '--nonotify', '--activewindow', '--no-decoration', '--no-shadow', '--output', file], { timeout: 15000 });
      for (let i = 0; i < 40 && !fs.existsSync(file); i++) await wait(50);
      if (!fs.existsSync(file)) throw new Error('the screenshot of the window in front did not arrive');
      return await this.exec(['tesseract', file, 'stdout', ...(tsv ? ['tsv'] : [])], { timeout: 30000 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * The one button or link the spoken name means in the window in front, as a plan to press
   * it. Throws a plain reason when there is none, several (unless `nth` picks one) or it is
   * greyed out.
   */
  async locate({ name, nth = 0 }) {
    const front = await this.front();
    let found = [];
    let via = 'atspi';
    let window = front?.caption || '';
    let scale = 1;
    try {
      const r = await this.atspi('find', { pid: front?.pid || 0, caption: front?.caption || '', name });
      if (r.window !== null) window = r.window || window;
      found = r.matches || [];
    } catch (err) {
      this.log({ event: 'screen-atspi-failed', error: err.message.slice(0, 120) });
    }
    if (!found.length && front && this.canOcr) {
      via = 'ocr';
      const { page, words } = ocrWords(await this.ocr(true));
      scale = page && front.w ? page.w / front.w : 1;
      found = ocrFind(words, name).map((h) => ({ ...h, role: 'text', enabled: true }));
    }
    const where = window ? `the window in front ("${window}")` : 'the window in front';
    if (!found.length) throw new Error(`there is no button or link called "${name}" in ${where}`);
    if (found.length > 1 && !nth) {
      const kinds = [...new Set(found.map((h) => (/link/.test(h.role) ? 'link' : 'button')))].join(' or ');
      throw new Error(`${found.length} places in ${where} say "${name}" (${kinds}); say which one, like "click the first ${name}" or "click the last ${name}"`);
    }
    const pick = nth === -1 ? found[found.length - 1] : found[Math.max(0, nth - 1)];
    if (!pick) throw new Error(`there are only ${found.length} places in ${where} that say "${name}"`);
    if (pick.enabled === false) throw new Error(`"${pick.name}" is greyed out in ${where}, so it cannot be pressed now`);
    return { via, said: name, nth, name: pick.name, role: pick.role, box: pick.box, window, front, scale, actions: pick.actions || [] };
  }

  /** Press what `locate` found, after checking the window in front is still the same one. */
  async press(plan) {
    const front = await this.front();
    if (plan.front && (!front || front.pid !== plan.front.pid || front.caption !== plan.front.caption)) throw new Error('the window in front changed, so nothing was pressed');
    if (plan.via === 'atspi') {
      const r = await this.atspi('click', { pid: plan.front?.pid || 0, caption: plan.front?.caption || '', name: plan.said, expect: { name: plan.name, role: plan.role, box: plan.box } });
      if (r.changed) throw new Error(`"${plan.name}" is no longer where it was, so nothing was pressed`);
      if (r.pressed) return { how: 'accessibility' };
      // No way to press it through the tree: a click in the middle of it, where it is on screen.
      if (!plan.front || !(plan.box[2] > 0)) throw new Error(`"${plan.name}" cannot be pressed from here`);
    }
    const s = plan.via === 'ocr' ? plan.scale || 1 : 1;
    if (!plan.front) throw new Error(`"${plan.name}" cannot be pressed: where the window in front is on screen is not known here`);
    const x = Math.round(plan.front.x + (plan.box[0] + plan.box[2] / 2) / s);
    const y = Math.round(plan.front.y + (plan.box[1] + plan.box[3] / 2) / s);
    if (x < plan.front.x || y < plan.front.y || x > plan.front.x + plan.front.w || y > plan.front.y + plan.front.h) throw new Error(`"${plan.name}" is outside the window in front`);
    await this.pointTo(x, y);
    // Someone else moving the mouse, or the window moving, between the move and the click: no click.
    const at = await this.pointer();
    const now = await this.front();
    if (Math.abs(at.x - x) > 3 || Math.abs(at.y - y) > 3 || !now || now.pid !== plan.front.pid || Math.abs(now.x - plan.front.x) > 1 || Math.abs(now.y - plan.front.y) > 1) throw new Error(`the pointer or the window moved, so "${plan.name}" was not clicked`);
    await this.run(['ydotool', 'click', '0xC0'], YDOTOOL());
    return { how: 'pointer', x, y };
  }

  async pointer() {
    const p = await this.kwin(POINTER_JS, (out) => {
      const [x, y] = out.trim().split(/\s+/).map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    });
    if (!p) throw new Error('could not read where the pointer is');
    return p;
  }

  /**
   * Move the pointer to a point on screen. ydotool moves are relative and the desktop speeds
   * them up, so it moves, reads where the pointer landed (KWin), and corrects, a few times.
   */
  async pointTo(x, y) {
    // How far the pointer went for each unit asked, per axis, learnt from the last move.
    const gain = [1, 1];
    let last = null;
    for (let i = 0; i < 10; i++) {
      const p = await this.pointer();
      const d = [x - p.x, y - p.y];
      if (Math.abs(d[0]) <= 2 && Math.abs(d[1]) <= 2) return p;
      if (last) {
        const went = [p.x - last.p.x, p.y - last.p.y];
        for (const k of [0, 1]) if (last.ask[k] && went[k] && Math.sign(went[k]) === Math.sign(last.ask[k])) gain[k] = Math.min(4, Math.max(0.25, went[k] / last.ask[k]));
      }
      const ask = d.map((v, k) => (Math.abs(v) <= 2 ? 0 : Math.round(v / gain[k]) || Math.sign(v)));
      await this.run(['ydotool', 'mousemove', '--', String(ask[0]), String(ask[1])], YDOTOOL());
      last = { p, ask };
      await wait(60);
    }
    throw new Error('could not put the pointer on it');
  }

  /** The text of the window in front, for the voice to say briefly: { says, via, chars }. */
  async read() {
    const front = await this.front();
    let r = { window: front?.caption || '', text: [], buttons: [] };
    let via = 'atspi';
    try {
      const a = await this.atspi('read', { pid: front?.pid || 0, caption: front?.caption || '' });
      if (a.window !== null) r = { window: a.window || r.window, text: a.text || [], buttons: a.buttons || [] };
    } catch (err) {
      this.log({ event: 'screen-atspi-failed', error: err.message.slice(0, 120) });
    }
    if (!r.text.length && front && this.canOcr) {
      via = 'ocr';
      const text = (await this.ocr(false)).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => /[\p{L}\p{N}]{2}/u.test(p));
      r = { window: r.window, text, buttons: [] };
    }
    if (!r.text.length && !r.buttons.length) throw new Error('no text could be read in the window in front');
    const says = sayable(r);
    return { says, via, chars: says.length };
  }
}
