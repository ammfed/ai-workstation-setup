# Voice mode: talk with your assistant

The `voice-mode` module (opt-in, Linux and macOS) lets you speak to your assistant and hear
it answer in real time, speech to speech. It answers from your own records, notes and files
(read-only), hands real work to your assistant's inbox and says out loud that it is queued,
and opens apps, websites, folders and records on your desktop while you are still talking.

It is a handful of dependency-free Node scripts in `~/.config/ai-workstation-setup/voice/bin/`,
one `config.json` next to them, and the system's own audio tools (`parecord` and `pacat`
from PulseAudio or PipeWire on Linux, `sox` on macOS). On Linux a small floating orb (a QML
file run by Qt 6's `qml` tool) shows the conversation while it runs.

```sh
voice-mode toggle           # the hotkey: start a conversation, or end the one running
voice-mode start            # the same conversation, in this terminal (Ctrl+C ends it)
voice-mode check            # what is configured and what is missing (never prints keys)
```

A conversation is one continuous speech-to-speech exchange: the mic stays open from start
to end, you talk, it answers, and you cut in on an answer by talking over it.

## How it fits together

```
mic ──► realtime voice provider (OpenAI Realtime or Gemini Live) ──► speaker
            │   ▲                     │
            │   └── tool results ◄────┴── tool calls: search/read/list records, queue work
            │
            └── words as you speak ──► decision model picks ONE action from a fixed list
                                        └──► plain code opens it (app, site, folder, record)
```

- **The voice model talks.** It has four tools that read your records and one that queues
  work. It has no tool that changes a file, runs a command or sends a message.
- **A decision model chooses, code acts.** While you speak, the partial transcript goes to a
  fast decision model ([Jev](https://openrouter.ai/typesafe/jev-1.13), through OpenRouter's
  Decisions API), which returns one choice from a fixed catalog with a probability per option.
  Plain code opens the chosen item only when that probability clears a threshold, so the app
  can open before you finish the sentence. The model never produces a command, a path or a
  URL: every item and its target come from the catalog.
- **The voice model is told what was opened** (a one-line note on OpenAI, a `desktop_action`
  tool on either provider), so it confirms instead of claiming it cannot open apps.

## The config file

`~/.config/ai-workstation-setup/voice/config.json` (the installer writes it; `VOICE_MODE_CONFIG`
points at another one). Everything not in the file takes the defaults in `bin/config.mjs`.

| Key | What it does |
| --- | --- |
| `provider` | **The one line that switches providers**: `openai`, `gemini`, or `fake` (no network, for tests). |
| `keysFile` | Env file holding `OPENAI_API_KEY` and `GEMINI_API_KEY`; default `~/.config/ai-workstation-setup/voice/.env` (mode 600). Read at run time only. |
| `providers.openai` | `model` (`gpt-realtime`), `voice`, `transcribeModel` (`gpt-live-transcribe`, which streams words while you speak), `silenceMs`, `vad` (`server` or `semantic`). |
| `providers.gemini` | `model` (`gemini-3.8-live`), `voice`, `silenceMs`. |
| `persona` / `personaFile` | Who the voice is. The shipped default is neutral and brief; put your own in a file. |
| `sources` | What it may read: `{ "name", "path", "about"?, "show"? }` for a file or folder (a `*` in a path segment makes one source per match), or `{ "name", "command": [..., "{query}"] }` for a read-only search command (`{regex}` gives the keywords as `a\|b`). `about` tells the model what the source holds; `show: true` lets its top-level notes be shown on screen by voice. |
| `queue` | `{ "command": [...], "env": {} }`: the request text is added as the last argument. Never run through a shell. |
| `actions` | `enabled`, `chooser` (`model`, `keyName`, `keyFile`, `threshold` 0.9 mid-sentence, `finalThreshold` 0.7 once you stop), `apps` (extra `{ id, name, desktop \| mac \| command }`), `discoverApps` (installed desktop apps on Linux), `sites` (`{ id, name, url }`, http and https only), `documents` (its folders can be opened), `files`, `decisionLog` (default on: one line per decision in `logs/decisions.log`). |
| `audio` | `duplex`: `full` (default: talk over a reply to cut in) or `half` (the mic is muted while a reply plays), `echoCancel` (default on; it wraps the `input` and `output` devices, or the default ones), `input` and `output` device names, `earcons` (a short tone when a conversation starts and ends). |
| `listen.exitAfterMin` | End the conversation after this many minutes without speech (default 10). |
| `orb` | `enabled`, `size` (pixels), `corner` (`bottom-right`, `bottom-left`, `top-right`, `top-left`), `margin` (pixels from that corner), `colors` for `idle`, `listening`, `thinking`, `speaking` and `action`, `runner` (the Qt 6 `qml` tool, found by itself when empty). |
| `logDir`, `logTranscripts` | Run log and `metrics.jsonl`. Transcripts go to the run log only when `logTranscripts` is true, and never to the metrics file. |

Keys never go in `config.json`, an answers file, the repo, a log or a chat. The decision
model's key is read from `actions.chooser.keyFile` (or the environment) at run time and is
never copied.

## What it may read, and what it never does

- Only the configured sources, read-only. A file is read only when it sits inside a source
  (symlinks are followed and checked), is a text file, and is not named like a key or
  secret (`.env`, `*secret*`, `*token*`, `*credential*`, `*key*`, `.pem`). Search keeps file
  text in memory keyed by modification time, warmed at start, so a search over a few
  thousand notes takes a few hundred milliseconds.
- **The realtime provider sees what the tools return**, plus your voice. Point `sources` only
  at what you are content to send to that provider.
- Real work goes only through `queue`. The voice model is told it cannot do work itself and
  must say the request is queued.
- Desktop actions only open catalog items. Folders, files and records must still resolve
  inside the documents folder or a source; anything executable (scripts, `.desktop` launchers,
  installers, anything with an execute bit) is refused. Nothing closes, deletes, types or runs
  arbitrary commands.

## Barge-in (cutting in on a reply)

Talk over a reply and it stops:

- **OpenAI Realtime**: the server detects your speech and cancels the reply
  (`interrupt_response`); playback stops at once and the model's copy of the reply is
  truncated (`conversation.item.truncate`) to what you actually heard.
- **Gemini Live**: the server detects your speech and interrupts
  (`START_OF_ACTIVITY_INTERRUPTS`); playback stops on `interrupted`.

Either way, a records lookup still running when you cut in does not restart the answer you
abandoned.

A reply from laptop speakers must never come back in as you talking. On Linux, voice mode
loads PipeWire's (or PulseAudio's) own `module-echo-cancel` around the mic and speaker for
as long as a conversation runs and unloads it at the end, so the reply is subtracted from
what the mic hears while your voice gets through. When echo cancellation cannot load (or on
macOS), it falls back to half duplex: the mic is muted while a reply plays and for 400 ms
after, and you wait for the answer to finish (or end the conversation with the hotkey). A
headset needs no echo cancellation: `echoCancel: false`. If a room's echo still interrupts
replies, set `audio.duplex` to `"half"`.

## The hotkey

The hotkey is on and off for a whole conversation: press it once and a conversation starts
(a rising tone, and the orb appears), talk as long as you like, press it again and it ends
(a falling tone, and the orb goes). A conversation nobody talks to ends by itself after
`listen.exitAfterMin`.

There is only ever one conversation, so never two listeners or two voices, however fast or
often the key is pressed. It holds a lock file (its pid, in `$XDG_RUNTIME_DIR`) from the
moment the hotkey starts it, so the next press ends it even while it is still connecting,
and a second `voice-mode start` refuses. A lock left by a conversation that died is taken over.

The default is **Ctrl+2** (`VOICE_HOTKEY`). A global shortcut takes the key from every app,
so apps lose their own Ctrl+2 (a browser's "go to tab 2", for example); pick another
combination if you rely on it.

- **KDE Plasma (X11 or Wayland)**: the installer writes `~/.local/share/applications/voice-mode-toggle.desktop`
  with `X-KDE-Shortcuts`, the same kind of entry System Settings > Shortcuts > Add Command
  makes, and registers it with kglobalaccel over D-Bus so it works at once, without logging
  out. It refuses a combination another shortcut already uses. The installer prints the
  command that removes it.
- **Other desktops and macOS**: bind the printed `... voice-mode.mjs toggle` command in your
  desktop's keyboard shortcut settings.

## The orb

While a conversation runs, a small orb floats in a corner of the screen, above every window,
and moves with it:

| Look | When |
| --- | --- |
| Grey, slowly breathing | Listening, and it is quiet |
| Blue, a ring that swells with your voice | You are talking |
| Amber, two arcs turning and a sweeping highlight | Your turn has ended and it is thinking or looking something up |
| Violet, a lively ring that follows the reply's loudness | It is speaking |
| A green ring flashes out, and a label beside the orb names what was opened | The decision model just opened something (for a few seconds) |

Clicks go through the orb to whatever is under it. The small pill under it is the only part
that takes the mouse: drag its dots to move the orb (the place is remembered in
`orb-position.json` next to the config), and its cross ends the conversation, like the hotkey.

It is `bin/orb.qml`, run by Qt 6's own `qml` tool (package `qml-qt6` on Debian and Ubuntu,
`qt6-declarative` on Arch; the installer adds it). On KDE Plasma (and other Wayland desktops
with the layer-shell protocol, such as Sway and Hyprland) it is a layer-shell surface in the
overlay layer, through KDE's `layer-shell-qt`, which is what keeps it above every window on
Wayland, where an app cannot otherwise ask to stay on top. The orb only gets a mode and a
loudness level from voice mode (over a local port, behind a random token), never a word of
what is said. Without a `qml` tool or a desktop session, voice mode runs without it; turn it
off with `"orb": { "enabled": false }`.

## Latency

`voice-mode bench --clip question.wav --runs 5` streams a recorded question into the chosen
provider in real time, exactly as the microphone would (then silence), and prints each turn's
numbers. Live turns append the same numbers to `logs/metrics.jsonl`, and `voice-mode latency`
prints their medians.

- **First audio**: from the end of your speech (the last loud frame) to the first reply audio
  received. It includes the provider's end-of-speech wait (`silenceMs`, 500 ms by default).
- **Action**: from the start of your speech to the app, site, folder or record being launched.

Measured on 2026-09-25 on a Linux desktop, over a few thousand local notes, with the defaults
(`gpt-realtime` with `gpt-live-transcribe`, `gemini-3.8-live`, `typesafe/jev-1.13`):

| | OpenAI Realtime | Gemini Live |
| --- | --- | --- |
| First audio, question answered from the records | 1.34 s median (1.18 to 1.79, 5 runs) | 4.25 s median (2.85 to 6.68, 3 runs) |
| First audio, "open ..." request | 1.27 and 1.73 s medians (two requests, 5 runs each) | 2.94 s median (2.54 to 3.16, 3 runs) |
| Action, from speech start | 3.18 and 3.38 s medians (3.08 to 3.97) | 5.40 s median (5.23 to 6.16), after the sentence |

- On OpenAI, the words arrive while you speak, and each decision call takes about 0.35 to
  0.45 s. The action lands about 1.3 to 1.4 s after you say the word that names the target:
  in "Can you open Firefox? I want to check something" (3.7 s long) the browser started
  before the sentence ended in 3 of 5 runs, up to 0.7 s before. A short request ("Please open
  my Documents folder for me", 2.8 s) finishes before the action. Most of that delay is the
  provider's transcription, not the decision. In 1 of those 5 runs nothing was opened and the
  voice said it could not tell what to open. That run's quiet log does not say why; a failed
  decision call is the likely cause, so a failed call on the final sentence is now retried once.
- Gemini Live delivers its input transcript only after you stop speaking (measured), so the
  action lands after the sentence, not during it. Gemini also calls its record tools before
  saying anything, while OpenAI speaks a short acknowledgement first, which is most of the
  difference in the first row.
- Launching itself (`kstart`, `gtk-launch`, `xdg-open`, `open`) takes about 10 ms to hand
  off. The window appears when the app has started, which the numbers above do not include.
- Not included: your microphone and speaker buffers (about 20 and 40 ms as configured).

## Checking it without talking

- `logs/decisions.log` has one line per decision-model call: what it chose (or `nothing to
  open`), how sure it was, how long the call took, and how far into the sentence it was; a
  failed call gives its reason (for example a connect timeout). The words heard are added
  only when `logTranscripts` is on. `tail -f` it while you talk to watch the decisions arrive.
- `voice-mode check` lists the config, which keys are set (never their values), audio tools,
  sources, the queue command and the action catalog.
- `voice-mode pick "open my documents folder"` shows what the decision model would open, word
  by word, without opening anything.
- `voice-mode bench` with `"provider": "fake"` runs the whole pipeline with no network, and
  `test/voice-mode.test.mjs` covers the read boundary, the queue, the action refusals, the
  chooser, barge-in, both provider adapters, the one-conversation lock and the orb's routes.
