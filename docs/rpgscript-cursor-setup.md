# Install RPGScript support in Cursor or VS Code

The [standalone RPGScript extension](https://github.com/benjamin-t-brown/rpgscript-vs)
provides highlighting, formatting, diagnostics, completion, hover help, and
go-to-definition. Incanterm builds the VSIX from a pinned upstream revision;
the extension is not needed to build or run the game.

## 1. Prerequisites

- Install Cursor or VS Code, Git, and Node.js 22 or newer with npm 11.10 or newer.
- Open the Incanterm repository root (the folder containing `projects/`, `src/`,
  and `package.json`). The extension requires workspace trust.

## 2. Build the extension package

Run this from the Incanterm root. It fetches the pinned commit from GitHub,
applies the inline trigger and command navigation patches, installs the
extension's locked dependencies in a temporary checkout, and writes
`dist/rpgscript-vs.vsix`.
You don't need to install Incanterm's npm dependencies for this step.

```sh
npm run build:rpgscript-vs
```

## 3. Install in your editor

1. Open the Command Palette: **Ctrl+Shift+P** (Windows/Linux) or **Cmd+Shift+P**
   (macOS).
2. Run **Extensions: Install from VSIX...** and select the generated file.
3. Run **Developer: Reload Window**.

Alternatively, run this from the Incanterm root (use `code` for VS Code):

```sh
cursor --install-extension dist/rpgscript-vs.vsix --force
```

Then reload the editor window. The extension keeps the ID
`incanterm.rpgscript-vs` and replaces the old vendored build. Disable any copies
installed under a different publisher and the legacy `revirtualis.rpgscript-format`
extension to avoid duplicate language or formatting providers.

## 4. Configure the workspace

Incanterm already ships these settings in `.vscode/settings.json`. If you open a
different workspace, add or adjust them via **Preferences: Open Workspace Settings (JSON)**:

```json
{
  "rpgscript.scriptsRoot": "${workspaceFolder}/projects/ProjectJohnathan/assets/scripts",
  "rpgscript.sceneCommandsPath": "${workspaceFolder}/src/game/scene-commands.ts",
  "rpgscript.debug": false,
  "[rpgscript]": {
    "editor.defaultFormatter": "incanterm.rpgscript-vs"
  }
}
```

These settings select the bundled ProjectJohnathan game. `${workspaceFolder}`
resolves to the Incanterm repository.
For another project, change `scriptsRoot` to its script directory. If you open the
project folder itself as the workspace, use `${workspaceFolder}/assets/scripts`
and point `sceneCommandsPath` to your Incanterm installation's command catalog.
The language server reads the command catalog to discover supported commands.
Reload the window after changing these settings or adding commands to the catalog.

## 5. Verify the installation

Open an `.rpgscript` file under `projects/ProjectJohnathan/assets/scripts`. The status-bar language mode
should say **RPGScript**. For a quick check, create a temporary file there:

```rpgscript
#load@cursor_setup_check
  +:cursor_setup_echo("hello")

@cursor_setup_echo(message)
  +log("[message]")
```

- The script should have syntax highlighting and no diagnostics.
- `#load` should use the same color as other triggers; `@cursor_setup_check`
  should use the script declaration color.
- Run **Format Document** on a line such as `Guide: "Hello  there"`; it should become `Guide: "Hello there"`.
- Change `[message]` to `{message}`: expect a warning suggesting `[message]`.
- Change it to `[missing]`: expect an unknown-local warning.
- Remove `"hello"` from the call: expect an argument-count warning.

The standalone extension treats unknown locals and argument-count mismatches as
warnings for compatibility with other RPGScript games. Incanterm's runtime still
rejects both.

Restore the example or delete the temporary file when finished. Invalid scripts
under the selected project's `assets/scripts` also prevent normal game loading.

To check game execution separately, run these commands **from the repository
root**, after installing the root dependencies:

```sh
npm install
npm run run-rpgscript -- --project projects/ProjectJohnathan "testArgs()"
```

The included sample logs `Args a b`. Installing the extension enables editor
features; the game runs scripts using its own runtime.

## Updating the extension

When the pinned revision in `scripts/build-rpgscript-vs.mjs` changes, rebuild the
VSIX, reinstall it, and reload the editor. Make language-server or grammar changes
in the [standalone repository](https://github.com/benjamin-t-brown/rpgscript-vs),
not in Incanterm. Remove the build patches as their changes land in the pinned
revision.

## Troubleshooting

- **`cursor` or `code` is not recognized:** use **Extensions: Install from VSIX...** instead.
- **Plain Text language mode:** click the language indicator and select
  **RPGScript**; verify that the file ends in `.rpgscript` and the extension is enabled.
- **Highlighting works but diagnostics or completion do not:** check workspace
  trust and the two configured paths, then reload. Open **View → Output** and
  select **RPGScript Language Server** to inspect startup errors. Set
  `rpgscript.debug` to `true` temporarily for additional logging.
- **Old diagnostics persist after installing:** check for a second RPGScript
  extension, reinstall the newly built VSIX, and reload the window.
- **Missing `dist/server.js`:** rebuild and reinstall the VSIX. It bundles the
  client and language server together.

See [RPGScript integration](design/rpgscript.md) for language and runtime details.
