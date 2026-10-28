# RPGScript extraction from regem-ludos

Source snapshot for adapting the user's RPGScript language to Incanterm. These are reference sources, not the implemented Incanterm runtime. The original project was not modified. Copied files retain their original contents.

See [the adaptation design](../../docs/design/rpgscript.md) for the intended server implementation and [manifest.json](manifest.json) for source provenance and per-file SHA256 hashes. The snapshot captures working-tree contents, which may differ from the recorded Git commit.

## Included sources

| Location | Purpose |
|---|---|
| `src/lib/rpgscript.ts` | Runtime parser, script/trigger models, command validation, existing browser loading and registries |
| `src/model/scene.ts` | Existing script execution state, storage, waits, and helpers; this Scene is not Incanterm's room container |
| `src/controller/scene-management.ts` | Runner, conditions, dispatch, script stack, and skip behavior |
| `src/controller/scene/` | Original commands, skip commands, and conditional functions as behavioral references |
| `src/_db/scripts.ts`, `src/controller/res-loader.ts` | Original script registration and collection loading references |
| `scripts/get-rpgscript-collection.js` | Script collection generation |
| `src/rpgscript/` | Original script corpus, examples, language tests, and gameplay usage |
| `src/__tests__/` | Parser, conditionals, storage, scene-command tests, and test setup references |
| `rpgscript-vs/` | VS Code extension, TextMate grammar, language configuration, language server, and build sources |
| `rpgscript-format/` | Separate VS Code formatter extension and build sources |
| Root package/config files | Original dependency and test configuration references, not an Incanterm package setup |

## Editor features preserved

The language extension includes `.rpgscript` registration, TextMate highlighting, language configuration, icon, syntax source, completion, lint/diagnostics, hover documentation, and definitions. Its language-server parser is customized for editor features and must not be blindly replaced by the runtime parser. The separate formatter is included too.

The extension exposes `rpgscript.scriptsRoot` and `rpgscript.sceneCommandsPath` settings. Adapt these to Incanterm's future asset and command locations. Command discovery currently inspects a particular `commands` object and function-declaration layout; an arbitrary new registry format will require updating this discovery logic.

## Extraction boundaries

Dependency directories, generated dist/out output, redundant compiled JS beside TypeScript, source maps, machine npm/yarn settings, duplicate res scripts, and generated collections were omitted. `rpgscript-string-html/` was empty. Lockfiles and meaningful source/build/editor configuration were preserved.

The runtime files intentionally retain original game imports and browser/global dependencies. The copied tests likewise depend on the original application and are not a runnable standalone test suite here. Editor installation scripts may target the original developer environment; inspect/adapt them before use. No dependencies were installed and no extensions were installed or published by this extraction.
