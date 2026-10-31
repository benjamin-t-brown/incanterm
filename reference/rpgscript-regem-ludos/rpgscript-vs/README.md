# rpgscript-vs README

This is a simple language server for RPGSCRIPT. It includes:

- syntax highlighting
- a linter
- code completion
- go to definition

Duplicate `@script` and `#trigger` names are warned on each declaration across
the configured `rpgscript.scriptsRoot`, including subfolders and unsaved open
files. Warnings link to the other definitions and refresh as files are edited,
created, renamed, or deleted. Scripts and triggers have separate namespaces;
`@this` uses the preceding trigger's name. After building the server, run
`npm run test:duplicates` to check these diagnostics.

Calls to script names missing from that same global set are errors on the call
line. This covers `+:name(...)`, `+callScript(name)`, trigger targets, choice
targets, and `>name`. Forward declarations and unsaved definitions are included;
errors refresh when the target is renamed, added, or removed. Run
`npm run test:references` and `npm run test:diagnostics` after building the server.

If a script signature declares a parameter (for example `@test(arg1)`), using
`{arg1}` in its body produces a warning: `Did you mean [arg1]?`. The check is
scoped to that script's declared parameters, including substitutions in quoted
text. Run `npm run test:locals` after building the server to check these warnings.
Bare condition arguments that match a local parameter also warn: `is(arg1)`
suggests `[arg1]`, since the bare name reads global storage. This covers `is`,
`isnot`, `eq`, `gt`, and `lt`, including nested conditions. Quoted literals and
unrelated global names are not flagged by this check.

Other local-name warnings catch `+arg1=value` (suggesting `+[arg1]=value`),
`+setStorage(arg1, value)` (suggesting `setLocal`), and bare script-call arguments
such as `+:other(arg1)` or `+callScript(other, arg1)` (suggesting `[arg1]`).
Explicit `setStorage` destinations are checked even when quoted; quoted script-call
arguments remain intentional literals. Parameters named `true` or `false` warn
because those names conflict with boolean literals. These are warnings, so
intentional global writes and literal arguments remain valid.

Script signatures such as `@test(arg1, arg2)` and calls such as
`+:test("a", "b")` support call-local parameters. Read locals with `[arg1]` and
update them with `+[arg1]=value`. `{arg1}` still refers to global storage.
Undeclared locals and mismatched argument counts are errors, including calls
across files and unsaved buffers. Run `npm run test:arguments` for coverage of
signatures, call arguments, scopes, and assignment hovers.

## Storage assignment shorthand

Else branches can use `+?else:{ ... }` or inline `+?else:+command(...)`.
The older `+?else():` spelling remains supported.

`+a=true`, `+b={vars.tmp}`, and `+c=4` are shorthand for `setStorage` calls,
including inside conditional blocks and inline branches. The unquoted `{vars.tmp}`
reads that session-storage key at execution time; quoted text stays literal.
Destinations can be references too: `+someVar=a` then `+{someVar}=2` writes
`2` to `a`, equivalent to `+setStorage({someVar}, 2)`. Assignment hovers show
the expanded call, including dynamic destinations.
The Iro source and TextMate grammar highlight assignments and their values.
After building the server, run `npm run test:assignments` to check parser support.

## Installation

Follow the [fresh-checkout Cursor setup guide](../../../docs/rpgscript-cursor-setup.md)
to install dependencies, build a VSIX containing the client and language server,
install it in Cursor, and configure this repository. The guide also covers
verification, reinstalling after updates, and troubleshooting.

For development, run `npm run build` to build both components. `npm run package`
builds the production client and server; the VSIX packaging command in the guide
runs it automatically.

## Requirements

You must have a project with rpgscript inside of it. This means you need to provide the root dir of the rpgscript files and the file that contains all the scene commands.

The language server reads the `commands` object and matching command declarations
in `sceneCommandsPath` to discover available commands. In Incanterm this is
`src/game/rpgscript/scene-commands.ts`.

## Extension Settings

This extension contributes the following settings:

- `rpgscript.scriptsRoot`: script directory; default `${workspaceFolder}/src`.
- `rpgscript.sceneCommandsPath`: command catalog; default `${workspaceFolder}/src/scene-commands.ts`.
- `rpgscript.debug`: enable debug logging. Set to `false` for normal use.
