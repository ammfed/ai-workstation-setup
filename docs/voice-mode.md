# Voice mode: talk with your assistant

The `voice-mode` module (opt-in, Linux and macOS) lets you speak to your assistant and hear
it answer in real time, speech to speech. It answers from your own records, notes and files
(read-only) and from a live briefing of what your assistant is working on, hands anything
deeper or any real work to your assistant's own session and speaks the answer when it comes
back, and opens apps, websites, folders and records on your desktop while you are still talking.

It is a handful of dependency-free Node scripts in `~/.config/ai-workstation-setup/voice/bin/`,
one `config.json` next to them, and the system's own audio tools (`parecord` and `pacat`
from PulseAudio or PipeWire on Linux, `sox` on macOS). On Linux a small floating orb (a QML
file run by Qt 6's `qml` tool) shows the conversation while it runs.

```sh
voice-mode toggle           # the hotkey: start a conversation, or end the one running
voice-mode start            # the same conversation, in this terminal (Ctrl+C ends it)
voice-mode check            # what is configured and what is missing (never prints keys)
voice-mode do "<request>"   # for your assistant: one desktop action from the same safe list
voice-mode say "<text>"     # for your assistant: say these words aloud, as they are
voice-mode page             # what the browser's current page offers the voice (touches nothing)
voice-mode pc               # this computer's status in a few lines (what the voice reads when asked)
voice-mode tasks            # today's and overdue tasks in a few lines (what the voice reads when asked)
voice-mode help             # every command
```

A conversation is one continuous speech-to-speech exchange: the mic stays open from start
to end, you talk, it answers, and you cut in on an answer by talking over it.

## How it fits together

```
mic ──► realtime voice provider (OpenAI Realtime or Gemini Live) ──► speaker
            │   ▲                     │
            │   └── tool results ◄────┴── tool calls: search/read/list records, hand off
            │
            └── words as you speak ──► decision model picks ONE action from a fixed list
                                        └──► plain code does it (open, switch, volume, note...)
```

- **The voice model talks.** Its instructions carry a live briefing (see below). It has tools
  that read your records and one that hands a question or task to your assistant's own
  session. It has no tool that changes a file, runs a command or sends a message.
- **A decision model chooses, code acts.** While you speak, the partial transcript goes to a
  fast decision model ([Jev](https://openrouter.ai/typesafe/jev-1.13), through OpenRouter's
  Decisions API), which returns one choice from a fixed catalog with a probability per option.
  Plain code carries out the chosen item only when that probability clears a threshold, so the
  app can open before you finish the sentence. The model never produces a command, a path or
  a URL: every item and its target come from the catalog.
- **The voice model is told what was opened** (a one-line note on OpenAI, a `desktop_action`
  tool on either provider), so it confirms instead of claiming it cannot open apps.

## The config file

`~/.config/ai-workstation-setup/voice/config.json` (the installer writes it; `VOICE_MODE_CONFIG`
points at another one). Everything not in the file takes the defaults in `bin/config.mjs`.

| Key | What it does |
| --- | --- |
| `provider` | **The one line that switches providers**: `openai`, `gemini`, or `fake` (no network, for tests). |
| `keysFile` | Env file holding `OPENAI_API_KEY` and `GEMINI_API_KEY`; default `~/.config/ai-workstation-setup/voice/.env` (mode 600). Read at run time only. |
| `providers.openai` | `model` (`gpt-realtime`), `voice`, `transcribeModel` (`gpt-live-transcribe`, which streams words while you speak), `silenceMs`, `vad` (`server` or `semantic`), `ttsModel` (`gpt-4o-mini-tts`, for `voice-mode say`). |
| `providers.gemini` | `model` (`gemini-3.8-live`), `voice`, `silenceMs`, `ttsModel` (`gemini-3.8-flash-lite-tts`, for `voice-mode say`). Gemini resets each connection after about ten minutes; voice mode reconnects with the session's resumption handle, so the conversation carries on where it was. |
| `persona` / `personaFile` | Who the voice is. The shipped default is neutral and brief; put your own in a file. |
| `sources` | What it may read: `{ "name", "path", "about"?, "show"? }` for a file or folder (a `*` in a path segment makes one source per match), or `{ "name", "command": [..., "{query}"], "timeoutSec"? }` for a read-only search command (`{regex}` gives the keywords as `a\|b`; 6 s unless `timeoutSec` says otherwise). A command with neither runs only when the voice names its source. `about` tells the model what the source holds; `show: true` lets its top-level notes be shown on screen by voice. |
| `exclude` | Name patterns (`*` and `?`, any case) of files and folders that are never listed, searched, read, offered to the decision model or opened, in the documents folder and every source. Empty unless you fill it in; see Keeping files out. |
| `lookout` | `enabled`, `url` (the ledger board's `/api/board`; loopback only), `command` (`ledger board --json`, used when the board is off), `everySec` (5), `batchSec` (30), `gapSec` (120), `stateFile`. See The lookout. |
| `notes` | `enabled`, `vault` (a git repository), `agy` (the agy command), `rawDir` (raw material agy is told never to read), `waitSec` (30). See Answers from your notes. |
| `tasks` | `command` (default `ticktick --format json tasks due 1`), `timeoutSec` (5): what `voice-mode tasks` runs. |
| `queue` | `{ "command": [...], "env": {} }`: how a hand-off reaches your assistant; the note is added as the last argument. Never run through a shell. Without it there is no hand-off. |
| `handoff` | `replyCommand` (default `voice-mode reply`: the command written into each note; give the full path if your assistant's shell does not have it on PATH), `dir` (the reply queue; default `handoff/` next to the config), `waitMin` (15: how long a conversation stays open for an answer that is still coming), `stillComingSec` (20: when it says, once, that the answer is still coming; 0 never). |
| `briefing` | `enabled`, `refreshMin` (3), `maxChars` (120000 in all; see What a big briefing costs), `parts` (see Briefing and hand-off). |
| `actions` | `enabled`, `chooser` (`model`, `keyName`, `keyFile`, `threshold` 0.9 mid-sentence, `finalThreshold` 0.7 once you stop, `askThreshold` 0.5 for a browser button that is only asked about), `apps` (extra `{ id, name, desktop \| mac \| command }`), `discoverApps` (installed desktop apps on Linux), `sites` (`{ id, name, url }`, http and https only), `documents` (its folders can be opened), `files`, `decisionLog` (default on: one line per decision in `logs/decisions.log`), `control` (default on: the PC control below), `notes.folder`, `searchUrl` (`{q}` is replaced by the words), `dryRun`. |
| `browser` | `enabled` (off by default), `endpoint` (`http://127.0.0.1:9222`: the DevTools address of a Chrome started for the assistant; loopback only), `ignore` (URL prefixes of tabs it never reads, switches to or closes), `maxItems` (60 links, buttons and fields per page), `confirmSec` (30: how long a held button waits for a yes). See Browser control. |
| `audio` | `duplex`: `full` (default: talk over a reply to cut in) or `half` (the mic is muted while a reply plays), `echoCancel` (default on; it wraps the `input` and `output` devices, or the default ones), `input` and `output` device names, `earcons` (a short tone when a conversation starts and ends). |
| `listen.exitAfterMin` | End the conversation after this many minutes without speech (default 10). |
| `orb` | `enabled`, `size` (pixels), `corner` (`bottom-right`, `bottom-left`, `top-right`, `top-left`), `margin` (pixels from that corner), `colors` for `idle`, `listening`, `thinking`, `speaking` and `action`, `runner` (the Qt 6 `qml` tool, found by itself when empty). |
| `logDir`, `logTranscripts` | Run log and `metrics.jsonl`. Transcripts go to the run log only when `logTranscripts` is true, and never to the metrics file. |

Keys never go in `config.json`, an answers file, the repo, a log or a chat. The decision
model's key is read from `actions.chooser.keyFile` (or the environment) at run time and is
never copied.

## Controlling the computer

Everything the decision model can pick, and how plain code does it:

| Say something like | What happens | How |
| --- | --- | --- |
| "open Firefox", "open my Projects folder", "show me the backlog" | Opens an installed app, a listed site, a documents folder, or a record | the desktop's launcher or default app |
| "switch to Chrome" | Brings that app's open window to the front | a two-line KWin script (KDE Plasma) |
| "minimize this", "maximize it", "move it to the other screen", "next desktop" | Acts on the window in front | KWin's own shortcuts |
| "show the desktop", "show me all my windows" | Show desktop, Overview | KWin's own shortcuts |
| "turn it up", "volume down", "mute" | Volume | the volume shortcuts (Plasma), else `wpctl` |
| "pause the music", "next track", "previous" | Media players | the media shortcuts (Plasma), else `playerctl` |
| "brighter", "dim the screen" | Screen brightness | the brightness shortcuts (Plasma), else `brightnessctl` |
| "take a screenshot" | A full-screen screenshot | Spectacle's shortcut |
| "lock my screen" | Locks the screen, only once the sentence has ended | the lock shortcut (Plasma), else `loginctl lock-session` |
| "make a note: buy milk tomorrow" | Writes a new note with those words and opens it | a new `.md` file in `actions.notes.folder` (default: a `Notes` folder in your documents), opened with the default app |
| "search the web for cheap flights to Rome" | Opens a web search for those words | `actions.searchUrl` in the default browser |
| "type hello from voice mode" | Types those words into the window in front, once the sentence has ended | `ydotool` (needs `ydotoold` running); characters follow your keyboard layout |

On KDE Plasma every window, media, volume, brightness, screenshot and lock action is one of
the desktop's own global shortcuts, invoked over D-Bus exactly as if the key were pressed, so
it does what the key does and shows the same on-screen display. Actions whose component or
command is missing are left out of the catalog.

For a note, a search or typing, the model first picks the action (often mid-sentence), then,
once the sentence has ended, picks which span of your own words is the text: the Decisions
API returns choices and scores, never free text, so the text is always words you said.

It never deletes or moves files, sends messages or email, buys anything, changes settings,
runs commands, or closes or quits apps. Those are not in the catalog; asked for one, the
decision model picks nothing and the voice says voice mode does not do that. Set
`actions.control` to `false` to keep it to opening things, and `actions.dryRun` to `true` to
log what each action would run instead of running it.

## Browser control

With `browser.enabled`, the voice also acts on the current page of a Chrome window started
for your assistant, while you are still talking: "click the pricing link", "type blue hiking
boots in the search box", "scroll down", "go back", "switch to the docs tab", "close this
tab", "what does this page say". Listed sites and web searches then open in that window too.

Start that Chrome with its own profile and a debugging port (Chrome refuses remote debugging
on your everyday profile, and voice mode should never drive the browser you use yourself):

```sh
google-chrome --user-data-dir="$HOME/.config/assistant-chrome" --remote-debugging-port=9222
```

How it works, all in `bin/browser.mjs`, with no dependencies:

- **The page becomes choices.** At the start of each thing you say, plain code reads the page
  over the Chrome DevTools Protocol, in an isolated world the page's own scripts cannot reach:
  the links, buttons, fields and page tabs in view, by their visible names, plus scroll, back,
  forward, read, and the open tabs. That takes about 10 to 40 ms. Download links are left out.
- **The decision model picks one**, from the same catalog as the desktop actions, and for a
  field which span of your own words to type. It never produces a selector, a URL or text of
  its own.
- **Plain code carries it out**: a real mouse click at the element's centre once it is
  checked to be the same element and not covered by something else; the words inserted into
  the field (never Enter or another key); a scroll of the page under the mouse; the tab's own
  history; the endpoint's activate and close calls. Downloads are denied while an action runs.
- **Reading** gives the voice the page's title and main text (up to 1,500 characters,
  redacted), and it tells you briefly what the page says.

What it never does:

- **A button that sends, submits, posts, deletes, buys, pays, confirms, signs in or grants
  access is never pressed on a pick.** Plain code decides which buttons those are (their words,
  in English and Arabic, and any button that submits a form). The voice is told the button is
  held and asks you, naming it. It is pressed only when your next words are a short plain yes
  ("yes", "go ahead"; nothing with no, not or wait in it), said after the voice finished
  asking, within `confirmSec`, on the same page with the same button still there. If the
  voice's reply did not name the button and ask, a yes cannot be verified and nothing is
  pressed. `voice-mode do` never presses one: nobody can say yes there.
- **It never types into a password, payment or identity field**: password inputs, one-time
  codes, anything whose autocomplete says card, password or birth date, and fields named
  like a card number, security code, expiry, IBAN, account number, passport, national ID or
  date of birth. Such a field is offered only so the voice can say it will not type there,
  and the field is checked again, live, just before any typing.
- It never downloads, never reads or touches tabs whose URL starts with an `ignore` entry,
  and never talks to a non-loopback endpoint.

**Which page text leaves the machine.** The names of the links, buttons and fields in view go
to the decision model with your words, and a page you ask to hear goes to the realtime voice
provider. Nothing else from the page is sent anywhere.

Measured on 2026-09-27, Gemini Live and `typesafe/jev-1.13`, on an invented shop page, three
runs each (end of speech to the action carried out, medians): click a link 1.72 s, click a
button 1.62 s, scroll 1.85 s, go back 1.55 s, read the page 2.27 s, type into a field 2.53 s
(it waits for the sentence, then picks the words). The right thing was done in all of those
runs. A button that sends was held and asked about in every run; a following "yes" pressed it
1.05 and 1.58 s after the word; "no, wait" never did. On Gemini most of that time is the
provider delivering your words after you stop (about 0.9 s) and one decision call (about
0.75 s with a catalog of about 160 choices); reading the page and clicking take 10 to 30 ms.
With OpenAI Realtime the words arrive while you speak, so a click can land before the
sentence ends, as the desktop actions do.

## What it may read, and what it never does

- Only the configured sources, read-only, less anything `exclude` names. A file is read only when it sits inside a source
  (symlinks are followed and checked), is a text file, and is not named like a key or
  secret (`.env`, `*secret*`, `*token*`, `*credential*`, `*key*`, `.pem`). Search keeps file
  text in memory keyed by modification time, warmed at start, so a search over a few
  thousand notes takes a few hundred milliseconds.
- **The realtime provider sees what the tools return**, plus your voice. Point `sources` only
  at what you are content to send to that provider.
- Real work goes only through `queue`, as a hand-off note. The voice model is told never to
  say work is done until an answer says so.
- The briefing and every spoken answer pass a redactor first: keys (`sk-...`, GitHub, AWS,
  Google, Slack), JSON web tokens, private keys, authorization and bearer headers,
  `user:password@` in links, `NAME=value` and `"name": "value"` where the name says key,
  token, secret or password, "password is ...", and any long random-looking token.
- Desktop actions only do what the catalog lists (see Controlling the computer). Folders,
  files and records must still resolve inside the documents folder or a source; anything
  executable (scripts, `.desktop` launchers, installers, anything with an execute bit) is
  refused. Nothing closes, deletes, moves, sends or runs arbitrary commands, and the only
  file it writes is a new note (never over an existing file).

## Briefing and hand-off

Without context, a voice model is a stranger. Two things make it the assistant you work with.

**The briefing.** At the start of a conversation, and again whenever a source changes (checked
every few seconds) or `refreshMin` passes, voice mode builds a briefing and puts it in the
model's instructions. OpenAI takes the new instructions at once. Gemini keeps its first
instructions for the whole conversation (a resumed one too), so it is sent only the lines
that changed, as context, in the next quiet moment. Each part has its own budget (`maxChars`, default 4000):

| Part | What it takes |
| --- | --- |
| `{ "name", "transcript": "<folder>", "messages"?, "skip"? }` | The newest `.jsonl` in a Claude Code project folder (`~/.claude/projects/<project>`), headed with when it was last active: what you typed and the assistant's final reply to it, the newest `messages` (30) that fit. |
| `{ "name", "path", "sections"?, "lineChars"? }` | A text file, or only its named `## ` sections (a backlog's open work, say); `lineChars` cuts each long line. |
| `{ "name", "files": "<glob>", "except"? }` | Whole files, newest first, each under its own name (a folder of memory notes, say); front matter is reduced to its `description`. |
| `{ "name", "tasks": "<glob>" \| [...], "days"? }` | Who is working on what, from task records: one `<id>.meta` file of `key=value` lines per task (`kind`, `project`, `worktree`, and `home` for an agent with its own folder of task records, whose tasks are listed under it) and its `<id>.status` log beside it. Each task changed within `days` (14) is one line: kind, project, working copy and latest status line. |
| `{ "name", "glob", "hours"? }` | The newest line of each matching log changed within `hours` (24): live status logs. |

A transcript is cleaned for speech. It keeps what you typed (a slash command as its name and
arguments) and the one reply that ends each of the assistant's runs, never tool calls, tool
output, thinking, the narration between tool calls, harness notices, hook feedback, or
messages another program typed into the session (`skip` adds your own patterns for those).
Markdown is flattened as a person would read it aloud: a table row becomes "first cell:
the rest", a link becomes its text (a bare GitHub link becomes "repo pull request 12"), code
blocks, emphasis and emoji go.

`voice-mode briefing` prints exactly what the model would get, redacted, with its size.

**What a big briefing costs.** Gemini Live takes up to its whole context, 131,072 tokens, as
instructions (measured: an instruction of 131,014 tokens was accepted and a word planted at
each end was recalled; about 133,000 closed the connection as an invalid argument). English
prose runs at about four characters a token, so the default `maxChars` of 120,000 is about
30,000 tokens. A bigger briefing is slower to start answering and dearer:

| Instruction size | First audio (a one-line question) |
| --- | --- |
| 9,000 tokens | 0.6 s |
| 43,000 tokens | 0.77 s |
| 86,000 tokens | 0.97 s |
| 103,000 to 120,000 tokens | 1.1 s |
| 131,000 tokens | 1.5 s |

Every turn is billed for the whole context again, briefing included (measured: the second
turn of a conversation with a 43,000-token briefing counted 42,944 prompt tokens). At the
text-input price when this was written (0.75 USD a million tokens), that is about 3 cents a
turn at 43,000 tokens, and about 10 cents at the full context. Large briefings also meet the
per-minute token quota sooner: two back-to-back conversations near the limit were refused
until a minute had passed.

**Records first.** The voice answers at once from the briefing. For anything the briefing does
not hold, it looks in your records itself, in the same reply (`search_records` with a few
keywords, and the source when you name one; `list_records` for the newest; `read_record`),
and answers from what they return, the newest record first when two disagree. Asked to
read, look up or check something, it always reads it, even when the briefing seems to know.

**Hand-off.** Only when the records do not answer either, or you ask for something to be
done, the voice says one short line ("Let me check; I'll tell you here as soon as it's
back") and calls `hand_off`. That sends your assistant one note through `queue`:

```
Voice question vq-3f9a2c: "<your request>" -- the user is waiting in voice mode; answer in one to three short spoken sentences with: voice-mode reply vq-3f9a2c "<answer>"
```

(`Voice request` for work.) Your assistant answers by running the command in the note:

```sh
voice-mode reply vq-3f9a2c "It merged this morning; CI is green."
```

The answer lands in a file-based reply queue (`handoff/replies/`, no server). A running
conversation speaks it in the next quiet moment, as its own answer, and the orb shows
"Answer ready". Spoken answers move to `handoff/spoken/`. A wrong id, or one already
answered, makes `reply` fail.

While an answer is coming, the conversation stays open, even past `listen.exitAfterMin`
(for up to `handoff.waitMin`, 15 minutes). If the answer takes longer than
`handoff.stillComingSec` (20 s) and you are both quiet, the voice says once that it is still
coming and that it will say it here as soon as it lands. On Gemini the hand-off is a
non-blocking call, so the conversation carries on while it waits. Only if you end the
conversation yourself first does the answer wait for the next one, which starts with it.

Two safety nets: a reply that promises to check ("Let me check", "On it") without calling
`hand_off` or reading any record hands off your words anyway, and an answer that gets a reply
with no sound is said once more. An answer you talk over is not repeated; it stays in the
conversation for the model.

The run log records `handoff` (id, sent), `handoff-answer` with `round_trip_ms` (the end of
your question to the first sound of the answer) and `speak_ms` (answer queued to heard), and
`handoff-unheard` when an answer was not heard.

## The lookout: speaking up on its own

With `lookout.enabled`, a running conversation also keeps an eye on your assistant's work and
says, without being asked, when something new **waits on you** or a **worker stopped or
failed**. It reads the [ledger](ledger.md) module's live board (`/api/board` on 127.0.0.1, or
`ledger board --json` when the board is off) every 5 seconds, so "waits on you" is the board's
own rule, the one Firstmate's `/bearings` uses. It never reads the Firstmate homes itself and
never steers anything: running the work stays with your assistant.

| It says (task names as the board has them) | When the board shows |
| --- | --- |
| "blue header is waiting on you: Blue logo or grey?" | a new item in *Needs you now* |
| "docs update is asking you something: Which page first?" | a worker's open question that is not a hold yet |
| "parser fix failed: tests failing on the parser." | a task whose last status is `failed` (or `blocked`: "is stuck") |
| "import job stopped before finishing. Its last words: halfway through the import" | a task whose agent was working and is gone, with no `done` or `paused` |

It does not announce pull requests, landings or anything else.

- **No nagging.** The first read ever is a silent baseline: what is already on the board is
  never announced. Each event is said once. Events found within `batchSec` (30 s) become one
  line, at most one line is spoken every `gapSec` (2 minutes), and more roll into "and 3 more".
  A line waits for a quiet moment, like a hand-off's answer.
- **With no conversation running, nothing is read, shown or said.** What is seen and what is
  not said yet live in `lookout.json` next to the config (mode 600). The next conversation
  compares the board with it and says, once, what is new and still true: a question answered
  meanwhile is not said late.
- **What leaves the machine**: only the line, to the realtime voice provider, through the
  conversation that is running. Inside a conversation each line is one more model turn, billed
  for the whole context (see What a big briefing costs).

## Computer status and today's tasks

Two read-only command sources the installer can add, read only when you ask ("how is my
battery?", "what's due today?"):

- **`computer`** runs `voice-mode pc`: battery (`/sys/class/power_supply` on Linux, `pmset` on
  macOS), disk (`df`), memory (`/proc/meminfo`, `vm_stat`), load against the number of cores,
  network (`nmcli`, else whether an interface is up), the three busiest apps (`ps`, grouped by
  executable, so a browser's many processes count once) and uptime. It takes about 0.15 s.
  It never speaks up about these on its own.
- **`tasks`** runs `voice-mode tasks`: the `tasks.command` (by default the TickTick CLI that the
  daily-sync module also uses, `ticktick --format json tasks due 1`), keeping what is overdue or
  due today by your local calendar day, with titles. A failed read is said plainly ("the task
  list could not be read just now"). The titles go to the realtime voice provider when the
  voice reads this source.

## Answers from your notes (through agy)

The voice never reads your notes vault itself. With `notes.enabled`, a question about your
notes ("what do my notes say about the garden?") goes to a tool, `ask_notes`: the voice says
"Let me check your notes", and [agy](https://antigravity.google) reads the vault and answers in
one to three sentences, which come back through the same reply queue as a hand-off's answer
and are spoken in the next quiet moment. At 20 s it says once that the answer is still coming;
at `waitSec` (30 s) agy is stopped and the voice says it could not get an answer in time.

How it is run, all of it checked in `bin/notes.mjs`:

- agy is started with an argument list, never through a shell, from the vault folder:
  `agy --prompt "<fixed prompt>" --new-project --effort low`. Nothing else is added: no plan
  mode, no other model (agy uses the model it is set up with), no permission override.
- The fixed prompt treats your question as data between markers, answers only from the notes,
  never reads `.ingest/` or `notes.rawDir`, and asks for one to three spoken sentences.
- **Read-only is proven, not trusted.** The vault must be a git repository: its
  `git status --porcelain` (except `.obsidian/`) is taken before and after every run. Any new
  or changed file switches notes answers off (`notes-disabled.json` next to the config, listing
  what changed) and the voice says so; nothing is reverted or deleted. `voice-mode check`
  reports it; delete the file once you have looked, to switch them back on.
- It never runs while the vault's ingest is running (`.ingest/lock`, or an `ingest.mjs`
  process for the vault), while agy is already running in the vault, or while another notes
  question is being answered: the voice then says "Notes are busy, try again shortly".
- The question and answer live only in the reply queue (`handoff/`); logs get the id, the time
  taken and the outcome, even with `logTranscripts` on. agy keeps its own session history
  under `~/.gemini`.
- Each question runs as its own `voice-mode ask-notes <id>`, so an answer still lands if you
  end the conversation first; the next one starts with it.

agy run on its own cannot ask for permission. It refuses terminal commands, and it refuses
to read files unless its settings allow it: add a `read_file` rule to `permissions.allow` in
agy's `settings.json` (`~/.gemini/antigravity-cli/`), as agy's own message suggests. Without it
the voice says agy is not allowed to read your notes, and `voice-mode check` flags it. Its
file-writing tool is not refused that way, which is why every run is checked afterwards.

Measured on 2026-09-30 and 2026-10-01 on a Linux desktop: agy answered a question that reads no
file in 6 to 11 s from the start of the command (median 7.3 s, five runs); reading a note
took about 25 s in the one run where agy could read it.

## Keeping files out

`exclude` lists name patterns, such as `"exclude": ["*contract*", "Client ?"]`, matched
(case-insensitively) against every folder and file name below the documents folder and each
source. A match is left out of everything: the documents folders offered to the decision model,
`files`, record search, reading, listing and opening, folders with everything inside them.
Only the part of a path below a root counts. `voice-mode check` prints how many patterns there
are and how many files and folders they keep out, never the patterns or the names. Patterns
are yours: keep them in your own `config.json`, never in a repository.

## From your assistant's session: `do` and `say`

Two commands let your assistant use voice mode from its own session, without a conversation.

`voice-mode do "<request in plain words>"` asks the same decision model, with the same
catalog, to pick one desktop action, and plain code carries it out exactly as it would for
your voice, with the same limits (see Controlling the computer): nothing deletes, sends,
closes or runs a command. It prints one JSON line and logs the action in `logs/voice-mode.log` and
`logs/decisions.log`, marked as asked by the assistant:

```sh
$ voice-mode do "turn the volume up a notch"
{"key":"system:volume-up","name":"Turn the sound volume up","done":"turned the volume up","ms":704}
$ voice-mode do "delete my downloads"
{"key":null,"note":"no action in the catalog fits; nothing was done","ms":838}     # exit 1
```

Exit status 0 when the action was carried out, 1 when nothing fits or it failed, 2 when the
decision model has no key or there are no words. `--dry-run` shows what it would run.

`voice-mode say "<text>"` says the text aloud, word for word, in the configured provider's
voice. Nothing rewrites it: the words are redacted and spoken as they are. With no
conversation running it is one plain text-to-speech call (`ttsModel`; the other provider is
used only when the configured one has no key) played on `audio.output`. While a conversation
is running it is not a second voice: the text goes into the answer queue and the conversation
says it, word for word, in the next quiet moment. `--dry-run` makes the speech and plays
nothing.

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
- PC control, OpenAI Realtime, 3 runs each of a short spoken command (1 to 3 s long), from the
  start of speech to the action being carried out (medians): "Minimize this window please"
  2.15 s, "Pause the music" 2.53 s, "Take a screenshot" 2.65 s, "Switch to Chrome" 2.73 s,
  "Turn the volume down a little" 2.99 s, "Lock my screen" 3.18 s (waits for the end of the
  sentence), "Type hello from voice mode" 4.40 s, "Make a note: buy milk and eggs tomorrow"
  4.49 s, "Search the web for cheap flights to Rome in October" 5.59 s. The right action was
  taken in all 27 runs. Window, media, volume and screenshot commands are decided on a
  partial transcript; with sentences this short that is just after you stop, and on a longer
  sentence it is while you are still talking. Notes, searches and typing wait for the end of
  the sentence, then take about 0.4 s more to pick the words.
- Hand-off, OpenAI Realtime, with a stand-in for the assistant that answered 1.0 s after
  each note arrived: from the end of the question to the first sound of the answer, 4.72 s
  median (4.08 to 5.46, 8 runs). That is about 1.5 s to "Let me check", the stand-in's 1.1 s,
  the wait for a quiet moment after the acknowledgement, and 0.65 s median from queuing the
  answer to hearing it. Your real assistant's own time to answer comes on top. A reply that
  only promised to check was handed off by the safety net in both runs where that happened.
  In 4 of 13 hand-offs the provider returned a failed reply for the answer; answers are now
  kept and tried again until heard.
- Records first, Gemini Live, five spoken questions (the newest notes, where a piece of work
  lives, the version a design note gives, the configured voice, a project's stage), measured
  on 2026-09-26. With the earlier rules and a 23,000-character briefing, one question was
  handed off and two answered from the model's own memory, one of them with an outdated
  version. With records first and a 167,000-character briefing (about 43,000 tokens), none
  was handed off: the two questions that needed records read them (`list_records` then
  `read_record` three times; `search_records`), and the other three came from the briefing.
  First audio: 1.7 to 2.4 s from the briefing, 2.4 to 6.4 s after a chain of record reads.
- Hand-off while talking, Gemini Live, with a stand-in for the assistant that answered after
  55 s: "Let me check" at once, "still coming" said once at 20 s, the answer heard 0.69 s
  after it arrived (58.5 s from the end of the question), and the conversation held open past
  its idle limit until then. `voice-mode say` during that conversation was spoken word for
  word 0.73 s after it was queued; outside a conversation, `gemini-3.8-flash-lite-tts` took
  2.3 to 3.1 s to return the speech.
- `voice-mode do`: about 0.65 to 0.73 s from the request to the action carried out (one
  decision call and the shortcut).
- Launching itself (`kstart`, `gtk-launch`, `xdg-open`, `open`) takes about 10 ms to hand
  off. The window appears when the app has started, which the numbers above do not include.
- Not included: your microphone and speaker buffers (about 20 and 40 ms as configured).

## Checking it without talking

- `logs/decisions.log` has one line per decision-model call: what it chose (or `nothing to
  open`), how sure it was, how long the call took, and how far into the sentence it was; a
  failed call gives its reason (for example a connect timeout). The words heard are added
  only when `logTranscripts` is on. `tail -f` it while you talk to watch the decisions arrive.
- `voice-mode check` lists the config, which keys are set (never their values), audio tools,
  sources, the queue command and its reply command, the briefing's size and the action catalog.
- `voice-mode briefing` prints the briefing exactly as the model gets it, redacted.
- `voice-mode pick "open my documents folder"` shows what the decision model would open, word
  by word, without opening anything.
- `voice-mode bench` with `"provider": "fake"` runs the whole pipeline with no network, and
  `test/voice-mode.test.mjs` covers the read boundary, the queue, the action refusals, the
  chooser, barge-in, both provider adapters, the one-conversation lock, the orb's routes,
  every PC-control action's exact command, the redactor, the briefing's parts and cleaning,
  the hand-off round trip with its reply queue, a conversation staying open for an answer,
  `do` and `say`, and browser control: the choices built from an invented page, each pick's
  exact protocol calls, a held button pressed only after a later plain yes to a question that
  named it, and refused secret fields.
