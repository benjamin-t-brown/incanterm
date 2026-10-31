# Install RPGScript support in Cursor

The repository includes the RPGScript language extension under
`reference/rpgscript-regem-ludos/rpgscript-vs`. Build it into a local VSIX file and
install that file in Cursor. It provides highlighting, diagnostics, completion,
hover help, and go-to-definition, including script parameters and local variables.

## 1. Prerequisites

- Install Cursor.
- Install Node.js 24 LTS with npm 11.10 or newer. Check with `node --version` and
  `npm --version` in a new terminal.
- Clone or download this repository and extract it to a regular folder.
- Open the **repository root** (the folder containing `assets`, `src`, and the
  root `package.json`) using Cursor's **File → Open Folder**. Enable workspace
  trust when prompted; this extension requires a trusted workspace.

The commands below work in PowerShell, Command Prompt, and bash. Start in the
repository root. Internet access is needed to download the build dependencies.

## 2. Build the extension package

```sh
cd reference/rpgscript-regem-ludos/rpgscript-vs
npm install --legacy-peer-deps --package-lock=false
npx --yes @vscode/vsce package --no-yarn --allow-missing-repository --no-rewrite-relative-links --skip-license --out dist/rpgscript-vs.vsix
```

The extension has its own dependencies, separate from the game's root package.
`--legacy-peer-deps` accommodates the extension's older lint-tool dependencies;
`--package-lock=false` avoids creating an additional lockfile alongside its Yarn
lockfile. Yarn is not required for these instructions.

The packaging command automatically runs `vscode:prepublish`, which builds both
the extension client and language server. The VSIX includes the server's runtime
dependencies. `--allow-missing-repository` and `--skip-license` allow local
packaging of this extracted extension, whose manifest lacks those metadata fields.
`--no-rewrite-relative-links` keeps repository-relative documentation links as-is;
read those links from the checkout rather than Cursor's extension details page.

The resulting file is:

```text
reference/rpgscript-regem-ludos/rpgscript-vs/dist/rpgscript-vs.vsix
```

## 3. Install in Cursor

1. Open the Command Palette: **Ctrl+Shift+P** (Windows/Linux) or **Cmd+Shift+P**
   (macOS).
2. Run **Extensions: Install from VSIX...** and select the generated file.
3. Run **Developer: Reload Window**.

Alternatively, if the `cursor` command is on your PATH, run this from the
extension directory:

```sh
cursor --install-extension dist/rpgscript-vs.vsix --force
```

Then reload the Cursor window. The installed extension ID is
`incanterm.rpgscript-vs`. If you previously installed another copy of RPGScript
(for example `undefined_publisher.rpgscript-vs` linked to a separate checkout),
disable or uninstall that copy so only this language extension is active.

## 4. Configure the workspace

In Cursor's Command Palette, run **Preferences: Open Workspace Settings (JSON)**.
Merge these settings into the workspace's `.vscode/settings.json`:

```json
{
  "rpgscript.scriptsRoot": "${workspaceFolder}/assets/scripts",
  "rpgscript.sceneCommandsPath": "${workspaceFolder}/src/game/rpgscript/scene-commands.ts",
  "rpgscript.debug": false
}
```

If those entries are already present, keep them. `${workspaceFolder}` resolves to
the folder opened in Cursor, so these paths work wherever you cloned the repo.
The language server reads the command catalog to discover supported commands.
Reload the window after changing these settings or adding commands to the catalog.

## 5. Verify the installation

Open an `.rpgscript` file under `assets/scripts`. The status-bar language mode
should say **RPGScript**. For a quick check, create a temporary file there:

```rpgscript
@cursor_setup_check
  +:cursor_setup_echo("hello")

@cursor_setup_echo(message)
  +log("[message]")
```

- The script should have syntax highlighting and no diagnostics.
- Change `[message]` to `{message}`: expect a warning suggesting `[message]`.
- Change it to `[missing]`: expect an unknown-local error.
- Remove `"hello"` from the call: expect an argument-count error.

Restore the example or delete the temporary file when finished. Invalid scripts
under `assets/scripts` also prevent normal game loading.

To check game execution separately, run these commands **from the repository
root**, after installing the root dependencies:

```sh
npm install
npm run run-rpgscript -- "testArgs()"
```

The included sample logs `Args a b`. Installing the extension enables editor
features; the game runs scripts using its own runtime.

## Updating after a Git pull

Repeat the dependency-install and packaging commands in step 2, reinstall the
VSIX, and reload Cursor. Use the CLI's `--force` option when reinstalling the same
extension version (`0.0.1`). Editing extension source in the checkout does not
update an already installed VSIX.

## Troubleshooting

- **`cursor` is not recognized:** use **Extensions: Install from VSIX...** instead.
- **Plain Text language mode:** click the language indicator and select
  **RPGScript**; verify that the file ends in `.rpgscript` and the extension is enabled.
- **Highlighting works but diagnostics or completion do not:** check workspace
  trust and the two configured paths, then reload. Open **View → Output** and
  select **RPGScript Language Server** to inspect startup errors. Set
  `rpgscript.debug` to `true` temporarily for additional logging.
- **Old diagnostics persist after installing:** check for a second RPGScript
  extension, reinstall the newly built VSIX, and reload the window.
- **Missing `src/server/dist/server.js` or server dependencies:** rebuild and
  install the VSIX using step 2. `npm run build:client` alone only builds the client.

See [RPGScript integration](design/rpgscript.md) for language and runtime details.
