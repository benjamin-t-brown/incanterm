# Library 2 two-shelf trial

This is the floor-level interaction trial, not a staircase solution. Run from the repository root in a mouse-capable terminal:

```sh
npm run loopback -- --project projects/ProjectJohnathan --scene library2
```

Use a viewport around 120×50 cells or larger so the art and choice bar are both visible. Coordinates below are zero-based **room** cells, not terminal coordinates.

## Replay from reset

| Shelf | Scene instance ID | Initial anchor | Final anchor |
| --- | --- | --- | --- |
| Angled `bookshelf_6x9_left` | `067baab0-fd15-4da0-ac09-99aeecb59ad5-1` | `(60,8)` | `(61,10)` |
| Short `bookshelf_7x3` | `6f077125-2778-4e7f-beae-a27a4df225e3-1` | `(50,16)` | `(56,16)` |

1. **Pillar sequence:** Click the angled shelf at `(62,11)` and choose **Left**. It slides one step to `(59,8)`; the next footprint would hit the travel hole at the first pillar foot `(59,15)`. Click the shifted shelf at `(61,11)` and choose **Down**. It slides down-right through `(60,9)` and stops at `(61,10)`, before its leading bottom row would hit the second pillar foot `(64,19)`. Click its moved art at `(63,12)` and choose **Cancel**; both anchors should stay put.
2. **Shelf-to-shelf sequence:** With the angled shelf still at `(61,10)`, click the short shelf at `(52,17)` and choose **Right**. It stops six cells over at `(56,16)` because the next footprint would touch the angled shelf at `(63,18)`. The short shelf's old art cell is no longer hot; click its new art at `(58,17)` and cancel there too.
3. **Leave and return:** Walk down the lower Library 1 exit (click room cell `(42,21)`). In Library 1, turn back through the lower passage (click `(35,12)`). Library 2 places Johnathan at `FromLibrary1` `(41,20)` with both moved anchors intact.
4. **Reset:** Click the fixed `[RESET]` plaque just left of the short shelf's starting art. The plaque spans `(43,17)`–`(49,17)`. Johnathan walks to `ShelfResetSafe` at `(47,20)`, stands with his three feet cells at `x=46…48` on row 20, faces up, and resets both shelves. Repeat the exit/return: the original anchors should still be in place.

To reproduce the predictions in the editor, preview **Left** on the angled shelf, then stage its preview anchor `(59,8)` in the scene editor before previewing **Down-right**. Stage just the angled shelf at `(61,10)` before previewing **Right** on the short shelf. Do not save the staged placements as defaults.

## Authoring notes

- Edit the reusable `bookshelf_6x9_left` and `bookshelf_7x3` assets in **Props → Paint slide footprint**. The gold mask is independent of the red walking mask. Library 2 owns the travel area, action bindings and shove stands.

- The short shelf has **no walking blockers** in the existing prop asset, but its seven painted contacts stop at another shelf. To compare from reset, push only the short shelf **Right**: it goes farther, to `(61,16)`, and stops against walking-clear `(68,18)`, matching the preview. Neither stop could come from the walking mask.
- Exact shove stands in the replay, expressed as Johnathan's origin column and bottom row: angled **Left** `(66,16)`, angled **Down-right** `(56,14)`, short **Right** `(47,18)`. The angled shelf's wider walking paint stays intact; the push stands were chosen for Johnathan's three-cell width. Reset's script checks exact arrival rather than trusting the walk command's nearest-cell fallback. If the safe marker is moved, update the scripted check too.
- At the angled stop, the foreground pillar occludes a vertical stripe of shelf art; at the horizontal stop, the shelf tops slightly overlap while the floor contacts stay adjacent. The angled down-right shove faces right across the pillar line and may read as a reach rather than hands-on contact. Review that stance, the intended overlap, and the plain `[RESET]` plaque with the room author at game font size. The short shelf remains walk-through by design of its existing walking mask; don't change that as an incidental side effect of puzzle paint.

**Content:** [scene](../assets/scenes/30c1a8da-1122-4e28-bda4-4e7ce05957f2.json), [shared push and reset scripts](../assets/scripts/library2.rpgscript), and [plaque sprite](../assets/sprites/library2-shelf-reset.json). Both shelves pass their instance ID to `library2_pushShelf(instance)`; the fixed action calls `resetPropSlides(ShelfResetSafe)`. No engine changes or climb logic.

## Verification

- A finite search projected the footprints on the loaded room and used Johnathan's real walking pathfinder for the exact stands. It also checked a route to the reset stand from each of the 353 states it visited.
- An opt-in scratch playthrough drove a real `GameSession` with terminal mouse input and the project's Johnathan, Library 2, and Library 1. It matched the editor's preview helper to all four live settles (including the walking-clear boundary), exercised re-click and Cancel on both moved shelves, and used the existing lower exits to verify persistence and reset on re-entry. It compared the authored walking mask, existing placements, and door/exit trigger data with the pre-trial scene.
- Typecheck, lint (existing warnings), the room's RPGScript formatting check, and all 1,179 repository tests passed. No automated repository test reads the project assets. The editor UI itself and the room author's visual sign-off were not part of the scratch run.
