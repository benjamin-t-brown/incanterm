# Server UI system

[Design index](../../README.md)

## Server UI tree

UI code lives in ui/, separate from game logic. UIElement represents a screen element with an id, bounds, enabled/visible state, parent, and children. Elements update and draw themselves, and support recursive findById(id) lookup within their subtree.

Each layer can own a root UIElement. Define traversal in the base implementation: update the parent and then children; draw the parent and then children so children overlay its background. Later siblings draw above earlier siblings. Hit-test in reverse drawing order. Child ownership in the tree does not mean children draw behind their parent.

Keep keyboard focus and optional mouse capture per session. The focused control receives text input; keyboard navigation remains available for mouse-driven controls. The server builds and renders these trees because it generates the client frames.
