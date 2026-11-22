# Library 2 sliding shelves: implementation plan

**Goal:** Johnathan clicks a bookshelf, walks up to it, chooses a direction, and pushes it. The shelf slides until obstructed. Several shelves can form a staircase to the second floor. Leaving the room preserves the arrangement; an explicit reset restores the starting layout.

**Scope:** Sliding is an opt-in behavior for **any scene prop instance**. A crate, statue, or bookshelf uses the same editor controls, collision solver, push commands, and persistence. Two instances of the same asset may differ: one can slide while the other stays fixed. Only the library script knows that particular shelves form a staircase.

**The non-negotiable rule:** `blockedCells` is for staging and walking. Sliding uses two independently painted puzzle masks: a travel area on the scene, and `slideCells` on the reusable **prop asset**. Paint the latter once in the Prop editor; each opted-in placement uses that shape. Never infer, seed, or fall back to walking masks, sprite bounds, or visible glyphs for slide collision.

## Work order

Use a `general` agent with an OpenAI direct model (`openai/`) for every phase. Effort is a recommendation for a new assignment.

| Phase / deliverable | Depends on | Recommended model · effort | Why this assignment |
| --- | --- | --- | --- |
| 1. Scene data contract and shared slide solver | — | `openai/gpt-6.2-sol` · high | The editor and runtime both depend on the coordinate contract. Spend the reasoning effort on mask independence and edge cases. |
| 2. Paint masks and preview pushes | 1 | `openai/gpt-6.2-astra` · medium | The solver is settled. Most of the work is fitting selection, painting, and overlays into the existing Scene editor. |
| 3. Click, approach, choose, and animate | 1 | `openai/gpt-6.2-sol` · xhigh | Highest integration complexity: pathfinding, input ownership, script waits, and animation must agree on arrival, cancellation, and settle. |
| 4. Restore settled positions and reset | 1 and the settle/cancel interface from 3 | `openai/gpt-6.2-sol` · high | Use the Phase 3 agent if available: it already knows when a push is committed. Focus on interrupted pushes, restore order, and per-player isolation. |
| 5. Playable two-shelf trial | 2–4 | `openai/gpt-6.1-terra` · medium | Bounded content work with a known solver. The important check is a playthrough with the room author to judge the ASCII overlap and Johnathan's stance. |
| 6. Full staircase and upstairs access | 5 | `openai/gpt-6.2-sol` · high | The agent must find a playable push sequence, accept equivalent staircases, reject near misses, and verify exits and re-entry. |

Phases 2 and 3 can proceed independently against the Phase 1 fixture. Treat Phase 5 as a design review: prove that the painted shapes, approach positions, and stops look right in the actual room before authoring all eight shelves.

**Phases 1–3 handoff:** the editor writes `propSlide: { travelCells, directions }` on the scene; each moving instance specifies `slidable: { actionScript, standOffsets? }`. The reusable asset owns `slideCells`. Older scenes with inline offsets still load when the asset has no `slideCells`. `src/game/prop-slide.ts` exposes `getSceneSlideSetup` and `getSlidePath`; a hit on another prop returns `reason: 'prop'` and its instance ID. For Phase 4, consume `onPropSlideSettled({ sceneId, instanceId, from, to })` and call `GameSession.cancelPropSlideInteraction()` before resetting the layout.

### 1. Define the data and compute where a push stops

**Start in:** `src/editor/schema.ts`, `src/game/load-scene.ts`, `src/game/scene.ts`. Put the pure solver in a module importable by both the editor and runtime without Node, DOM, or session dependencies.

- Define the travel cells and four named direction vectors in the scene. Bind actions by scene entity ID, never display name or prop asset ID.
- Use row-major scene indexes for travel cells and row-major prop indexes for the shared footprint. Convert the latter to anchor-relative offsets using the default sprite origin, as for walking blockers. Validate unique cells, bounds, direction vectors and the resolved layout. A slidable placement needs a nonempty footprint.
- Define one query, e.g. `getSlidePath(board, positions, instanceId, direction)`. Return the ordered legal anchors, final anchor, first obstructed cell and reason. Move the **whole** footprint one vector per step. Stop before the first cell outside the travel area or inside another shelf's current footprint. Ignore the moving shelf itself. A blocked first step returns an empty path. No chain pushes.
- For `library2`, use left `(-1,0)`, right `(1,0)`, up `(-1,-1)`, down `(1,1)`. A diagonal is one projected floor step; do not apply character corner-cutting tests to shelves. Represent walls, pillars and doorways by holes in the travel area.

**Done when:** editor JSON round-trips and the runtime loads the same synthetic board. Tests prove movement across a walking-blocked cell, a stop at a walking-clear travel hole, a stop caused by the trailing end of an angled footprint, a blocked first step, and independent movement of two identically named instances. Include a nonzero sprite origin.

### 2. Paint the prop asset and preview pushes in the scene

**Start in:** `src/editor/client/scenes/` and `src/editor/scenes/`. Use `scene-blocked-cells.ts` as a reference for painting interactions, not as puzzle storage.

- In the Prop editor choose **Paint slide footprint** beside the walking mask. In the Scene editor enable **Slidable**, bind a script, and paint the **Prop travel area**. The inherited footprint is read-only; select an arrow in the **Preview Slide** row to preview that direction, or select it again to clear the preview.
- Add four preview buttons. Draw a ghost at the solver's final anchor and mark the first obstructed cell, including when the shelf cannot move. Let the author see which shelf or travel boundary caused the stop. Preview is read-only and uses the other shelves' current editor placements.
- Preserve both masks through save/reopen, moving a prop, and ordinary scene edits. Flag missing footprints, overlapping starting footprints, and starting cells outside the travel area at the affected instance.

**Done when:** changing a prop's footprint updates the previews for every opted-in placement after loading the saved asset. Reopening the scene preserves the four previews. Neither slide painting nor previewing changes `blockedCells`.

### 3. Play one complete push

**Start in:** `src/server/game-session.ts` (world input and update), `src/game/player-control.ts`, `src/game/scene-commands.ts`, and the RPGScript command registry/diagnostics in `src/editor/rpgscript/`.

1. Bind a shelf action to the **moving instance**. Resolve the clicked visible prop at its current draw position, respecting occlusion and the existing UI/item input priority. Pass the instance ID to one shared script. A fixed scene trigger rectangle will go stale after the first push.
2. Try to approach using character navigation and its existing walking blockers. If no stand can be reached, have Johnathan say “I can't reach that.” and end the action after the player dismisses the dialogue. Allow per-direction local stand offsets for staging.
3. Show a clickable direction pad with **Up**, **Left**, **Right**, and **Down** around a central **Cancel**. Available buttons show their numeric shortcuts. A push is available if the solver finds at least one step. Walk to the chosen side and face the shelf if reachable. Otherwise, if Johnathan is in the slide path, have him walk clear before moving the shelf. If he can't get clear, cancel that push. Recheck the slide path before moving.
4. Expose small script operations for approaching, querying available pushes, and awaiting a slide. The engine animates the actual prop through the Phase 1 anchors on the session update clock. Position, depth sorting, walking blockers, and click target follow the prop. One push at a time; no room polling timer or per-shelf RPGScript animation loops. On interruption, restore the pre-push anchor and release input; only a completed slide emits a settle event.

**Done when:** mouse and keyboard activation reach the same flow. Cancel and a failed initial approach leave the shelf unchanged. Once the player reaches the shelf, an unreachable pushing side does not prevent a legal push. A second click during motion cannot start another push. The animated stop equals the editor preview on the same board.

### 4. Persist settled positions and reset the room

**Start in:** scene construction and `changeScene` in `src/server/game-session.ts`; see [checkpoint semantics](saves.md).

- Keep a per-player map of `scene ID → prop instance ID → settled {x,y}`. Missing entries mean authored placement. Update only on settle; omit placements equal to defaults. Restore the layout as a group after cloning scene props and before load scripts, triggers, or input. Never mutate a shared scene template.
- Make the record plain serializable data. Integrate it with the committed snapshot path if available; if disk saves are not yet implemented, verify a serialization round-trip and document that cross-session resume awaits the save system. Scene re-entry must work now. Do not serialize menu state, partial slides, or a separate “staircase solved” flag.
- Expose a room-scoped reset to RPGScript. Restore all participating props atomically and clear only this room's overrides. The library script then recomputes its climb condition. If the restored walking masks cover the player, relocate them to an authored safe marker. Validate saved layouts as a group; if a content edit makes a layout illegal, restore that room's defaults rather than half-applying it.

**Done when:** push → leave → return preserves the exact layout; reset → leave → return restores defaults. An interrupted slide restores the last settled state. A second player's shelves and a second room's overrides are unaffected.

**Phase 4 handoff:** Use `resetPropSlides(safeMarker)` and evaluate the library's
climb condition from the resulting layout in script. Author the named marker on
a walkable spot that fits the player's feet with the props in their original
positions; a missing or unsafe required marker leaves the layout unchanged.
`GameSession.getPropSlideState()` returns a detached JSON-ready
`{ [sceneId]: { [instanceId]: { x, y } } }` record of nondefault settled anchors.
`createGameSession` accepts it as `initialPropSlideState` and validates each room
as a group before its entry scripts. The synthetic tests cover live re-entry and a
JSON round-trip. There is no committed checkpoint implementation yet; normal
cross-session resume and disk persistence await the save system.

### 5. Prove the interaction in the actual room

**Content only:** the `library2` scene and room script in `projects/ProjectJohnathan`, plus any art for the fixed reset control. Work from the author's current scene. Two `bookshelf7x5` instances share a name.

- Start with `bookshelf_7x3`, one angled shelf, and one existing pillar. Paint a small trial travel area, cut out the pillar, and paint the two footprints. Bind both instances to the shared push script. Place a fixed reset control and a safe standing marker outside shelf travel.
- In the editor, predict a down-right stop against the pillar and a horizontal stop against the other shelf. In play, reach both stops, select the moved shelf again, cancel a push, leave and return, then reset. Check that oversized walking masks still stage Johnathan convincingly. Adjust stand offsets or puzzle masks according to which behavior looks wrong.

**Handoff:** record the two push sequences, initial and final anchors, and any art/approach issue. Proceed when both stops match the preview and at least one position demonstrates why the two kinds of mask must differ.

**Phase 5 handoff:** [ProjectJohnathan's two-shelf trial](../../projects/ProjectJohnathan/story/library2-two-shelf-trial.md) has the staged editor previews, in-game coordinates and push sequence, reset location, and visual review notes.

### 6. Author the climb and verify the full puzzle

- The route check is implemented as `getPropClimbPath(MarkerPathFloor2)`. The reusable prop's `climbHeight` overrides its height above the row just below the slide footprint. Otherwise, infer height from the lowest painted roof row in `climbCells`. Ordinary walking masks are separate.
- The **[CHECK]** plaque below **[RESET]** reports in the game's Log tab whether the current layout has a route Johnathan can reach from where he's standing. The approach to the first shelf uses normal walking blockers and his full footing.
- A transfer requires touching slide footprints (including corners) and a level step or an increase in height of up to two cells. Painted roof tiles guide the waypoints, not eligibility. Floor entry and the final landing also allow a rise of at most two rows. The landing must be within one footprint column of the last shelf.
- Expand the travel area, paint the participating shelf assets and enable their instances. Keep entry markers, exits, the reset point and its approach usable. Decide the usable shelf heights and climb contacts from the artwork. These are project data or script constants; sprite height and slide footprint alone do not define a climbable top.
- In `library2.rpgscript`, offer **Climb** from a reachable lower start when the **settled** shelves form a connected sequence of climb contacts in ascending height order that meets the upper landing. Evaluate the actual arrangement after push, reset and re-entry. Equivalent working staircases should count; moving a required shelf away should remove the option.
- After a successful push, if Johnathan can reach a complete route, he says “I think I can make it to the top.” and starts climbing automatically. The **[CLIMB]** plaque uses the same RPGScript ascent: walk to the first shelf, jump across the shelf centers, then land at `MarkerPathFloorTop`. A descent control is not wired up yet.

**Release check:** hand another agent a reproducible sequence from reset to the second floor (shelf instance, direction, expected stop for each push). Replay it including a room exit/re-entry halfway through. Also try a near miss, an unreachable push, reset from a bad layout, and an upstairs entry from an adjoining room. Record the working solution and reset location in the project handoff.

## Verification and handoff conventions

Each implementation handoff should list changed files, the data/command interfaces downstream phases can use, checks run, and any remaining authoring decision. Follow repository `AGENTS.md`: put tests in the relevant `__tests__/`, use synthetic or test-owned fixtures, and pass an explicit test project or `assetsRoot` plus `sceneId` for server tests. Use the real library only for manual content playthroughs. For code phases run `npm run typecheck`, `npm run lint`, and the relevant `npm run test:run -- <test paths>` suites; run the full suite at integration.
