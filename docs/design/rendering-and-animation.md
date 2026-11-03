# Rendering and animation

[Design index](../../README.md)

Visual rendering is one part of [presentation](presentation-and-audio.md), alongside the separate event-driven audio system. Both coordinate through session timing; render calls must not start sounds.

## Rendering

On the server, use a grid of characters with foreground and background colors and convert updates to terminal sequences. Clients display those sequences. Use explicit RGB foreground/background colors on truecolor terminals, with reduced-color fallbacks. Basic named colors depend on the player's theme. Unicode and half-block art can be supported alongside ASCII.

Choose the update rate to suit the game. Turn-based play can redraw when state changes. Animated play should avoid unnecessary redraws to keep SSH bandwidth and latency manageable.

termbox2 and Bubble Tea are optional implementation candidates. The server-rendered output contract is independent of the chosen rendering library.

## Composition pipeline

Render into a server-side cell buffer before producing terminal bytes:

```text
Background pass
  → depth-sorted world entities
  → scene filters
  → UI layers
  → whole-screen filters/transitions
  → debug overlay
  → terminal color reduction/encoding and final-output comparison
  → terminal updates to client
```

Each cell contains a single-width Unicode character and opaque foreground/background colors. A sprite cell with a Black (`#000000`) background and a space (`" "`) glyph is undefined: skip it entirely, preserving the glyph, foreground, and background underneath regardless of its foreground color. Other sprite cells supply the foreground glyph and color when frontmost, including spaces with non-Black backgrounds. A Black sprite background is transparent: the final background comes from the nearest non-Black sprite background behind it, or Black if none exists. Uncovered scene cells are blank spaces on Black. Clip drawing to the scene and destination buffer. Complete filters and debug composition before determining output changes. The server owns the canonical cell grid; each connection owns its output encoding and previous-screen baseline. Compare the actual terminal-representable final output against that connection's valid previous baseline.

Scene filters affect the room without necessarily affecting dialogue/UI. Whole-screen filters include UI. Layer order still governs composition; the scene/world renderer supplies its composed image to the appropriate game layer.

## Scene depth modes

Every scene uses one fixed perspective/depth mode. Depth affects draw ordering, not projection geometry, collision, or walkable areas.

| Mode | Sort value | Behavior |
|---|---|---|
| Bottom Up (`bottom-up`) | world ground-anchor Y + depthOffset | Smaller first; objects farther down appear in front |
| Regular Z (`regular-z`) | explicit entity z | Smaller first; x/y movement does not change depth |

For Bottom Up, define an explicit ground/contact anchor, typically a character's feet or a prop's base. Do not infer depth from the bottom of the current animation frame: frame-size changes must not reorder the character. Ground-anchor offsets and sprite origins need a consistent coordinate convention in the asset schema.

For Regular Z, scripts can change z explicitly. Equal sort values use stable scene order to prevent flickering. Backgrounds use a separate back pass and do not participate in world depth sorting. Cache ordering until sort keys or membership change.

The scene editor selects the mode and exposes anchors/depth offsets or explicit z accordingly, with a depth-order preview. A large object may need separate artwork/entities if a character must pass behind one portion and in front of another simultaneously, such as an archway.

## Screen filters

A ScreenFilter transforms a whole character grid, analogous to a fragment effect over cells. It can change characters, foreground/background colors, or sample neighboring/displaced cells. Proposed interface:

```text
enabled
update(elapsedTime)
apply(sourceBuffer, destinationBuffer, context)
```

Context supplies dimensions, effect time, progress, and seeded randomness. Keep source and destination separate so reads are not contaminated by earlier writes in the same pass. Filters compose in an explicit ordered stack. Their output is temporary; never modify source assets or game state through filtering.

| Filter | Operation |
|---|---|
| Fade | Interpolate foreground and background RGB toward a target color over time |
| Scramble | Replace selected cells with generated characters/colors |
| Dissolve | Hide/reveal cells using a stable pattern |
| Wipe | Reveal across a moving boundary |
| Distortion | Read cells from displaced source positions |

Apply RGB effects before reducing colors for limited terminals. Filter ordering matters. Concrete parameter schemas, ownership, lifecycle, and RPGScript command names remain to be specified.

## Transitions

Transitions between scenes can use an outgoing snapshot and an incoming buffer. A transition controller advances progress and composes the displayed result. A scramble transition can obscure/fill the outgoing scene, switch the underlying scene while obscured, then resolve cells into the incoming image.

Use seeded patterns or per-cell thresholds for reproducible progression; continuously changing noise is also a possible effect. The policy for updating outgoing/incoming scenes and enabling player input during transitions remains open.

## Debug rendering

Provide developer debug overlays, normally after all screen filters so effects cannot hide diagnostics. Allow hiding them for an exact player-view preview. Settings belong to the developer session and are not saved as player progress.

Independent toggles should show trigger regions and activation state, marker positions/names, entity IDs/bounds, ground anchors, depth values/drawing order, and walkable areas/destinations/paths when those systems exist. These overlays must not become ordinary gameplay artwork or alter world collision/input behavior.

Use compatible debug concepts in [ed-ascii's scene editor](assets-and-scene-editor.md) and the game preview. Full-screen effects such as scrambling can change nearly every cell; benchmark their output bandwidth early.

## Screen size and animation proposals

The target scene viewport is 120 columns by 40 rows. Half-block characters can represent a 120 by 80 color sample grid. Render the scene across the full canvas, then overlay the bottom 16 rows with UI. Larger terminals center the layout; smaller terminals keep UI accessible while cropping the canvas. Hiding the UI reveals the scene underneath without shifting scene coordinates. See [Interaction and navigation](interaction-and-navigation.md).

Start by benchmarking cutscenes at 30 FPS. This is a target, not guaranteed SSH performance. Actual results depend on changed cells, color sequences, terminal performance, connection throughput, and latency. Test both sparse animation and full-screen changes.

Game sessions advance simulation on an elapsed-time tick targeting 30 FPS, independently of input-triggered painting. Terminal output uses cursor-addressed changed-cell runs against the last frame accepted by the transport; opening and resizing send a full screen. Unchanged frames send no data. WebSocket output allows one frame write in flight and SSH output waits for `drain` after backpressure. While blocked, simulation continues without queuing rendered frames; the next update catches up from the accepted baseline. Browser and loopback clients maintain a cell buffer so partial updates preserve unchanged cells, and loopback can restore a complete screen after switching views.

Use the same character/foreground/background cell representation for gameplay and animation. Proposed asset approaches:

- Scripted scenes for character movement, dialogue, fades, and most cutscenes.
- Stored cell frames for prerecorded sequences or converted video.
- Compression and optional keyframes plus changed cells for longer assets.
- Convert video offline rather than requiring real-time video conversion for each player.

Use timestamps to schedule playback and skip overdue frames before sending them. Data already queued in SSH cannot be withdrawn; avoid building a backlog of stale frames.
