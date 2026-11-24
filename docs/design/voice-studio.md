# Incanterm Voice Studio

[Presentation and audio](presentation-and-audio.md)

**Status: proposed implementation plan.**

A writer requests voice for selected dialogue in the Script Writer. An actor records
and compares takes in the browser. When a requested line changes, the editor keeps every
take, shows the old and new wording, and queues a pickup. Text-only dialogue does not
generate recording or pickup warnings. Only requested audio approved for the current
wording ships.

Deliver recording and pickup tracking first. Add publishing, game playback, and export
validation in a second milestone. The pilot does not require a spreadsheet, desktop
audio editor, or hosted recording service.

## Milestone 1: Record and track takes in the editor

### 1. Make voice opt-in and give requested lines a permanent ID

Extend `playDialogue` in `src/game/scene-commands.ts` with an optional fourth argument
for the stable line ID and an optional fifth argument, `"no-voice"`, to turn off a
request without dropping that ID. Keep the existing two- and three-argument forms and
dialogue shorthand working. Dialogue without a voice ID is text-only by default.

```rpgscript
+playDialogue(Tess, "Wait by the lifts.", "", "v_tess_hallway_warning")
+playDialogue(Tess, "See you around.", "", "v_tess_hallway_farewell", "no-voice")
```

- Add **Request voice** and **No voice requested** to `src/editor/client/scripts/scripts.ts`.
  Requesting voice assigns a project-unique ID on first use or reuses the existing ID.
  Turning it off keeps the ID and all take history; on a line that never had an ID,
  there's nothing to rewrite. Persist these choices through the existing safe-save
  flow. Start with plain, single-line dialogue with a literal speaker and text. If a
  line can't be rewritten without changing its meaning, explain why and leave the draft
  alone.
- Build the voice catalog from **saved RPGScript** with the existing parser. Include the
  script location and nearby dialogue for context. Show parse errors without treating
  lines in an unreadable script as deleted.
- Compute a deterministic revision from the parsed speaker and spoken text, not from the
  source line. Moving a line, changing its indentation, or changing its portrait emotion
  does not invalidate takes. Turning a voice request on or off does not change the
  revision either. Changing the speaker or spoken text does. When a request is turned
  back on, compare saved takes and approvals to the current revision before deciding
  whether a pickup is needed. Flag duplicate IDs with both source locations; disable
  recording and publishing for those IDs instead of guessing which line owns the audio.

### 2. Save each take separately

Add a project-scoped voice API through `src/editor/projects.ts`. Keep the editor
loopback-only and use its existing same-origin request checks. Store originals and their
metadata in a project-owned `voice-work/` directory outside the configured assets root.
Do not store the only copy in the browser or expose recording uploads on the game server.

Each take stores a server-generated take ID, line ID, recorded revision, speaker and text
snapshot, audio format, and creation time. Bind the take to the revision the actor sees
when recording starts. If the script changes before upload finishes, **save the take
against the original revision**. Never replace or relabel an original recording. Enforce
an upload limit, generate storage paths on the server, and make retries safe so they
don't create duplicate takes.

### 3. Add the Voice Studio page

Register `/voice` alongside the Soundboard in `src/editor/client/main.ts`. Use
`getUserMedia` and `MediaRecorder`, negotiate a supported format, and target Chrome and
Edge on the local editor for the pilot. Show microphone and upload errors, keep failed
uploads available for retry while the page is open, and release the microphone when
leaving the page.

Reuse the existing editor UI before adding new components or styles. Use the shared
page shell and navigation in `src/editor/client/shell.ts`, the button, toolbar, list,
and theme styles in `src/editor/client/style.css`, and the dialogs in
`src/editor/client/modal.ts`. Use the Script Writer and Soundboard as references for
layout and playback controls. Add Voice Studio-specific styles only where existing
patterns don't fit, such as the microphone meter or the before/after text comparison.

Show the current line, script location, and context, with **Record, Stop, Listen,
Retake, Favorite, and Next**. Save each completed take before moving on. A favorite is
not an approval. Show only requested lines in the recording and pickup queues. Offer
a separate filter for unrequested lines with take history; omit them from coverage
counts and never warn about missing or stale audio for them.

| State | What the editor shows |
| --- | --- |
| **Needs recording** | Requested line with no takes. |
| **Needs review** | A take exists for the current revision, but none is approved for it. |
| **Needs pickup** | Takes exist only for earlier wording. Show old and new text together and let the user listen to older takes. |
| **Approved** | A reviewer selected an exact take for the current revision. Reusing an older take requires explicit confirmation and does not change its recorded revision. |
| **No voice requested** | Text-only. No recording or pickup warning, even when the line changes; any previous takes remain available in history. |
| **Archived** | The ID is no longer in saved scripts. Keep every take; restoring the ID brings back its history. |

### 4. Add optional room-tone noise reduction

Build this after basic recording and take playback work. Cleanup is optional and off by
default. It must not add processing to the live recording path or require a desktop editor.

1. **Capture room tone.** Add a button that records 3–5 seconds of quiet with the same
   mic, position, and gain used for the dialogue. Request that browser auto-gain, noise
   suppression, and echo cancellation be disabled; show the actual settings when the
   browser reports them. Save the sample with the recording session under `voice-work/`.
   Ask for a fresh sample after a mic, gain, or room change, without changing profiles
   already attached to earlier takes.
2. **Learn the noise profile and clean the take in the browser.** Decode the sample and
   take to PCM at the same sample rate. In a Web Worker, estimate the typical noise
   power per frequency bin from overlapping FFT windows of room tone. Apply a smooth
   gain reduction where the take is close to that baseline, then reconstruct the audio
   with overlap-add. Do not subtract the room-tone waveform from the take. Start with
   a **Light** preset that caps attenuation at about 6 dB.
3. **Preview before committing.** Provide an **Original / Cleaned** switch with
   speech levels matched for comparison only. Let reviewers leave cleanup off if word
   endings or soft consonants start sounding unnatural. Save the profile ID, strength,
   and algorithm version as settings on the take; never overwrite the original.
   Apply cleanup before final clip gain. Use pickups for noises that overlap words,
   such as a door slam or another voice; the room profile is for steady background noise.

**Recording acceptance test:** Record three takes. Start a fourth in one tab, then
rewrite the line in another tab before stopping. Reopen the project. All four takes
must be playable under the original wording, and the current line must show
**Needs pickup**. Moving a line to another script without changing its words must not
trigger a pickup.

**Voice request acceptance test (including Milestone 2):** Add a text-only line.
Turn off a voiced line with existing takes, then edit its wording. Neither line
should appear in the recording or pickup queue, warn about audio, play a clip, or
block export. Export must omit the old clip. Request voice again on the edited line:
it should show **Needs pickup** with its previous takes attached.

**Cleanup acceptance test:** Capture room tone with a fan running, then record a quiet
line with the same setup. In a level-matched comparison, the fan should recede without
damaging the words. Reopen the project and verify that the profile and settings persist,
the original still plays unchanged, and cleanup can be turned off.

## Milestone 2: Publish, play, and package

1. **Publish the approved take.** Allow publishing only for requested lines. Tie approval
   to the line revision, take, and edit settings. Use the same browser processing for
   preview and publish; for an edited take, send a bounded PCM WAV render to the local
   editor API. Use a fixed FFmpeg preset to encode the approved audio to MP3. FFmpeg
   is an editor-side publishing dependency, not a requirement for cleanup previews
   or deployment. Write the clip under
   `assets/audio/voice/` and a versioned runtime index containing its line ID, approved
   revision, file, and checksum. Keep room-tone samples, alternate takes, and recording
   metadata out of the runtime index and the release.
2. **Wire up game playback.** Trigger voice from the dialogue lifecycle in
   `src/server/game-session.ts`, not `paint()`. Use voice start/stop messages in
   `src/protocol/messages.ts`; serve approved clips from the selected project and play
   them in `src/browser/main.ts`. Do not emit a voice cue for unrequested lines, even
   if an old published clip exists. Verify URLs in Vite dev, the editor's game preview,
   and the exported server. Play one voice clip at a time. Revealing the rest of the
   text does not stop playback; advancing the line, closing the conversation, or
   leaving the scene does. Ignore late audio loads after a skip. Add a voice toggle.
   Missing audio, autoplay restrictions, mute, and silent clients must never block
   dialogue.
3. **Validate releases.** In `src/export/export-game.ts`, compare the saved dialogue
   catalog against the published index. Reject duplicate IDs and requested lines with
   missing, stale, or mismatched audio, reporting the script location. Do not check
   voice coverage for unrequested lines. Exclude the voice subfolder from the generic
   audio copy and export only validated clips for requested lines, with a matching
   filtered index. Keep existing non-voice audio behavior unchanged. Development
   playback should fall back to text for unfinished voice work.

## Verification and pilot

- Use synthetic clips and test-owned projects in `__tests__/`. Cover ID stability,
  duplicate and archived lines, changes during recording, upload retries, rapid advance,
  and export excluding originals, room-tone samples, and alternate takes. Test that
  cleanup reduces a known steady noise signal, bypass preserves the input, and no
  processing changes the original take on disk.
- Run `npm run lint`, `npm run typecheck`, and `npm run test:run`. Manually test the
  page in both editor themes, mic permission, auditioning takes after reopening the
  editor, and the exported game with the editor shut down.
- Pilot with five scratch lines across two characters. Before booking a full session,
  verify that a writer can change one line, an actor can find and record just that
  pickup, and a reviewer can publish it without renaming or moving files.
