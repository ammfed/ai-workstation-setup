# Video workflow

A working method for making any video with AI agents for one owner: a film edited from footage, a motion graphics piece, an explainer, a talking-head video, a fully generated video, or a mix of these. AI generation (pictures, shots, voices, presenters, music) is an option at the stages where it fits. It is never required.

These rules come from a first film made this way, widened to every kind of video. The film reached a final cut the owner approved, but about half of the work was wasted along the way. Each rule below fixes one cause of that waste, or one risk that AI generation adds.

This file extends the workflow playbook. The playbook's phases, gates, review pages, research and wording rules still apply. This file says what is different for video.

- The owner is the person who decides. Agents and workers do the rest.
- Reviewers are the other people whose word counts: a client, an event lead, a colleague, a subject-matter expert.
- Tools named in this file are examples. Check any tool live on the day before relying on it (playbook rule 3.10).
- Each rule has a "Why" line. Keep the reason in mind when a case does not fit the words.
- Plans for the owner show the order of the stages, never days, hours or estimates.

## The stages

The stages follow the four parts of established video production: pre-production, production, post-production and delivery.

| Part | Stage | What it makes | Playbook phase | The owner's review point | AI generation option |
| --- | --- | --- | --- | --- | --- |
| Pre-production | 1. Brief and delivery facts | One brief: where it plays, the kind of video, the rules, the generation stance and limit | 1 Capture, 2 Requirements | Answers the brief cards | No |
| | 2. Gather and watch | An inventory of every source, a fact sheet, the gaps | 2 Requirements, 3 Does it already exist | Sees the inventory with the script | No. Transcription and frame notes help the watching |
| | 3. Script | The words: voice, on-screen text, captions, or talking points | 5 Prototype | Signs off the script with the storyboard | Yes: a language model drafts lines |
| | 4. Concepts and storyboard | Two or three concepts, then a storyboard with a source for every beat | 5 Prototype | Picks a concept, signs off the storyboard | Yes: generated frames where no real frame exists |
| | 5. Look and sound direction | A one-page direction: type, colour, motion, music, sound | 5 Prototype | Sees it with the first cut | Yes: generated style frames and music candidates |
| | 6. Media plan and tests | Each beat's source: shoot, existing, draw or generate, with a test of each generated kind | 6 Breakdown | Approves what is generated, the tests and the spend | A short test of each generated kind. This is where generation is decided |
| Production | 7. Make the media | Shot, recorded, captured, drawn and generated pieces, each in a media ledger | 7 Build | None, unless a test fails | Yes: shots, presenters, voices, music, pictures |
| Post-production | 8. First full cut | A watchable video from one editable source | 7 Build | Watches it and gives feedback | Yes: a generated guide voice and captions from transcription |
| | 9. Feedback rounds | One frozen version per round | 8 Review | Watches each version | Yes: regenerate a piece for a named fault, once |
| | 10. Voice and sound | The final voice, music, sound effects and mix | 8 Review | Picks a voice by ear | Yes: a generated voice-over or music |
| | 11. Finishing passes | Clean picture, checked figures, captions, labels for generated media | 8 Review | Gets the sign-offs from the content and figure owners | Yes: clean plates (footage with an unwanted object removed). Transcription checks the voice |
| Delivery | 12. Delivery and hand-off | The file that plays, checked end to end, a run sheet, the close-out | 9 Ship and hand over, 10 Improve | Says "final" | No |

Under a short deadline, the owner signs off only the brief, the script with the storyboard, and the media plan, and then the first cut carries the open options. Stages 10 and 11 can run side by side once the picture is liked, because each touches a different layer.

## Which stages a video needs

Pick by the kind of work, never by a guess of how long it takes. A video that mixes kinds runs the stages of each kind.

| Kind of video | Stages it runs | Where generation usually fits | Test |
| --- | --- | --- | --- |
| Edited from footage (a recap, a promo, an event film) | 1 to 5, 8 to 12. 6 and 7 only to fill a gap | A gap shot or a clean plate. A voice-over | The story is carried by footage that already exists |
| Motion graphics (titles, data, an animated logo) | 1 to 5, 8, 9, 11, 12. 6, 7 and 10 when it has generated pieces or a voice | Backgrounds, textures, music | Everything on screen is drawn or animated |
| Explainer or tutorial | All twelve | A voice-over, illustrations, a presenter | It teaches one idea in a set order, usually voice-led |
| Talking-head video (a real person on camera) | All twelve. Stage 4 is a shot list | Clean-up of the sound, captions. A presenter avatar only with the person's written consent | A named person speaks to camera |
| Fully generated | All twelve. 6 and 7 carry most of the work | Every picture, shot, voice and track | Nothing is filmed or drawn by hand |
| A small change to a finished video (a trim, a caption, a figure) | 1, 9, 11, 12 | A regenerated piece for a named fault | The video is already approved |

## 1. Brief and delivery facts

1. **Ask how the video plays before anything is made.**
   - Ask where it plays (a hall screen, a website, a phone feed, a meeting), at what size and shape, with or without sound, with burned-in captions or a caption file.
   - Ask its length, the audience, and what plays right before and after it.
   - Ask which single file plays. Make that one first, and only that one, until the owner asks for more.

   Why: a video made in five variants and three screen shapes costs hours of rendering, and only one file plays.
2. **Name the kind of video and the stages it runs.**
   - Pick the kind from the table above and write the stages it runs into the map (playbook rule 2.4).

   Why: a talking-head video and a fully generated one need different stages, and a stage nobody needs costs a round.
3. **Set the generation stance and the spend limit once.**
   - Ask whether AI generation is welcome in this video, and for what: pictures, shots, voices, presenters, music.
   - Ask for a spend limit for paid generation. Money is the owner's call.
   - Ask whether generated people may appear, and how generated media is labelled.

   Why: a generation choice made mid-build stalls the build, and a spend the owner did not set takes the decision from them.
4. **Fix the tool set once.**
   - Name the tools for the cut, the motion, the voice and each kind of generation, each checked live that day.
   - A tool the owner has not bought or approved stays a card, never a step in the plan.
   - When the owner changes the tool set, drop the old tool from every plan and brief at once.

   Why: a plan built around an unapproved tool is rewritten when the owner says no, and a tool left in an old brief comes back.
5. **Set the data rule.**
   - Say what may leave the machine. Usually that is the final voice script and generic prompts for generated pictures.
   - Footage, photos, recordings, documents and figures stay local, unless the owner grants a named, written exception.
   - A photo or a voice sent as a reference for generation leaves the machine too. It needs the same exception.
   - Load any key from its environment variable inside the command that uses it. Never print, log or copy it.

   Why: a data question asked mid-build stalls the build, and a file or a key that leaves once cannot be called back.
6. **Name the reviewers, their channels and who signs off.**
   - List every reviewer, what they can decide, and where their words arrive: a call recording, a brief, a message.
   - Name who signs off the content, the figures, and the language of the script.
   - Read each recording and brief in full, and keep the transcript beside the work.
   - Start one acceptance list now (see "Fixed items").

   Why: a reviewer whose words were never read comes back late with a change that undoes a round.

## 2. Gather and watch

1. **Get the brand kit and the client's own material first.**
   - Ask for the brand guidelines, the logo files, the fonts and any rule for this event or channel.
   - Treat the client's own documents (a data deck, a report, a list of achievements) as primary content.
   - Keep a list of each item the client listed and where it appears in the video. An item left out is a choice the owner sees and approves.

   Why: visual work done before the kit arrives is redone, and a video that skips what the client listed reads as if they were ignored.
2. **Watch every source before any idea.**
   - Pull frames from every clip and photo locally and lay them out as a grid of small frames. Transcribe every recording locally.
   - For each source, write what it shows, its quality, the people in it, any burned-in text or logo, its licence, and which part of the story it can carry.
   - List the gaps: parts of the story with no source. A gap is filled later by a shoot, a drawing or a generated piece (stage 6), never by a guess now.

   Why: concepts drawn before the material is known are rejected once the owner sees what the material can carry.
3. **Wait for the material that is promised.**
   - When reviewers promise more footage soon, list what is here, then wait for the rest before concepts.
   - Fill a real gap from the client's own public channels first, and list each candidate with its link before downloading anything.

   Why: a concept round on thin material is a round the owner throws away.
4. **Write one fact sheet.**
   - Put every fact in one file, each with its source file and page.
   - Add a conflicts table where sources disagree, with the one the video uses and why.

   Why: the script, the figures and the captions all draw from one sheet, so a correction happens once.

## 3. Script

1. **Write the words before the picture.**
   - The script sets the order of the story and the length of each part.
   - For a talking-head video, write talking points or a prompter script in the speaker's own way of speaking.
   - Write in the target language as a native speaker in that role would say it, never as a translation.
   - Keep lines short. One idea per line.
   - A language model may draft or rewrite lines. The person named in the brief checks the language before any voice is made.

   Why: a picture built before the words is re-cut when the words change, and a literal script reads as robotic in every voice.
2. **Split each beat into voice, on-screen text and captions.**
   - For each beat, say what is heard, what the screen shows as text, and what the captions carry.
   - Keep figures on screen only, unless the owner asks for them in the voice.

   Why: a figure that changes late then needs one edit and one render, not a new recording.
3. **Set the order and the weight.**
   - Use the order the brief asks for. For a recap of events, use time order with the newest last, unless the owner says otherwise.
   - When the owner asks for more weight on a subject, measure its screen time in seconds.

   Why: a clear order is easy to follow and check, and seconds settle "more weight" without argument.

## 4. Concepts and storyboard

1. **Offer concepts on real material.**
   - Offer two or three concepts that are different videos, not variations. Each has a one-line summary, its opening and closing beats, and the material that carries it.
   - Show each on real frames from the inventory. Where a beat has no real frame, a generated frame may stand in, marked as a stand-in.
   - Recommend one, with the reason.

   Why: the owner judges a concept by the material it uses, and a generated frame that looks final can be mistaken for real material.
2. **Storyboard every beat with its source.**
   - Draw each beat with its frame, its words and its source: existing footage, a new shoot, a screen capture, a motion graphic, a generated picture, a generated shot, a presenter.
   - Get the owner's sign-off on the storyboard before the build.

   Why: the finished video is then never a surprise, and the storyboard is the media plan's input.
3. **Share one visual language between pieces of the same show.**
   - When the video sits in a show with other pieces, use one motif, one palette and one type set across them, written in one note.

   Why: pieces built apart look like they come from different shows.

## 5. Look and sound direction

1. **Study references, then write a one-page direction.**
   - Before the first build, look at strong current references for this kind of video and the motion presets the tools offer.
   - Write one page: the type and its scale, the palette and where each colour goes, the motion language, the few transitions and when each is used, the backgrounds, the music and the sound effects.
   - Generated style frames and music candidates may show the direction. Real brand material comes first.
   - Run this pass on the strongest model at high effort.

   Why: a video built without a direction comes out generic, and "generic" was the owner's first complaint.
2. **Use the brand's own files.**
   - Load the brand fonts from the kit and confirm they render. A missing font falls back silently.
   - Use colours from the brand guidelines, each for its named role.

   Why: a fallback font passes every automatic check and still looks wrong to the owner.
3. **Choose sound for the room.**
   - Keep music under the voice, with the cultural colour the owner asks for.
   - Note the source and licence of every track, generated or not. A track with an unknown licence is flagged before any publication.
   - At a live event, use no blasts, impacts or alarming sounds.
   - Loop a track only on a beat and a phrase boundary, and send the owner the join to hear.

   Why: a loud hit in a hall can alarm people, and a licence found late can stop a publication.

## 6. Media plan and tests

1. **Pick a source for every beat.**
   - For each beat of the storyboard, pick one: existing material, a new shoot or recording, a screen capture, a drawn motion graphic, or a generated piece.
   - Prefer real material for real people, places, products and events. Generate only what has no real source, or what the brief asks to generate.
   - Write the plan as a table: the beat, the source, the tool, the prompt or the shot notes, and the cost where there is one.

   Why: a real thing shown from a generated picture is wrong in small ways that the people who know it see at once.
2. **Test each generated kind before the full run.**
   - Make one short test of each kind the plan uses: a shot, a presenter, a voice, a track.
   - Test the hard cases: a name, a figure, a face over several shots, a brand colour.
   - Show the tests to the owner with the plan. The full run starts after the owner approves the plan and the spend.

   Why: a full run of a kind that fails the test wastes the spend and a round.
3. **Get consent for any real person's likeness or voice.**
   - A presenter avatar or a cloned voice of a real person needs that person's written consent, kept beside the work.
   - By default, the only generated person is a real person's avatar made with their written consent, and labelled. A brief may change this for one video.

   Why: a likeness used without consent harms the person and the owner, and cannot be called back once shown.

## 7. Make the media

1. **Record each shoot and recording against a checklist.**
   - For a shoot: framing for the delivery shape, light on the face, clean sound with a separate microphone, a take of the room's own sound, and the release forms for people on camera.
   - For a screen capture: the real product, clean data, the delivery size.

   Why: a fault in a recording is fixed only by recording again.
2. **Keep one media ledger.**
   - Every piece gets one line: the file, its source (shot, existing, drawn or generated), its licence, and for a generated piece the tool, the model, the prompt and the files it was made from.
   - Every file lives locally in the project. The render never fetches from the web.

   Why: a piece with no record cannot be licensed, labelled or made again.
3. **Generate clean pieces.**
   - Generated pictures and shots carry no words or logos. Draw all words in the editor.
   - Keep a face, a product or a place the same across shots: use the same reference picture, or start each shot from the last frame of the one before.
   - Make a piece again only for a fault you can name, once. Then ask the owner.
   - Stay under the owner's spend limit. When a step does not fit, say so and ask before dropping or shrinking it.

   Why: generated text comes out misspelled, a face that changes between shots breaks the story, and retries without a named fault spend money without a plan.

## 8. First full cut

1. **Build from one editable source.**
   - Keep every on-screen word, figure, position and timing in one data file, and build the picture from it with one command.
   - Changes made by dragging in a visual editor are lost at the next build. Make lasting changes in the data file.
   - Write a short "how to change a word or a number" note beside it.

   Why: a confirmed change is then one edit and one render, and anyone can make it.
2. **Use a guide voice, not the final one.**
   - Cut the picture to a generated or recorded guide voice. Make the final voice only after the owner likes the picture.

   Why: a final voice made before the picture is liked is made again when the picture changes.
3. **Check placement on a rendered still of every scene.**
   - Keep text and key visuals inside the safe margins of the real screen.
   - No overlaps. Captions never cover faces or key footage. One clear focal point.
   - Check that right-to-left text reads the right way and no word is cut off or half drawn in any fade.
   - Look at the still yourself before calling a scene done.

   Why: a placement fault seen on the real screen cannot be fixed then.
4. **Show the owner only what the audience sees.**
   - A preview for the owner shows the audience's view, full frame.
   - Label a test capture, such as a side-by-side sync check, as a test, and keep it out of the owner's way.
   - Run a live preview page only when the owner asks, keep it on the newest version, and close it when that version is replaced.

   Why: a test capture sent as a preview confuses the owner, and an old preview shows a version that is no longer true.

## 9. Feedback rounds

1. **Freeze, then branch.**
   - Before any change, freeze the current version read-only.
   - Each round gets a new version, branched from the version it changes. Never overwrite an earlier one.
   - Keep one index that shows which version came from which, whose feedback, and what changed.
   - When the owner edits the video themselves, bring their edits in first, before any other change.

   Why: the owner can always go back to the version they liked, and a round that starts from a stale copy undoes their edits.
2. **Report each round point by point.**
   - List each point from the acceptance list that the round covered, what changed, and a before-and-after still.
   - Before the report goes out, a fresh check compares the round's points with the result and names any point that was dropped.

   Why: the owner checks a round in minutes, and a dropped point is found before the owner finds it.
3. **Change only what the round asked for.**
   - Keep what the owner said they love. Name it in the round's brief as fixed.
   - When the owner says to leave a known fault, leave it and note it.

   Why: a round that reworks a liked part loses the version the owner chose.
4. **Name delivered files by date and hour.**
   - Save each delivered cut with a plain name holding the date and the hour, beside its script. Never overwrite a delivered file.

   Why: the owner and the reviewers can say which cut they mean.

## 10. Voice and sound

1. **Check the script's language before any voice.**
   - The person named in the brief reads the script.
   - Add the vowel marks or stress from the meaning of each sentence, not word by word. Fix the grammar in context.
   - Respell names, foreign terms and numbers the way they are spoken.

   Why: every voice, generated or human, misreads an unmarked or literal script, and each misread costs a round.
2. **Sample short, then pick from whole videos.**
   - Make two or three short samples of the same few lines, including a hard name and a number, each a clearly different voice or delivery, with a plain label.
   - Use the voice tool's own controls for emotion and delivery.
   - When the owner compares voices in context, render the whole video once per voice, reusing the same picture.
   - Make the full voice-over only after the owner says a sample sounds right.

   Why: a short sample settles the voice cheaply, and the owner judges best in the whole video.
3. **Check the read by ear and by transcription.**
   - Transcribe each line back locally and compare it with the script word by word. List every word that differs.
   - Say that a transcriber can mishear too. The owner's ear is final.
   - Send a short sample of fixed lines before a full render.

   Why: a word heard wrong is the fault people remember.
4. **Fit the picture to the voice.**
   - After every new voice take, measure every voice file again. Never reuse old lengths.
   - Stretch or trim the picture to fit the voice. Do not insert silences into the voice.
   - Check that every line plays to its end and its caption shows whole.

   Why: a stale list of lengths cut the end off a sentence that the owner then had to find.
5. **Mix for where it plays.**
   - Lower the music under the voice. Measure the loudness of the final mix against the target for where it plays, such as a broadcast or streaming loudness standard.

   Why: a mix that is right on headphones can be too quiet or too loud in a hall or on a phone.

## 11. Finishing passes

1. **Check every shot from its first frame to its last.**
   - Fix a shot that starts or ends on the wrong moment, and a wrong crop.
   - Remove titles, name bars and labels burned into your own footage. A watermark on someone else's footage means a licence is missing: get the licence or replace the shot.
   - Show a software screen whole, with nothing cut off.
   - Remove any person the owner names, everywhere they appear, and check again after every re-cut.
   - In generated pieces, look for warped hands, faces, text and logos, and for a face or product that changes between shots.

   Why: a check in the middle of a shot misses the bad start and end the owner sees at once.
2. **Trace every figure to a file.**
   - Keep a table: the figure, its words on screen, the source file, the page, the date and its status.
   - Never show a worked-out figure as final. Ask, or leave it out.
   - Make the build stop when a figure on screen has no source.
   - The figure owner signs off. Remove a "to be confirmed" tag only on the owner's word.

   Why: one wrong figure undoes the video, and a check that stops the build cannot be skipped.
3. **Caption for everyone.**
   - Make captions from the final voice, checked against the script, timed to the speech, and placed clear of faces.
   - Deliver them burned in or as a caption file, as the brief says.

   Why: many people watch without sound, and captions are an access need for people who cannot hear.
4. **Label generated media.**
   - Mark what was generated in the media ledger and in the credits or description, as the brief and the platform require.
   - Keep any content credentials the generation tool adds, and do not strip them on export.

   Why: an audience that later finds an unlabelled generated person or scene stops trusting the whole video.

## 12. Delivery and hand-off

1. **Check the delivered file itself.**
   - Play the final file from start to end, with sound, at the playback size, on the real player or platform. Check its length and its loudness.
   - Make one backup file. Make other sizes only when the owner asks.

   Why: a render warning or a stalled render can leave a gap that only playing the file shows.
2. **When the video plays at a live event, rehearse it.**
   - Make the main route the simplest one the operator already knows, such as a slide and a clicker. Keep a device route and a no-device fallback as backups.
   - Make the first and last frames match the pieces around the video, with one hand-off frame for every join.
   - Write a short run sheet: which file, when, and what to do if it fails. Rehearse on the real screen.

   Why: an untested device fails in the room, and a jump between two pieces on one screen looks like a fault.
3. **Close out.**
   - When the owner says final, record it, stop the workers and the previews, and keep the final version with the versions and sources it was built from.
   - Write down the method lessons of this video for the next one (playbook section 9).

   Why: a finished video with workers and previews still running costs quota and confuses the next round.

## Fixed items for every video

These run through every stage. Add them to the map at the brief.

| Item | What it is | Why |
| --- | --- | --- |
| One acceptance list | Every ask from the owner and every reviewer, in their words, with its source and date. The newest ask wins. Replaced asks are marked, not deleted. Every round is checked against the whole list | A note passed on by memory gets dropped, and the owner then sees the same fault twice |
| The media ledger | One line per piece: source, licence, and for a generated piece the tool, model and prompt | A piece with no record cannot be licensed, labelled or made again |
| The spend record | Paid generation so far against the owner's limit | Money is the owner's call, and a limit nobody tracks is passed silently |
| The version index | Every frozen version, where it came from, and what changed | The owner can go back to the version they liked |
| Consent records | Written consent for every real person's likeness or voice used to generate | A likeness used without consent cannot be called back |

## Traps

| Trap | What it cost | The rule that prevents it |
| --- | --- | --- |
| Concepts before the material arrived | A full concept round thrown away | 2.2, 2.3 |
| Long decision pages before anything was watchable | Pages the owner never answered | 1.1, the deadline note under "The stages" |
| A reviewer's note dropped along the way | An extra version | The acceptance list, 9.2 |
| The client's own data left out of the first cut | A round, and the owner's trust | 2.1 |
| Every variant rendered for every version | Hours of render time | 1.1, 12.1 |
| A plan built around a tool that was then dropped | Rewritten plans | 1.4 |
| A live trigger built from a misunderstood description | A whole version thrown away | 12.2 |
| A test capture sent as a preview | A confused owner | 8.4 |
| Voice samples from an unmarked, literal script | Many sample rounds | 3.1, 10.1 |
| Old voice lengths reused after a re-voice | A sentence cut off in the final cut | 10.4 |
| A shot checked only in its middle | Wrong starts, ends and burned-in text left in | 11.1 |
| A brand font that silently fell back | A wrong look in the first cut | 5.2 |
| A full generation run before a test | Spend and a round on a kind that fails | 6.2 |
| Words inside a generated picture | Misspelled text on screen | 7.3 |
| A real person's face or voice generated without consent | Harm that cannot be undone | 6.3 |
| A generated piece with no record | A piece that cannot be labelled or made again | 7.2 |
