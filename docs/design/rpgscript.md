# RPGScript integration

[Design index](../../README.md)

## Decision

Use the user's RPGScript language from regem-ludos for server-side Script assets. Preserve its stage-play/movie-script authoring style. Rewrite loading and ScriptRunner to fit Incanterm's server and per-player sessions, and supply an Incanterm-specific scene command library.

The [extracted sources and editor tooling](../../reference/rpgscript-regem-ludos/README.md) are a reference snapshot, not integrated runtime code. This replaces the previously open script-language choice in [Scenes, entities, and scripts](scenes-entities-and-scripts.md). It does not introduce scripting in any client.

## Language to preserve

The existing implementation supports named scripts (`@name`), trigger definitions (`#name`), dialogue (`Character: "Text"`), command calls (`+command(...)`), conditionals and blocks, choices, substitutions, and script-to-script calls. Preserve existing syntax and semantics where applicable; inventory the existing tests and script corpus before changing behavior.

Existing authoring example:

```text
@test-callScript
  +setConversation('Conscience')
  Conscience: "This script tests `callScript`."
  +endConversation()
  +callScript('test-callScript2')
```

The example uses original commands for illustration, not a finalized Incanterm command contract.

## Server responsibilities

Separate these responsibilities rather than copying the browser's runtime unchanged:

- Asset loading: read script sources from server assets, parse them, retain filename/line locations, and report errors. Remove window/fetch-based loading assumptions. Exact packaging/discovery remains open.
- Definitions: retain immutable parsed scripts and trigger definitions, shareable across sessions.
- ScriptRunner: hold execution positions, evaluated block results, wait state, call stack, arguments, and completion/cancellation state per session/execution. Never share the original mutable Script instances between players.
- Commands and conditions: resolve names through Incanterm's registry and operate on an explicit context containing the owning session, Scene, state, and game services. Async completions must retain that context; remove global current-scene and sceneForCommands access.
- Scheduling: support simultaneous scripts, advancing from the session update flow and yielding for dialogue input, time, movement, and animation without blocking other sessions or rendering. Latest-wins behavior is acceptable for competing actions. Proposed scope is the affected entity/property (a new walk supersedes its old walk, not unrelated dialogue). Superseded waits must resolve as canceled rather than hang; continuing the waiting script is the proposed default. Exact completion API and cancellation result handling remain open.
- Triggers: connect parsed trigger definitions to Incanterm Trigger entities and scene hooks. Decide how old trigger event names map to click, scene-load, item-use, and region events; do not silently reinterpret them.

Use ScriptRunner as the execution name. The original project's Scene contains much of its scripting context; Incanterm's Scene means a room containing entities.

Scene changes rebuild the room and cancel room-owned scripts/actions. Session state, music, ongoing dialogue, and explicitly cross-room layers can persist; persistent work needs session/layer ownership. Session disposal cleans up all remaining work. Missing entity/marker references log a warning and skip the command. Other error classes still need defined behavior. A command loop should have a per-update work budget so a long immediate sequence cannot monopolize the server. Timing and work limits need explicit tests during implementation.

## Incanterm scene commands

Replace game-specific command implementations with an Incanterm library. Candidate groups, not finalized signatures:

| Group | Operations |
|---|---|
| Characters | Walk to a position/entity/marker, spawn at a marker, look at a marker, face a direction, play animation |
| Entities | Show/hide, move, enable/disable, change animation |
| Effects | Start/stop, configure interval/repetition |
| Dialogue/UI | Speak, choices, typed answers, interaction control |
| State | Read/write flags and variables, numeric updates, conditions |
| Inventory | Give/remove/check items |
| Scenes | Enter a room, place player, transition |
| Presentation | Sound/music cues, screen filters/transitions, fades, waits |

Scripts call server game functions. Audio commands send cues to capable clients and do not wait on audible playback for silent SSH sessions. Define authoritative sequence timing independently of audio availability.

Keep original commands and skip implementations as references, not required features. Finalize waiting versus immediate behavior, return values, argument types, and skip behavior for each supported command. Persist inventory/location/flags/vars, not runner stacks. Commit a save snapshot after room construction/restoration and before entry scripts; scripts can commit manually after sequences. Save requests export that snapshot, not live execution state. See [Local saves](saves.md).

## Language support and authoring tools

Preserve and adapt both extracted extensions:

- `rpgscript-vs`: TextMate syntax highlighting, language configuration, extension entry point, and language server providing diagnostics, completion, hover help, and definitions.
- `rpgscript-format`: document formatter.

The editor-side parser has extra reference tracking and adaptations. Keep that behavior when consolidating or sharing parser code. Runtime and editor diagnostics should agree on supported syntax and command names.

Configure script-root and command-source paths for Incanterm. Existing editor command discovery parses the shape of a TypeScript/JavaScript source registry; either retain its expected layout initially or update discovery. A shared command metadata catalog for validation, completion, signatures, and help is a proposal, not an implemented requirement.

## Adaptation outline

1. Establish parser behavior from the extracted examples and tests; isolate parsing from original game/browser dependencies.
2. Build server asset loading and immutable definitions with useful source diagnostics.
3. Implement a session-owned ScriptRunner and explicit command context.
4. Add a small command set for dialogue, waiting, flags, inventory, movement, and scene changes.
5. Verify two players can execute the same script independently, including waits and callbacks; check cleanup and save reconstruction.
6. Adapt editor command discovery and paths, then verify highlighting, diagnostics, completion, hover, definitions, and formatting against actual Incanterm scripts.

This extraction does not implement these steps. The planned Node.js/TypeScript server can adapt the TypeScript parser directly; see [Development and build](development-and-build.md).
