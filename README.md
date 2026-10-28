# Incanterm

A server-run point-and-click terminal adventure with dialogue, puzzles, and cutscenes. The server runs the game and sends terminal output; clients display it and forward input. The Node.js testing client and browser support audio; ordinary SSH play is silent. A small native client is deferred. There is no client scripting layer.

The server draws one scene, [`assets/scenes/test-room.json`](assets/scenes/test-room.json): a small room with a single crate prop. Dialogue, puzzles, inventory, audio, and the SSH menu are not implemented yet. This repository has the development scaffold: a TypeScript server, a Node terminal client, a Vite browser client, and Vitest, ESLint, and Prettier.

The [asset editor](docs/design/assets-and-scene-editor.md) runs with `npm run editor` on port 7104. The older ed-ascii painter remains in `ed-ascii/` as an import source.

## Run

```text
npm install
npm run dev       # server on 7101/7102 and the Vite browser client on 7103
npm run client    # Node terminal client, in a second terminal
npm run scene     # print the test scene in this terminal
```

The game server listens on `127.0.0.1:7101` (HTTP and WebSocket) and `127.0.0.1:7102` (SSH). The Vite game client uses port 7103 and proxies `/ws` to the game server. Any SSH login is accepted; there are no accounts yet. Each connection receives the test scene. Gameplay input, audio playback, and the SSH menu are not implemented.

```text
ssh -p 7102 player@127.0.0.1
npm test              Vitest watch mode
npm run test:run      Tests once
npm run typecheck
npm run lint
npm run format:check
npm run build         Server, terminal client, and browser
npm start             Built server; serves dist/browser when it exists
npm run editor        asset editor on port 7104
```

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
