// A crontab line per job, the fallback when no systemd user session runs (WSL with systemd
// off, minimal Linux). Each line ends with "# <marker>"; a re-run replaces only its own line.

export const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** `node <script> [args]` with this run's PATH, quoted for a crontab line. */
export function cronCommand(script, args = [], env = {}) {
  const vars = Object.entries({ PATH: process.env.PATH, ...env }).map(([k, v]) => `${k}=${shellQuote(v)}`);
  return [...vars, shellQuote(process.execPath), shellQuote(script), ...args.map(shellQuote)].join(' ');
}

/** Add or replace the crontab line marked `marker`; returns false when it was already there. */
export function ensureCronLine(ctx, schedule, command, marker) {
  const line = `${schedule} ${command} >/dev/null 2>&1 # ${marker}`;
  const current = ctx.capture('crontab -l 2>/dev/null') || '';
  if (current.split('\n').includes(line)) {
    ctx.ok(`already in your crontab (${marker})`);
    return false;
  }
  const kept = current.split('\n').filter((l) => l && !l.endsWith(`# ${marker}`));
  ctx.run('crontab -', { input: `${[...kept, line].join('\n')}\n` });
  ctx.info(`remove it with crontab -e (the line marked "# ${marker}")`);
  return true;
}
