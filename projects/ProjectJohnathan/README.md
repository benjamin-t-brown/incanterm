# ProjectJohnathan

This is an Incanterm game project. `incanterm.json` defines its name, asset directory,
and entry scene (`classroom1`). Assets, scripts, story notes, and project runtime settings
belong here; the Incanterm engine and editor live outside the project.

Start the Incanterm editor and open this directory. The bundled checkout lists this
project automatically, but the folder can also be moved elsewhere and opened by path.
Use the editor's Game zone to play the project.

From the engine repository:

```sh
npm run editor
npm run loopback -- --project projects/ProjectJohnathan
npm run loopback -- --project projects/ProjectJohnathan --scene hallwayGym
npm run dev -- --project projects/ProjectJohnathan
```

For a relocated project, replace the path with its new location. To start at a different
scene temporarily, append `--scene <scene-id-or-label>` (quote labels containing spaces);
to change the default, edit `entryScene`
in `incanterm.json`.

`assets/session-config.json` contains project-owned dialogue and portrait animation settings.
Engine tests do not depend on this project's content.
