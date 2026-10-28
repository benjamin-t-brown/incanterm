# Clients, protocol, and access

[Design index](../../README.md)

## Server ports

Default development listeners:

| Listener | Port | Purpose |
|---|---|---|
| HTTP / WebSocket | 7101 | REST API, browser/assets, and live Node/browser connections |
| SSH | 7102 | Interactive terminal connections |
| Vite game client | 7103 | Development page for the browser client. Production serves that page from 7101 |
| Asset editor | 7104 | Sprite, animation, sound, and script tools, including `/api` |

Local examples: `http://localhost:7101/play`, `http://localhost:7103/`, `http://localhost:7104/`, and `ssh -p 7102 localhost`. WebSocket connections share the HTTP listener through an upgrade request. The scaffold listens on these ports. Each game connection receives the test scene. The asset editor is a separate Vite app and does not start the game server.

## Client protocol and later native client

Use WebSocket for live Node/browser sessions and an SSH channel for ordinary terminal sessions, both adapted to the same session system. HTTP supplies a simple REST API and browser/assets serving. Node's ssh2 library is the proposed SSH implementation; ws is the proposed WebSocket library. No operating-system shell or separate game process is required for SSH. Keep a persistent SSH host key. Final dependency versions, authentication/session attachment, and API paths remain to be specified.

Use framed WebSocket messages with distinct types for terminal data and audio commands. Suggested types include terminal-data, play-sound, stop-sound, input, resize, and session-status; exact encoding, reconnect behavior, and asset delivery remain to be designed. The SSH adapter carries terminal bytes and translates supported input, resize, and save interactions.

Audio commands identify assets and playback options; they are not shell commands or executable scripts. Keep them separate from bytes written to the terminal. SSH exposes the terminal stream without audio; the Node.js and browser clients handle audio through their local playback facilities.

The server's per-session audio controller emits these cues from actions/scripts, independently of visual rendering. See [Presentation and audio](presentation-and-audio.md) for timing and lifecycle responsibilities.

The deferred native client can be a small C/C++ program with terminal I/O, networking, and SDL audio. It uses the player's existing terminal, not a new terminal emulator. Audio may run in-process; a helper process is optional and must close with the application. Duktape, QuickJS, QuickJS-NG, Bun, and other embedded scripting runtimes are unnecessary for this thin-client design.

## Terminal controls

The terminal client manages terminal setup and restoration, raw input without automatic echo, and forwarding keyboard/mouse input and resize events. The server's terminal stream controls cursor visibility and display. The server game layer supplies action mappings, option selection, text editing, and scene navigation. Select input and rendering libraries during implementation rather than requiring termbox2 in every client.

Support terminal mouse reporting for clicking destinations, objects, dialogue choices, and inventory cells where the player's terminal supports it. Preserve keyboard equivalents. Browser input should map to equivalent server actions.

Traditional terminal input does not reliably report key releases. Design baseline controls around discrete presses and destination selection rather than simultaneous held keys. Enhanced keyboard protocols could be investigated later.

## SSH and browser entry choices

An SSH connection should offer these two paths:

```text
Welcome to Incanterm

[ Continue in SSH - no sound ]
[ Play in browser - with sound ]
```

SSH play is silent. Browser play is the full game with integrated music and sound effects, not a companion audio page. There is no audio pairing flow.

Choosing browser play displays a full web URL. Use an OSC 8 terminal hyperlink where supported, while always displaying the URL as readable text for copying or terminals without clickable links. Do not automatically launch a browser.

Example only; no domain has been selected or registered:

```text
Open Incanterm in your browser:

https://incanterm.com/play

Click the link, or copy it into your browser.

[ Back ]
```

The browser uses WebSocket; its terminal-emulation implementation remains to be chosen. All access paths connect to the server-run game and share its rules and content. Session transfer between access paths has not been specified.
