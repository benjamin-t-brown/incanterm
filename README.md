# Incanterm

A server-run point-and-click terminal adventure with dialogue, puzzles, and cutscenes. The server runs the game and sends terminal output; clients display it and forward input. The Node.js testing client and browser support audio; ordinary SSH play is silent. A small native client is deferred. There is no client scripting layer.

The server draws one scene, [`assets/scenes/test-room.json`](assets/scenes/test-room.json): a small room with a single crate prop. An RPGScript dialogue plays on entry; puzzles, inventory, audio, and the SSH menu are not implemented yet. This repository has the development scaffold: a TypeScript server, a Node terminal client, a Vite browser client, and Vitest, ESLint, and Prettier.

The [asset editor](docs/design/assets-and-scene-editor.md) runs with `npm run editor` on port 7104. The older ed-ascii painter remains in `ed-ascii/` as an import source.

Editor saves send the last loaded/saved version along with the draft. The server rereads disk, merges
independent changes, and rejects overlapping edits without overwriting the file. This shared path
covers sprites, animations, scripts, palettes and reference placement; sprite cells and separate
script lines can merge independently. Reordered/structurally changed lists cannot be safely merged
without stable identities. Binary reference images use a revision check instead of attempting to
merge pixels. On conflict, review the still-open draft (or use Save As for sprites).

## Run

```text
npm install
npm run dev       # server on 7101/7102 and the Vite browser client on 7103
npm run client    # Node terminal client, in a second terminal
npm run scene     # print the test scene in this terminal
npm run test:ui   # interactive BorderBox gallery in this terminal
```

The game server listens on `127.0.0.1:7101` (HTTP and WebSocket) and `127.0.0.1:7102` (SSH). The Vite game client uses port 7103 and proxies `/ws` to the game server. Any SSH login is accepted; there are no accounts yet. Each connection receives the test scene. Only dialogue advancement is handled as gameplay input so far; audio playback and the SSH menu are not implemented.

```text
ssh -p 7102 player@127.0.0.1
npm test              Vitest watch mode
npm run test:run      Tests once
npm run test:ui -- border-box   Interactive UI component gallery (↑/↓ scroll, q quit)
npm run test:ui -- --list       List available galleries
npm run test:ui -- border-box --plain   Print a noninteractive, uncolored frame
npm run typecheck
npm run lint
npm run format:check
npm run build         Server, terminal client, and browser
npm start             Built server; serves dist/browser when it exists
npm run editor        asset editor on port 7104
```

## RPGScript dialogue smoke test

Run `npm run dev` and connect using `npm run client`, the browser, or SSH. The test room
plays [`assets/scripts/test-dialogue.rpgscript`](assets/scripts/test-dialogue.rpgscript) on
entry. Press Space or Enter to advance each line. Restart the server after editing scripts.
Run `npm run test:run -- src/game/rpgscript/index.test.ts src/server/server.test.ts` to test
parsing, independent player state, and game connections.

For a fresh checkout, follow [Install RPGScript support in Cursor](docs/rpgscript-cursor-setup.md)
to build and install the bundled language extension. The guide includes workspace settings,
verification, and updates. Configure it to use `assets/scripts` and the command catalog in
`src/game/rpgscript/scene-commands.ts`. Reload the Cursor window after changing the settings
or the catalog so the language server refreshes its command cache.
The server parses scripts with an adaptation of the original RPGScript parser. Its **runner**
executes dialogue, script calls, state flags, supported conditions, and choices per session.
Triggers are dispatchable by explicit RPGScript event name but are not yet mapped to scene
interactions; unsupported game-specific commands fail with a file/line error at startup.

To run a script without a scene, use `npm run run-rpgscript -- "testRoomEntry()"` (or
`npm run run-rpgscript -- --assets path/to/assets "scriptName()"`). It loads all scripts,
prints dialogue and logs, prints the selected portrait's ASCII glyphs (animation frame 0 only),
prompts for numbered choices, and reports unknown commands as errors.
You can also pass a command snippet, such as `'+log("Hello")'`. The terminal shim does not
alter how unsupported commands behave in the game server.

## Isolated loopback playtests

Run `npm run loopback -- --scene test-room` in a terminal to start the
server and terminal client in one process. Both network ports are bound to `127.0.0.1` on
ephemeral ports, and the SSH key is generated in memory. Press `~` to switch between the game

Automated tests can call `startLoopback` from `src/loopback/start.ts` with `sceneId` and
`assetsRoot`, then send input and assert on actual WebSocket frames.
`npm run test:run -- src/loopback` runs the isolated integration and input tests.

## Visual UI tests

Visual UI tests use the same `CellBuffer` and component drawing code as the game. Add a gallery to
`src/renderer/ui/visual-tests.ts` and register it in `visualTests`; `test:ui` handles terminal input,
resizing, and cleanup. Run the command in a real terminal for interaction; redirected output uses
the plain-text frame. These tests complement, rather than replace, automated Vitest assertions.

## Design documents

| Document                                                                    | Contents                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Project overview](docs/design/overview.md)                                 | Game direction and implementation outline                                        |
| [Development and build](docs/design/development-and-build.md)               | Vite, tsx, esbuild, Vitest, ESLint, Prettier, and planned commands               |
| [Scenes, entities, and scripts](docs/design/scenes-entities-and-scripts.md) | Object-oriented room model, entity types, triggers, and server-side scripts      |
| [Interaction and navigation](docs/design/interaction-and-navigation.md)     | Scene modes, inventory, eight-way paths, animation facing, and viewport behavior |
| [RPGScript integration](docs/design/rpgscript.md)                           | Language reuse, server runner/loading rewrite, commands, and editor tooling      |
| [Assets and scene editor](docs/design/assets-and-scene-editor.md)           | Asset formats, ed-ascii expansion, scene authoring, and rapid preview loop       |
| [System architecture](docs/design/architecture.md)                          | Server/client responsibilities, architecture diagram, and library candidates     |
| [Clients and protocol](docs/design/clients-and-protocol.md)                 | Testing and native clients, message types, input, audio, SSH/browser entry       |
| [Server and sessions](docs/design/server-and-sessions.md)                   | Folder organization, layers, event routing, per-player state, and lifecycle      |
| [UI system](docs/design/ui.md)                                              | UIElement trees, drawing order, recursive lookup, focus, and mouse capture       |
| [Local saves](docs/design/saves.md)                                         | JSON schema, defaults, local storage, copyable codes, and loading                |
| [Rendering and animation](docs/design/rendering-and-animation.md)           | Depth modes, render passes, filters/transitions, debug overlays, and animation   |
| [Presentation and audio](docs/design/presentation-and-audio.md)             | Event-driven sound, audio controller, shared timing, and client playback         |
| [Art tools](docs/design/art-tools.md)                                       | Drawing, image conversion, and video conversion candidates                       |

Confirmed decisions and proposals are distinguished in the relevant documents. The planned server uses Node.js/TypeScript; exact wire encoding, reconnect details, and several asset formats remain open. Keep future notes in the document for their subject; keep this README as the entry point.
