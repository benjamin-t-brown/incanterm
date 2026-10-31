# Server UI system

[Design index](../../README.md)

## Server UI tree

UI code lives in ui/, separate from game logic. UIElement represents a screen element with an id, bounds, enabled/visible state, parent, and children. Elements update and draw themselves, and support recursive findById(id) lookup within their subtree.

Each layer can own a root UIElement. Define traversal in the base implementation: update the parent and then children; draw the parent and then children so children overlay its background. Later siblings draw above earlier siblings. Hit-test in reverse drawing order. Child ownership in the tree does not mean children draw behind their parent.

Keep keyboard focus and optional mouse capture per session. The focused control receives text input; keyboard navigation remains available for mouse-driven controls. The server builds and renders these trees because it generates the client frames.

The standard scene UI uses a TabbedView inside its fixed 16-row panel. Log, Inventory, and Menu have three-row bordered buttons (double border when selected, single otherwise). Each tab owns a separately scrollable, clipped BorderBox that fills the space below the buttons. Tab/Shift-Tab switches tabs; Up/Down and Page Up/Down scroll the selected pane.
While RPGScript dialogue is active, a double-bordered dialogue panel replaces the tabs in the area beneath the world divider. `setConv` selects an optional left portrait from a sprite-sheet frame (`name_0`) or animation (`name`), rendered inside a single border; dialogue text wraps beside it. The tabs return after dialogue ends, and portrait animations redraw while the connection is open. Inventory and Menu content and pointer hit-testing remain to be implemented.
