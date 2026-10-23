// The computer password, asked once at a terminal right before the install starts and kept
// fresh for the whole run, so a package that needs sudo never stops the install halfway.
// Linux and WSL only: on macOS and Windows this setup installs nothing through sudo itself.

import { spawn, spawnSync } from 'node:child_process';
import { c } from './context.mjs';

export const PASSWORD_LINES = [
  '  First, your computer password.',
  '  It lets the setup install things without stopping halfway.',
  '  Nothing shows while you type. That is normal.',
  '',
];
export const PASSWORD_PROMPT = '  Password: ';

/** Whether this run asks for the password: at a terminal, through sudo, and not already cached. */
export function needsPassword(ctx) {
  if (!ctx.interactive || !['linux', 'wsl'].includes(ctx.os)) return false;
  if (ctx.sudo() !== 'sudo ') return false; // root, or no sudo on this machine
  if (ctx.dryRun || ctx.platform.simulated) return true;
  // Already cached, or a rule needs none (the Windows-driven run inside WSL): nothing to ask.
  return ctx.capture('sudo -n true') === null;
}

// Refresh sudo's cached password every minute while the installer runs. Not detached, so it
// keeps the terminal sudo keys its cache on; it stops by itself when the installer exits.
function keepFresh() {
  const loop = `while kill -0 ${process.pid} 2>/dev/null; do sudo -n -v 2>/dev/null || exit 0; sleep 60; done`;
  spawn('sh', ['-c', loop], { stdio: 'ignore' }).unref();
}

/** Screen 2. In a dry run the password line is shown and what is typed is thrown away. */
export async function askPassword(ctx) {
  if (!needsPassword(ctx)) return false;
  console.log(`\n${PASSWORD_LINES.join('\n')}`);
  if (ctx.dryRun) {
    await ctx.prompter.secret(PASSWORD_PROMPT, { plain: true });
    console.log(`  ${c.cyan('~')} would check it with sudo and keep it fresh until the end`);
    return true;
  }
  ctx.prompter?.release();
  // sudo's own password line, in the screen's words; it gives three tries.
  const r = spawnSync('sudo', ['-v', '-p', PASSWORD_PROMPT], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log('  That did not work. The setup asks again when it needs it.');
    return false;
  }
  keepFresh();
  return true;
}
