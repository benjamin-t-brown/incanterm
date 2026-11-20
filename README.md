# Incanterm

Incanterm is a terminal-adventure engine and project editor. Its server runs scenes and
RPGScript; browser, terminal, and SSH clients display the output and forward input.
Game content belongs to an opened project, not to the engine installation.

## Open a project

```sh
npm install
npm run editor
```

Open <http://127.0.0.1:7104>. Choose an available project, **OPEN PROJECT** with a local
folder or `incanterm.json` path, or **CREATE PROJECT** with a new folder and name.
The path refers to the computer running the editor server. External project directories
are supported; projects do not need to live in this repository.

The editor starts with no project selected. The selected project is remembered for that
browser tab. Tabs, unsaved drafts, selections, and preferences are stored separately for
each project. Switching projects uses the normal unsaved-work confirmation and reloads
the editor so in-flight operations cannot write to another project's assets.

Choose **GAME / PLAY** to run the opened project's entry scene. The editor starts its own
local preview; a separate `npm run dev` or fixed game-client port is not required.
Leave and return to Play to reload the latest saved content.

### ProjectJohnathan

The current game is now [`projects/ProjectJohnathan`](projects/ProjectJohnathan).
Its asset files and story notes were moved without changing their contents or asset IDs.
Its manifest selects `classroom1` as the entry scene.

After upgrading, restart old editor/server processes. Open ProjectJohnathan from the
project list. To recover browser tabs or drafts saved before projects were introduced,
use **IMPORT LEGACY TABS / DRAFTS** on the project page. This is explicit: legacy data
is retained, and existing project-scoped state is not overwritten.

## Project format

```text
my-game/
  incanterm.json
  assets/
    scenes/
    scripts/
    sprites/
    animations/
    characters/
    props/
    items/
    audio/
    references/
  story/                   Optional game-owned notes
```

```json
{
  "format": "incanterm-project",
  "version": 1,
  "id": "my-game",
  "name": "My Game",
  "assets": "assets",
  "entryScene": "start"
}
```

Paths are relative to the manifest. `assets` must stay inside the project directory.
The entry scene must exist. New projects include an empty, playable `start` scene.
Optional `assets/session-config.json` controls dialogue and portrait animation and
can bind [session-wide RPGScript timers](docs/design/rpgscript.md#timer-triggers).
These settings apply to standalone servers and local previews.

Editor saves merge independent changes against the last loaded version and reject
conflicts rather than overwriting newer disk content. Binary reference images use
revision checks instead of merges.

## Character visual variants

A character owns its script names, portraits, default facing, and walking speed.
Use **CHARACTERS → VISUAL VARIANTS → + VARIANT** to copy the selected animation set,
then edit its clips or **FILL FROM FOLDER**. Each variant defines all idle, walk,
and talking directions; custom states can differ between variants.

Existing characters keep their original animations as the default variant, initially
named `default`. You can name it `3x3`, for example, and add a `5x5` variant. Variant
names use letters, numbers, hyphens, or underscores and are case-sensitive.
Scene character instances have a **VISUAL VARIANT** picker. Leaving it at Default
uses the character's original animation set. Script-spawned characters also start there.

```text
+setPlayerWalkCh(Johnathan, 5x5)
```

The second argument is optional: omitting it keeps an existing character's current
variant, or uses the default for a newly spawned character. Use
`+setCharacterVariant(Johnathan, 3x3)` to change visuals without selecting a walker.

Switching visuals keeps the same character instance, facing, animation state, speed,
busy status, and walk destination, with the feet anchored in place. The new variant
must support the current state; otherwise the switch fails without changing the
character. Set an ordinary state such as `idle` first when leaving a variant-only
custom state. Cloned characters retain their variant.

The asset format remains backwards compatible: `animations` and `customAnimations`
are the default visual set, optional `defaultVariant` names it, and optional `variants`
maps additional names to `{ animations, customAnimations }`. Scene instances store an
optional `variant`. Portraits stay on the character, not its variants. Renaming or
removing a variant requires updating explicit scene/script references.
If two instances of the same character share a scene, target their unique instance
names or IDs rather than an ambiguous shared script name.

## Items and inventory

Use **ITEMS** to create reusable item assets with a sprite frame or animation, an optional
unique script name (for example `OfficeKey`), examine/failure scripts, and combination
rules targeting item, prop, or character **asset IDs**. Bind zero-argument `@scripts`,
not `#triggers`. Item recipes work in either direction; the selected item's rule wins
when both items define a recipe. Scripts decide which ingredients to remove or results
to grant; combinations do not automatically consume anything.

In **SCENE → ENTITIES → Add Item**, choose an item and position its world instance.
Items animate and participate in depth ordering without blocking movement.
Left-click a world item to collect it; right-click to examine it.
Open Inventory by clicking its tab or pressing Tab, click **EXAMINE** to inspect an item,
or select an item and click another inventory item or a world item/prop/character to
combine them. Esc cancels the selection.

Press **`** (backtick, without Ctrl) to open a large log-only window, even behind
dialogue, choices, or a center toast. Press **`** again to return to the previous
UI without cancelling or advancing the interaction. Use Up/Down or Page Up/Down
to scroll the log; browser users can select and copy its text.

```text
+addItem(OfficeKey)
+?func(hasItem, OfficeKey):+examineItem(OfficeKey)
+combineItem(OfficeKey, prop, OfficeDoor)
+removeItem(OfficeKey)
```

`acquireItem` remains an alias for `addItem` in world games. Both resolve an item asset
by ID or script name and reject unknown references. Prop/character command targets use
scene instance IDs/names. Player-session `vars.inventory` holds unique `{ "itemId": "…" }`
references, not copies of asset definitions. Legacy string entries resolve through the
item catalog and are normalized on the next inventory mutation; create matching assets
and script names before running old game scripts. The standalone script-only terminal
shim retains name-only inventory because it has no world scene.

Items are currently unique, non-stacking objects per player. Once acquired, their world
instances stay collected across scene changes, even if a script later consumes the item.
Each player's inventory and world pickups are independent.

## Command-line play and tools

Run commands from the engine repository, selecting any project folder or manifest:

```sh
npm run dev -- --project projects/ProjectJohnathan
npm run server -- --project projects/ProjectJohnathan
npm run loopback -- --project projects/ProjectJohnathan
npm run scene -- --project projects/ProjectJohnathan --plain
npm run run-rpgscript -- --project projects/ProjectJohnathan "testArgs()"
npm run format:rpgscript:check -- --project projects/ProjectJohnathan
npm run format:rpgscript -- --project projects/ProjectJohnathan
```

`--scene <id-or-label>` overrides the manifest's entry scene. Scene IDs take precedence;
labels must match exactly and be unique. Quote labels containing spaces. For example:

```sh
./loopback.sh --project projects/ProjectJohnathan --scene hallwayGym
```

`INCANTERM_PROJECT` can provide
the selected project when `--project` is omitted. There is no built-in game fallback.
Low-level tools also accept explicit `--assets <folder>`; scene-based tools additionally
require `--scene <id-or-label>`.

`dev` starts the game server on ports 7101/7102 and the browser client on 7103.
`npm run client` or `ssh -p 7102 player@127.0.0.1` connects to the standalone server.
Loopback uses temporary local ports and combines server and terminal client; press `~`
to switch between game and server views.

## Export and deploy a game

Build a standalone release from a saved project:

```sh
npm run export-game -- --project projects/ProjectJohnathan --out release/ProjectJohnathan
```

Add `--scene hallwayGym` (or another scene ID or unique label) to change the release's
entry scene without changing the source project. The output directory must be new;
use a new release directory for subsequent exports.

The release contains compiled server/browser code, runtime game assets, a production-only
npm package and lockfile, a Dockerfile, and deployment instructions. It excludes the
editor, reference images, folder metadata, story notes, source files, and tests.
Build tools are only needed when exporting, not on the deployment machine.

### Run with Node.js

Install Node.js 22+ on the deployment machine, copy the release directory, then run:

```sh
cd release/ProjectJohnathan
npm ci --omit=dev
npm start
```

Open <http://127.0.0.1:7101/play>. `/health` provides a health check and `/ws` carries
gameplay. SSH is disabled by default in the exported release. Set `INCANTERM_HOST=0.0.0.0`
to accept connections outside localhost. `INCANTERM_HTTP_PORT` overrides `PORT`;
otherwise the HTTP port defaults to 7101.

### Run with Docker

Build from the exported directory, not the engine repository:

```sh
docker build -t projectjohnathan ./release/ProjectJohnathan
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1:7101:7101 projectjohnathan
```

The container runs as a non-root user and exposes only HTTP/WebSocket, not SSH or the
editor. For public access, put an HTTPS reverse proxy in front of it. Proxy both
`/play` (including browser assets) and `/ws`, enabling WebSocket upgrades and a suitable
idle timeout. Keep the editor private.

Sessions live in memory and are tied to their WebSocket connections; disconnects and
restarts do not persist or resume a game. Start with a single instance. Persistent
saves, cross-instance session routing, authentication, and rate limiting are not included.

## Engine development

```sh
npm run test:run
npm run typecheck
npm run lint
npm run format:check
npm run build
npm start -- --project projects/ProjectJohnathan
npm run test:ui -- --list
```

Engine formatting does not rewrite game projects. Format RPGScript separately with a
selected project. Tests use synthetic projects and test-owned fixtures, never the
bundled game's files. CI runs the engine tests in a checkout without `projects/`,
legacy `assets/`, or `ed-ascii/data/`.

Engine code remains in `src/`; the editor's own images live in `src/editor/resources/`.
The old `ed-ascii/` painter remains an optional import tool, not a runtime dependency.

See [RPGScript setup in Cursor and VS Code](docs/rpgscript-cursor-setup.md) and the
[design overview](docs/design/overview.md) for language tooling and design notes.
