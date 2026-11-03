# Interaction, inventory, and navigation

[Design index](../../README.md)

## Scene operating modes

Each Scene has an operating mode that defines what activating a cell does. Initial modes are Walk Mode and Cursor Mode; additional modes can be added. The mode can interpret activation as movement, trigger activation, or another authored action. There is no default verb-selection menu.

Mouse activation and keyboard activation use the same game action. An animated keyboard cursor indicates the hovered cell; arrow keys move it and activation selects that cell. Exact cursor timing and bindings remain implementation details.

## Inventory

Inventory is one list of item-ID strings and can contain duplicates. Queries such as isInInventory inspect it; removing an item removes one occurrence. Pickup/drop behavior exposes events such as OnPickedUpItem and OnDroppedItem; final API spelling remains open.

In Walk Mode, players can select an item to hold. Trigger logic can query the active/held item. The UI supports combining items. Exact combination recipes, selection presentation, and consumption rules are content/API decisions still to be defined.

## Walking

A scene supplies row-major `blockedCells`; reusable prop blocked cells and other characters' bottom cells also block walking. Characters pathfind to clicked destinations using eight-way adjacency. Diagonals cannot cut blocked corners: both orthogonal tiles alongside the diagonal step must be traversable.

In a scene-load script, `+setPlayerWalkCh(hero)` selects a character by scene entity ID, instance name, or character asset ID (in that order). Each player session owns its selection and character positions. Clicking a trigger attempts its Action event first, using the trigger instance ID; if no action activates, the selected character walks to the clicked cell. Successful actions stop the current path. For blocked, occupied, or unreachable destinations, the character walks to the reachable tile nearest the click by straight-line distance, breaking ties by shortest walking path. If its current tile is already the best candidate, it stays there.

Character assets and scene character instances accept an optional `speed` in milliseconds per cell (1–60000, default 150); an instance value overrides the asset value. Cardinal and diagonal steps have the same delay. Walking uses `walk` animations and returns to `idle` on arrival. Occupancy is rechecked before each step. Browser clicks and terminal SGR left-button presses are transformed into scene coordinates; UI and margin clicks are ignored.

Characters use an animation state system with idle/facing and walking states for up, down, left, and right. During diagonal movement, horizontal direction determines facing and walking animation. Characters can define additional custom animations. This is the baseline animation model; independently animated puppet parts are not required by it.

Paths use breadth-first search with equal-cost steps. Action triggers currently activate at the clicked region without requiring the character to approach it first.

## Viewport and UI

The standard scene viewport is 120 by 40 cells. A fixed 16-row UI panel overlays its bottom rows, with an `=` line at the top of the overlay. The UI does not shrink or recenter the scene viewport; covered scene cells remain underneath it, and UI clicks do not pass through to the scene. Larger terminals center the layout. Smaller terminals crop the canvas while retaining the UI's center and some world down to 40 by 16 cells. Below that size, display a minimum-size warning. Do not scroll essential controls off-screen with the world.

Adjust the camera area to terminal dimensions. The minimum terminal size is 40 by 16 cells; scrolling/follow rules for moving scenes remain to be defined. Transform client coordinates through viewport offsets before scene hit testing; UI and world coordinates are distinct.

## Deferred content decisions

The first playable room and first scene-editor milestone remain for the user to choose. Earlier suggested room/puzzle examples and editor milestone lists are proposals, not selected content.
