# System architecture

[Design index](../../README.md)

## Architecture

```text
Game server: rules, state, dialogue, puzzles, saves, cutscenes, rendering
       │
       ├─ Node.js terminal client (testing): display, input, local audio
       ├─ SSH session: existing terminal, input, no audio
       └─ Browser client: terminal-style display, input, browser audio

Later: small native C/C++ terminal client with local audio
```

- The server owns game execution, authoritative state, game actions, scene progression, animation timing, and terminal output generation.
- Start with a Node.js client for testing. It connects and maintains the session, writes received terminal sequences to the existing terminal, forwards input and resize events, and plays sound cues locally.
- There is no client scripting layer or embedded JavaScript engine. Node.js is the testing client's implementation runtime, not a mechanism for executing game scripts received from the server.
- Clients do not run puzzle rules or render scenes from game logic. They display the server's terminal stream and handle presentation-side audio commands.
- Keep the protocol independent of Node.js so a small native client can implement it later.
- The planned server uses Node.js/TypeScript with HTTP/REST/WebSocket and SSH adapters. See [Development and build](development-and-build.md). A later small native terminal client remains optional.
- Preserve SSH and browser access. Give SSH players direct access to the game rather than an operating-system shell.
- Wish plus a pseudo-terminal-hosted termbox2 game was the original SSH proposal. It remains an implementation candidate, not a mandatory stack for the revised architecture.

## References

- [Wish](https://github.com/charmbracelet/wish)
- [Wish command and pseudo-terminal support](https://github.com/charmbracelet/wish/blob/main/cmd.go)
- [termbox2](https://github.com/termbox/termbox2)

This is an architecture note, not an implemented server or game.
