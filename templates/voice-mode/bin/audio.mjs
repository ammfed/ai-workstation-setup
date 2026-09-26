// Microphone and speaker through the system's own command-line tools, so there is nothing
// to install from npm: parecord/pacat (PulseAudio or PipeWire) on Linux, sox on macOS.
// All audio here is 16-bit little-endian mono PCM.

import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

export const has = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;

/** Linear resampling, enough for speech between 16, 24 and 48 kHz. */
export function resample(buf, from, to) {
  if (from === to || !buf.length) return buf;
  const n = Math.floor(buf.length / 2);
  const outN = Math.floor((n * to) / from);
  const out = Buffer.alloc(outN * 2);
  for (let i = 0; i < outN; i++) {
    const x = (i * from) / to;
    const j = Math.floor(x);
    const a = buf.readInt16LE(Math.min(j, n - 1) * 2);
    const b = buf.readInt16LE(Math.min(j + 1, n - 1) * 2);
    out.writeInt16LE(Math.round(a + (b - a) * (x - j)), i * 2);
  }
  return out;
}

export function rms(buf) {
  let s = 0;
  const n = Math.floor(buf.length / 2);
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2);
    s += v * v;
  }
  return n ? Math.sqrt(s / n) : 0;
}

/** A short sine tone, for the "listening" and "stopped" cues. */
export function tone(rate, hz, ms, gain = 0.15) {
  const n = Math.floor((rate * ms) / 1000);
  const out = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / (rate * 0.01), (n - i) / (rate * 0.01));
    out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 32767 * gain * fade), i * 2);
  }
  return out;
}

function captureArgv(rate, device) {
  if (process.platform === 'darwin') return ['rec', '-q', '-t', 'raw', '-r', String(rate), '-e', 'signed', '-b', '16', '-c', '1', '-'];
  return ['parecord', '--raw', '--format=s16le', `--rate=${rate}`, '--channels=1', '--latency-msec=20', ...(device ? [`--device=${device}`] : [])];
}

function playArgv(rate, device) {
  if (process.platform === 'darwin') return ['play', '-q', '-t', 'raw', '-r', String(rate), '-e', 'signed', '-b', '16', '-c', '1', '-'];
  return ['pacat', '--playback', '--raw', '--format=s16le', `--rate=${rate}`, '--channels=1', '--latency-msec=40', ...(device ? [`--device=${device}`] : [])];
}

/** A WAV file's audio (16-bit PCM, first channel) and its rate; anything else is taken as raw PCM at `rate`. */
export function wavToPcm(buf, rate = 24000) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return { pcm: buf, rate };
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('only 16-bit PCM WAV is supported');
      // A streamed WAV can say 0 or more than it has: take what is there.
      let pcm = buf.subarray(off + 8, size && off + 8 + size <= buf.length ? off + 8 + size : buf.length);
      if (fmt.channels > 1) {
        const mono = Buffer.alloc(Math.floor(pcm.length / 2 / fmt.channels) * 2);
        for (let i = 0; i < mono.length / 2; i++) mono.writeInt16LE(pcm.readInt16LE(i * 2 * fmt.channels), i * 2);
        pcm = mono;
      }
      return { pcm, rate: fmt.rate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('no audio data in the WAV');
}

/** Play PCM once to the end on `device` (the default output when empty). */
export function play(pcm, { rate, device = '' }) {
  return new Promise((resolve, reject) => {
    const argv = playArgv(rate, device);
    const proc = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${argv[0]} exited with ${code}`))));
    proc.stdin.on('error', () => {});
    proc.stdin.end(pcm);
  });
}

export function audioTools() {
  return process.platform === 'darwin' ? ['rec', 'play'] : ['parecord', 'pacat'];
}

/**
 * Echo cancellation for laptop speakers and microphone, so the reply is not heard as the
 * user talking (which would interrupt it). Loads PipeWire/PulseAudio's own echo-cancel
 * module for as long as voice mode runs and unloads it on exit; returns the device names.
 * It wraps the default devices, or the `input` and `output` devices when they are named.
 */
export function startEchoCancel(log = () => {}, { input = '', output = '' } = {}) {
  if (process.platform !== 'linux' || !has('pactl')) return null;
  const name = `voice_mode_${process.pid}`;
  const args = ['load-module', 'module-echo-cancel', `source_name=${name}_mic`, `sink_name=${name}_out`, 'aec_method=webrtc'];
  if (input) args.push(`source_master=${input}`);
  if (output) args.push(`sink_master=${output}`);
  const r = spawnSync('pactl', args, { encoding: 'utf8' });
  const id = r.stdout.trim();
  if (r.status !== 0 || !/^\d+$/.test(id)) {
    log({ event: 'echo-cancel-unavailable', error: (r.stderr || '').trim().slice(0, 200) });
    return null;
  }
  return { input: `${name}_mic`, output: `${name}_out`, stop: () => spawnSync('pactl', ['unload-module', id], { stdio: 'ignore' }) };
}

/** The microphone: emits 'data' with PCM chunks at `rate` while started. */
export class Mic extends EventEmitter {
  constructor({ rate, device }) {
    super();
    this.rate = rate;
    this.device = device;
    this.proc = null;
  }

  start() {
    if (this.proc) return;
    const argv = captureArgv(this.rate, this.device);
    this.proc = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'ignore'] });
    this.proc.stdout.on('data', (b) => this.emit('data', b));
    this.proc.on('error', (err) => this.emit('error', err));
    this.proc.on('close', () => (this.proc = null));
  }

  stop() {
    if (this.proc) this.proc.kill();
    this.proc = null;
  }
}

/**
 * The speaker. Keeps a player process warm so the first reply chunk plays at once, and
 * can stop mid-reply (barge-in): the player is killed, which drops what it buffered, and a
 * fresh one is started for the next reply. `playedMs()` is how much of the current reply
 * the user has heard, which the provider needs to cut the model's memory of the reply.
 */
export class Speaker extends EventEmitter {
  constructor({ rate, device }) {
    super();
    this.rate = rate;
    this.device = device;
    this.proc = null;
    this.warm();
  }

  warm() {
    const argv = playArgv(this.rate, this.device);
    const proc = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.on('error', (err) => this.emit('error', err));
    proc.stdin.on('error', () => {});
    this.proc = proc;
    this.playEnd = 0;
    this.replyMs = 0;
    this.levels = [];
  }

  write(pcm) {
    const ms = (pcm.length / 2 / this.rate) * 1000;
    const now = performance.now();
    // Latency of the player itself is small and constant; the cursor tracks audible time.
    let at = Math.max(now + 40, this.playEnd);
    this.playEnd = at + ms;
    this.replyMs += ms;
    // Loudness per 40 ms slice, keyed by when it will be heard, for `level()`.
    const slice = Math.round((this.rate * 40) / 1000) * 2;
    for (let i = 0; i < pcm.length; i += slice, at += 40) this.levels.push([at + 40, rms(pcm.subarray(i, i + slice))]);
    this.proc.stdin.write(pcm);
  }

  /** Loudness (RMS) of what is being heard right now; 0 when nothing is playing. */
  level() {
    const now = performance.now();
    while (this.levels.length && this.levels[0][0] < now) this.levels.shift();
    return this.levels.length && this.levels[0][0] - 40 <= now ? this.levels[0][1] : 0;
  }

  /** A new reply starts: count its audio from zero. */
  beginReply() {
    this.replyMs = 0;
  }

  /** Milliseconds of the current reply heard so far. */
  playedMs() {
    return Math.max(0, this.replyMs - Math.max(0, this.playEnd - performance.now()));
  }

  /** True while sent audio is still playing (and for `tailMs` after). */
  busy(tailMs = 0) {
    return performance.now() < this.playEnd + tailMs;
  }

  /** Stop now, dropping anything not yet played. */
  cut() {
    const old = this.proc;
    this.warm();
    old.kill('SIGKILL');
  }

  close() {
    this.proc?.kill();
  }
}
