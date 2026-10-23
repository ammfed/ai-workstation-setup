import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Skip } from '../../lib/context.mjs';

// Pixel Agents (github.com/pixel-agents-hq/pixel-agents) keeps its settings in
// ~/.pixel-agents/config.json, one block per host ("standalone" is the `pixel-agents` command,
// "vscode" the extension). These are a starting point: a value you already set is kept.
export const PIXEL_SETTINGS = {
  alwaysShowLabels: true,
  watchAllSessions: true,
  showAreas: true,
  soundEnabled: false,
};

export function mergePixelSettings(config) {
  config.standalone = { ...PIXEL_SETTINGS, ...config.standalone };
  return config;
}

// Office names. Pixel Agents 1.4 labels each character with the folder its agent runs in and has
// no setting for another name, so this is an opt-in patch of the installed program. Every ten
// seconds the patched office asks the installed helper (`pixel-office-names --print`, which reads
// herdr and writes nothing) for session id -> name pairs, on top of any kept in
// ~/.pixel-agents/agent-names.json, and uses a name found there in place of the folder. It is
// applied only to a version listed here, whose code was read and whose three anchors each occur
// exactly once; any other version is refused unchanged. An upgrade of pixel-agents replaces the
// patched file; re-run the installer.
export const PATCH_MARKER = '/* ai-workstation-setup: office names 2 */';
const ANY_MARKER = '/* ai-workstation-setup: office names';
// sha256 of each version's published dist/cli.js, so an untouched copy can be told apart from one
// another patch already changed (checked against `npm pack pixel-agents@<version>`).
export const PRISTINE_SHA256 = {
  '1.4.1': '24f93fcf08280ff775602ebe52d1e718c67474a628a0ca07d34eea7c0e284e05',
};
export const PATCHED_VERSIONS = Object.keys(PRISTINE_SHA256);

// Keeps the last names it found when both sources fail for a moment, so labels do not flicker.
const LOOKUP = `${PATCH_MARKER}
var __awsNames={},__awsNamesAt=0;
function __awsName(sid){if(!sid)return null;var now=Date.now();if(now-__awsNamesAt>10000){__awsNamesAt=now;var fs=require('fs'),os=require('os'),path=require('path'),next={},ok=false;try{next=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.pixel-agents','agent-names.json'),'utf8'))||{};ok=true}catch(e){}try{Object.assign(next,JSON.parse(require('child_process').execFileSync(process.execPath,[path.join(os.homedir(),'.local','bin','pixel-office-names'),'--print'],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']})));ok=true}catch(e){}if(ok)__awsNames=next}var n=__awsNames[sid];return typeof n==='string'&&n?n:null}
`;

const ANCHORS = [
  ['folderName:n.folderName,teamName:n.teamName', 'folderName:(__awsName(n.sessionId)||n.folderName),teamName:n.teamName'],
  ['S.folderName&&(d[g]=S.folderName)', '(__awsName(S.sessionId)||S.folderName)&&(d[g]=__awsName(S.sessionId)||S.folderName)'],
  ['{type:"agentCreated",id:l,folderName:f.folderName,', '{type:"agentCreated",id:l,folderName:(__awsName(f.sessionId)||f.folderName),'],
];

/** Patched text of dist/cli.js, or throws Skip with the reason it was refused. */
export function patchPixelCli(source, version) {
  if (source.includes(PATCH_MARKER)) return source;
  if (!PATCHED_VERSIONS.includes(version)) {
    throw new Skip(`pixel-agents ${version} is not a version this patch was written for (${PATCHED_VERSIONS.join(', ')}); left unchanged`);
  }
  let out = source;
  for (const [from, to] of ANCHORS) {
    const count = out.split(from).length - 1;
    if (count !== 1) throw new Skip(`pixel-agents ${version} does not look as expected (an anchor occurs ${count} times); left unchanged`);
    out = out.replace(from, to);
  }
  // After the shebang line, so the file still runs as a command, and after a "use strict"
  // directive, which only counts as the first statement.
  let at = out.startsWith('#!') ? out.indexOf('\n') + 1 : 0;
  const strict = out.slice(at).match(/^\s*(["'])use strict\1;?/);
  if (strict) at += strict[0].length;
  return `${out.slice(0, at)}\n${LOOKUP}${out.slice(at)}`;
}

const anchorsIntact = (text) => ANCHORS.every(([from]) => text.split(from).length === 2);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * What to write to dist/cli.js: { patched, from }. A file another patch already changed (an
 * earlier office-names patch, for example) has lost the anchors; it is patched from an untouched
 * copy of the same version kept beside it (`siblings`: { name, text }, proved by its hash), and
 * `from` names that copy. Without one it is refused with the way out. Throws Skip when refused.
 */
export function planPixelPatch(source, version, siblings = [], pristine = PRISTINE_SHA256[version]) {
  if (source.includes(PATCH_MARKER)) return { patched: source, from: null };
  if (!PATCHED_VERSIONS.includes(version) || anchorsIntact(source)) return { patched: patchPixelCli(source, version), from: null };
  const original = pristine && siblings.find((s) => sha256(s.text) === pristine);
  if (original) return { patched: patchPixelCli(original.text, version), from: original.name };
  const by = source.includes(ANY_MARKER) ? 'an older version of this office-names patch' : 'another patch (an earlier office-names patch, for example)';
  throw new Skip(`dist/cli.js of pixel-agents ${version} was already changed by ${by}, and no untouched copy of it was found beside it; reinstall it with \`npm install -g pixel-agents@${version}\` and run again (left unchanged)`);
}

export async function patchPixelAgents(ctx) {
  if (ctx.platform.simulated) {
    ctx.info(`would patch pixel-agents ${PATCHED_VERSIONS.join(' or ')} (dist/cli.js, a backup kept) to take names from pixel-office-names`);
    return;
  }
  const root = ctx.capture('npm root -g');
  const pkgDir = root && path.join(root, 'pixel-agents');
  if (!pkgDir || !fs.existsSync(path.join(pkgDir, 'package.json'))) throw new Skip('pixel-agents is not installed with npm here');
  const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const dist = path.join(pkgDir, 'dist');
  const cli = path.join(dist, 'cli.js');
  const source = fs.readFileSync(cli, 'utf8');
  if (source.includes(PATCH_MARKER)) return ctx.ok(`pixel-agents ${version} already reads office names`);
  const siblings = fs
    .readdirSync(dist)
    .filter((name) => name.startsWith('cli.js.') && fs.statSync(path.join(dist, name)).isFile())
    .map((name) => ({ name, text: fs.readFileSync(path.join(dist, name), 'utf8') }));
  const { patched, from } = planPixelPatch(source, version, siblings);
  if (from) ctx.info(`dist/cli.js was already changed by another patch; patching the untouched copy beside it (${from}) instead, and the changed file is backed up`);
  await ctx.writeFile(cli, patched, { onConflict: 'replace' });
}

/**
 * Is the file at `file` an office-names helper someone wrote before this one (it keeps the same
 * names file) and different from `content`? Such a file cannot answer --print, which the patched
 * office needs, so the installer replaces it with a backup; any other file there is left alone.
 */
export function earlierOfficeNamesHelper(file, content) {
  let current;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  return current !== content && current.includes('agent-names.json') && !current.includes('--print');
}
