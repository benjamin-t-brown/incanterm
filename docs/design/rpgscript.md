# RPGScript integration

[Design index](../../README.md)

## Decision

Use the user's RPGScript language from regem-ludos for server-side Script assets. Preserve its stage-play/movie-script authoring style. Rewrite loading and ScriptRunner to fit Incanterm's server and per-player sessions, and supply an Incanterm-specific scene command library.

The [extracted sources and editor tooling](../../reference/rpgscript-regem-ludos/README.md) are a reference snapshot, not integrated runtime code. This replaces the previously open script-language choice in [Scenes, entities, and scripts](scenes-entities-and-scripts.md). It does not introduce scripting in any client.

## Language to preserve

The existing implementation supports named scripts (`@name`), trigger definitions (`#name`), dialogue (`Character: "Text"`), command calls (`+command(...)`), conditionals and blocks, choices, substitutions, and script-to-script calls. Preserve existing syntax and semantics where applicable; inventory the existing tests and script corpus before changing behavior.

### Character subscripts

`+callChSubscript(Ralgo, moveToBoard)` starts `@moveToBoard(ch)` independently of
the main script runner. The first argument resolves a character using the usual
character references; `[ch]` receives its scene instance ID. Each character has
one background task with its own call stack, locals, and waits. Calls for a busy
character are ignored; different characters can run simultaneously. Ordinary
`+:helper([ch])` calls stay within that character's task.

Talking to a character marks it busy until the conversation ends. Direct subscript
calls and character timer ticks skip busy characters without queuing. Use
`+setBusy(Ralgo, true)` to mark a character busy manually and
`+setBusy(Ralgo, false)` to clear that manual state. Character references and local
arguments work as usual (`+setBusy([ch], true)`). Conversation and manual busy
states are independent: ending a conversation does not clear a manual busy flag,
and clearing the manual flag does not release a character still in conversation.
Busy flags prevent new tasks; they do not cancel an already-running subscript.

Globals and once keys are shared with the session, so assignments such as
`+tmp.ralgoMoveVar=1` are visible to the main timer script. Tasks advance on scene
updates even while the main runner waits or displays dialogue, and are discarded
on scene changes or session close. Dialogue and choices must run on the main
runner; attempting them in a character task reports a script error.

```rpgscript
@moveToBoard(ch)
  +walkToMarker([ch], ralgo1)
  +setFacing([ch], left)
  +tmp.ralgoMoveVar=1
```

### Timer triggers

Bind a timer trigger to a scene through its `triggers` array (for example,
`"triggers": ["classroom1Updater"]`):

```rpgscript
#classroom1Updater
  timer,classroom1Updater,1000
@classroom1Updater
  +log("Tick!")
```

`timer,scriptName[,intervalMs]` repeats after each interval, starting one interval
after scene entry. The interval defaults to 1000 ms and must be a positive finite
number. Each binding has its own session-local clock. Leaving the scene removes
its timers; entering a scene resets them. Timers defer while the runner is busy,
coalescing missed ticks into one firing rather than replaying a backlog. Timer
conditions are evaluated when due, using the usual trigger condition syntax.

To run the timer on a character's independent subscript runner, use
`timer,scriptName,characterNameOrId,intervalMs`:

```rpgscript
#classroom1Updater
  timer,classroom1Updater,Ralgo,2000
@classroom1Updater(ch)
  +walkToMarker([ch], ralgo1)
```

The target must take exactly one parameter; `[ch]` receives the resolved character
instance ID. Character timers run even while the main runner is busy. If that
character already has a subscript running, the tick is skipped without queuing or
restarting it. Conditions run with the character's instance ID, and ordinary calls
inside the timer script stay on that character's runner. The scene editor uses the
same TIMER option for both forms; the RPGScript binding selects the behavior.

`#@name` defines a trigger with an unconditional `action,name` binding and opens
the script `@name`. Write its body immediately below the header. For example,
`#@classroom1_smileyPoster` replaces `#classroom1_smileyPoster`,
`action,classroom1_smileyPoster`, and `@classroom1_smileyPoster`.
Action shorthand scripts take no parameters. The editor highlights `#` as a
trigger and `@name` as a script declaration.

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

### Numeric expressions

Assignments and scalar command arguments accept numeric expressions, for example
`+a={a}+1`, `+[b]=({a}+2)*3`, and `+^count=2**3`. Global references (`{a}`)
and local references (`[b]`) are resolved at execution time, then JavaScript's
`eval` evaluates the numeric expression with its normal precedence. Supported
operators include `+`, `-`, `*`, `/`, `%`, and `**`, unary signs, and parentheses.
Only numeric literals, arithmetic operators, and variable references are accepted;
this is not arbitrary JavaScript execution. Quoted strings remain strings.

Malformed expression syntax is rejected during parsing. Every referenced operand
must be a finite number. A string (even `"1"`), boolean, undefined value, or non-finite result logs a script error and
aborts the current runner's call stack. A character subscript error stops that
character's task, not the main runner. Set-if-undefined assignments do not evaluate
their initializer when the destination is already defined.

### Set-if-undefined globals

`+^a=1` initializes global `a` only when its value is undefined. Later executions
leave it unchanged, including when it is `0`, `false`, or an empty string. This
uses shared session storage, not a per-script static slot. If the global becomes
undefined again, the next execution initializes it again. Dotted names and
indirect global keys work too (`+^tmp.flag=false`, `+^{key}=1`). Local targets such
as `+^[a]=1` are rejected. The long form is `+setStorageIfUndefined(a, 1)`.

### Returning values

`<value` exits the current script immediately and returns a scalar value or numeric
expression. `<` returns undefined; reaching the end also returns undefined.
Use `+[local]<+:script(args);` to call a script and capture its result in a local
(declaring it if needed), or `+globalName<+:script(args);` to store it globally.
The caller resumes only when the callee returns, including after waits or dialogue.
Ordinary `+:script(args)` calls discard returned values. Return values never leak
between calls or character tasks.

```rpgscript
@testReturn1
  +[local]<+:testReturn2();
@testReturn2
  +^a=1
  +a={a}+1
  <{a}
```

Here `[local]` receives 2, then 3, and so on on successive calls to `testReturn1`.

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
`+setLocal(name, value)`) declares or updates a local. Bare `+name=value` still writes
global storage. Unquoted references preserve value types; references inside strings
interpolate as text. Calls also accept numbers and booleans; quoted call arguments
remain strings. Argument values are evaluated in the caller before binding the callee.

Body locals do not need parameters or caller arguments:

```rpgscript
@testReturn
  +[a]=1
  +log("[a]")
```

Assignments declare names for the entire script invocation, including assignments
inside conditional blocks. Locals start undefined until assigned (so a skipped
assignment leaves an undefined value), reset on every call, and are not visible
to other scripts. Parameters retain their passed values until reassigned.

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

`+setConv()` opens the conversation panel with a right-facing portrait. `+setConv2(Johnathan, Eva)` opens a two-person panel with Johnathan's right-facing portrait and name on the left and Eva's left-facing portrait and name on the right. Both portraits remain displayed as the dialogue advances; the current speaker's portrait and nameplate borders are white and the listener's are grey. `+endConv()` closes either mode, restores player control, and resumes the clicked character's prior movement, facing and animation. `+endConvNR()` closes without restoring that character's activity. Neither closing command takes a portrait argument. In the character editor, set a **Script Name** matching the dialogue actor (`Eva` for `Eva: "Hello"`) and assign any number of portrait combinations: left or right facing, emotion (blank for default), and an animation ID or sprite frame ID (`face_0`). A line such as `Eva&happy: "Hello"` selects that actor's facing-specific happy portrait; if absent, the blank-emotion portrait of the same facing is used. The opposite-facing portrait is not substituted. If no character or matching portrait is found, dialogue remains readable without one. Portrait animations advance by frame duration while the line is displayed. The scene-free CLI prints the first frame before each matching dialogue line.

The single-speaker portrait is shown on the left, inside its own rounded border and outside the dialogue border; the dialogue box uses the remaining horizontal space. The renderer also supports placing the portrait on the right independently of its artwork facing. In narrow viewports where both cannot fit side by side, the portrait overlays the panel and dialogue text reserves space for it. "Right-facing" selects the artwork, not the side of the panel. Assigning portraits requires a Script Name so that dialogue cannot silently fail to resolve them. Live sessions reload portrait assets when opened and when a character conversation starts.

The speaker's name appears without a colon, padded by one space on each side, in a double-bordered nameplate at the dialogue box's top-left corner. Names are blue; in single-speaker mode the nameplate border is white, while in two-speaker mode borders indicate the current speaker. The dialogue text starts below the nameplate; the grey `[Space/Enter]` hint follows the text after a blank line while awaiting advancement. Clicking anywhere while a dialogue line is waiting advances it, just like pressing Space or Enter.

Portraits render at their native cell dimensions as a final overlay, bottom-aligned with the visible UI and growing upward over the world. The dialogue panel does not crop or scale them; only the physical terminal viewport can clip an oversized portrait. Future conversation layouts may place them elsewhere.

The equivalent explicit command is `+playDialogue(Eva, "Hello", happy)`; the emotion argument is optional.

### Character walking

`+chWalkToCoord(npc, 5, 3)` starts any character walking to a zero-based scene cell. Coordinates refer to the character's feet, as with player clicks. The character is resolved by entity ID, instance name, then character asset ID. Arguments may use storage references or script parameters. Coordinates must be integers within the scene.

Walking is non-blocking: subsequent script commands run immediately. Each character owns its path and movement timing, and the scene updates all characters, including NPCs without player control. Movement uses the existing collision-aware pathfinding and approaches the nearest reachable cell when a destination is blocked. The terminal shim validates arguments without moving a character. Marker destinations are not implemented because scenes do not yet define markers.

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

The workspace config points the existing language extension at `src/game/scene-commands.ts`. Its `commands = { ... }` export and matching `const` declarations are deliberately shaped for the extension's command discovery, completion, signatures, hover, and definitions. The game supplies this catalog when loading scripts, then constructs `ScriptRunner` with `{ commands, context: game }`. Each command defines `parse`, `execute`, and optional script `targets`; execution receives `(step, script, game)`. RPGScript only knows the generic registry and passes the host context through unchanged. The terminal uses `src/game/scene-commands-shim.ts` with terminal IO as its context. The `showChoices` entry is needed because the editor parser emits that command for `$` blocks; authors should use `$` choice syntax, not call `showChoices` directly.

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
