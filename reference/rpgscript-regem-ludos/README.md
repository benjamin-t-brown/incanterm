# RPGScript extraction from regem-ludos

Source snapshot for adapting the user's RPGScript language to Incanterm. These are reference sources, not the implemented Incanterm runtime. The language extension is now maintained in [rpgscript-vs](https://github.com/benjamin-t-brown/rpgscript-vs) and is no longer included in this snapshot.

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
| `rpgscript-format/` | Legacy formatter reference; not required for editor integration |
| Root package/config files | Original dependency and test configuration references, not an Incanterm package setup |

Follow the [editor setup guide](../../docs/rpgscript-cursor-setup.md) to build and
install the standalone extension for Incanterm.

## Extraction boundaries

Dependency directories, generated dist/out output, redundant compiled JS beside TypeScript, source maps, machine npm/yarn settings, duplicate res scripts, and generated collections were omitted. `rpgscript-string-html/` was empty. Lockfiles and meaningful source/build/editor configuration were preserved.

The runtime files intentionally retain original game imports and browser/global dependencies. The copied tests likewise depend on the original application and are not a runnable standalone test suite here. Editor installation scripts may target the original developer environment; inspect/adapt them before use. No dependencies were installed and no extensions were installed or published by this extraction.
