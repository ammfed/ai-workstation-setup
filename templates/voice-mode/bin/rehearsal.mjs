// Rehearsal mode: practise a talk or a workshop out loud with the voice as a listening partner.
//
//   voice-mode rehearse            the same live voice, in this terminal (Ctrl+C ends it)
//   voice-mode rehearse --text     the same prompt, tool and notes, typed instead of spoken
//
// The voice gets one thing to know: the material in `rehearsal.contextFile`. Everything else
// that a normal conversation carries is switched off for the run: no records, no briefing, no
// hand-off or its answers, no notes vault, no lookout, no desktop or browser actions (so no
// words go to the decision model either). Only the rehearsal rules, that file and the
// conversation itself reach the realtime provider. At the end, plain notes go to a local file.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { merge } from './config.mjs';
import { redact } from './briefing.mjs';

export const RULES = `You are a rehearsal partner. The user is practising a talk or a workshop out loud, and you help them make it better. The material below is a draft they are testing, not a final version: any choice it marks as open is theirs to make.

How you work:
- Listen first. Never speak first, and never interrupt. While the user is presenting, let them talk.
- When they only paused for breath in the middle of a section, say just "Go on." and nothing more.
- When they finish a section and pause, or ask you something, answer briefly: one short reaction (what landed, or what was unclear), then one question someone in the audience might ask, then one suggestion. Only one suggestion at a time; give another only when they ask for more. Never repeat a suggestion or a question you already gave; build on what they just said instead. A suggestion must not assume anything about how the session runs that the material does not say.
- When they ask you to brainstorm, give one or two ideas at a time (an example, an opening, a way to explain a point, a game twist), then ask which one to explore.
- Hold the material in mind. When they skip a part, change the main point or run long on one part, say so in one sentence and ask whether that is on purpose.
- Never invent facts, figures, names or quotes about the audience, the organisation or anyone else. When something depends on facts you do not have, say so and ask.
- You are heard, not read: short spoken sentences, no lists, no markdown. Keep each answer under about fifteen seconds unless asked for more. Answer in the language the user speaks.
- When they say they are done, or ask to wrap up or save the notes, call save_notes once with what they covered, what worked and the open points. Then say the words in the "say" field of its result, exactly as written, and nothing more.`;

export const SAVE_NOTES_TOOL = {
  name: 'save_notes',
  description: 'Save the rehearsal notes to a file on this computer. Call when the user says they are done, or asks to wrap up or save the notes.',
  parameters: {
    type: 'object',
    properties: {
      said: { type: 'string', description: 'What the user covered, in their order, in a few plain sentences.' },
      worked: { type: 'array', items: { type: 'string' }, description: 'What worked well, one point per item.' },
      open_points: { type: 'array', items: { type: 'string' }, description: 'Questions, weak spots and ideas still open, one point per item.' },
    },
    required: ['said', 'worked', 'open_points'],
  },
};

/**
 * The config a rehearsal runs with: the user's config with everything that could send other
 * material out switched off, and a longer pause before the voice answers.
 */
export function rehearsalConfig(config) {
  const r = config.rehearsal;
  return merge(config, {
    sources: [],
    briefing: { enabled: false, parts: [] },
    queue: { command: [] },
    notes: { enabled: false },
    lookout: { enabled: false },
    actions: { enabled: false },
    browser: { enabled: false },
    providers: { [config.provider]: { silenceMs: r.silenceMs } },
  });
}

/** The material from `rehearsal.contextFile`, redacted; throws a plain message when it is missing or too long. */
export function readContext(config) {
  const { contextFile: file, maxChars } = config.rehearsal;
  if (!file) throw new Error(`no rehearsal material: set "rehearsal": { "contextFile": "<file>" } in ${config.file || 'the config'}`);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read the rehearsal material ${file} (${err.code || err.message})`);
  }
  text = redact(text).trim();
  if (!text) throw new Error(`the rehearsal material ${file} is empty`);
  if (text.length > maxChars) throw new Error(`the rehearsal material ${file} has ${text.length} characters; shorten it to ${maxChars} or raise rehearsal.maxChars`);
  return text;
}

export function rehearsalInstructions(context) {
  return `${RULES}\n\nThe material:\n<<<\n${context}\n>>>`;
}

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
const pad = (n) => String(n).padStart(2, '0');

/** One rehearsal's notes: the voice's summary (save_notes) and the transcript, in one Markdown file. */
export class RehearsalNotes {
  constructor(config, { now = new Date() } = {}) {
    const r = config.rehearsal;
    this.dir = r.notesDir;
    this.closing = r.closing;
    this.context = r.contextFile;
    this.started = now;
    this.stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    this.file = path.join(this.dir, `rehearsal-${this.stamp}.md`);
    this.claimed = false;
    this.summary = null;
    // The turns heard so far: the live list, so a save mid-rehearsal has the transcript too.
    this.turns = [];
  }

  /** The first write takes a name no other rehearsal holds (two can start in the same minute). */
  claim() {
    if (this.claimed) return;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    for (let i = 1; ; i++) {
      const file = path.join(this.dir, `rehearsal-${this.stamp}${i > 1 ? `-${i}` : ''}.md`);
      try {
        fs.closeSync(fs.openSync(file, 'wx', 0o600));
        this.file = file;
        this.claimed = true;
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    }
  }

  /** True when there is nothing to keep: no summary and no word heard. */
  get empty() {
    return !this.summary && !this.turns.some((t) => (t.text || '').trim() || (t.reply || '').trim());
  }

  /** The save_notes tool: keep the summary, write the file, and tell the voice what to say. */
  save(args = {}) {
    this.summary = { said: String(args.said || '').trim(), worked: list(args.worked), open: list(args.open_points) };
    this.write();
    return { saved: true, say: this.closing };
  }

  /** Write the file as it stands: the summary when there is one, then every turn heard so far. */
  write(turns = this.turns) {
    this.turns = turns;
    const d = this.started;
    const out = [`# Rehearsal notes, ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`, '', `Material: ${this.context}`, ''];
    const s = this.summary;
    if (s) {
      out.push('## What was said', '', s.said || '(nothing given)', '');
      out.push('## What worked', '', ...(s.worked.length ? s.worked.map((x) => `- ${x}`) : ['(nothing given)']), '');
      out.push('## Open points', '', ...(s.open.length ? s.open.map((x) => `- ${x}`) : ['(nothing given)']), '');
    } else {
      out.push('The voice did not write a summary: the rehearsal ended before notes were asked for. The transcript below is what was heard.', '');
    }
    out.push('## Transcript', '');
    const said = turns.filter((t) => (t.text || '').trim() || (t.reply || '').trim());
    if (!said.length) out.push('(nothing was heard)');
    for (const t of said) {
      if ((t.text || '').trim()) out.push(`You: ${t.text.trim()}`, '');
      if ((t.reply || '').trim()) out.push(`Voice: ${t.reply.trim()}`, '');
    }
    this.claim();
    fs.writeFileSync(this.file, `${out.join('\n').trimEnd()}\n`, { mode: 0o600 });
    return this.file;
  }
}

/** Answer a rehearsal tool call, or undefined when it is not one. */
export function rehearsalTool(notes, call) {
  if (call.name === SAVE_NOTES_TOOL.name) return notes.save(call.args);
  return undefined;
}

/**
 * The typed rehearsal: each line goes to the provider as the user's words, through the same
 * instructions, tool and notes as the spoken one; the reply's words are printed. Ends at the
 * end of input or a line "/end", then writes the notes, also when it stops early (an error;
 * a signal writes them through notes.turns). Returns the notes file, or null when nothing was said.
 */
export async function rehearseText({ provider, notes, input = process.stdin, output = process.stdout, timeoutMs = 60000, afterToolMs = 8000, busyMs = 10000, log = () => {} }) {
  // The notes hold the live list, so an early end still has every turn.
  const turns = (notes.turns = []);
  let turn = null;
  let done = null;
  // A provider can end the part of the reply before a tool call, then go on once the result
  // is in: an end that comes before any words after the call waits a moment for them.
  let afterTool = false;
  provider.on('reply-text', (d) => {
    if (turn) turn.reply += d;
    afterTool = false;
  });
  provider.on('tool-call', (call) => {
    let result;
    try {
      result = rehearsalTool(notes, call) ?? { error: `unknown tool ${call.name}` };
    } catch (err) {
      result = { error: err.message };
    }
    log({ event: 'tool', name: call.name, ok: !result.error });
    if (turn) turn.tools.push(call.name);
    afterTool = true;
    provider.toolResult(call, result);
  });
  provider.on('reply-done', () => {
    const end = done;
    if (!afterTool) return end?.();
    setTimeout(() => afterTool && end?.(), afterToolMs).unref?.();
  });
  provider.on('error', (err) => log({ event: 'provider-error', error: err.message }));
  await provider.connect();
  const rl = readline.createInterface({ input, terminal: false });
  try {
    for await (const line of rl) {
      const text = line.trim();
      if (!text) continue;
      if (text === '/end') break;
      turn = { text, reply: '', tools: [] };
      turns.push(turn);
      output.write(`You: ${text}\n`);
      const finished = new Promise((resolve) => {
        done = resolve;
        setTimeout(resolve, timeoutMs).unref?.();
      });
      if (!provider.text) throw new Error(`${provider.name} cannot take typed words`);
      // A reply that outlasted the wait for the line before holds this line back a little.
      let sent = provider.text(text);
      for (const until = Date.now() + busyMs; !sent && Date.now() < until; ) {
        await new Promise((r) => setTimeout(r, 200));
        sent = provider.text(text);
      }
      if (sent) await finished;
      else turn.text = `${text} (not sent: the voice was still answering)`;
      done = null;
      output.write(`Voice: ${sent ? turn.reply.trim() || '(no words)' : '(not sent: the voice was still answering)'}${turn.tools.length ? `   [called ${turn.tools.join(', ')}]` : ''}\n\n`);
    }
  } finally {
    rl.close();
    provider.close();
    if (!notes.empty) notes.write(turns);
  }
  return notes.empty ? null : notes.file;
}
