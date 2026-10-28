# Server organization and sessions

[Design index](../../README.md)

## Server organization and layer control flow

```text
server/
  connections/       Node-client, SSH, and browser adapters
  sessions/          SessionManager and GameSession lifecycle
core/
  layers/            Layer and LayerManager
  events/            Input events and routing
  presentation/
    rendering/       Cell buffers, compositing, terminal output
    audio/           Per-session music, effects, volume, fades, cue output
ui/
  UIElement          Generic UI tree base class
  controls/          Panels, labels, buttons, text fields, choices
game/
  layers/            Exploration, dialogue, inventory, cutscenes
  scenes/
  puzzles/
  systems/
state/
  SessionState       Per-player application and game state
  persistence/       Save schema, encoding, loading, defaults
assets/              Shared art, animation, audio metadata, content
```

A Layer is a control-flow class with update(elapsedTime), render(renderContext), and handleEvent(event). It can be enabled or disabled. LayerManager owns layer order, routes events to eligible layers, updates them, and renders them.

- Render bottom to top; overlays appear above underlying scenes.
- Route input top to bottom; stop when handled or blocked by a modal layer.
- Disabled layers receive no input, updates, or rendering.
- Proposed additional switches are visible, updates, acceptsInput, blocksInputBelow, and blocksUpdatesBelow. These let a menu pause a scene while leaving it visible.
- Queue stack additions/removals until a safe point rather than mutating the stack during traversal.

Session processing: drain input, route events, update eligible layers and presentation timing, render visible layers into the cell buffer, then emit terminal changes and queued audio cues. Actions/scripts generate audio requests independently of render calls. Normalize mouse positions and screen dimensions to character cells. See [Presentation and audio](presentation-and-audio.md).

## Sessions

The server's SessionManager holds a sessionId-to-GameSession map in memory. Each GameSession contains one player's application: state, LayerManager, UI trees and focus, queued input, render buffers, and connection/output state. Mutable player state must not be global. Immutable assets and game definitions can be shared across sessions.

A connection owns the live session for the initial implementation. On disconnect, clean up the session and its room-owned work; recovering from the latest locally stored committed checkpoint is sufficient. Do not implement a retained-session reconnect grace period initially. Loading a save requires no account. Exact cleanup mechanics remain to be implemented.

Durable progress is a player-owned save, not a live session object. Loading a save constructs a fresh game state and rebuilds layers/UI. Long-term server-side saves and player accounts are not required. A server restart can discard live sessions; clients retain their latest received save.

Process each session's input and updates sequentially. A separate process or thread per player is not required; server concurrency is an implementation choice. Bound outgoing queues and avoid accumulating obsolete animation. When pending updates are discarded, regenerate output against a valid client baseline or send a full redraw; terminal deltas cannot simply be dropped independently.
