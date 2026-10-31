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
- Triggers: scene assets list named RPGScript triggers; entry dispatches their explicit `load` event. Click, item-use, and region event mappings are not yet implemented; do not silently reinterpret them.

Use ScriptRunner as the execution name. The original project's Scene contains much of its scripting context; Incanterm's Scene means a room containing entities.

Scene changes rebuild the room and cancel room-owned scripts/actions. Session state, music, ongoing dialogue, and explicitly cross-room layers can persist; persistent work needs session/layer ownership. Session disposal cleans up all remaining work. Missing entity/marker references log a warning and skip the command. Other error classes still need defined behavior. A command loop should have a per-update work budget so a long immediate sequence cannot monopolize the server. Timing and work limits need explicit tests during implementation.

## Incanterm scene commands

### Script parameters and locals

```rpgscript
@test_args
  +:test_args_2("a", "b")

@test_args_2(arg1, arg2)
  +log("Args [arg1] [arg2]")
  +[arg1]="updated"
```

Each invocation binds its declared parameters to a separate local scope, including
nested and recursive calls. `[name]` reads a local; `{name}` reads session-global
storage. Passing arguments does not write globals. `+[name]=value` (or
`+setLocal(name, value)`) updates a declared local. Bare `+name=value` still writes
global storage. Unquoted references preserve value types; references inside strings
interpolate as text. Calls also accept numbers and booleans; quoted call arguments
remain strings. Argument values are evaluated in the caller before binding the callee.

The runtime and editor reject undeclared locals and incorrect argument counts.
The editor warns `Did you mean [name]?` when `{name}` matches a local parameter;
global existence is not checked. Signatures have no defaults or rest parameters.
Trigger and choice targets supply zero arguments. `@name` and `@name()` both declare
zero-argument scripts.

### Global storage assignments

`eq` returns false if either resolved operand is `undefined`, including when both
are undefined. Two unset globals therefore do not satisfy a trigger's equality
condition. Defined values still use strict equality: `0`, `false`, and `""` each
equal themselves. Quoted interpolation still converts missing values to empty
strings, so use unquoted references such as `eq({vars.a}, {vars.b})` when checking
stored values.

Use `+key=value` as shorthand for `+setStorage(key, value)`:

```rpgscript
+a=true
+vars.tmp=7
+b={vars.tmp}
+c=4
```

Assignments work at top level, inside conditional blocks, and in inline branches (`+?is(a):+c=4`). Whitespace around `=` and a trailing semicolon are optional. Keys can contain underscores, dots, and legacy hyphens. Values follow `setStorage`'s scalar argument conventions (booleans, numbers, and strings); quote strings containing spaces or punctuation.

An unquoted `{key}` on the right-hand side reads that exact session-storage key when the assignment executes, preserving its value's type. This also works in `+setStorage(b, {vars.tmp})` and unquoted condition arguments such as `eq({score}, 0)`. Any missing key resolves to `undefined` and execution continues; the same applies when the source is explicitly `undefined`. In dialogue, logs, choices, and text arguments (including quoted storage values and condition arguments), `{key}` interpolates the value as text at execution time (`0` and `false` become `"0"` and `"false"`). Missing values inside text become empty strings. For example, `+setStorage(message, "Hello {name}")` stores a string, while `+setStorage(message, {name})` preserves the source's type. Script and choice targets remain static names.

The destination can also be a storage reference: `+someVar=a` followed by `+{someVar}=2` sets `a` to `2`. This is equivalent to `+setStorage({someVar}, 2)`. The destination is resolved once at execution time and must contain a non-empty string key; otherwise the runner reports a file-and-line error. Both sides may be references, as in `+{vars.destination}={vars.source}`. A quoted destination such as `+setStorage("{someVar}", 2)` uses the literal key `{someVar}`.

### Conversation portraits

`+setConv(johnathan1_0)` writes `dialogue.portraitLeft` before the next `playDialogue`. The value may also come from an interpolated string or a script parameter, e.g. `+setConv([port])`. Sprite-sheet IDs use an explicit zero-based suffix (`johnathan1_0`, `johnathan1_1`); animation IDs use their own name (`test1anim`). While dialogue is active, it replaces the tab strip with a double-bordered dialogue panel filling the UI below the world divider. A resolved portrait appears at left in a single-bordered box; animations advance according to their frame durations. The portrait is centered and cropped to fit when necessary, and text wraps in the remaining space. If the name is empty or not found, the dialogue remains readable without a portrait. `+setConv("")` clears the portrait for following lines. The session timer stops when dialogue ends or the connection closes; the scene-free CLI prints the portrait's ASCII glyphs and a blank line as soon as `setConv` executes (only frame 0 for animations, without playback), rather than reprinting it for each dialogue line.

### Command groups

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

Prefer underscores (`_`) over hyphens (`-`) in RPGScript script and trigger names and other author-defined identifiers—for example, `test_goodbye` rather than `test-goodbye`. Underscores make it easier to select the whole name with a double-click or word-selection shortcut in the editor.

Preserve and adapt both extracted extensions:

- `rpgscript-vs`: TextMate syntax highlighting, language configuration, extension entry point, and language server providing diagnostics, completion, hover help, and definitions.
- `rpgscript-format`: document formatter.

The editor-side parser has extra reference tracking and adaptations. Keep that behavior when consolidating or sharing parser code. Runtime and editor diagnostics should agree on supported syntax and command names.

The workspace config points the existing language extension at `src/game/rpgscript/scene-commands.ts`. Its `commands = { ... }` export and matching `const` declarations are deliberately shaped for the extension's command discovery, completion, signatures, hover, and definitions. The runner imports this same catalog to construct supported commands. The `showChoices` entry is needed because the editor parser emits that command for `$` blocks; authors should use `$` choice syntax, not call `showChoices` directly.

Use `+?else:{ ... }` for an else block or `+?else:+command(...)` for an inline
else branch. Parentheses are optional for `else`; the older `+?else():` spelling
has identical behavior and remains supported.

## Adaptation outline

1. Establish parser behavior from the extracted examples and tests; isolate parsing from original game/browser dependencies.
2. Build server asset loading and immutable definitions with useful source diagnostics.
3. Implement a session-owned ScriptRunner and explicit command context.
4. Add a small command set for dialogue, waiting, flags, inventory, movement, and scene changes.
5. Verify two players can execute the same script independently, including waits and callbacks; check cleanup and save reconstruction.
6. Adapt editor command discovery and paths, then verify highlighting, diagnostics, completion, hover, definitions, and formatting against actual Incanterm scripts.

The adapted parser runs without its original browser globals or Scene runtime. A session-owned `ScriptRunner` now executes dialogue, script calls, `setStorage`, `log` (server-side logging), `awaitChoice`, and `$` choices (choice targets are script names). It evaluates `is`, `isnot`, `eq`, numeric `gt`/`lt`, `all`, `any`, `once`, and `oncePerInstance` against session storage; a block's condition is cached for that invocation, even if commands within the block change storage. `lastChoiceIndex` is zero-based. Numbered choices (1–9) are accepted by game-session input. Other commands and game-specific conditions (such as `with`, `as`, and `func`) fail with a source location instead of pretending to run. The existing RPGScript language extension remains in use; no second extension is needed.

For scene-free smoke tests, `npm run run-rpgscript -- "testRoomEntry()"` loads every RPGScript under `assets/scripts`, creates a temporary inline call, and runs it through the same session runner. `--assets path` selects a different asset root. The terminal shim clones the command catalog, printing dialogue and logs, retaining storage and script-call semantics, and prompting for numbered `$` and `awaitChoice` options. Unknown commands are errors in both loaded assets and inline snippets, with a file/line location and a nonzero CLI exit status. Use `+:testArgs()` to call a script inside a snippet; `+testArgs()` instead names a command and errors if that command is unknown. Unsupported conditions and unresolved script calls also report errors.

Incanterm also supports `+?else():{ ... }` and inline `+?else():+command(...)` after a conditional at the same block depth. `else()` uses the prior branch's **cached result**, not its condition re-evaluated after commands change storage. A second `else`, an orphan `else`, or an `else` separated from its `if` by an unconditional command is an error. Parent branches likewise keep their cached result across nested blocks. The existing Cursor extension's hard-coded condition list was updated in `C:/progs/regem-ludos/rpgscript-vs`; its language server was rebuilt, and the installed `incanterm.rpgscript-vs-0.0.1` parser was patched without replacing its other local changes. Its TextMate and Iro grammars and the bundled reference were also updated so `else` and conditional and command-call parentheses receive the control-flow scope. Both parsers lint a braced example without diagnostics. Reload Cursor to pick up changes to the installed grammar or language server. Runtime validation of orphan/duplicate `else` branches is stricter than the editor parser's syntax validation.

Triggers are loaded and validated with shared definitions and dispatched with `runner.dispatchTrigger(name, TriggerType.ACTION)` (or another **explicit RPGScript event type**). A scene asset's `triggers` array binds RPGScript `#name` definitions to that scene; session entry dispatches the `load` event for each bound trigger. For example, `"triggers": ["room-entry"]` and `#room-entry` followed by `load,intro` run `@intro` when the scene opens. Missing references fail server startup. Entry triggers run in scene order as the runner becomes idle; later ones wait for an earlier dialogue to finish. The first matching, passing call for a trigger runs only when the runner is idle. `oncePerInstance` needs an explicit third `instanceId` argument, which carries into scripts called from that trigger. Other scene-to-event mappings (`action`, item, region) remain unconnected. Storage and once keys are session-local and not yet persisted. Trigger targets with arguments, waits, inventory, effects, and other scene commands are not implemented. See [Development and build](development-and-build.md).

The adapted parser uses plain script/trigger records and local builders instead of the old mutable `Script`/`Trigger` instances. It does not allocate the original dialogue-sound bookkeeping until audio support exists. The loader freezes conditions, blocks, steps, and definitions; each runner retains its own mutable call stack, storage, once keys, and dialogue/choice position. Parser state is per call, so reusing a parser does not leak definitions between files or players. The nested-condition scanner keeps outer block conditions when an inner block ends.
