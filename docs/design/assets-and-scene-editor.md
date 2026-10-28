# Assets and scene editor

[Design index](../../README.md)

## Direction

Extend the asset editor from an ASCII art maker into Incanterm's scene authoring tool. Create art, animations, entity placement, markers, and trigger/script bindings there, then load the result in the real game server for rapid iteration.

## Current editor

`npm run editor` serves the Vite editor at `http://localhost:7104/`. The index has an authoring zone and a Game zone.

- **Art** paints `incanterm-sprite` documents. Cells store palette color ids. `assets/palette.json` holds exactly 16 named colors with explicit RGB, seeded from the old ed-ascii palette. The editor can recolor those entries and cannot add or remove them. Glyphs are single-width. Ids are chosen when a file is created or duplicated and are not renamed.
- **Animation** writes flat `incanterm-animation` clips: ordered sprite frames, a duration per frame, and a loop flag. Playback stays on that page.
- **Soundboard** lists wav, ogg, and mp3 files already in `assets/audio/` and plays them in the browser. Files are added on disk.
- **Script writer** edits `.rpgscript` files and reports parse errors, missing `callScript` targets, and unknown commands.
- **Scene** is a TODO page. This milestone does not write scene documents or place entities.
- **Game** embeds the browser client on port 7103. Start it with `npm run dev`. The page does not launch the server or load the open asset into a session.

Sprite export writes truecolor SGR from the palette. `POST /api/import/ed-ascii` maps the old 16 color indices onto these palette ids. The game's existing `assets/sprites/crate.json` still stores inline `#rrggbb` colors for the test room and is not an editor sprite.

Scene placement, character facing sets, and Play Scene remain later work.

## Previous ed-ascii format

The previous painter saved `data/*.json` documents with `format`, `version`, `width`, `height`, and row-major `cells` entries containing `ch`, `fg`, and `bg`. Colors were 16-color ANSI indices. It exported 16-color ANSI, defaulted to 120 by 40 cells, and supported canvas resizing up to 256 by 128 cells. Import those files through the art editor.

## Proposed asset model

Use versioned JSON as the authoring and runtime interchange. The editor writes sprite and animation documents the asset API stores directly. Scene schema, extensions, and version migration rules remain open.

| Asset | Contents |
|---|---|
| Sprite | Single-width Unicode character cells, opaque foreground/background colors, dimensions, and origin/anchor |
| Animation | Sprite-frame references, per-frame duration, and loop behavior |
| Scene | Dimensions, depth mode, entity instances, asset references, markers, trigger regions, and script bindings |
| RPGScript | Separate `.rpgscript` source assets referenced by stable script names |
| Audio | Sound/music files referenced by stable asset IDs |

Suggested layout:

```text
assets/
  sprites/
  animations/
  scenes/
  scripts/
  audio/
```

Scenes reference reusable art rather than duplicating sprite cells in every entity. Keep editor-only selection, zoom, and panel state separate from runtime data. Preserve stable identifiers for scenes, entities, markers, art, and scripts.

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
