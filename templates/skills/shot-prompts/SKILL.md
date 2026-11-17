---
name: shot-prompts
description: Write cinematic prompts for AI video models (Wan, MiniMax H3, Seedance and others). Use when turning a scene or shot description into a video-generation prompt, splitting a scene into generations, or repairing a failed generation.
---

# Shot prompts

Turn a plain description of a shot, plus its reference assets, into a prompt a video model can follow on the first serious attempt. The job is not a beautiful description. The job is a shot the model can understand physically, spatially, cinematically and in time.

Ideas drawn from the community CINEDANCE v4.4.2 Seedance prompt builder, rewritten to suit any video model. The method holds across models. Only the clip limits and inputs change, in the table below.

Write the final prompt in clean, short, visual English. Talk to the user in their language.

## Clip limits by model

Set the shot length and the block length from the model in use. Check the model's page on the day before relying on these (checked 17 Nov 2026).

| Model | One clip | Resolutions | References |
| --- | --- | --- | --- |
| Wan 3.0 | 2 to 30 s | 480p, 720p, 1080p | Reference pictures, first and last frame, optional generated audio |
| MiniMax H3 Max | 5 to 15 s | 480p, 768p | Reference pictures, first and last frame |
| Seedance 2.0 | 4 to 15 s | 480p to 4K | Pictures, video and audio references, first and last frame |

- One shot on screen runs 3 to 4 seconds. A clip longer than one shot holds several shots as timed beats, each with its own camera.
- When a model's minimum clip is longer than the shot, generate the minimum and cut in the edit.
- A block of acting never exceeds the model's clip limit. Split it.

## Operating loop

Work in this order every time.

1. **Diagnose the shot.** Take only the current shot. Name the active characters, references, place, props, the first frame, the main action, any dialogue and sound, the camera side and angle, the screen direction, body orientation and gaze, contact points, light sources, and the final frame or cut point. Drop everything from earlier scenes: old tags, old characters, scene numbers, any object not seen or heard in this shot.
2. **Run the feasibility veto.** Decide whether the shot can work as asked. When the ask conflicts (an ultra-wide frame and tiny facial acting; many readable objects, exact dialogue and complex blocking in one wide shot; a long lens in a room with no distance), keep the core intent and change the least important part, or split into two generations. In a final prompt, write the corrected version without comment.
3. **Choose one job.** One shot has one main idea, one main action, one camera strategy, one feeling. Pick its job: acting beat, geography, impact, suspense, atmosphere, object detail, motion or chase, transformation, dialogue coverage, final hook, or a requested camera device. The job sets the lens, the framing, the detail and the camera move. Several big events become timed beats or separate generations.
4. **Build the world map.** Before any style: who is where, who faces whom, where the camera stands, which side of the action line it keeps, what is in the foreground, middle and background, which landmarks anchor the space, what is visible in the first frame, what moves and what stays fixed. Write physical relationships first. Add screen positions (0% left to 100% right) only when they help.
5. **Pick the lens from the content** (see Optics).
6. **Write the prompt** in the architecture below, then run the self-check.

## Prompt architecture

```text
SCENE CONTEXT
ACTIVE REFERENCES
LOCATION MAP
FIRST FRAME AND SPATIAL BLOCKING
FORMAT MODE
OPTICS
CAMERA
ACTION TIMING
PHYSICS
LIGHTING
AUDIO
STYLE
QUALITY
POSITIVE CONSTRAINTS
```

- Space comes before style. Camera comes before mood. Dialogue timing comes before voice style.
- Keep subject motion, camera motion, environment motion, acting, optics, light and sound in their own sections.
- Add `OUTPUT SETTINGS` only when the model's interface does not set them.
- Write limits as positive constraints in the relevant section: "Exactly three named characters appear: @CAL, @OLI and @HORACE."

## References

- Name every asset to the model once, plainly: "@CUP is the white enamel cup; @TABLE is the long oak table; this is the harbour."
- Use only references the user supplied. Every tag in the prompt appears in ACTIVE REFERENCES. No stale, unused or invented tags.
- A character reference gets a compact line: identity, current visible state, wardrobe if needed, action-critical details, "100% matches the reference", and what to ignore from the reference.
- A place reference controls geometry, materials, layout, landmarks, atmosphere and practical lights. It does not set the camera, the framing, the story identity, added props or added people. A back alley stays a back alley unless the user names it otherwise.
- A sketch reference (a height chart, a hand-drawn layout) controls size and position. Say so: "Follow @SKETCH for the giant's height: the hero's head reaches his mid-thigh."
- An audio reference (a hummed melody, a track) controls pitch and rhythm when a character sings or moves to music.

## First frame

- Everything that matters is already in the first frame, in its right place. Open on an empty frame only when asked.
- In a multi-shot clip, every beat gets its own first-frame blocking.

```text
First frame: @CAL is foreground-left, his back shoulder cutting into frame; @OLI stands center mid-depth facing screen-left; @HORACE stands right of him, also facing screen-left; the car is parked behind them on the right against the bins.
```

## Blocking

- Define body orientation, gaze, screen direction, the distance between subjects and to landmarks, the camera side, the action line, the depth layer, and contact with floor, wall, object or vehicle.
- Body orientation and gaze are separate: "Oli's torso stays angled toward Cal, but his eyes drop to the cobbles."
- In action, lock the left-right relationship across cuts. In dialogue, keep the eyelines and stay on one side of the line unless a flip is asked for.

## Camera placement

Translate every angle word into a physical placement: camera height, side, distance, aim, roll, and the foreground object or body part that anchors the view.

```text
Camera sits close to the ground beside the alley wall, half a metre over the cobbles, and looks across the lane toward the group. The near edge of the wall fills the foreground.
```

- A Dutch angle is roll only, 8 to 15 degrees for tension. It never changes the camera side.
- Every move has a dramatic job: locked-off for pressure, handheld settle for presence, slow push-in for realization, tracking to follow action, whip for a sudden shift, low for mass, high for exposure.
- When the acting matters, keep the camera calm. When impact matters, let it react without chaos.
- The camera must fit inside the place: check the distance, the lens, the height and the action line.

## Optics

The model reads the lens from what is in the frame, not from a number. Write content that only that field of view would show.

| Look | Diagonal field of view |
| --- | --- |
| 16 mm | about 107° |
| 24 mm | about 84° |
| 35 mm | about 63° |
| 50 mm | about 47° |
| 85 mm | about 29° |
| 135 mm | about 18° |

- Acting and dialogue: 47° to 84°. Use 63° or 47° when eyes and lips matter, 29° to isolate a face.
- Geography and groups: 84° to 107°. In a 107° frame, acting reads through body movement, never tiny facial detail.
- Action: 84° is the safe wide baseline.
- Object detail: a tight frame, or a wide one only with the camera very close.
- Write "84° diagonal field of view, classic wide rectilinear look. Lens locked for the whole shot." Leave film-gear words (lens brands, f-stops, ISO) out unless the user asks for them.

## Camera devices

A named device the user asks for (a crash zoom, a Dutch angle, a whip pan, a dolly zoom, a director's style) is part of the intent. Keep it, and translate it into physical behaviour: placement, height, distance, lens change, move direction, subject size before and after, timing in seconds or on a line, start frame, landing frame, the hold after, and what stays stable.

```text
[Device] appears as [visible effect] at [timing or trigger], moving from [start framing] to [landing framing], while [stable elements] stay controlled.
```

- One major device per short shot. A held device and a timed one may combine ("a 12° Dutch roll held, plus one crash zoom on the punchline").
- Trigger first, move second, a readable held landing third.
- With no device asked for, use the shot's natural coverage.

## Acting

- Give each character a playable state: what they feel, what they want, what they hide, their body rhythm, two to four habits that fit the beat, and what changes during the shot.
- Listeners react to what is said, with motivated small reactions.
- In a wide shot, acting is body-readable: a weight shift, a head drop, a step back, a freeze. Close-ups carry eye, jaw, throat and breath detail.

## Physics

- Write the motion as mechanics, not as an abstract verb: "shoulders hit, suitcases swing, momentum carries them half a step past, planted feet turn", not "they bump into each other".
- Every move has weight, contact, gravity, acceleration and recovery: anticipation, acceleration, impact, follow-through, recoil, settling.
- Cloth and hair lag. Liquids, vehicles and objects behave by their mass.
- Every background person is mid-action in every frame.
- For motion blur, write natural 180-degree shutter cadence: "moving hands, heads and cloth carry natural motion blur during fast movement, while faces and the main action stay readable at the hold points; stable cadence, no ghosting, no duplicated limbs."

## Light, sound, style, quality

- Light: name each source and what it does to faces, eyes, surfaces and depth. Pick it from the scene: motivated window or practical light for interiors, wet bounce and practicals for night streets, backlight and rim for a standoff. Night scenes keep daylight out.
- Sound: dialogue only when the user gives it, with the exact lines and timing, one speaker at a time, no narration, no music unless asked. Otherwise the shot's own sound: footsteps, cloth, rain, engine, breath, silence.
- Style: a compact block: realism level, genre texture, colour relationship, grain, contrast. One reference tradition at most.
- Quality: "Sharp clarity, stable picture, natural colours, readable faces, controlled highlights" for calm shots; "sharp readable impact poses with natural motion blur during fast movement" for action.

## Splitting a scene

- Action and acting go in separate generations: the fight in one, the faces in the next. Stitch them in the edit.
- A long acting moment splits into blocks within the clip limit, each with its own first frame, so each beat has room.
- Make about four takes per prompt and keep the best seconds of each.

## Repairing a failed generation

Keep a working prompt file as the source of truth. After a failed take, name the fault, patch only that section, and run again.

| Fault | Fix |
| --- | --- |
| A gentle contact becomes a hug or a fight | Write the exact mechanics of the contact |
| Background people stare or melt | Make every background person mid-action; use a cast crowd reference |
| Sizes drift between takes | Attach a sketch of the sizes and name the ratio |
| Left and right flip | State the camera side physically, and the world order once in FIRST FRAME and once in POSITIVE CONSTRAINTS |
| The angle is ignored | Rewrite it as height, side, aim, roll and a foreground anchor |
| The lens is ignored | Rewrite the content so only that lens fits |
| Actors freeze | Add motivated listener reactions tied to the lines |
| Motion stutters | Use the 180-degree shutter wording, calm the camera, remove "no blur" |
| A beat feels rushed | Split it into its own generation |

## Self-check before output

1. The shot has one job.
2. The lens matches the content.
3. The camera fits inside the place.
4. The first frame is occupied and right.
5. Every tag is active and needed.
6. Place references control only what they can.
7. Body orientation and gaze are clear.
8. The action line holds where needed.
9. Dialogue is exact and limited.
10. Actors are alive, without random fidgeting.
11. Physics and contact are grounded.
12. Light suits the scene.
13. No stale context remains.
14. A requested camera device is kept.
15. No unrequested device was added.
16. The clip length fits the model in use.

Patch only the section that fails.

The best prompt is not the longest one. It is the one where the model can see at once the shot's job, the first frame, the space, the camera, the lens, the movement, the acting, the light, the sound and the final moment.
