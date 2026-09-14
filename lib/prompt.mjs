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

  async multi(message, choices, def = []) {
    stdout.write(`? ${message}\n`);
    choices.forEach((ch, i) => {
      const mark = def.includes(ch.value) ? '[x]' : '[ ]';
      stdout.write(`    ${String(i + 1).padStart(2)}) ${mark} ${ch.label ?? ch.value}\n`);
    });
    for (;;) {
      const a = await this.question('  Numbers or names, comma-separated (Enter keeps [x], "none" for nothing): ');
      if (a === '') return def;
      if (a.toLowerCase() === 'none') return [];
      const picked = [];
      let bad = null;
      for (const part of a.split(',').map((s) => s.trim()).filter(Boolean)) {
        const ch = /^\d+$/.test(part) ? choices[Number(part) - 1] : choices.find((c) => c.value === part);
        if (!ch) bad = part;
        else if (!picked.includes(ch.value)) picked.push(ch.value);
      }
      if (!bad) return picked;
      stdout.write(`  "${bad}" is not one of the listed options.\n`);
    }
  }

  async secret(message) {
    const rl = this.ensure();
    stdout.write(`? ${message} (input hidden, Enter to skip): `);
    this.muted = true;
    try {
      return await new Promise((resolve) => rl.question('', (a) => resolve(a.trim())));
    } finally {
      this.muted = false;
      stdout.write('\n');
    }
  }
}
