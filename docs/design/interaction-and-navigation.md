# Interaction, inventory, and navigation

[Design index](../../README.md)

## Scene operating modes

Each Scene has an operating mode that defines what activating a cell does. Initial modes are Walk Mode and Cursor Mode; additional modes can be added. The mode can interpret activation as movement, trigger activation, or another authored action. There is no default verb-selection menu.

Mouse activation and keyboard activation use the same game action. An animated keyboard cursor indicates the hovered cell; arrow keys move it and activation selects that cell. Exact cursor timing and bindings remain implementation details.

## Inventory

Inventory is one list of item-ID strings and can contain duplicates. Queries such as isInInventory inspect it; removing an item removes one occurrence. Pickup/drop behavior exposes events such as OnPickedUpItem and OnDroppedItem; final API spelling remains open.

In Walk Mode, players can select an item to hold. Trigger logic can query the active/held item. The UI supports combining items. Exact combination recipes, selection presentation, and consumption rules are content/API decisions still to be defined.

## Walking

A scene supplies a list of traversable tiles. Characters pathfind to clicked destinations using eight-way adjacency. Diagonals cannot cut blocked corners: both orthogonal tiles alongside the diagonal step must be traversable. Triggers can interrupt movement.

Characters use an animation state system with idle/facing and walking states for up, down, left, and right. During diagonal movement, horizontal direction determines facing and walking animation. Characters can define additional custom animations. This is the baseline animation model; independently animated puppet parts are not required by it.

Exact pathfinding algorithm, blocked-destination behavior, arrival/interact distance, and trigger interruption/resumption rules remain open.

## Viewport and UI

The target canvas is 120 by 40 cells, split into a top game area and a bottom UI area. Larger terminals center the target layout. Smaller terminals keep the UI accessible while the world camera/viewport scrolls. Do not scroll essential controls off-screen with the world.

Adjust the camera area to terminal dimensions. Exact game/UI height allocation, minimum terminal size, and scrolling/follow rules remain to be defined. Transform client coordinates through viewport offsets before scene hit testing; UI and world coordinates are distinct.

## Deferred content decisions

The first playable room and first scene-editor milestone remain for the user to choose. Earlier suggested room/puzzle examples and editor milestone lists are proposals, not selected content.
