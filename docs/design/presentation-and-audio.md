# Presentation and audio

[Design index](../../README.md)

## Responsibilities

Presentation covers both visual rendering and audio. Keep them as separate systems with coordinated timing:

```text
Game actions / RPGScript
  ├─ Visual rendering → character frames / terminal updates
  └─ Audio presentation → music and sound cues
```

Group the systems under `core/presentation/`, with `rendering/` and `audio/` subfolders. See [Rendering and animation](rendering-and-animation.md) for the visual pipeline.

## Event-driven audio

Game actions, scripts, and state transitions request audio. Do not start sounds inside a visual `render()` method: rendering can repeat or be skipped independently of game actions, causing duplicate or missing playback.

A per-session audio controller tracks intended music, active loops, volume, and fades and emits playback commands to the connected client. One-shot effects are requested once by an action, not once per frame. Concrete APIs and playback handle/channel identifiers remain to be defined.

Clients perform local playback. The server does not produce sound through its own audio device. Audio cues remain separate protocol messages rather than being embedded in terminal character sequences. See [Clients and protocol](clients-and-protocol.md).

## Timing and lifecycle

Visual effects, cutscenes, and audio use a shared session timeline so scripts can coordinate them. Session time coordinates events; it does not guarantee exact network/client playback synchronization. Exact timestamp encoding and client scheduling remain open.

Silent SSH sessions omit audio output and continue with the same game timing. Script progression must not require an audio-capable client or an audible-completion callback. Sequence durations and waits are determined by the game timeline.

Music can persist across room changes. Scene transitions can coordinate visual and audio fades. Exact track replacement and pause APIs remain open. Disconnect recovery uses the latest local committed checkpoint rather than retaining a live session. Session disposal releases audio-controller state; client exit stops local playback and any managed audio helper. A newly loaded session establishes intended audio from the reconstructed game state.

This is presentation state, not an additional client scripting layer. The existing simple save model does not require storing device playback state; the loaded room/game state can establish its intended audio.
