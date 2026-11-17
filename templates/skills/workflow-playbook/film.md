# Generated film workflow

A working method for a cinematic video where every shot is generated: characters, places and action made with image and video models, cut to a voice-over. It is the second video workflow beside `video.md`. Use `video.md` when real footage carries the story and generation fills gaps. Use this file when generation carries the story.

This method comes from a working AI film-maker's practice and a published end-to-end tutorial (Higgsfield, "How to Make a Wedding Love Story Using AI", August 2026). It extends the workflow playbook and `video.md`: their phases, gates, review pages, wording rules, data rule, media ledger, spend record and consent rules still apply. This file says what is different when every shot is generated.

- The owner is the person who decides. Agents and workers do the rest.
- Each rule has a "Why" line. Keep the reason in mind when a case does not fit the words.
- Tools and prices below were checked on 17 Nov 2026. Check them live on the day before relying on them (playbook rule 3.10).
- Plans for the owner show the order of the stages, never days, hours or estimates.

## The stages

| Stage | What it makes | Tool | The owner's review point |
| --- | --- | --- | --- |
| 1. Brief | Length, screen, audience, spend limit, data rule, consent for any real face | None | Answers the brief cards |
| 2. Story and script | The story, then the voice-over script | Claude | Signs off the script |
| 3. Voice-over and shot plan | The voice-over laid under the timeline, each section measured, shots counted | The voice tool | Hears the voice-over, sees the shot plan |
| 4. Asset library | Characters, places and props, designed and named | Claude lists them, the image model designs them | Locks the assets |
| 5. Shot prompts | One prompt per shot or per block | Claude with the `shot-prompts` skill | None. The tests judge the prompts |
| 6. Low-resolution tests | About four takes per prompt at 480p | The video model | Sees the test reel and the cost of the full run |
| 7. High-quality run | The chosen takes made again at full quality | The video model | None, unless a take fails |
| 8. Edit | The best pieces cut under the voice-over, with captions | The editor | Watches the first cut |
| 9. Feedback, finishing and delivery | As in `video.md` stages 9, 11 and 12 | As there | Says "final" |

## The tool set (checked 17 Nov 2026)

Fix the tool set once at the brief (`video.md` rule 1.4). The default set:

| Job | Tool | Why this one |
| --- | --- | --- |
| Story, script, asset list, shot prompts | Claude | Writes the long, structured prompts this method needs |
| Pictures: characters, places, props, sketches | Qwen Image 2.1 Pro (`qwen/qwen-image-2.1-pro` on OpenRouter) | Edits with up to 10 reference pictures, up to 2K, from about $0.046 a picture |
| Video: tests and finals | Wan 3.0 (`alibaba/wan-3.0` on OpenRouter) | 2 to 30 s per clip, 480p to 1080p, first and last frame, reference pictures, from about $0.03 a second |
| Video: the second try for a shot the first model misses | MiniMax H3 Max (`minimax/hailuo-3-max`) | 5 to 15 s, 480p or 768p, $0.05 a second at 480p and $0.08 at 768p |
| Video: an option | Seedance 2.0 (`bytedance/seedance-2.0`) | 4 to 15 s, up to 4K, from about $0.067 a second. The prompt method was first written for it |
| Voice-over | ElevenLabs | The voice tool already in use |
| Edit, captions, titles | HyperFrames, with the motion-designer skill | The editor already in use |

- All the image and video models above run through OpenRouter, so one key covers them. Load the key from its environment variable inside the command that uses it.
- Leave LTX out of this set. The practitioner advised against it.

## 1. Brief

1. **Run `video.md` stage 1, and add the consent question.**
   - Ask whether any real person's face will appear. By default, characters are invented.
   - A real face is used only after the owner asks the person and confirms consent, recorded beside the work (`video.md` rule 6.3). The photo leaves the machine when it is sent as a reference.

   Why: a generated film tempts a real face onto every character, and a photo sent once cannot be called back.

## 2. Story and script

1. **Write the story, then the voice-over script.**
   - Claude drafts the story in beats, then the voice-over script that carries it.
   - Follow `video.md` stage 3 for language, captions and figures.

   Why: every later stage takes its length, its shot count and its asset list from the script.

## 3. Voice-over and shot plan

1. **Start from the voice-over.**
   - Make the voice-over first: a guide voice is enough until the picture is liked (`video.md` rule 8.2).
   - Lay it under the timeline and measure each section in seconds.
   - Without a voice-over, use the target length of each section instead.

   Why: the voice-over decides how long each section runs, and so how many shots it needs.
2. **Count the shots from the seconds.**
   - Each shot runs 3 to 4 seconds. A 20-second section needs five or six shots.
   - Change the camera on every cut: wide, close-up, side, low, over the shoulder.
   - Write the plan as a table: the section, its seconds, each shot's job and its camera.

   Why: short shots with changing angles keep a generated film alive, and a long generated shot shows its faults.

## 4. Asset library

1. **List the assets from the script.**
   - Claude reads the whole script and lists every character, place and prop it needs.
   - Give each asset one name. Use that name in every prompt.
   - Make one folder per scene, with a sub-folder per asset, before generating anything.

   Why: a film runs to hundreds of generations, and an asset with two names drifts into two looks.
2. **Design each asset before any scene.**
   - Characters: a character sheet (front, side, back, a portrait), soft even light.
   - For a consented real face, keep the generated costume and body, erase the head, and put the real photo in its place.
   - Compare one sheet across more than one image model when a detail matters, and keep the best for that asset.

   Why: a scene prompt can only hold a look that already exists as a picture.
3. **Treat the place as most of the quality.**
   - Generate many versions of each place, then pick the one with room for the action, a clean middle, and light that suits the film.
   - Reject a place with clutter where the action happens, or a colour cast that will leak into every shot.
   - When a crowd keeps breaking, generate the place already full of people.

   Why: about 70% of the final quality comes from the place.
4. **Cast background people as extras.**
   - Line up the extras as one group picture and keep it as one asset, the crowd.

   Why: background people made fresh in every shot come out as mush and change face from shot to shot.
5. **Draw what the model gets wrong in space.**
   - When the model will not hold a size (a giant stays three times the hero's height) or a layout (the horse stays off the rails), draw a simple sketch and attach it as a reference.

   Why: a sketch fixes spatial logic that more words cannot.

The owner locks the assets on a review page before any shot prompt is written.

## 5. Shot prompts

1. **Write every prompt with the `shot-prompts` skill.**
   - Describe the shot to Claude in plain words, attach its assets, and name each asset to the model ("object one is a cup, object two is a table").
   - The skill turns that into the full prompt.

   Why: the skill carries the camera, space, physics and timing rules that a hand-written prompt forgets.
2. **Split what one prompt cannot hold.**
   - Action and acting go in separate prompts. Stitch them in the edit.
   - A long acting moment splits into blocks no longer than the video model's clip limit, so each beat has room.

   Why: one prompt that asks for a fight and a face loses both.
3. **Judge prompts by the tests, not by reading.**
   - A full prompt runs to pages. Run it at low resolution and watch the result.

   Why: reading a long prompt does not show whether the motion works, and a test costs little.

## 6. Low-resolution tests

1. **Test at 480p first.**
   - Make about four takes of each prompt at 480p.
   - Watch each take for the motion, the space and the faces.
   - After a failed take, patch only the weak section of the prompt and run it again (the skill's working-prompt rule).
   - Show the owner the test reel and the cost of the full run. The full run starts after the owner approves the spend.

   Why: tests at the lowest resolution find the failures cheaply, before the money goes on quality.
2. **Take the best pieces, not the best take.**
   - Keep the good seconds from each take, and plan to stitch them.

   Why: a perfect long generated take rarely exists, and the edit joins the good parts.

## 7. High-quality run

1. **Make again only the chosen takes, at full quality.**
   - Use the same model, the same prompt and the same references as the test.
   - When the first model cannot make a shot, try the second-try model once, then ask the owner.

   Why: the same model and prompt keep the look the owner approved in the test.

## 8. Edit

1. **Cut the pieces under the voice-over.**
   - Follow the shot plan: 3 to 4 seconds per shot, a new camera on each cut.
   - Draw all words, titles and captions in the editor, never inside a generated picture.
   - Then follow `video.md` stages 8 to 12.

   Why: the voice-over set the plan, and generated text comes out misspelled.

## Traps

| Trap | What it costs | The rule that prevents it |
| --- | --- | --- |
| Shots planned before the voice-over is measured | A re-cut when the voice lands | 3.1 |
| Long generated shots | Faults the audience sees | 3.2 |
| A scene prompt written before its assets exist | Characters and places that change from shot to shot | 4.2 |
| A cluttered or wrongly lit place | Every shot in that place | 4.3 |
| Background people made fresh each shot | A crowd of mush | 4.4 |
| Size or layout described in words only | Batches that ignore it | 4.5 |
| A fight and a face in one prompt | Both come out weak | 5.2 |
| A full-quality run before a test | Spend on takes that fail | 6.1 |
| A prompt set to a clip limit the model does not have | Cut-off or padded shots | `shot-prompts`, the clip limits table |
