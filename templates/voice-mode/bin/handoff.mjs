// Hand-off: what the voice cannot answer from its briefing and records, or any real work,
// goes to the assistant's own session through the queue command, as one line carrying an
// id and the exact command that answers it. The answer comes back as a file (one reply
// queue, no server); the running conversation speaks it as its own, or, when no
// conversation is running, the next one does.
//
//   <dir>/pending/<id>.json   written when the voice hands something off
//   <dir>/replies/<id>.json   written by `voice-mode reply <id> "<answer>"`
//   <dir>/spoken/<id>.json    moved here once the answer has been spoken

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, expandHome } from './config.mjs';

export const ID = /^vq-[0-9a-f]{6}$/;

export const handoffDir = (config) => (config.handoff.dir ? expandHome(config.handoff.dir) : path.join(config.file ? path.dirname(config.file) : CONFIG_DIR, 'handoff'));

const sub = (config, name) => {
  const d = path.join(handoffDir(config), name);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};

/** Write JSON so a reader never sees half a file. */
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The one-line note the assistant receives. */
export function noteText({ id, kind, request, replyCommand }) {
  const what = kind === 'task' ? 'Voice request' : 'Voice question';
  const flat = String(request).replace(/\s+/g, ' ').trim();
  return `${what} ${id}: "${flat}" -- the user is waiting in voice mode; answer in one to three short spoken sentences with: ${replyCommand} ${id} "<answer>"`;
}

export function newId() {
  return `vq-${crypto.randomBytes(3).toString('hex')}`;
}

/** Record a hand-off before it is sent, so its reply can be matched to the question. */
export function savePending(config, entry) {
  writeAtomic(path.join(sub(config, 'pending'), `${entry.id}.json`), entry);
}

/** `voice-mode reply`: the answer to a hand-off, queued for the voice to speak. */
export function saveReply(config, id, text) {
  if (!ID.test(id)) throw new Error(`"${id}" is not a voice hand-off id (they look like vq-3f9a2c)`);
  const answer = String(text || '').trim();
  if (!answer) throw new Error('the answer is empty');
  if (answer.length > 4000) throw new Error('the answer is over 4000 characters; it is spoken, so keep it short');
  const pending = path.join(sub(config, 'pending'), `${id}.json`);
  if (!fs.existsSync(pending)) {
    const spoken = fs.existsSync(path.join(sub(config, 'spoken'), `${id}.json`));
    throw new Error(spoken ? `${id} was already answered and spoken` : `no voice hand-off ${id} is waiting for an answer`);
  }
  writeAtomic(path.join(sub(config, 'replies'), `${id}.json`), { id, text: answer, at: Date.now() });
}

/** Answers waiting to be spoken, oldest first, each with its question. */
export function waitingReplies(config) {
  const dir = sub(config, 'replies');
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const reply = readJson(path.join(dir, f));
      let question = null;
      try {
        question = readJson(path.join(sub(config, 'pending'), f));
      } catch {}
      out.push({ ...reply, question });
    } catch {}
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Once spoken (or given up on): kept in spoken/ with question and answer, out of the queue. */
export function markSpoken(config, id, extra = {}) {
  const pending = path.join(sub(config, 'pending'), `${id}.json`);
  const reply = path.join(sub(config, 'replies'), `${id}.json`);
  let record = {};
  try {
    record = { question: readJson(pending), reply: readJson(reply), spokenAt: Date.now(), ...extra };
  } catch {}
  writeAtomic(path.join(sub(config, 'spoken'), `${id}.json`), record);
  fs.rmSync(reply, { force: true });
  fs.rmSync(pending, { force: true });
}

/**
 * Which answer to speak next. An answer leaves the queue only once it was heard; one that was
 * not (the reply failed, or the user started talking first) is tried again after a pause,
 * and given up on after `maxTries`.
 */
export class Deliveries {
  constructor(config, { maxTries = 3, backoffMs = 2000 } = {}) {
    this.config = config;
    this.maxTries = maxTries;
    this.backoffMs = backoffMs;
    this.tries = new Map();
  }

  next(now = Date.now()) {
    return waitingReplies(this.config).find((r) => (this.tries.get(r.id)?.at ?? 0) <= now) || null;
  }

  heard(id) {
    this.tries.delete(id);
    markSpoken(this.config, id);
  }

  /** True when this was the last try: the answer then leaves the queue unheard. */
  failed(id, now = Date.now()) {
    const n = (this.tries.get(id)?.n ?? 0) + 1;
    if (n >= this.maxTries) {
      this.tries.delete(id);
      markSpoken(this.config, id, { unheard: true });
      return true;
    }
    this.tries.set(id, { n, at: now + this.backoffMs * 2 ** (n - 1) });
    return false;
  }
}
