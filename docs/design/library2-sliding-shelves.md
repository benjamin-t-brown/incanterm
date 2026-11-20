# Library 2 sliding shelves: implementation plan

**Goal:** Johnathan clicks a bookshelf, walks up to it, chooses a direction, and pushes it. The shelf slides until obstructed. Several shelves can form a staircase to the second floor. Leaving the room preserves the arrangement; an explicit reset restores the starting layout.

**The non-negotiable rule:** `blockedCells` is for staging and walking. The author intentionally paints it generously so characters look right against ASCII art. Sliding uses **two independently painted puzzle masks**: a travel area on the scene and a footprint on each participating prop instance. Never infer, seed, or fall back to walking masks, sprite bounds, or visible glyphs for slide collision. Overlapping shelf art or walking masks can be a perfectly legal stop.

## Work order

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| 1 | Scene data contract and shared slide solver | — |
| 2 | Paint both masks and preview a push in the Scene editor | 1 |
| 3 | Click, approach, choose, and animate a push in a synthetic room | 1 |
| 4 | Restore settled positions on entry; reset safely | 1 and the settle/cancel interface from 3 |
| 5 | Playable two-shelf trial in `library2` | 2–4 |
| 6 | Full staircase, upstairs access, and room playthrough | 5 |

Phases 2 and 3 can proceed independently against the Phase 1 fixture. Treat Phase 5 as a design review: prove that the painted shapes, approach positions, and stops look right in the actual room before authoring all eight shelves.

### 1. Define the data and compute where a push stops

**Start in:** `src/editor/schema.ts`, `src/game/load-scene.ts`, `src/game/scene.ts`. Put the pure solver in a module importable by both the editor and runtime without Node, DOM, or session dependencies.

- Add optional, typed scene data for the travel cells and four named direction vectors. Add optional `slidable` data to a **scene prop instance** for its local footprint and action binding. Old scenes require no migration. Identify shelves by scene entity ID, never display name or prop asset ID.
- Use row-major scene indexes for travel cells. Store footprint offsets relative to the prop's placement anchor; for a clicked scene cell the offset is `(cellX - prop.x, cellY - prop.y)`. Respect sprite origin when drawing the overlay. Validate unique integer cells, bounds, nonzero unit direction vectors, and legal starting placements. Surface an empty footprint as an authoring error; an incomplete shelf cannot slide.
- Define one query, e.g. `getSlidePath(board, positions, instanceId, direction)`. Return the ordered legal anchors, final anchor, first obstructed cell and reason. Move the **whole** footprint one vector per step. Stop before the first cell outside the travel area or inside another shelf's current footprint. Ignore the moving shelf itself. A blocked first step returns an empty path. No chain pushes.
- For `library2`, use left `(-1,0)`, right `(1,0)`, up `(-1,-1)`, down `(1,1)`. A diagonal is one projected floor step; do not apply character corner-cutting tests to shelves. Represent walls, pillars and doorways by holes in the travel area.

**Done when:** editor JSON round-trips and the runtime loads the same synthetic board. Tests prove movement across a walking-blocked cell, a stop at a walking-clear travel hole, a stop caused by the trailing end of an angled footprint, a blocked first step, and independent movement of two identically named instances. Include a nonzero sprite origin.

### 2. Paint and preview in the existing Scene editor

**Start in:** `src/editor/client/scenes/` and `src/editor/scenes/`. Use `scene-blocked-cells.ts` as a reference for painting interactions, not as puzzle storage.

- Add **Shelf travel area** to scene overlays. In the selected prop inspector add **Slidable**, **Paint slide footprint**, and **Copy footprint from…** for compatible shapes. Copy by value. Give puzzle paint and walking paint distinct labels and colors.
- Add four preview buttons. Draw a ghost at the solver's final anchor and mark the first obstructed cell, including when the shelf cannot move. Let the author see which shelf or travel boundary caused the stop. Preview is read-only and uses the other shelves' current editor placements.
- Preserve both masks through save/reopen, moving a prop, and ordinary scene edits. Flag missing footprints, overlapping starting footprints, and starting cells outside the travel area at the affected instance.

**Done when:** an author can paint a diagonal shelf, copy it, edit the copy independently, preview all four directions, and reopen the scene with identical results. Neither previewing nor painting changes `blockedCells` or the reusable prop asset.

### 3. Play one complete push

**Start in:** `src/server/game-session.ts` (world input and update), `src/game/player-control.ts`, `src/game/scene-commands.ts`, and the RPGScript command registry/diagnostics in `src/editor/rpgscript/`.

1. Bind a shelf action to the **moving instance**. Resolve the clicked visible prop at its current draw position, respecting occlusion and the existing UI/item input priority. Pass the instance ID to one shared script. A fixed scene trigger rectangle will go stale after the first push.
2. Approach using character navigation and its existing walking blockers. Require arrival on an exact reachable stand cell beside the shelf before showing choices; the normal “nearest reachable cell” fallback is not success. Allow per-direction local stand offsets when an oversized walking mask puts the visually convincing push position farther from the slide footprint.
3. Use the existing choice UI with text labels **Left**, **Right**, **Up-left**, **Down-right**, and **Cancel**. A push is available only if Johnathan can reach its pushing side and the solver finds at least one step. Explain an unavailable push or omit it. After selection, walk to the chosen side, face the shelf, and recheck before moving. Johnathan stays at the shove position.
4. Expose small script operations for approaching, querying available pushes, and awaiting a slide. The engine animates the actual prop through the Phase 1 anchors on the session update clock. Position, depth sorting, walking blockers, and click target follow the prop. One push at a time; no room polling timer or per-shelf RPGScript animation loops. On interruption, restore the pre-push anchor and release input; only a completed slide emits a settle event.

**Done when:** in a synthetic room, mouse and keyboard activation reach the same flow. Cancel and unreachable approaches leave state unchanged; a second click during motion cannot start another push. The animated stop equals the editor preview on the same board. Afterward the shelf is clickable at its new location, and its old walking blockers are gone.

### 4. Persist settled positions and reset the room

**Start in:** scene construction and `changeScene` in `src/server/game-session.ts`; see [checkpoint semantics](saves.md).

- Keep a per-player map of `scene ID → prop instance ID → settled {x,y}`. Missing entries mean authored placement. Update only on settle; omit placements equal to defaults. Restore the layout as a group after cloning scene props and before load scripts, triggers, or input. Never mutate a shared scene template.
- Make the record plain serializable data. Integrate it with the committed snapshot path if available; if disk saves are not yet implemented, verify a serialization round-trip and document that cross-session resume awaits the save system. Scene re-entry must work now. Do not serialize menu state, partial slides, or a separate “staircase solved” flag.
- Expose a room-scoped reset to RPGScript. Restore all shelves atomically, clear only this room's overrides, and recompute the climb condition. If the restored walking masks cover Johnathan, relocate him to an authored safe marker. Validate saved layouts as a group; if a content edit makes a layout illegal, restore that room's defaults rather than half-applying it.

**Done when:** push → leave → return preserves the exact layout; reset → leave → return restores defaults. An interrupted slide restores the last settled state. A second player's shelves and a second room's overrides are unaffected.

### 5. Prove the interaction in the actual room

**Content only:** `projects/ProjectJohnathan/assets/scenes/30c1a8da-1122-4e28-bda4-4e7ce05957f2.json` and `projects/ProjectJohnathan/assets/scripts/library2.rpgscript`. Work from the author's current scene. Two `bookshelf7x5` instances share a name.

- Start with `bookshelf_7x3`, one angled shelf, and one existing pillar. Paint a small trial travel area, cut out the pillar, and paint the two footprints. Bind both instances to the shared push script. Place a fixed reset control and a safe standing marker outside shelf travel.
- In the editor, predict a down-right stop against the pillar and a horizontal stop against the other shelf. In play, reach both stops, select the moved shelf again, cancel a push, leave and return, then reset. Check that oversized walking masks still stage Johnathan convincingly. Adjust stand offsets or puzzle masks according to which behavior looks wrong.

**Handoff:** record the two push sequences, initial and final anchors, and any art/approach issue. Proceed when both stops match the preview and at least one position demonstrates why the two kinds of mask must differ.

### 6. Author the climb and verify the full puzzle

- Expand the travel area and paint the participating shelf instances. Keep entry markers, exits, the reset point and its approach usable. Decide the usable shelf heights and climb contacts from the artwork. These are project data or script constants; sprite height and slide footprint alone do not define a climbable top.
- In `library2.rpgscript`, offer **Climb** from a reachable lower start when the **settled** shelves form a connected sequence of climb contacts in ascending height order that meets the upper landing. Evaluate the actual arrangement after push, reset and re-entry. Equivalent working staircases should count; moving a required shelf away should remove the option.
- Script the climb through the shelf-top positions to an authored upper-floor marker, hold player input during the sequence, and restore normal walking at the landing. Verify that the existing `library2_isUpstairs` check recognizes that position and the upstairs doors work. Keep the route, landing and character dialogue out of engine code.

**Release check:** hand another agent a reproducible sequence from reset to the second floor (shelf instance, direction, expected stop for each push). Replay it including a room exit/re-entry halfway through. Also try a near miss, an unreachable push, reset from a bad layout, and an upstairs entry from an adjoining room. Record the working solution and reset location in the project handoff.

## Verification and handoff conventions

Each implementation handoff should list changed files, the data/command interfaces downstream phases can use, checks run, and any remaining authoring decision. Follow repository `AGENTS.md`: put tests in the relevant `__tests__/`, use synthetic or test-owned fixtures, and pass an explicit test project or `assetsRoot` plus `sceneId` for server tests. Use the real library only for manual content playthroughs. For code phases run `npm run typecheck`, `npm run lint`, and the relevant `npm run test:run -- <test paths>` suites; run the full suite at integration.
