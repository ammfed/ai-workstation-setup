// The floating orb: a small always-on-top window that shows the conversation is running and
// moves with it (listening to the user's voice, thinking, speaking the reply). It is
// orb.qml run by Qt 6's own `qml` tool; on KDE Plasma and other Wayland desktops with
// layer-shell it sits in the overlay layer above every window. This side serves its state
// on a random local port behind a random token, and ends the conversation when its close
// control is clicked. It never gets a word of what is said, only a mode and a level.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { has } from './audio.mjs';

const QML = path.join(path.dirname(fileURLToPath(import.meta.url)), 'orb.qml');
const RUNNERS = ['/usr/lib/qt6/bin/qml', 'qml6', 'qml-qt6'];

/** The Qt 6 `qml` tool: `orb.runner` in the config, else the first one found. */
export function orbRunner(config) {
  if (config.orb.runner) return config.orb.runner;
  return RUNNERS.find((r) => (r.startsWith('/') ? fs.existsSync(r) : has(r))) || null;
}

/** 0..1 from a 16-bit RMS on a log scale: a quiet room is about 0, speech about 0.5 to 0.8. */
export const toLevel = (v) => (v <= 100 ? 0 : Math.min(1, Math.log10(v / 100) / 2));

/** Where the orb was dragged to, kept next to the config. */
const positionFile = (config) => path.join(path.dirname(config.file), 'orb-position.json');

export function orbLook(config) {
  const o = config.orb;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(positionFile(config), 'utf8'));
  } catch {}
  const num = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : d);
  return { size: num(o.size, 150), corner: o.corner, x: num(saved.x, o.margin), y: num(saved.y, o.margin), colors: o.colors };
}

export function startOrb(config, { state, stop, log = () => {}, env = process.env }) {
  if (process.platform !== 'linux' || !(env.WAYLAND_DISPLAY || env.DISPLAY)) return null;
  const runner = orbRunner(config);
  if (!runner) {
    log({ event: 'orb-unavailable', why: 'Qt 6 qml tool not found (Debian and Ubuntu: qml-qt6)' });
    return null;
  }
  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    const [, tok, route] = (req.url || '').split('/');
    if (tok !== token) {
      res.writeHead(404).end();
      return;
    }
    const reply = (body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (route === 'state') return reply(state());
    if (route === 'look') return reply(orbLook(config));
    if (req.method !== 'POST') return res.writeHead(404).end();
    let body = '';
    req.on('data', (d) => (body += d).length > 1000 && req.destroy());
    req.on('end', () => {
      reply({ ok: true });
      if (route === 'stop') stop();
      if (route === 'moved') {
        try {
          const { x, y } = JSON.parse(body);
          if (Number.isFinite(x) && Number.isFinite(y)) fs.writeFileSync(positionFile(config), `${JSON.stringify({ x: Math.round(x), y: Math.round(y) })}\n`);
        } catch {}
      }
    });
  });
  let proc = null;
  let stopped = false;
  server.listen(0, '127.0.0.1', () => {
    if (stopped) return;
    const url = `http://127.0.0.1:${server.address().port}/${token}`;
    proc = spawn(runner, [QML, '--', url], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => (err = (err + d).slice(-400)));
    proc.on('error', (e) => log({ event: 'orb-failed', error: e.message }));
    proc.on('exit', (code) => {
      if (!stopped && code) log({ event: 'orb-failed', code, error: err.trim().split('\n').slice(-2).join(' ') });
    });
    log({ event: 'orb', runner });
  });
  return {
    stop() {
      stopped = true;
      proc?.kill();
      server.close();
    },
  };
}
