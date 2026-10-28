# Project overview

[Design index](../../README.md)

Incanterm is a server-run terminal adventure. The server generates terminal output; a Node.js client is used for testing, SSH provides silent play, and the browser provides play with audio. A small native client is deferred.

These documents describe the design, not an implemented game. Explicitly labeled proposals and open choices remain unsettled.

## Adventure game direction

The intended game is an adventure with substantial dialogue, puzzles, and player-advanced cutscenes. Players can type answers, select dialogue options, or use a cursor to choose where a character should walk or interact.

- Dialogue: numbered options or arrow-key selection with Enter to confirm.
- Text entry: game-drawn fields for answers, passwords, and other typed input.
- Exploration: move a selection cursor, select a destination or hotspot, then animate the character walking there. Mouse support can supplement keyboard controls.
- Cutscenes: support explicit waits for player input as well as timed animation.
- Keep story and puzzle state separate from presentation. The local save model is described in [Local saves](saves.md); exact game content and server scene-authoring formats remain to be designed.

Game content uses an object-oriented [scene, entity, and script model](scenes-entities-and-scripts.md). Scenes contain Characters, Props, Backgrounds, Effects, Triggers, and Items. Server-side Script assets coordinate actions and state changes; there is no client scripting layer.

## Implementation outline

1. Define the terminal-data, input, resize, and audio message contract.
2. Build a minimal server-run scene and a Node.js testing client that displays its output, forwards controls, and plays an audio cue.
3. Add the adventure systems on the server: dialogue, puzzles, state, and cutscenes.
4. Add SSH access without sound and browser access with sound, including the SSH-to-web menu link.
5. Verify terminal restoration, resize handling, mouse/keyboard controls, disconnect cleanup, animation bandwidth, and audio behavior.
6. Defer standalone packaging and a small native client until the protocol and testing client prove the experience.
