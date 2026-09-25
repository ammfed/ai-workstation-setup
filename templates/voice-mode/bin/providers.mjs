// Realtime speech-to-speech providers behind one small interface. Pick one with the
// config's "provider" line; the session never looks past this interface.
//
//   const p = createProvider(config, { instructions, tools, key })
//   p.inputRate / p.outputRate      PCM16 mono sample rates it takes and gives
//   await p.connect()               open and configure the session
//   p.sendAudio(pcm)                microphone audio at inputRate
//   p.interrupt(playedMs)           the user cut in: stop the reply, forget what was not heard
//   p.toolResult(call, result)      answer a 'tool-call'
//   p.note?.(text)                  optional: context the model reads without replying
//   p.close()
//
// Events: 'user-speech-start', 'user-speech-end', 'user-text' (textSoFar, final),
// 'audio' (pcm), 'reply-text' (delta), 'tool-call' ({ id, name, args }), 'reply-done',
// 'interrupted', 'error' (Error), 'close'.
//
// Barge-in: both real providers detect the user speaking over a reply on the server and
// stop it (OpenAI interrupt_response, Gemini START_OF_ACTIVITY_INTERRUPTS). interrupt() is
// called when that speech starts while reply audio is still playing here: OpenAI cancels
// the reply and truncates the model's copy to what was heard; Gemini has no cancel or
// truncate message, so the reply's remaining audio is dropped here.

import { EventEmitter } from 'node:events';
import { rms } from './audio.mjs';

const b64 = (buf) => Buffer.from(buf).toString('base64');

async function frameText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  if (data && typeof data.text === 'function') return data.text();
  return String(data);
}

class Socketed extends EventEmitter {
  open(url, protocols) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, protocols);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = (e) => {
        const err = new Error(`${this.name} connection failed${e?.message ? `: ${e.message}` : ''}`);
        if (!opened) reject(err);
        else this.emit('error', err);
      };
      ws.onclose = (e) => {
        if (!opened) reject(new Error(`${this.name} closed the connection (${e.code}${e.reason ? ` ${e.reason}` : ''})`));
        this.emit('close', { code: e.code, reason: e.reason });
      };
      ws.onmessage = async (e) => {
        let msg;
        try {
          msg = JSON.parse(await frameText(e.data));
        } catch {
          return;
        }
        if (process.env.VOICE_MODE_DEBUG) process.stderr.write(`${this.name} <- ${JSON.stringify(msg, (k, v) => (typeof v === 'string' && v.length > 200 ? `[${v.length} chars]` : v)).slice(0, 600)}\n`);
        try {
          this.onMessage(msg);
        } catch (err) {
          this.emit('error', err);
        }
      };
    });
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }

  /** Resolve once `event` fires, or reject after ms. */
  wait(event, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: no ${event} within ${ms} ms`)), ms);
      this.once(event, (v) => {
        clearTimeout(t);
        resolve(v);
      });
    });
  }
}

// ------------------------------------------------------------------ OpenAI Realtime

export class OpenAIRealtime extends Socketed {
  constructor(cfg, { instructions, tools, key }) {
    super();
    this.name = 'OpenAI Realtime';
    this.cfg = cfg;
    this.instructions = instructions;
    this.tools = tools;
    this.key = key;
    this.inputRate = 24000;
    this.outputRate = 24000;
    this.userText = new Map();
    this.pending = new Set();
    this.hadCalls = false;
    this.responseActive = false;
    this.audioItem = null;
  }

  async connect() {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.cfg.model)}`;
    // Node's built-in WebSocket cannot set headers; the documented subprotocol carries the key.
    await this.open(url, ['realtime', `openai-insecure-api-key.${this.key}`]);
    this.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: this.instructions,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: this.cfg.transcribeModel },
            turn_detection:
              this.cfg.vad === 'semantic'
                ? { type: 'semantic_vad', eagerness: this.cfg.eagerness || 'auto', create_response: true, interrupt_response: true }
                : { type: 'server_vad', silence_duration_ms: this.cfg.silenceMs, create_response: true, interrupt_response: true },
          },
          output: { format: { type: 'audio/pcm', rate: 24000 }, voice: this.cfg.voice },
        },
        tools: this.tools.map((t) => ({ type: 'function', ...t })),
        tool_choice: 'auto',
      },
    });
    await this.wait('ready', 10000);
  }

  onMessage(m) {
    switch (m.type) {
      case 'session.updated':
        this.emit('ready');
        break;
      case 'input_audio_buffer.speech_started':
        this.abandonTools();
        this.currentItem = m.item_id;
        this.userText.set(m.item_id, '');
        // A cut-in (handled on this event) still needs the reply's audio offsets.
        this.emit('user-speech-start');
        this.turnAudioMs = 0;
        break;
      case 'input_audio_buffer.speech_stopped':
        this.emit('user-speech-end');
        break;
      // Words of an earlier turn that arrive after the user started a new one are dropped.
      case 'conversation.item.input_audio_transcription.delta': {
        if (m.item_id !== this.currentItem) break;
        const text = (this.userText.get(m.item_id) || '') + (m.delta || '');
        this.userText.set(m.item_id, text);
        this.emit('user-text', text, false);
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        this.userText.delete(m.item_id);
        if (m.item_id === this.currentItem) this.emit('user-text', m.transcript || '', true);
        break;
      case 'response.created':
        this.responseActive = true;
        break;
      case 'response.output_audio.delta': {
        // Where each spoken item starts in the turn's audio, so a cut lands inside the right one.
        const pcm = Buffer.from(m.delta, 'base64');
        if (m.item_id !== this.audioItem) {
          this.audioItem = m.item_id;
          this.itemStartMs = this.turnAudioMs || 0;
        }
        this.turnAudioMs = (this.turnAudioMs || 0) + (pcm.length / 2 / this.outputRate) * 1000;
        this.emit('audio', pcm);
        break;
      }
      case 'response.output_audio_transcript.delta':
        this.emit('reply-text', m.delta || '');
        break;
      case 'response.output_item.done':
        if (m.item?.type === 'function_call') {
          let args = {};
          try {
            args = JSON.parse(m.item.arguments || '{}');
          } catch {}
          this.pending.add(m.item.call_id);
          this.hadCalls = true;
          this.emit('tool-call', { id: m.item.call_id, name: m.item.name, args });
        }
        break;
      case 'response.done':
        this.responseActive = false;
        // A cancelled reply was cut off by the user, who is already on the next turn.
        if (m.response?.status === 'cancelled') this.emit('interrupted');
        else if (this.hadCalls) this.continueAfterTools();
        else this.emit('reply-done');
        break;
      case 'error':
        // Cancelling a reply that already ended is harmless.
        if (m.error?.code !== 'response_cancel_not_active') this.emit('error', new Error(`${this.name}: ${m.error?.message || 'error'}`));
        break;
    }
  }

  /** The user moved on: tool calls still running must not restart the reply they belonged to. */
  abandonTools() {
    this.pending.clear();
    this.hadCalls = false;
  }

  continueAfterTools() {
    if (this.responseActive || this.pending.size) return;
    this.hadCalls = false;
    this.send({ type: 'response.create' });
  }

  sendAudio(pcm) {
    this.send({ type: 'input_audio_buffer.append', audio: b64(pcm) });
  }

  toolResult(call, result) {
    // The output is always recorded, so the conversation stays well formed; only a call
    // that is still wanted continues the reply.
    this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.id, output: JSON.stringify(result) } });
    if (this.pending.delete(call.id)) this.continueAfterTools();
  }

  /** A line of context the model reads without replying to it (what the desktop helper did). */
  note(text) {
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
    return true;
  }

  interrupt(playedMs) {
    this.abandonTools();
    if (this.responseActive) this.send({ type: 'response.cancel' });
    if (this.audioItem) {
      const itemMs = this.turnAudioMs - this.itemStartMs;
      const heard = Math.max(0, Math.min(playedMs - this.itemStartMs, itemMs));
      this.send({ type: 'conversation.item.truncate', item_id: this.audioItem, content_index: 0, audio_end_ms: Math.floor(heard) });
    }
    this.audioItem = null;
  }
}

// ------------------------------------------------------------------ Gemini Live

export class GeminiLive extends Socketed {
  constructor(cfg, { instructions, tools, key }) {
    super();
    this.name = 'Gemini Live';
    this.cfg = cfg;
    this.instructions = instructions;
    this.tools = tools;
    this.key = key;
    this.inputRate = 16000;
    this.outputRate = 24000;
    this.userText = '';
    this.userFinal = false;
    this.replying = false;
    this.dropping = false;
  }

  async connect() {
    const url =
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent' +
      `?key=${encodeURIComponent(this.key)}`;
    await this.open(url);
    this.send({
      setup: {
        model: `models/${this.cfg.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.cfg.voice } } },
        },
        systemInstruction: { parts: [{ text: this.instructions }] },
        tools: [{ functionDeclarations: this.tools }],
        realtimeInputConfig: {
          automaticActivityDetection: { silenceDurationMs: this.cfg.silenceMs },
          activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
      },
    });
    await this.wait('ready', 10000);
  }

  finishUserText() {
    if (this.userText && !this.userFinal) {
      this.userFinal = true;
      this.emit('user-speech-end');
      this.emit('user-text', this.userText, true);
    }
  }

  onMessage(m) {
    if (m.setupComplete) return this.emit('ready');
    if (m.goAway) this.emit('error', new Error(`${this.name} is ending the session in ${m.goAway.timeLeft}`));
    const sc = m.serverContent;
    if (sc) {
      if (sc.inputTranscription?.text) {
        // Gemini sends no speech-start event; the first words of a new turn stand in for it.
        if (!this.userText || this.userFinal) {
          this.userText = '';
          this.userFinal = false;
          this.emit('user-speech-start');
        }
        this.userText += sc.inputTranscription.text;
        this.emit('user-text', this.userText, false);
      }
      if (sc.interrupted) {
        this.dropping = false;
        this.replying = false;
        this.emit('interrupted');
      }
      for (const part of sc.modelTurn?.parts || []) {
        if (part.inlineData?.data) {
          this.finishUserText();
          this.awaitingTools = false;
          this.replying = true;
          if (!this.dropping) this.emit('audio', Buffer.from(part.inlineData.data, 'base64'));
        }
      }
      if (sc.outputTranscription?.text && !this.dropping) this.emit('reply-text', sc.outputTranscription.text);
      // A turn that ends in a tool call is not the reply: the reply follows the tool answer.
      if (sc.turnComplete && this.awaitingTools) this.awaitingTools = false;
      else if (sc.turnComplete) {
        this.finishUserText();
        this.replying = false;
        this.dropping = false;
        this.emit('reply-done');
      }
    }
    for (const fc of m.toolCall?.functionCalls || []) {
      this.finishUserText();
      this.awaitingTools = true;
      this.emit('tool-call', { id: fc.id, name: fc.name, args: fc.args || {} });
    }
  }

  sendAudio(pcm) {
    this.send({ realtimeInput: { audio: { data: b64(pcm), mimeType: `audio/pcm;rate=${this.inputRate}` } } });
  }

  toolResult(call, result) {
    this.send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response: { output: result } }] } });
  }

  interrupt() {
    if (this.replying) this.dropping = true;
  }
}

// ------------------------------------------------------------------ fake (tests and offline runs)

/**
 * Behaves like a realtime provider with no network: finds speech by loudness, streams a
 * scripted transcript word by word while the user talks, calls the scripted tools, then
 * replies with a tone. Each script turn: { text, tools?: [{ name, args }], reply? }.
 */
export class FakeProvider extends EventEmitter {
  constructor(cfg = {}, { script = [] } = {}) {
    super();
    this.name = 'fake';
    this.cfg = { replyDelayMs: 300, wordMs: 220, silenceMs: 500, threshold: 500, replyMs: 800, ...cfg };
    this.script = [...(cfg.script || []), ...script];
    this.inputRate = 24000;
    this.outputRate = 24000;
    this.speaking = false;
    this.lastLoud = 0;
    this.turn = null;
    this.replyTimer = null;
    this.calls = [];
  }

  async connect() {
    this.clock = setInterval(() => this.tick(), 20);
    queueMicrotask(() => this.emit('ready'));
  }

  sendAudio(pcm) {
    const now = performance.now();
    if (rms(pcm) >= this.cfg.threshold) {
      this.lastLoud = now;
      if (!this.speaking) {
        this.speaking = true;
        if (this.replyTimer) this.stopReply(true);
        this.turn = { spec: this.script.shift() || { text: 'hello', reply: 'fake reply' }, started: now, words: 0 };
        this.emit('user-speech-start');
      }
    }
  }

  tick() {
    const now = performance.now();
    if (!this.speaking || !this.turn) return;
    const words = this.turn.spec.text.split(/\s+/);
    const n = Math.min(words.length, 1 + Math.floor((now - this.turn.started) / this.cfg.wordMs));
    if (n > this.turn.words) {
      this.turn.words = n;
      this.emit('user-text', words.slice(0, n).join(' '), false);
    }
    if (now - this.lastLoud >= this.cfg.silenceMs) {
      this.speaking = false;
      this.emit('user-speech-end');
      this.emit('user-text', this.turn.spec.text, true);
      this.respond(this.turn.spec);
    }
  }

  async respond(spec) {
    for (const t of spec.tools || []) {
      const call = { id: `call_${this.calls.length}`, name: t.name, args: t.args || {} };
      const answered = new Promise((resolve) => (call.resolve = resolve));
      this.calls.push(call);
      this.emit('tool-call', call);
      call.result = await answered;
    }
    this.replyTimer = setTimeout(() => this.streamReply(spec), this.cfg.replyDelayMs);
  }

  streamReply(spec) {
    const chunkMs = 40;
    let sent = 0;
    const chunk = Buffer.alloc((this.outputRate * chunkMs * 2) / 1000);
    for (let i = 0; i < chunk.length / 2; i++) chunk.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / this.outputRate) * 3000), i * 2);
    this.emit('reply-text', spec.reply || 'ok');
    const step = () => {
      if (sent >= this.cfg.replyMs) {
        this.replyTimer = null;
        this.emit('reply-done');
        return;
      }
      sent += chunkMs;
      this.emit('audio', chunk);
      this.replyTimer = setTimeout(step, chunkMs / 2);
    };
    step();
  }

  stopReply(byVoice) {
    clearTimeout(this.replyTimer);
    this.replyTimer = null;
    this.emit('interrupted', { byVoice });
  }

  toolResult(call, result) {
    this.calls.find((c) => c.id === call.id)?.resolve(result);
  }

  interrupt() {
    if (this.replyTimer) this.stopReply(false);
  }

  close() {
    clearInterval(this.clock);
    clearTimeout(this.replyTimer);
    this.emit('close', {});
  }
}

export const PROVIDERS = { openai: { make: OpenAIRealtime, keyName: 'OPENAI_API_KEY' }, gemini: { make: GeminiLive, keyName: 'GEMINI_API_KEY' }, fake: { make: FakeProvider } };

export function createProvider(config, { instructions, tools, key, script }) {
  const entry = PROVIDERS[config.provider];
  if (!entry) throw new Error(`unknown provider "${config.provider}"`);
  const cfg = config.providers[config.provider] || {};
  return config.provider === 'fake' ? new FakeProvider(cfg, { script }) : new entry.make(cfg, { instructions, tools, key });
}
