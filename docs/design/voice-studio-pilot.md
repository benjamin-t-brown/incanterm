# Voice Studio pilot

Use a disposable editor project, a microphone, and five lines split between two scripts. Start with no voice IDs. Record browser/version, theme, input device, and the result of each gate. Run the recording flow in Chrome and Edge. FFmpeg is needed on the editor machine for the publishing gate.

For a repeatable browser check with synthetic microphone input, run
`node --import tsx scripts/smoke/voice-studio.mjs` from the repository root.
It uses temporary browser profiles and disposable projects. Use the manual
steps below to evaluate speech quality on the intended recording setup.

| Speaker | Text | Purpose |
| --- | --- | --- |
| Tess | Wait by the lifts. | Four-take pickup and release |
| Tess | Meet me upstairs. | Move between scripts |
| Ren | I can hear the fan. | Room-tone comparison |
| Ren | I'll take the stairs. | Disable and restore |
| Tess | See you there. | Text-only control |

1. **Request and record.** Request voice for the first four lines in Script Writer and save. Leave the fifth alone. Deny microphone permission, check that the failure is visible, then grant permission. On the first line, save three takes. Start a fourth and, before stopping it, change “lifts” to “stairs” in a second editor tab and save. Reopen the project. Expect four playable originals under the old wording, a pickup for the new wording, and no warning on the fifth line.
2. **Move and restore.** Record the second line and move it to another saved script with the same ID. Its review status should survive. Temporarily remove it from all saved scripts: its takes should be archived. Restore it and verify that they reappear. Duplicate its ID in a second location; both locations should be identifiable and neither should be recordable or publishable. Undo the duplicate.
3. **Listen and review.** With a steady fan running, capture room tone and record the third line softly. Compare original and cleaned at matched levels. Listen specifically to the last consonant in “fan.” Reopen the editor: the chosen settings should persist, bypass should still work, and the original should sound unchanged. Favorite a take and confirm that it still needs review.
4. **Disable and export.** Record, approve, and publish the fourth line. Disable its request, change its words, and save. Finish and publish all other requested lines, including a pickup for the first. Export. Neither the fourth nor fifth line should warn, play voice, or have a clip in the exported index. The export should contain no alternate takes or room tone.
5. **Play outside the editor.** Stop the editor and run the exported game. Reveal a voiced line, then advance rapidly: revealing should preserve playback; advancing must stop the old clip. Try the voice toggle and a silent client. Text progression should work throughout.
6. **Re-request.** Reopen the editor and request voice again for the fourth line. Expect its original takes and a pickup for its new wording. Record and approve the pickup, publish, and export again. Verify the exported game now plays the replacement. Repeat the recording UI checks in the other theme and verify the microphone is released when leaving Voice Studio.

Keep the automated-check result separate from the listening result: synthetic noise reduction cannot establish that quiet speech sounds natural on the pilot microphone.
