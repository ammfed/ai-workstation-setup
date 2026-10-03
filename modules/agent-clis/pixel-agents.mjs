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
// no setting for another name, so this is an opt-in patch of the installed program: it reads
// session id -> name pairs from ~/.pixel-agents/agent-names.json (kept by pixel-office-names) and
// uses a name found there in place of the folder. It is applied only to a version listed here,
// whose code was read and whose three anchors each occur exactly once; any other version is
// refused unchanged. An upgrade of pixel-agents replaces the patched file; re-run the installer.
export const PATCH_MARKER = '/* ai-workstation-setup: office names */';
export const PATCHED_VERSIONS = ['1.4.1'];

const LOOKUP = `${PATCH_MARKER}
var __awsNames={},__awsNamesAt=0;
function __awsName(sid){if(!sid)return null;var now=Date.now();if(now-__awsNamesAt>10000){__awsNamesAt=now;try{__awsNames=JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(),'.pixel-agents','agent-names.json'),'utf8'))||{}}catch(e){}}var n=__awsNames[sid];return typeof n==='string'&&n?n:null}
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

export async function patchPixelAgents(ctx) {
  if (ctx.platform.simulated) {
    ctx.info(`would patch pixel-agents ${PATCHED_VERSIONS.join(' or ')} (dist/cli.js, a backup kept) to read names from ~/.pixel-agents/agent-names.json`);
    return;
  }
  const root = ctx.capture('npm root -g');
  const pkgDir = root && path.join(root, 'pixel-agents');
  if (!pkgDir || !fs.existsSync(path.join(pkgDir, 'package.json'))) throw new Skip('pixel-agents is not installed with npm here');
  const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const cli = path.join(pkgDir, 'dist', 'cli.js');
  const source = fs.readFileSync(cli, 'utf8');
  if (source.includes(PATCH_MARKER)) return ctx.ok(`pixel-agents ${version} already reads office names`);
  const patched = patchPixelCli(source, version);
  await ctx.writeFile(cli, patched, { onConflict: 'replace' });
}
