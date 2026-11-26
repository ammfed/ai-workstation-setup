// Test helper: where the installer keeps the backups of one file (see Context.backup).
import fs from 'node:fs';
import path from 'node:path';

/** Full paths of the backups of `file`, oldest first, for an installer whose home is `home`. */
export function backupsOf(home, file, claudeDir = path.join(home, '.claude')) {
  const abs = path.resolve(file);
  const skills = path.resolve(claudeDir, 'skills');
  const h = path.resolve(home);
  let place;
  if (abs.startsWith(skills + path.sep)) place = path.join('skills', path.relative(skills, abs));
  else if (abs.startsWith(h + path.sep)) place = path.join('files', path.relative(h, abs));
  else place = path.join('files', '_outside', abs.slice(path.parse(abs).root.length).replace(/^[\\/]+/, '').replace(/:/g, ''));
  const full = path.join(home, '.config', 'ai-workstation-setup', 'backups', place);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.startsWith(`${path.basename(full)}.bak-`)).sort().map((n) => path.join(dir, n));
}
