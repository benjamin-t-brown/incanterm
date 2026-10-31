# Scenes, entities, and scripts

[Design index](../../README.md)

## Object-oriented model

Use an object-oriented design, not an Entity Component System (ECS). Scenes contain entity objects, and objects own their state and behavior. Share reusable helpers such as animation players through composition rather than requiring a deep inheritance tree.

All game objects and scripts execute on the server within a player's GameSession. Clients receive terminal output and audio cues; they do not execute game scripts. See [System architecture](architecture.md) and [Server and sessions](server-and-sessions.md).

## Scenes

A Scene is a room or other playable location that contains entities. It coordinates their updates, rendering, and scene events under the session's layer control flow. A scene is game content, not a replacement for LayerManager: exploration, dialogue, inventory, and other layers manage interaction around it.

Separate scene asset definitions from runtime instances. A definition describes starting content; each session creates its own instances and applies its saved progress. Shared assets must not hold mutable per-player state.

Loading constructs the scene from its definition and saved state, including room, player x/y, inventory, flags, and variables. For example, an already collected item must not reappear. Exact scene asset schema, load-event ordering, and transition lifecycle remain open.

## Entities

Entity is the common base for scene objects. Use stable IDs for content references and save-state reconstruction. The initial types are extensible:

| Type | Behavior |
|---|---|
| Character | An animatable puppet with facing/direction and its own animation set. Tracks current animation and position. |
| Prop | A widget-like world object that updates and renders a static sprite or animation. Occupies space and can have a drawing depth so other entities appear in front or behind it. |
| Background | A specialized Prop drawn behind world entities. It uses a dedicated background ordering pass rather than world z/depth space, typically for a background image. |
| Effect | An activatable/deactivatable sprite, animation, or particle system. Can run at intervals or be activated by a trigger or game action. |
| Trigger | An invisible region or scene hook that responds to player/game events, tests conditions, and starts a Script when eligible. |
| Item | A Prop that the player can pick up and add to inventory. |

Conceptual inheritance:

```text
Entity
├─ Character
├─ Prop
│  ├─ Background
│  └─ Item
├─ Effect
└─ Trigger
```

Entities participate in update/render and relevant event handling. Invisible entities need no visible render output. Exact base interfaces and subtype properties remain to be specified.

Entity objects are separate from [UIElement](ui.md) objects. A world door is a Prop; dialogue panels and inventory controls belong to UI trees. Scripts coordinate the world and UI through game functions.

Reusable prop assets hold the visual, footprint, blocking, and depth offsets; scene entities supply position and instance identity. See [Prop definitions](assets-and-scene-editor.md#prop-definitions) for the authoring schema. Backgrounds and Items can reuse prop behavior, but have their own scene-level semantics.

Scenes define operating modes, traversable tiles, and inventory interaction as described in [Interaction and navigation](interaction-and-navigation.md). Character animation states cover four-direction idle/facing and walking plus custom states; diagonal movement uses horizontal-facing animation.

## Drawing and space

Backgrounds draw first; world entities draw in depth order. Backgrounds do not participate in world z sorting. The ordering of multiple backgrounds must be deterministic.

Each scene has one fixed depth mode: Bottom Up or Regular Z. Bottom Up uses the entity's world ground-anchor Y plus a depth offset; Regular Z uses an explicit entity z value. Smaller depths draw first, and equal depths preserve stable scene order. See [Rendering](rendering-and-animation.md) for details. Drawing depth and movement obstruction are separate concerns: being drawn in front of something does not imply blocking it.

## Markers

A Scene also owns named locations called Markers. They are visible only to developers in the scene editor or debug overlay and are invisible during normal gameplay. Markers are exported with the scene because the server needs their coordinates. Names are unique within a scene.

Markers are simple location data, not visible props or updating/colliding entities. Scripts can reference them for operations such as SpawnAtMarker, WalkToMarker, and LookAtMarker. Exact command names/signatures remain to be finalized in [RPGScript](rpgscript.md).

```json
"markers": [
  { "id": "entrance", "x": 12, "y": 28 },
  { "id": "door-approach", "x": 84, "y": 25 }
]
```

Scene and asset authoring is described in [Assets and scene editor](assets-and-scene-editor.md).

## Triggers

A Trigger receives relevant events, evaluates logic/conditions, and activates a Script if eligible. Events can originate from the player or the game, including clicking a region, entering a region, scene load/entry, using an item, or explicit activation. Scene-wide hooks do not require a physical region.

Example:

```text
Event: click observatory door
Conditions: inventory contains brass_key; observatory_unlocked is false
Action: start unlock_observatory script
```

Proposed activation policies are once, once per scene visit, and repeatable. Guard against unintentionally starting the same script multiple times while it is running. Persistent once-only behavior can be represented with a saved flag. Simultaneous scripts are supported, with latest-wins acceptable for conflicting actions; exact trigger policy defaults remain open.

## Scripts

A Script is a game asset loaded on the server. It calls game functions to change state or perform actions such as dialogue, movement, animations, audio, effects, and scene transitions. This is a server content mechanism; there is no client scripting layer.

Example sequence, illustrating behavior rather than a chosen syntax:

```text
Disable player interaction
Walk player to door
Face player north
Play sound key_turn
Set flag observatory_unlocked
Play door animation open
Say player: "Finally."
Wait for player to advance dialogue
Change scene to observatory
```

Use the user's RPGScript language from regem-ludos. Preserve its screenplay-like syntax while rewriting the ScriptRunner and loading code for server sessions and providing Incanterm-specific scene commands. See [RPGScript integration](rpgscript.md) for the design and extracted source/tooling references.

Scripts wait for actions or player input without blocking the session's update/render loop. Execution API, cancellation, error handling, scheduling, and the final scene-command catalog remain to be designed. No client scripting engine is needed.

## Save integration

Use the existing [local save model](saves.md): inventory, room and position, flags, and variables reconstruct game state and scene instances. Do not serialize live entity objects, UI trees, or script execution stacks.

Save requests export the latest committed snapshot. Commit after room construction/restoration and before room-entry scripts, with explicit commits available after authored sequences. Live script execution is not serialized. See [Local saves](saves.md).

## Room change lifecycle

Changing scenes rebuilds the room and cancels its scripts/actions. Session state and music persist; active dialogue and explicitly cross-room layers can persist too. Persistent work must belong to the session/persistent layer rather than to a destroyed room. Exact ownership APIs remain open. A missing script entity/marker reference logs a warning and skips the affected command rather than stopping the game.
