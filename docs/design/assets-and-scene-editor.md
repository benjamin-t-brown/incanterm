# Assets and scene editor

[Design index](../../README.md)

## Direction

Extend the asset editor from an ASCII art maker into Incanterm's scene authoring tool. Create art, animations, entity placement, markers, and trigger/script bindings there, then load the result in the real game server for rapid iteration.

## Current editor

`npm run editor` serves the Vite editor at `http://localhost:7104/`. The index has an authoring zone and a Game zone.

- **Art** paints `incanterm-sprite` documents. Cells store palette color ids. `assets/palette.json` holds exactly 16 named colors with explicit RGB, seeded from the old ed-ascii palette. The editor can recolor those entries and cannot add or remove them. Glyphs are single-width. New spritesheets receive a UUID id and a separately editable human-readable label; the id remains stable when the label changes. Legacy spritesheets without a label display their existing id as the label, preserving references from animations, props, and scenes. Edit → Spritesheet meta opens the editable label alongside a read-only id.
- **Animation** writes flat `incanterm-animation` clips: ordered sprite frames, a duration per frame, and a loop flag. Playback stays on that page. New clips (including generated character-state clips and copies) have UUID ids and separately editable labels. Existing clips without a label display their unchanged id as the label. Meta shows the read-only id alongside the editable label; changing the label does not change character or prop references.
- **Props** writes `incanterm-prop` definitions. A searchable list selects a prop; the center editor sets its visual, space, movement blocking, and depth offsets. The selected prop is linked by `/props?id=<prop-id>` so refreshing or sharing the URL reopens it. Choosing a visual opens a two-column picker: first select a sprite sheet, then select a sprite frame or one of the animations using that sheet, with previews. The selection applies only after OK. Props are reusable assets, not scene instances.
- **Characters** writes reusable `incanterm-character` version 1 definitions in `assets/characters/`. Each assigns animation clip IDs to eight required idle/walk directions and up to 64 named custom states, with a default facing. The editor lists, creates, previews, saves, and deletes these assets at `/characters?id=<id>`. Animation and sprite editing remain in their respective tools. Characters are not yet placeable in scenes or instantiated by the runtime.

The Props editor links the chosen visual to its Art spritesheet or Animation clip in a new tab, preserving the prop draft in the current tab.

Art and Animation also reflect the selected saved asset in their URLs (`/art?id=<sprite-id>` and `/animation?id=<animation-id>`). Refreshing either URL restores that selection; changing or removing the selection updates the URL without creating an extra history entry.
- **Soundboard** lists wav, ogg, and mp3 files already in `assets/audio/` and plays them in the browser. Files are added on disk.
- **Script writer** edits `.rpgscript` files and reports parse errors, missing `callScript` targets, and unknown commands.
- **Scene** writes `incanterm-scene` documents in `assets/scenes/`. Add Background Sprite chooses a sprite frame and adds a scene-owned, movable background prop (not a separate `assets/props/` definition). Its footprint always matches the sprite, it blocks no cells, and it draws behind world props. The canvas also places reusable prop instances and overlays load/action triggers bound by name to RPGScript `#triggers`. **+ Trigger** enters a one-shot draw mode: drag to create a cell-aligned region with a generated ID, select it immediately, then type/paste an RPGTrigger name or choose a matching name suggested from the scripts in the inspector. Selected regions have corner and edge resize handles and independent Action and Step switches; unchecking both disables the region. Existing test-room sprite props and string load triggers still open. Region dispatch is not yet implemented in the game.

Each scene has at most one background. In normal mode it is visible but locked: selecting and dragging affects only props and triggers. The right-hand Background Edit button switches to an exclusive mode that selects and moves only the background. Add Background becomes Replace Background when one exists, preserving its position and instance id. Clicking empty space does not move the current selection.

The scene viewport fits the room initially; zoom using the wheel or −/+ controls, use Fit to recenter, and pan with Space+drag or middle-drag. The cursor changes to a hand only during pan gestures. **+ Prop** opens a searchable preview picker for existing prop definitions and places a new scene instance at the viewport center; it does not create a prop asset.

Scene preview measures terminal cells with the same font metrics as Art, draws opaque sprites with their origins and project palette, and shares the game's background/depth sorting rules. Hovering a selectable object shows a dotted outline; Escape clears the current selection. Ctrl/Cmd+S saves the scene and reports the result in the same toast style as Art and Animation.
- **Game** embeds the browser client on port 7103. Start it with `npm run dev`. The page does not launch the server or load the open asset into a session.

Sprite export writes truecolor SGR from the palette. `POST /api/import/ed-ascii` maps the old 16 color indices onto these palette ids. The game's `assets/sprites/crate.json` uses the same compact cell-palette idea with its original `#rrggbb` colors. It remains a test-room sprite rather than an editable art-editor sprite.

Art spritesheets use compact JSON on disk. A top-level `cellPalette` contains each distinct `[character, foreground id, background id]` tuple once. Each layer stores palette indexes (0 means a transparent layer cell), using either `indices` for varied art or `runs` as `[length, index]` pairs for repeated cells. The asset API expands this into the editor's ordinary cell objects when loading and compresses it when saving. The `test1` sheet is about 0.9 KB in this layout instead of about 21 KB as pretty-printed cell objects. This storage change keeps the existing sprite version number.

Character scene placement and runtime facing, action-region interaction, and Play Scene remain later work.

### Concurrent editor saves

Editors keep the last version loaded from the API alongside their working copy. `PUT` requests for
editable documents send `{ base, doc }` (`base: null` creates a new file); a bare document is rejected.
`src/editor/client/save.ts` supplies the request helper. On the server, `SaveCoordinator` in
`src/editor/safe-save.ts` serializes per-asset reads and writes: the store rereads the file, merges
`base → doc` against the current disk version, validates the result, then writes it atomically.
Conflicts return HTTP 409 without writing. Editors must preserve their draft and show that error.

New editor asset types should provide a schema validator, disk reader/writer and merge policy to
`SaveCoordinator`. `mergeJson` merges independent fields and arrays with unchanged stable ids;
unidentified reordered arrays conflict. Sprites use `mergeSprite` for per-cell merging; scripts use
`mergeText` for independent edits on existing lines. Reference image bytes are opaque: uploads send
the revision from the last GET (or `new` for a new image), and conflicting uploads are rejected rather
than merged. These per-asset locks coordinate requests handled by one editor server process; running
multiple servers against the same asset folder would require cross-process locking.

## Previous ed-ascii format

The previous painter saved `data/*.json` documents with `format`, `version`, `width`, `height`, and row-major `cells` entries containing `ch`, `fg`, and `bg`. Colors were 16-color ANSI indices. It exported 16-color ANSI, defaulted to 120 by 40 cells, and supported canvas resizing up to 256 by 128 cells. Import those files through the art editor.

## Proposed asset model

Use versioned JSON as the authoring and runtime interchange. The editor writes sprite and animation documents the asset API stores directly. Scene schema, extensions, and version migration rules remain open.

| Asset | Contents |
|---|---|
| Sprite | Single-width Unicode character cells, opaque foreground/background colors, dimensions, and origin/anchor |
| Animation | Sprite-frame references, per-frame duration, and loop behavior |
| Prop | Reusable sprite or animation visual, occupied space, movement blocking, and ground/depth offsets |
| Character | Reusable four-direction idle/walk animation set, custom animation states, and default facing |
| Scene | Dimensions, depth mode, entity instances, asset references, markers, trigger regions, and script bindings |
| RPGScript | Separate `.rpgscript` source assets referenced by stable script names |
| Audio | Sound/music files referenced by stable asset IDs |

Suggested layout:

```text
assets/
  sprites/
  animations/
  props/
  characters/
  scenes/
  scripts/
  audio/
```

Scenes reference reusable art rather than duplicating sprite cells in every entity. Keep editor-only selection, zoom, and panel state separate from runtime data. Preserve stable identifiers for scenes, entities, markers, art, and scripts.

### Prop definitions

`assets/props/<id>.json` stores a reusable `incanterm-prop` version 1 document. A prop is a world object, not a UI element. Its `visual` refers to either a sprite sheet and zero-based frame index or an animation clip. `width` and `height` describe its occupied rectangle in scene cells. The editor defaults them to the selected sprite sheet's dimensions, or the first visible frame's sprite sheet dimensions for an animation; they remain editable independently of the visual. Selecting a different visual resets the footprint to that visual's dimensions, while reselecting the same visual preserves manual edits. `blockedCells` stores sorted, zero-based row-major indexes of footprint cells that obstruct movement, independently of drawing depth. The blocking dialog lets you paint these cells; Apply commits them, Cancel discards them. In the preview, focus the canvas and press Tab or use the show/hide button to toggle the blocked-cell overlay. Resizing keeps blocked cells at the same coordinates where they still fit. Older `blocksMovement: true/false` files load as all/none blocked; the next changed save writes the mask. `groundOffsetY` shifts the ground/contact anchor relative to the scene instance's position for Bottom Up sorting; `depthOffset` adjusts ordering within that mode (and can be applied to explicit z in Regular Z). Position, scene-specific z, and unique instance IDs belong to the scene, not the prop asset. The editor validates visual references when saving; scene integration is future work.

```json
{
  "format": "incanterm-prop",
  "version": 1,
  "id": "brass-door",
  "visual": { "type": "sprite", "id": "brass-door", "index": 0 },
  "width": 3,
  "height": 1,
  "blockedCells": [0, 1, 2],
  "groundOffsetY": 0,
  "depthOffset": 0
}
```

Sprites are opaque: every cell in the sprite rectangle, including blank spaces, overwrites underlying content. There are no transparent-background sprites. Restrict glyphs to single-width Unicode characters. Add a project palette with explicit RGB values so editor art and game output can agree independently of a terminal's theme. Conversion from the existing indexed format and exact color representation remain open.

## Proposed scene shape

Illustrative field names, not a frozen schema:

```json
{
  "format": "incanterm-scene",
  "version": 1,
  "id": "observatory",
  "width": 120,
  "height": 40,
  "depthMode": "bottom-up",
  "markers": [{"id": "entrance", "x": 12, "y": 28}],
  "entities": [
    {"id": "background", "type": "Background", "sprite": "observatory-background"},
    {"id": "brass-key", "type": "Item", "sprite": "brass-key", "x": 38, "y": 25, "itemId": "brass_key"}
  ]
}
```

See [Scenes and entities](scenes-entities-and-scripts.md) for type behavior and [Rendering](rendering-and-animation.md) for depth rules. Loading creates per-session runtime instances and applies saved progress rather than mutating shared definitions.

## Scene editing

Add an entity list, placement canvas, and type-specific property inspector. Support character animations/facing, prop anchors/depth, effect settings, trigger regions and script bindings, and collectible item IDs. Scene settings select one depth mode for the entire room.

Scene settings also specify operating mode and traversable tiles. Characters have four-direction idle/walk states plus custom animations. See [Interaction and navigation](interaction-and-navigation.md). The exact first editor milestone remains undecided.

Markers are named scene locations, editable as labeled guides and exported for scripts. Trigger bounds, ground anchors, depth order, and other guides are editor overlays, not visible sprite content. Preview the same depth rules used by the server.

## Rapid development loop

1. Edit art, place entities/markers, and bind RPGScript.
2. Save the project assets.
3. Click Play Scene to validate and load them in a fresh server preview session.
4. Open the preview in the browser; use the Node client for terminal testing too.
5. Restart Scene to retry from chosen test state.

Preview options should allow a starting position and test flags/inventory without changing scene defaults. Initially reload the preview session after changes instead of attempting to patch every running object. Hot replacement of sprites can come later. Invalid assets should produce useful file/entity diagnostics and leave the last valid preview intact.

Development can load saved files directly. Packaged exports are a later distribution concern. Exact preview launch API, server/editor process orchestration, asset manifest, reference validation, and reload mechanism remain open.
