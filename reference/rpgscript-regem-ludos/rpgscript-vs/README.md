# rpgscript-vs README

This is a simple language server for RPGSCRIPT. It includes:

- syntax highlighting
- a linter
- code completion
- go to definition

## Installation

```
yarn
yarn build
yarn package
```

Then install with ctrl+shift+p

## Requirements

You must have a project with rpgscript inside of it. This means you need to provide the root dir of the rpgscript files and the file that contains all the scene commands.

The language server will attempt to parse the sceneCommandsPath file's exports to see which commands are available. Do not attempt to change the default export from that file.

## Extension Settings

This extension contributes the following settings:

- "rpgscript.enable": turn on or off this extension.
- "rpgscript.scriptsRoot": location where rpgscript files are located. default "${workspaceFolder}/src/rpgscript"
- "rpgscript.sceneCommandsPath": location of the scene-commands.ts file that exports all available commands. default "${workspaceFolder}/src/controller/scene/scene-commands.ts"
