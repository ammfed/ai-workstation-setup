// Interactive prompts on top of node:readline, with no third-party dependencies.
//
// The readline interface is created lazily and released before any child process
// that needs the terminal (sudo, `gh auth login`), because a live interface keeps
// stdin in raw mode and would swallow that child's input.

import readline from 'node:readline';
import { stdin, stdout } from 'node:process';

export class Prompter {
  constructor() {
    this.rl = null;
    this.muted = false;
  }

  ensure() {
    if (this.rl) return this.rl;
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    const write = rl._writeToOutput?.bind(rl);
    // Hide typed characters while a secret is being entered.
    rl._writeToOutput = (s) => {
      if (this.muted) return;
      if (write) write(s);
      else stdout.write(s);
    };
    rl.on('SIGINT', () => {
      stdout.write('\nAborted.\n');
      process.exit(130);
    });
    this.rl = rl;
    return rl;
  }

  release() {
    if (!this.rl) return;
    this.rl.close();
    this.rl = null;
  }

  question(text) {
    const rl = this.ensure();
    return new Promise((resolve) => rl.question(text, (a) => resolve(a.trim())));
  }

  async ask(q, def) {
    switch (q.type) {
      case 'confirm':
        return this.confirm(q.message, def);
      case 'choice':
        return this.choice(q.message, q.choices, def);
      case 'multi':
        return this.multi(q.message, q.choices, def);
      default:
        return this.text(q.message, def);
    }
  }

  async text(message, def) {
    const hint = def !== undefined && def !== '' ? ` [${def}]` : '';
    const a = await this.question(`? ${message}${hint}: `);
    return a === '' ? def ?? '' : a;
  }

  async confirm(message, def = true) {
    for (;;) {
      const a = (await this.question(`? ${message} ${def ? '[Y/n]' : '[y/N]'}: `)).toLowerCase();
      if (a === '') return def;
      if (['y', 'yes'].includes(a)) return true;
      if (['n', 'no'].includes(a)) return false;
      stdout.write('  Please answer y or n.\n');
    }
  }

  async choice(message, choices, def) {
    stdout.write(`? ${message}\n`);
    choices.forEach((ch, i) => {
      const mark = ch.value === def ? ' (default)' : '';
      stdout.write(`    ${i + 1}) ${ch.label ?? ch.value}${mark}\n`);
    });
    for (;;) {
      const a = await this.question('  Enter a number or value: ');
      if (a === '' && def !== undefined) return def;
      const byIndex = choices[Number(a) - 1];
      if (/^\d+$/.test(a) && byIndex) return byIndex.value;
      const byValue = choices.find((ch) => ch.value === a);
      if (byValue) return byValue.value;
      stdout.write('  Not one of the listed options.\n');
    }
  }

  // At a terminal: a list to move through and tick. Otherwise typed numbers or names toggle.
  async multi(message, choices, def = []) {
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      this.release();
      try {
        return await pickMulti({ input: stdin, output: stdout, message, choices, ticked: def });
      } catch (err) {
        if (err.code !== 'ABORT') throw err;
        stdout.write('\nAborted.\n');
        process.exit(130);
      }
    }
    stdout.write(`? ${message}\n`);
    choices.forEach((ch, i) => {
      const mark = def.includes(ch.value) ? '[x]' : '[ ]';
      stdout.write(`    ${String(i + 1).padStart(2)}) ${mark} ${ch.label ?? ch.value}\n`);
    });
    let current = def;
    for (;;) {
      const a = await this.question('  Numbers or names to tick or untick, comma-separated ("all", "none"; Enter when done): ');
      if (a === '') return current;
      const r = toggleTyped(choices, current, a);
      if (r.bad) {
        stdout.write(`  "${r.bad}" is not one of the listed options.\n`);
        continue;
      }
      current = r.value;
      stdout.write(`  Ticked: ${current.join(', ') || 'none'}\n`);
    }
  }

  /** Hidden input. `plain`: the text is shown exactly as given, for a screen's own words. */
  async secret(message, { plain = false } = {}) {
    const rl = this.ensure();
    stdout.write(plain ? message : `? ${message} (input hidden, Enter to skip): `);
    this.muted = true;
    try {
      return await new Promise((resolve) => rl.question('', (a) => resolve(a.trim())));
    } finally {
      this.muted = false;
      stdout.write('\n');
    }
  }
}

// ---------------------------------------------------------------- multi-pick, pure parts

/**
 * Typed answer against the ticked set: each number or name flips that item, "all" and
 * "none" replace the set, empty keeps it. Returns { value } in list order, or { bad }.
 */
export function toggleTyped(choices, current, text) {
  const a = String(text ?? '').trim();
  if (a === '') return { value: [...current] };
  if (a.toLowerCase() === 'none') return { value: [] };
  if (a.toLowerCase() === 'all') return { value: choices.map((ch) => ch.value) };
  const ticked = new Set(current);
  for (const part of a.split(',').map((s) => s.trim()).filter(Boolean)) {
    const ch = /^\d+$/.test(part) ? choices[Number(part) - 1] : choices.find((c) => c.value === part);
    if (!ch) return { bad: part };
    if (ticked.has(ch.value)) ticked.delete(ch.value);
    else ticked.add(ch.value);
  }
  return { value: choices.map((ch) => ch.value).filter((v) => ticked.has(v)) };
}

export function pickerStart(choices, ticked = []) {
  return { cursor: 0, ticked: choices.map((ch) => ticked.includes(ch.value)), typed: '', note: '' };
}

export const pickerResult = (choices, state) => choices.filter((_, i) => state.ticked[i]).map((ch) => ch.value);

/**
 * One keypress (node:readline's key object) applied to the picker state. Returns the next
 * state, plus done: true on Enter, or abort: true on Ctrl+C. Digits typed into the line
 * below the list are applied as toggles by Enter, the same way as the typed answer.
 */
export function pickerKey(choices, state, str, key = {}) {
  const n = choices.length;
  const s = { ...state, ticked: [...state.ticked], note: '' };
  if (key.ctrl && key.name === 'c') return { state: s, abort: true };
  switch (key.name) {
    case 'up':
    case 'k':
      s.cursor = (s.cursor - 1 + n) % n;
      return { state: s };
    case 'down':
    case 'j':
      s.cursor = (s.cursor + 1) % n;
      return { state: s };
    case 'home':
      s.cursor = 0;
      return { state: s };
    case 'end':
      s.cursor = n - 1;
      return { state: s };
    case 'space':
      s.ticked[s.cursor] = !s.ticked[s.cursor];
      return { state: s };
    case 'a':
      s.ticked = s.ticked.map(() => !s.ticked.every(Boolean));
      return { state: s };
    case 'backspace':
      s.typed = s.typed.slice(0, -1);
      return { state: s };
    case 'escape':
      s.typed = '';
      return { state: s };
    case 'return':
    case 'enter': {
      if (!s.typed) return { state: s, done: true };
      const r = toggleTyped(choices, pickerResult(choices, s), s.typed);
      if (r.bad) s.note = `"${r.bad}" is not one of the listed numbers`;
      else s.ticked = choices.map((ch) => r.value.includes(ch.value));
      s.typed = '';
      return { state: s };
    }
    default:
      if (str && /^[\d,]$/.test(str)) s.typed += str;
      return { state: s };
  }
}

export function pickerLines(message, choices, state) {
  const lines = [`? ${message}`];
  choices.forEach((ch, i) => {
    const pointer = i === state.cursor ? '>' : ' ';
    lines.push(`  ${pointer} ${String(i + 1).padStart(2)}) ${state.ticked[i] ? '[x]' : '[ ]'} ${ch.label ?? ch.value}`);
  });
  lines.push(state.typed ? `  Toggle: ${state.typed}  (Enter applies, Esc clears)` : '  Arrows move, Space ticks, a ticks all, numbers then Enter toggle them, Enter when done');
  if (state.note) lines.push(`  ${state.note}`);
  return lines;
}

/**
 * The interactive picker on a raw-mode terminal stream, redrawn in place after each key.
 * Resolves with the ticked values; rejects with code ABORT on Ctrl+C. Raw mode is always
 * turned off again. `input` only needs to be a readable stream with setRawMode, so tests
 * feed it keypresses without a real terminal.
 */
export function pickMulti({ input, output, message, choices, ticked = [] }) {
  if (!choices.length) return Promise.resolve([]);
  let state = pickerStart(choices, ticked);
  let drawn = 0;
  // A line wider than the terminal wraps and the redraw would drift, so each is cut to fit.
  const fit = (line) => (output.columns && line.length >= output.columns ? `${line.slice(0, output.columns - 2)}…` : line);
  const draw = () => {
    const lines = pickerLines(message, choices, state).map(fit);
    if (drawn) output.write(`\x1b[${drawn}F`);
    output.write(`\x1b[J${lines.join('\n')}\n`);
    drawn = lines.length;
  };
  return new Promise((resolve, reject) => {
    const finish = (fn) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(false);
      input.pause();
      fn();
    };
    const onKey = (str, key) => {
      let r;
      try {
        r = pickerKey(choices, state, str, key);
      } catch (err) {
        finish(() => reject(err));
        return;
      }
      state = r.state;
      if (r.abort) return finish(() => reject(Object.assign(new Error('aborted'), { code: 'ABORT' })));
      draw();
      if (r.done) finish(() => resolve(pickerResult(choices, state)));
    };
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.resume();
    draw();
  });
}
