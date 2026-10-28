# ED/ASCII

The project editor is the Vite app started with `npm run editor` from the repository root: **http://localhost:7104**. This folder is the previous painter. Its JSON files can be imported by that editor. Running `npm start` here still serves this older tool on port 3000.

A lightweight, dependency-free browser editor for character art. Requires Node.js 18 or newer.

```sh
npm start
```

Open **http://localhost:3000**. The Node server serves the editor and stores saved documents in `data/*.json`. The last opened or saved file is reopened when you return in the same browser; creating a new document clears that remembered file. Set `PORT` to change the listening port or `HOST` to change the bind address (loopback by default). No build or package installation is needed.

Use the mouse to paint, erase, select, or fill. `B`, `F`, and `E` select full-tile Brush, Fill, and Erase. `Ctrl+B/F/E` selects the foreground version; `Ctrl+Shift+B/F/E` selects the background version. FG Brush paints character and foreground while preserving target background; BG Brush paints only background. FG Fill changes only foreground across connected cells with the same foreground color; BG Fill does likewise for background. FG Erase clears character and foreground while preserving background; BG Erase clears only background. Brushes use the character/colors from a right-picked tile or a per-cell right-dragged stamp. The separate FG Color and BG Color tools recolor existing cells without changing characters; `[` and `]` choose them. Brushes, erasers, and color tools use the current brush size. Middle drag or Space + left drag pans; scroll zooms. Select a rectangle, then use Ctrl+C and Ctrl+V to place a copy. Ctrl+Z / Ctrl+Y undo and redo. S selects rectangle selection; tap Alt and then a key to choose a drawing character (hold Shift with the second key for its shifted version; Esc cancels); Ctrl+S saves. Open the file browser with File → Browse files or Ctrl+O. Export ANSI from the File menu for 16-color terminal output (UTF-8 glyphs, ANSI SGR color codes).

Files use the `ed-ascii` JSON format: `format`, `version`, `width`, `height`, and a row-major `cells` array containing `{ "ch": "█", "fg": 15, "bg": 0 }`. Color indices follow the standard ANSI order: black, red, green, yellow, blue, magenta, cyan, white, then their bright variants. Maximum canvas size is 256 × 128 cells.

New documents default to **120 × 40** cells. Use **Edit → Resize canvas** to change the dimensions of an existing document. Cells stay anchored at the top-left; newly added space is blank, and clipped cells can be recovered with Undo.
