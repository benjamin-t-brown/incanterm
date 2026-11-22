# RPGScript integration

[Design index](../../README.md)

## Decision

Use the user's RPGScript language from regem-ludos for server-side Script assets. Preserve its stage-play/movie-script authoring style. Rewrite loading and ScriptRunner to fit Incanterm's server and per-player sessions, and supply an Incanterm-specific scene command library.

The [extracted sources](../../reference/rpgscript-regem-ludos/README.md) are a reference snapshot, not integrated runtime code. This replaces the previously open script-language choice in [Scenes, entities, and scripts](scenes-entities-and-scripts.md). It does not introduce scripting in any client.

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

For a timer that runs in every scene, list the **trigger name** (the name after
`#`) in the project's `assets/session-config.json`:

```json
{
  "timerTriggers": ["sessionClock"]
}
```

```rpgscript
#sessionClock
  timer,updateSession,1000
@updateSession
  +log("Session tick!")
```

No scene needs to list `sessionClock`. Each player session starts its own clock
on open, keeps it across scene changes, and stops it on close. Only `timer`
bindings are picked up by `timerTriggers`; existing scene events such as `load`
are unchanged. If a scene also lists the trigger, its timer runs only once per
interval. Like a scene timer, a regular session timer defers while the foreground
runner is busy. Its script uses the session's existing globals and current scene.

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
For character timers bound to the session, the character reference is resolved in
the current scene at each tick, and any running character task is still cleared
on scene changes.

### Inline trigger scripts

An inline header defines an unconditional trigger and opens a script with the
same name. Write the script body immediately below it.

| Header | Binding |
| --- | --- |
| `#@name` or `#action@name` | `action,name` |
| `#step@name` | `step,name` |
| `#load@name` | `load,name` |
| `#timer@name,2000` | `timer,name,2000` |

For example, `#step@maintenance_toLibrary2` replaces the separate trigger
header, `step,maintenance_toLibrary2` binding, and script header:

```rpgscript
#step@maintenance_toLibrary2
  +changeScene(library2, FromMaintenance)
```

Configure the trigger by its name (`maintenance_toLibrary2`) as usual. Inline
scripts take no parameters. Inline timers require an explicit positive interval
in milliseconds. Use a separate trigger and script for conditional bindings,
character timers, or different trigger and script names.

The Cursor/VS Code extension colors the `#step` (or other trigger prefix) like a
regular trigger and `@name` like a script declaration.

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

`getSceneId()` returns the active scene's asset ID. Use it for comparisons
or to save a reference for `changeScene()`. `getSceneName()` returns the scene's
editor label, or its ID if no label is set. Both read the scene at the time of
the call, including after a scene change.

```rpgscript
  +[sceneId]=getSceneId()
  +sceneName=getSceneName()
  +log("Current scene: {sceneName}")
```

`+walkToOffset(character, x, y[, skipWait])` walks from the character's current
position by integer scene-cell offsets (positive x moves right, positive y
moves down). Like `walkToMarker`, it waits for arrival by default; pass `true`
as the fourth argument to continue the script while the character walks.
For example, `+walkToOffset(player, 2, -1)` moves two cells right and one up.

`getCharacterPos(character)` (also `getChPos(character)`) and `getPropPos(prop)` return a two-element
`[x, y]` list. Use `setChPos(character, x, y)` or `setPropPos(prop, x, y)` to
move an instance immediately to integer scene coordinates, without pathfinding.
For characters, `y` is the feet row used by walking; for props, it is the sprite
origin row. `setChPos` cancels an active walk, and a moved prop's blocking
footprint moves with it. Use `player` for the controlled character or identify a
prop by its instance ID or unique instance name.

```rpgscript
  +[saved]=getCharacterPos(player)
  +cratePos=getPropPos(crate)
  +setChPos(player, 12, 5)
  +setPropPos(crate, 18, 5)
  +setChPos(player, [saved]->0, [saved]->1)
```

### Switch blocks

`+?switch(value):{` selects the first matching braced case; cases do not fall
through. The selector is evaluated once. `*` is an optional default and must
come last. Quoted `"*"` matches the literal asterisk instead.

```rpgscript
+?switch(tmp.a):{
  0: {
    +log("Zero")
  }
  "ready": {
    +log("Ready")
  }
  waiting: {
    +log("Matches the string waiting")
  }
  [candidate]: {
    +log("Matches the local value")
  }
  *: {
    +log("Other")
  }
}
```

Numeric labels match either the number or its string representation (`0`
matches `0` and `"0"`). Boolean labels match only booleans; quoted strings
match only strings. Bare names (`waiting`) also match literal strings, not
storage keys. `[name]` and `{name}` read the local or global value at
runtime. Other case labels use the existing condition syntax, so
`+?switch(true):{` can have cases such as `lt({score}, 50): { ... }`.

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

### Using return values in conditions

Use `+:script(args)` inside a script condition to read its returned value.
The condition waits for the called script to finish. `is(...)` and `isnot(...)`
use truthiness: all lists (even empty ones) and nonempty strings (even `"false"`)
are true; an empty string, `0`, `false`, and no return value are false. Use
`eq(+:script(), "0")` to match a returned string, or `eq(+:script(), 0)` to
match a returned number. Numeric comparisons require two operands, for example
`lt(+:script(), 0)`. Calls inside trigger conditions are not supported.

Assign a condition's boolean result with `+name=?condition(...)` or
`+[local]=?condition(...)`. `lte` and `gte` compare numbers inclusively.

```rpgscript
@isUpstairs(character)
  +[pos]=+getChPos([character])
  +[upstairs]=?lte([pos]->1, 1)
  <[upstairs]

@useTerminal
  +?is(+:isUpstairs(player)):{
    <
  }
  +log("Using terminal")
```

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

### Storage namespace

Session storage is one flat map. Every script-visible variable lives under the `global.` prefix: `+a=1` stores `global.a`, and `{a}`, `is(a)`, `eq(a, 1)` and `{key}` interpolation all read `global.a`. Write `a`, never `global.a`; the prefix is added by the runner. Engine-owned keys (`dialogue.active`, `dialogue.leftActor`, `dialogue.rightActor`) are stored unprefixed, so script variables can no longer collide with them. `lastChoiceIndex`, `vars.inventory` and `vars.rand100` are ordinary globals, so they are `global.lastChoiceIndex` and so on in storage while scripts still use the short names. Host code uses `getGlobal`/`setGlobal` (also on `CommandContext`) for script variables and `getStorage`/`setStorage` for raw keys.

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

`+awaitChoice("Reset the bookshelves?", "Yes", "No")` takes the question first, followed by one to nine answers. The question appears in a centered, 60-column panel above the conversation, with numbered buttons stacked below it on the left. The panel narrows on smaller terminals and can scroll if it doesn't fit. It uses the same glyph transitions and timing settings as portraits. While the choices are visible, the dialogue box and portraits are grayscale, but the choice panel keeps its colors. Click a button or press its number (`1`–`9`) to resume immediately with the zero-based `lastChoiceIndex` (`0` for Yes here), without waiting for the exit animation. `$` choices use the same buttons without a question and also call their selected target script.

`+fadeOut(300)` sweeps left to right twice: first it turns the screen white-on-black, then it shrinks the glyphs into spaces using separate animations for tall and short glyphs. The command waits for both passes, and the screen stays black while the foreground script runs intervening commands such as a room reset. `+fadeIn(300)` also sweeps left to right: first it regrows the glyphs, then it restores their original colors. Durations are in milliseconds; finishing or canceling the foreground script clears the fade.

The single-speaker portrait is shown on the left, inside its own rounded border and outside the dialogue border; the dialogue box uses the remaining horizontal space. The renderer also supports placing the portrait on the right independently of its artwork facing. In narrow viewports where both cannot fit side by side, the portrait overlays the panel and dialogue text reserves space for it. "Right-facing" selects the artwork, not the side of the panel. Assigning portraits requires a Script Name so that dialogue cannot silently fail to resolve them. Live sessions reload portrait assets when opened and when a character conversation starts.

The speaker's name appears without a colon, padded by one space on each side, in a double-bordered nameplate at the dialogue box's top-left corner. Names are blue; in single-speaker mode the nameplate border is white, while in two-speaker mode borders indicate the current speaker. The dialogue text starts below the nameplate; the grey `[Space/Enter]` hint follows the text after a blank line while awaiting advancement. Clicking anywhere while a dialogue line is waiting advances it, just like pressing Space or Enter.

Portraits render at their native cell dimensions as a final overlay, bottom-aligned with the visible UI and growing upward over the world. The dialogue panel does not crop or scale them; only the physical terminal viewport can clip an oversized portrait. Future conversation layouts may place them elsewhere.

The equivalent explicit command is `+playDialogue(Eva, "Hello", happy)`; the emotion argument is optional.

Scene speakers automatically switch from `idle` to `talking` for each dialogue line, using their current facing's `talking-<direction>` animation. Advancing the line (or starting a replacement script) returns only automatically animated speakers to `idle`. Walking and explicitly selected animation states are left untouched, including manually selected talking states. A missing talking animation, off-scene speaker, or ambiguous character reference does not prevent dialogue; it simply skips automatic animation. No `setAnimState` commands are needed for ordinary speech.

### Character walking

`+chWalkToCoord(npc, 5, 3)` starts any character walking to a zero-based scene cell. Coordinates refer to the character's feet, as with player clicks. The character is resolved by entity ID, instance name, then character asset ID. Arguments may use storage references or script parameters. Coordinates must be integers within the scene.

Walking is non-blocking: subsequent script commands run immediately. Each character owns its path and movement timing, and the scene updates all characters, including NPCs without player control. Movement uses the existing collision-aware pathfinding and approaches the nearest reachable cell when a destination is blocked. The terminal shim validates arguments without moving a character. Marker destinations are not implemented because scenes do not yet define markers.

### Barks

`+bark(ch, text, ?ms, ?skipWait)` shows `text` above a character. `+barkProp(prop, text, ?ms, ?skipWait)` shows it above a static or animated prop instance. Use the prop's scene instance name or ID (case-insensitive); if multiple props share a name, use the instance ID.

For example, `+barkProp(vending_machine, "Out of stock!", 1500, true)` displays the text for 1.5 seconds without pausing the script. Both commands default to 2000 ms and wait unless `skipWait` is `true`. Text is centered, wraps at 20 columns, and follows the target as it moves. A new bark replaces the current one on that instance, and all barks clear on scene change.

### Prop animation states

`+setPropAnimState(vend_energy_1, open)` sets the animation state on every animated
prop whose instance name matches (case-insensitive). Prop assets define a built-in
`default` state from their visual, plus optional `customAnimations` in the prop
editor. Scene instances pick a starting state in the scene inspector. A missing
state logs a warning and falls back to `default` for each matching prop.

### Prop action scripts

Set **Action Script** in a prop's scene inspector to bind an RPGScript function
to that instance (`actionScript` in scene JSON). Click its visible art, or press
Enter to activate the nearest visible prop with an action. The player walks to a
reachable edge and faces the prop before the script runs. The approach uses
walking blockers, then a slide footprint if present, or the sprite's lowest
visible row for an unmasked prop.

This only cancels the automatic approach. It does not change the behavior of
explicit RPGScript walk commands.

Both reusable props and directly placed sprites can use an action without being
slidable. The function may take no parameters, or one parameter for the
**scene instance ID**, not the display name or an asset ID:

```rpgscript
@inspectProp(instance)
  +barkProp([instance], "It's locked.")
```

If there is no path, the prop's action does not run. A project can handle that
failure by adding `scriptHooks.propUnreachable` to `assets/session-config.json`:

```json
{
  "scriptHooks": { "propUnreachable": "reportUnreachableProp" }
}
```

Define the named function in any file in `assets/scripts/`. It takes one
argument, the unreachable prop's scene instance ID. In a dialogue line, `player`
uses the currently controlled character's name and portrait.

```rpgscript
@reportUnreachableProp(instance)
  +setConv()
  player: "I can't reach that."
  +endConv()
```

If the hook is omitted, failure is silent. Canceling the approach (for example,
by clicking elsewhere) does not call the hook.

### Slidable prop actions

**Slidable** controls movement independently from **Action Script**. Existing
`slidable.actionScript` bindings still start their one-parameter script
immediately, so scripts that call `approachSlideProp` themselves still work.
A top-level `actionScript` takes precedence and walks the player there first.

```rpgscript
@pushProp(instance)
  +approachSlideProp([instance])
  +[direction] = choosePropPush([instance])
  +?eq([direction], cancel):{
    <
  }
  +[settled] = slideProp([instance], [direction])
```

- `approachSlideProp(id)` waits for an exact stand cell and returns `true` on
  arrival, `false` without reaching it. This is optional staging: it isn't
  required before choosing a push. Walking never falls back to a nearby cell.
- `getPropPushes(id)` returns the list of unblocked push
  direction keys (`left`, `right`, `up`, `down`).
- `choosePropPush(id)` waits for a numbered key or a click on a direction-pad button and
  returns a direction key or `cancel`. Call it outside dialogue. Buttons show
  Up, Down, Left and Right; the scene vectors determine actual movement.
  A direction is dimmed if the prop cannot slide that way, not if the player
  cannot reach the pushing side. Cancel is in the center.
- `slideProp(id, direction)` walks to the selected pushing side if reachable.
  If the character cannot get there, it pushes from where the character is
  when clear of the slide, or first walks to the nearest reachable spot clear
  of the prop's swept footprints. If there is no safe spot, it returns `false`
  without moving the prop. It rechecks the slide path and returns `true` only if the
  slide completes. Forced cancellation aborts the action script and synchronously
  restores the original anchor rather than leaving a partial slide.
- `resetPropSlides(safeMarker)` restores all slidable props in the current room
  and clears that room's settled overrides. It returns `true` on reset, or
  `false` if the room has no slidable props. If the restored walking masks cover
  the controlled character, the command places them at the named scene marker
  using walk-marker coordinates. If that relocation is needed and the marker is
  missing or not walkable after reset, the command reports an error and changes
  neither the layout nor its overrides. After a successful reset, the script can
  read prop positions and reevaluate any room-specific puzzle.
- `getPropClimbPath(landingMarker)` checks the current shelf layout and uses
  normal walking rules to find a floor entry the controlled character can
  reach from their current position. It returns `[x, y]` waypoints from that
  walk anchor to the marker, or `[]` if there is no reachable route or no
  controlled character. Transfers
  require touching slide footprints and a level step or a rise of up to
  two cells. A prop's `climbHeight` is measured from the row just below its
  slide footprint; when omitted, the lowest painted `climbCells` row sets the
  height. Roof cells guide the returned waypoints but don't need to line up
  between shelves. The command doesn't move the player.
- `getPropClimbPath(landingMarker, shelfCenters)` returns the same reachable
  floor anchor and logical landing with one centered character anchor per
  shelf in between, for scripting an animation. `getMarkerPos(marker)` returns
  the marker's exact `[x, y]` coordinates.
- `setChForeground(character, true)` draws a character in front of the normal
  scene layer. Pass `false` to restore normal depth sorting after an animation.

Automatic stand positions are next to the prop's walking blockers, or next to
its slide footprint if it has no walking blockers. The initial approach
accepts any edge; a push prefers the edge opposite the selected direction.
Optional `slidable.standOffsets` entries override individual
directions: e.g. `"right": { "x": -3, "y": 0 }`. The spot follows the prop's
current anchor. The player's entire bottom row must fit the walking mask, but
any column of that row can cover the spot. For an authored offset, the engine
prefers to align the player's origin column with the spot if it can. This does
not change slide collision.

Completed pushes survive leaving and re-entering rooms in the same session.
The runtime can copy the settled anchors to and from JSON, but disk saves and
automatic cross-session resume are not implemented.

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

The standalone [rpgscript-vs extension](https://github.com/benjamin-t-brown/rpgscript-vs) provides syntax highlighting, formatting, diagnostics, completion, hover help, and definitions. Its editor-side parser has extra reference tracking and supports legacy RPGScript used by other games. Editor diagnostics are advisory; Incanterm still validates scripts with its own runtime parser. See the [editor setup guide](../rpgscript-cursor-setup.md).

The workspace config points the existing language extension at `src/game/scene-commands.ts`. Its `commands = { ... }` export and matching `const` declarations are deliberately shaped for the extension's command discovery, completion, signatures, hover, and definitions. The game supplies this catalog when loading scripts, then constructs `ScriptRunner` with `{ commands, context: game }`. Each command defines `parse`, `execute`, and optional script `targets`; execution receives `(step, script, game)`. RPGScript only knows the generic registry and passes the host context through unchanged. The terminal uses `src/game/scene-commands-shim.ts` with terminal IO as its context. The `showChoices` entry is needed because the editor parser emits that command for `$` blocks; authors should use `$` choice syntax, not call `showChoices` directly.

Use `+?else:{ ... }` for an else block or `+?else:+command(...)` for an inline
else branch. Parentheses are optional for `else`; the older `+?else():` spelling
has identical behavior and remains supported.

Chain further branches with `+?elseif cond:{ ... }` (or an inline `+?elseif cond:+command(...)`). An `elseif` runs only when every earlier branch in its chain failed and its own condition passes; a trailing `else` runs only when none ran. Like `else`, it uses the earlier branches' cached results and is an error without a preceding conditional at the same block depth.

Longform spellings drop the `?`: `+if cond:{ ... }`, `+elseif cond:...`, `+else:...` and `+while cond:{ ... }` are identical to their `+?` forms. They are rewritten before parsing, so every rule above applies unchanged.

Loop with `+?while cond:{ ... }`. The condition is re-tested before every pass (unlike `if`, whose result is cached), and branch results inside the body reset each pass. The body must be a braced block, `once` and `oncePerInstance` are rejected as loop conditions, and an `else` cannot follow a loop. Dialogue and waits work inside the body. Runaway loops are bounded two ways, and both stop the script with a file/line error through the normal command-error path instead of throwing: a single `while` stops after 1000 passes (even if it pauses for dialogue or waits each pass), and a run of more than 1000 steps without pausing hits the runner's immediate-work budget.

### Indexed lists

Pipe-delimited list literals can be assigned to globals or locals, on one line
or across several lines. Bare names in a list are strings; use `[name]` or
`{name}` to include a local or global value. `||` is an empty list, `|a|` is a
one-element list, and `[a]` still reads a local variable. Commas separate
elements, with an optional trailing comma in a multiline list. `in(index, list)` is true when
`index` is an integer from zero up to (but excluding) the list length; it checks
an **index**, not whether a value occurs in the list. `->` reads an element, and
an indexed assignment replaces an existing element:

```rpgscript
+items=|
  key,
  map,
  coin,
|
+[i]=0
+?while in([i], {items}):{
  +[item]={items}->[i]
  +[i]=[i]+1
}
+{items}->1="compass"
```

`[items]->0` works for a local list; `{items}->[i]` reads a global list at a
local index. Indexed reads and writes require an existing nonnegative integer
index and a list; invalid reads stop the script and invalid assignments report
a command error. Assigning to the variable itself replaces its whole value.
An indexed assignment creates a new list value rather than changing other
variables that were previously assigned the same list. The existing while-loop
work and pass limits still apply.

Control keywords are line prefixes written with `!`, like `<` for return, and work on their own line or after a condition (`+?gt(n, 5):!break`):

- `!break` leaves the innermost `while` and continues after it.
- `!continue` skips to the next pass of the innermost `while`, re-testing its condition. It counts toward the 1000-pass cap.
- `!returnempty` exits the current script and returns undefined, the same as a bare `<`.

Write them without a leading `+`; Incanterm rejects `+!break` even though the standalone extension accepts that legacy spelling. `!break` and `!continue` outside a `while` are errors. A called script's loops are independent, so neither keyword can leave the caller's loop. `<value` and `!returnempty` leave the whole script, not just the loop.

## Adaptation outline

1. Establish parser behavior from the extracted examples and tests; isolate parsing from original game/browser dependencies.
2. Build server asset loading and immutable definitions with useful source diagnostics.
3. Implement a session-owned ScriptRunner and explicit command context.
4. Add a small command set for dialogue, waiting, flags, inventory, movement, and scene changes.
5. Verify two players can execute the same script independently, including waits and callbacks; check cleanup and save reconstruction.
6. Adapt editor command discovery and paths, then verify highlighting, diagnostics, completion, hover, definitions, and formatting against actual Incanterm scripts.

The adapted parser runs without its original browser globals or Scene runtime. A session-owned `ScriptRunner` now executes dialogue, script calls, `setStorage`, `log` (server-side logging), `awaitChoice`, and `$` choices (choice targets are script names). It evaluates `is`, `isnot`, `eq`, numeric `gt`/`lt`, `all`, `any`, `once`, and `oncePerInstance` against session storage; a block's condition is cached for that invocation, even if commands within the block change storage. `lastChoiceIndex` is zero-based. Numbered choices (1–9) are accepted by game-session input. Other commands and game-specific conditions (such as `with`, `as`, and `func`) fail with a source location instead of pretending to run. The existing RPGScript language extension remains in use; no second extension is needed.

For scene-free smoke tests, `npm run run-rpgscript -- "testRoomEntry()"` loads every RPGScript under `assets/scripts`, creates a temporary inline call, and runs it through the same session runner. `--assets path` selects a different asset root. The terminal shim clones the command catalog, printing dialogue and logs, retaining storage and script-call semantics, and prompting for numbered `$` and `awaitChoice` options. Unknown commands are errors in both loaded assets and inline snippets, with a file/line location and a nonzero CLI exit status. Use `+:testArgs()` to call a script inside a snippet; `+testArgs()` instead names a command and errors if that command is unknown. Unsupported conditions and unresolved script calls also report errors.

Incanterm also supports `+?else():{ ... }` and inline `+?else():+command(...)` after a conditional at the same block depth. `else()` uses the prior branch's **cached result**, not its condition re-evaluated after commands change storage. A second `else`, an orphan `else`, or an `else` separated from its `if` by an unconditional command is an error. Parent branches likewise keep their cached result across nested blocks.

Triggers are loaded and validated with shared definitions and dispatched with `runner.dispatchTrigger(name, TriggerType.ACTION)` (or another **explicit RPGScript event type**). A scene asset's `triggers` array binds RPGScript `#name` definitions to that scene; session entry dispatches the `load` event for each bound trigger. For example, `"triggers": ["room-entry"]` and `#room-entry` followed by `load,intro` run `@intro` when the scene opens. Missing references fail server startup. Entry triggers run in scene order as the runner becomes idle; later ones wait for an earlier dialogue to finish. The first matching, passing call for a trigger runs only when the runner is idle. `oncePerInstance` needs an explicit third `instanceId` argument, which carries into scripts called from that trigger. Other scene-to-event mappings (`action`, item, region) remain unconnected. Storage and once keys are session-local and not yet persisted. Trigger targets with arguments, waits, inventory, effects, and other scene commands are not implemented. See [Development and build](development-and-build.md).

The adapted parser uses plain script/trigger records and local builders instead of the old mutable `Script`/`Trigger` instances. It does not allocate the original dialogue-sound bookkeeping until audio support exists. The loader freezes conditions, blocks, steps, and definitions; each runner retains its own mutable call stack, storage, once keys, and dialogue/choice position. Parser state is per call, so reusing a parser does not leak definitions between files or players. The nested-condition scanner keeps outer block conditions when an inner block ends.
