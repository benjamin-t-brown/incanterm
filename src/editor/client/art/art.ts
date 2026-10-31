import {
  applyPath,
  extendDrawPath,
  isPathMode,
  isPathStyle,
  PATH_MODES,
  strokeCells,
  type GridPoint,
  type PathMode,
  type PathStyle,
} from '../../art/ascii-path.js';
import { artCursorKind, type ArtCursorGesture, type ArtTool } from '../../art/art-cursor.js';
import { generateCharacter3x3 } from '../../art/character-generator.js';
import { brushValue } from '../../art/art-brush.js';
import { wrappedFrameIndex } from '../../animation/animation-navigation.js';
import { fillCells } from '../../art/art-fill.js';
import { moveSelectedCells, type SelectionRect } from '../../art/art-move.js';
import { isSingleWidthGlyph } from '../../glyph.js';
import { PALETTE_COLORS, PALETTE_IDS, paletteRgb, type PaletteDocument } from '../../palette.js';
import {
  blankCell,
  createSprite,
  DEFAULT_FRAME_DURATION_MS,
  emptySpriteFrame,
  exportTruecolor,
  flattenSprite,
  isAssetId,
  layerNameError,
  spriteLabelError,
  MAX_FRAME_DURATION_MS,
  MAX_FRAMES,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYERS,
  type SpriteCell,
  type SpriteDocument,
  type SpriteFrame,
  type SpriteLayer,
} from '../../schema.js';
import {
  DEFAULT_SPRITE_FONT,
  isSpriteFontId,
  preloadSpriteFonts,
  spriteFontFamily,
  spriteFontNativePx,
  SPRITE_FONTS,
  terminalCellAtZoom,
  terminalFont,
  type SpriteFontId,
  type TerminalCell,
} from '../../terminal-cell.js';
import { drawTerminalGlyph, fillTerminalCell } from '../terminal-renderer.js';
import {
  createReference,
  DEFAULT_REFERENCE_OPACITY,
  fitReferenceRect,
  resizeReferenceRect,
  type ReferenceHandle,
  type SpriteReference,
} from '../../art/reference.js';
import {
  ART_TAB_PERSIST_MS,
  LAST_SPRITE_KEY,
  addOpenTab,
  buildArtTabStore,
  closeOpenTab,
  defaultArtTabChrome,
  neighborTab,
  pruneMissingTabs,
  readArtTabStore,
  renameOpenTab,
  sessionDirty,
  writeArtTabStore,
  type ArtTabChrome,
  type ArtTabDirtySession,
} from '../../art/art-tabs.js';
import {
  jsonRequest,
  requestJson,
  putBytes,
  getBytes,
  getBytesWithRevision,
  ApiError,
} from '../api.js';
import { mergeSprite } from '../../art/sprite-merge.js';
import { mergeJson } from '../../safe-save.js';
import { saveDraft } from '../save.js';
import { artCursorCss } from './cursors.js';
import {
  alertModal,
  askAnimationSpeed,
  askNewSprite,
  askSaveAs,
  askAssetMeta,
  confirmModal,
  isModalOpen,
} from '../modal.js';
import {
  askId,
  assetEditorTopbar,
  setDirtyGuard,
  setEditorAssetUrl,
  setupThemeToggle,
} from '../shell.js';

type Stamp = { width: number; height: number; cells: (SpriteCell | null)[] };
type Point = { x: number; y: number; sx: number; sy: number };
type Tool = ArtTool;
type HistoryEntry = {
  doc: SpriteDocument;
  selectedFrame: number;
  activeLayerId: string | null;
  selection?: SelectionRect | null;
};
type TabSession = ArtTabDirtySession & {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  reference: SpriteReference | null;
  referenceBase: SpriteReference | null;
  referenceRevision: string | null;
  referenceImage: HTMLImageElement | null;
  referenceUrl: string | null;
  referenceEdit: boolean;
};

const SPECIAL_GLYPHS = [
  '█',
  '▓',
  '▒',
  '░',
  '■',
  '▪',
  '●',
  '○',
  '╔',
  '╗',
  '╚',
  '╝',
  '═',
  '║',
  '╠',
  '╣',
  '╦',
  '╩',
  '┌',
  '┐',
  '└',
  '┘',
  '─',
  '│',
  '┼',
  '╬',
  '╱',
  '╲',
  '╳',
  '•',
  '→',
  '←',
  '↑',
  '↓',
  '▀',
  '▄',
  '▌',
  '▐',
  '▬',
  '▮',
  '▯',
  '▰',
  '┬',
  '┴',
  '├',
  '┤',
  '╭',
  '╮',
  '╰',
  '╯',
  '┏',
  '┓',
  '┗',
  '┛',
  '━',
  '┃',
  '┳',
  '┻',
  '┣',
  '┫',
  '╋',
  '▲',
  '▼',
  '◄',
  '►',
  '★',
  '☆',
  '♥',
  '◆',
];
const ALIASING_GLYPHS = Array.from('_,od8bn."*+=YP^\'`;[]()-/\\|');
const GLYPH_TABS = [
  { id: 'specials', label: 'SPECIALS', glyphs: SPECIAL_GLYPHS },
  { id: 'aliasing', label: 'ALIASING', glyphs: ALIASING_GLYPHS },
] as const;
type GlyphTabId = (typeof GLYPH_TABS)[number]['id'];
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 8;
const ZOOM_STEPS = [MIN_ZOOM, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, MAX_ZOOM];
const SPEED_KEY = 'incanterm-editor-animation-ms';
const GRID_KEY = 'incanterm-editor-show-grid';

function readAnimationSpeed(): number {
  const raw = Number(localStorage.getItem(SPEED_KEY));
  if (Number.isInteger(raw) && raw >= 1 && raw <= MAX_FRAME_DURATION_MS) return raw;
  return DEFAULT_FRAME_DURATION_MS;
}

export function mountArt(root: HTMLElement): () => void {
  root.innerHTML = artMarkup();
  void preloadSpriteFonts().then(() => {
    if (!alive) return;
    if (autoFit) fit();
    else redraw();
  });
  const $ = <T extends Element>(selector: string) => {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element as T;
  };
  const canvas = $<HTMLCanvasElement>('#canvas');
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('Canvas is unavailable');
  const context: CanvasRenderingContext2D = drawing;
  const wrap = $<HTMLElement>('#canvas-wrap');

  let palette: PaletteDocument = { format: 'incanterm-palette', version: 1, colors: [] };
  let paletteSaved: PaletteDocument = palette;
  let paletteSaving = false;
  let doc: SpriteDocument | null = null;
  let selectedFrame = 0;
  let playFrom = 0;
  let playTo = 0;
  let rangeSelected = false;
  let moveArmed = false;
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | null = null;
  let animationSpeed = readAnimationSpeed();
  let frameGesture: {
    origin: number;
    last: number;
    kind: 'pending' | 'range' | 'reorder';
    startX: number;
    startY: number;
  } | null = null;
  let activeLayerId: string | null = null;
  let renamingLayer = false;
  let savedState = '';
  let saving = false;
  let spriteId: string | null = null;
  let tool: Tool = 'brush';
  let brushSize = 1;
  let pathMode: PathMode = 'draw';
  let pathStyle: PathStyle = 'double';
  let glyph = '█';
  let fg = 'bright-white';
  let bg = 'black';
  let colorTarget: 'fg' | 'bg' = 'fg';
  let paletteEdit = 'bright-white';
  const generateColors = { shirt: 'bright-yellow', letter: 'bright-black' };
  function generatorColorHex(kind: 'shirt' | 'letter'): string {
    const color = generateColors[kind];
    return (
      paletteRgb(palette, color) ??
      PALETTE_COLORS.find((entry) => entry.id === color)?.rgb ??
      color
    );
  }
  function generatorColorValue(kind: 'shirt' | 'letter'): string {
    const typed = $<HTMLInputElement>(`#generate-${kind}-hex`).value.trim();
    return typed.toLowerCase() === generatorColorHex(kind) ? generateColors[kind] : typed;
  }
  let stamp: Stamp | null = null;
  let clipboard: Stamp | null = null;
  let layerClipboard: (SpriteCell | null)[] | null = null;
  let clipboardKind: 'layer' | 'stamp' | null = null;
  let celMarked = false;
  let selection: { x: number; y: number; width: number; height: number } | null = null;
  let pasteMode = false;
  let showGrid = localStorage.getItem(GRID_KEY) !== '0';
  let zoom = 1;
  let ox = 30;
  let oy = 30;
  let viewW = 0;
  let viewH = 0;
  let hover: Point | null = null;
  let gesture: {
    kind: string;
    before?: HistoryEntry;
    start?: Point;
    end?: Point;
    last?: Point;
    sx?: number;
    sy?: number;
    ox?: number;
    oy?: number;
    rect?: { x: number; y: number; width: number; height: number };
    sourceCells?: (SpriteCell | null)[];
    handle?: ReferenceHandle;
    path?: GridPoint[];
    shift?: boolean;
  } | null = null;
  let reference: SpriteReference | null = null;
  let referenceBase: SpriteReference | null = null;
  let referenceRevision: string | null = null;
  let referenceSaving = false;
  let referenceImage: HTMLImageElement | null = null;
  let referenceUrl: string | null = null;
  let referenceEdit = false;
  let spaceHeld = false;
  let pressing = false;
  let sampling = false;
  let keyMode = false;
  let altDown = false;
  let altUsed = false;
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  let framePending = false;
  let autoFit = true;
  let alive = true;
  let openTabs: string[] = [];
  const spriteLabels = new Map<string, string>();
  const sessions = new Map<string, TabSession>();
  const displayName = (id: string) =>
    (id === spriteId ? doc?.label : sessions.get(id)?.doc.label ?? spriteLabels.get(id)) ?? id;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistWarned = false;
  let discardOnLeave = false;
  let switchToken = 0;

  const stops: (() => void)[] = [];
  const listen = (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, listener, options);
    stops.push(() => target.removeEventListener(type, listener, options));
  };

  function rgb(id: string): string {
    return paletteRgb(palette, id) ?? '#000000';
  }
  function dirty(): boolean {
    return doc !== null && JSON.stringify(doc) !== savedState;
  }
  function layerLabel(layer: SpriteLayer): string {
    const flags = [layer.visible ? '' : 'HIDDEN', layer.locked ? 'LOCKED' : ''].filter(
      (flag) => flag !== '',
    );
    return flags.length === 0
      ? layer.name.toUpperCase()
      : `${layer.name.toUpperCase()} · ${flags.join(' · ')}`;
  }
  function paintBlocked(): boolean {
    const layer = activeLayer();
    if (!layer || (layer.visible && !layer.locked) || spaceHeld) return false;
    if (pasteMode) return true;
    const base = toolBase(tool);
    return base === 'brush' || base === 'fill' || base === 'erase' || base === 'path' || base === 'move';
  }
  function syncCanvasCursor(): void {
    if (referenceEdit && referenceShown() && !spaceHeld && gesture?.kind !== 'pan') {
      const hit =
        gesture?.kind === 'ref-resize' && gesture.handle
          ? gesture.handle
          : gesture?.kind === 'ref-move'
            ? 'body'
            : hover
              ? hitReference(hover.sx, hover.sy)
              : null;
      if (hit === 'nw' || hit === 'se') {
        canvas.style.cursor = 'nwse-resize';
        return;
      }
      if (hit === 'ne' || hit === 'sw') {
        canvas.style.cursor = 'nesw-resize';
        return;
      }
      if (hit === 'body') {
        canvas.style.cursor = 'move';
        return;
      }
      canvas.style.cursor = 'default';
      return;
    }
    if (tool === 'move' && (gesture?.kind === 'move' || (!spaceHeld && gesture?.kind !== 'pan'))) {
      canvas.style.cursor = paintBlocked()
        ? 'not-allowed'
        : gesture?.kind === 'move'
          ? 'grabbing'
          : selection && hover && selectionContains(selection, hover)
            ? 'grab'
            : 'default';
      return;
    }
    const kind = gesture?.kind;
    const cursorGesture: ArtCursorGesture | null =
      kind === 'pan' || kind === 'pick' || kind === 'paint' || kind === 'select' || kind === 'path'
        ? kind
        : null;
    canvas.style.cursor = artCursorCss(
      artCursorKind({
        tool,
        pasteMode,
        spaceHeld,
        gesture: cursorGesture,
        sampling,
        blocked: paintBlocked(),
      }),
      pressing,
    );
  }
  function activeFrame(): SpriteFrame | null {
    if (!doc || doc.sprites.length === 0) return null;
    return doc.sprites[selectedFrame] ?? doc.sprites[0] ?? null;
  }
  function frameLayers(): SpriteLayer[] {
    return activeFrame()?.layers ?? [];
  }
  function sheetLayers(): SpriteLayer[] {
    return doc?.sprites[0]?.layers ?? [];
  }
  function layerPainted(layer: SpriteLayer | undefined): boolean {
    return layer?.cells.some((cell) => cell !== null) ?? false;
  }
  function blankFrame(): SpriteFrame {
    if (!doc) return emptySpriteFrame(1, 1);
    const count = doc.width * doc.height;
    const layers = sheetLayers();
    if (layers.length === 0) return emptySpriteFrame(doc.width, doc.height);
    return {
      layers: layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        cells: Array.from({ length: count }, () => null),
      })),
    };
  }
  function eachNamedLayer(id: string, visit: (layer: SpriteLayer) => void): void {
    if (!doc) return;
    for (const frame of doc.sprites) {
      const layer = frame.layers.find((entry) => entry.id === id);
      if (layer) visit(layer);
    }
  }
  function selectTopLayer(): void {
    const layers = frameLayers();
    activeLayerId = layers[layers.length - 1]?.id ?? null;
  }
  function activeLayer(): SpriteLayer | null {
    const layers = frameLayers();
    if (layers.length === 0) return null;
    return layers.find((layer) => layer.id === activeLayerId) ?? layers[layers.length - 1];
  }
  function layerCell(x: number, y: number): SpriteCell | null {
    if (!doc || !inside(x, y)) return null;
    const layer = activeLayer();
    if (!layer) return null;
    return layer.cells[y * doc.width + x] ?? null;
  }
  function visibleEntry(x: number, y: number): SpriteCell | null {
    if (!doc || !inside(x, y)) return null;
    const layers = frameLayers();
    for (let index = layers.length - 1; index >= 0; index--) {
      const layer = layers[index];
      if (!layer.visible) continue;
      const entry = layer.cells[y * doc.width + x];
      if (entry) return entry;
    }
    return null;
  }
  function inside(x: number, y: number): boolean {
    return doc !== null && x >= 0 && y >= 0 && x < doc.width && y < doc.height;
  }
  function cloneFrame(frame: SpriteFrame): SpriteFrame {
    return {
      layers: frame.layers.map((layer) => ({
        ...layer,
        cells: layer.cells.map((entry) => (entry ? { ...entry } : null)),
      })),
    };
  }
  function cloneDoc(source: SpriteDocument): SpriteDocument {
    return {
      ...source,
      sprites: source.sprites.map((frame) => cloneFrame(frame)),
    };
  }
  function captureHistory(): HistoryEntry | null {
    if (!doc) return null;
    return {
      doc: cloneDoc(doc),
      selectedFrame,
      activeLayerId,
      selection: selection ? { ...selection } : null,
    };
  }
  function stopPlayback(): void {
    playing = false;
    if (playTimer !== null) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    const button = root.querySelector<HTMLButtonElement>('#frame-play');
    if (button) {
      button.textContent = '▶';
      button.title = 'Play (Enter)';
    }
  }
  function clampSelectedFrame(): void {
    if (!doc || doc.sprites.length === 0) {
      selectedFrame = 0;
      playFrom = 0;
      playTo = 0;
      return;
    }
    selectedFrame = Math.max(0, Math.min(selectedFrame, doc.sprites.length - 1));
    clampPlayRange();
  }
  function clampPlayRange(): void {
    if (!doc || doc.sprites.length === 0) {
      playFrom = 0;
      playTo = 0;
      return;
    }
    const last = doc.sprites.length - 1;
    playFrom = Math.max(0, Math.min(playFrom, last));
    playTo = Math.max(0, Math.min(playTo, last));
    if (playFrom > playTo) {
      const swap = playFrom;
      playFrom = playTo;
      playTo = swap;
    }
  }
  function playBounds(): { from: number; to: number } {
    clampPlayRange();
    return { from: playFrom, to: playTo };
  }
  function focusFrameColumn(index: number): void {
    selectedFrame = index;
    playFrom = index;
    playTo = index;
    rangeSelected = true;
    moveArmed = true;
  }
  function clearColumnRange(): void {
    rangeSelected = false;
    moveArmed = false;
  }
  function frameStatusText(): string {
    if (!doc) return 'NO FRAME';
    const { from, to } = playBounds();
    const current = `FRAME ${selectedFrame + 1}/${doc.sprites.length}`;
    return rangeSelected && from !== to ? `${current} · ${from + 1}–${to + 1}` : current;
  }
  function announce(text: string): void {
    $<HTMLElement>('#status').textContent = text;
  }
  function toast(message: string, error = false): void {
    const item = document.createElement('div');
    item.className = error ? 'save-toast error' : 'save-toast';
    item.innerHTML = `<span class="toast-icon">${error ? '!' : '✓'}</span><span class="toast-message"></span><button class="close-toast" type="button">×</button>`;
    item.querySelector('.toast-message')!.textContent = message;
    item.querySelector('button')!.addEventListener('click', () => item.remove());
    $<HTMLElement>('#toast-stack').append(item);
    setTimeout(() => item.remove(), 4000);
  }
  function updateTitle(): void {
    const grid = doc ? cell() : null;
    $<HTMLElement>('#dimensions').textContent = doc
      ? grid
        ? `${doc.width} × ${doc.height} CELLS · ${Math.round(grid.width)}×${Math.round(grid.height)}`
        : `${doc.width} × ${doc.height} CELLS`
      : 'NO SPRITE';
    renderTabs();
  }
  function refreshControls(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === toolBase(tool));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach((button) => {
      const active = button.dataset.variant === toolVariant(tool);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = toolBase(tool) === 'select' || toolBase(tool) === 'move';
    });
    const pathActive = toolBase(tool) === 'path';
    $<HTMLInputElement>('#brush-size').disabled = pathActive || tool === 'move';
    $<HTMLElement>('#path-settings').hidden = !pathActive;
    $<HTMLSelectElement>('#path-mode').value = pathMode;
    $<HTMLSelectElement>('#path-style').value = pathStyle;
    $<HTMLElement>('#fg-target').classList.toggle('active', colorTarget === 'fg');
    $<HTMLElement>('#bg-target').classList.toggle('active', colorTarget === 'bg');
    $<HTMLElement>('#fg-chip').style.background = rgb(fg);
    $<HTMLElement>('#bg-chip').style.background = rgb(bg);
    const paintHex = $<HTMLInputElement>('#paint-hex');
    if (document.activeElement !== paintHex) paintHex.value = rgb(colorTarget === 'fg' ? fg : bg);
    $<HTMLElement>('#glyph-capture-char').textContent = glyph;
    $<HTMLButtonElement>('#glyph-capture').setAttribute('aria-pressed', String(keyMode));
    $<HTMLElement>('#key-mode-hint').hidden = !keyMode;
    $<HTMLInputElement>('#brush-size').value = String(brushSize);
    $<HTMLElement>('#brush-size-label').textContent = `${brushSize} × ${brushSize}`;
    const variantLabel = { full: 'GLYPH', fg: 'FG', bg: 'BG' }[toolVariant(tool)];
    $<HTMLElement>('#tool-status').textContent = tool === 'move'
      ? selection ? `MOVE / ${selection.width} × ${selection.height}` : 'MOVE / SELECT AREA'
      : pathActive
      ? `${toolBase(tool).toUpperCase()} / ${pathMode.toUpperCase()} / ${pathStyle.toUpperCase()} / ${variantLabel}`
      : stamp && ['brush', 'fg-brush', 'bg-brush'].includes(tool)
        ? `${toolBase(tool).toUpperCase()} / ${variantLabel} / ${stamp.width} × ${stamp.height} STAMP`
        : `${toolBase(tool).toUpperCase()} / ${variantLabel} / ${brushSize} × ${brushSize}`;
    const layer = activeLayer();
    $<HTMLElement>('#frame-status').textContent = frameStatusText();
    $<HTMLElement>('#layer-status').textContent = layer ? layerLabel(layer) : 'NO LAYER';
    syncCanvasCursor();
    renderTimeline();
    $<HTMLElement>('#zoom-label').textContent = `${Math.round(zoom * 100)}%`;
    $<HTMLInputElement>('#palette-rgb').value = rgb(paletteEdit);
    const family = spriteFontFamily(doc?.font ?? DEFAULT_SPRITE_FONT);
    $<HTMLElement>('#glyph-capture-char').style.fontFamily = family;
    root.querySelectorAll<HTMLElement>('.glyph-list').forEach((list) => {
      list.style.fontFamily = family;
    });
    root.querySelectorAll<HTMLButtonElement>('.glyph-list button').forEach((button) => {
      button.classList.toggle('active', button.dataset.glyph === glyph && !stamp);
    });
    if (doc) {
      $<HTMLInputElement>('#origin-x').value = String(doc.originX);
      $<HTMLInputElement>('#origin-y').value = String(doc.originY);
    }
    refreshReferenceControls();
    const gridAction = root.querySelector<HTMLButtonElement>('[data-action="toggle-grid"]');
    if (gridAction) {
      gridAction.replaceChildren(
        document.createTextNode(showGrid ? 'Hide grid ' : 'Show grid '),
        Object.assign(document.createElement('kbd'), { textContent: 'G' }),
      );
    }
    root.querySelectorAll<HTMLButtonElement>('#palette button').forEach((button) => {
      const id = button.dataset.color ?? '';
      button.classList.toggle('selected', id === fg || id === bg || id === paletteEdit);
      button.style.background = rgb(id);
    });
    refreshGenerateColors();
    updateTitle();
    schedulePersist();
    redraw();
  }
  function editingOrigin(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLElement && (active.id === 'origin-x' || active.id === 'origin-y');
  }
  function marchingSelection(): boolean {
    return selection !== null || gesture?.kind === 'select' || gesture?.kind === 'pick';
  }
  function redraw(): void {
    if (framePending || !alive) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      if (!alive) return;
      draw();
    });
  }
  function spriteFont(): SpriteFontId {
    return doc?.font ?? DEFAULT_SPRITE_FONT;
  }
  function cell(): TerminalCell {
    return terminalCellAtZoom(context, zoom, spriteFont());
  }
  function draw(): void {
    if (!viewW || !viewH) return;
    context.clearRect(0, 0, viewW, viewH);
    context.fillStyle = getComputedStyle(wrap).backgroundColor;
    context.fillRect(0, 0, viewW, viewH);
    if (!doc) return;
    const grid = cell();
    const cw = grid.width;
    const ch = grid.height;
    const x0 = Math.max(0, Math.floor(-ox / cw));
    const y0 = Math.max(0, Math.floor(-oy / ch));
    const x1 = Math.min(doc.width, Math.ceil((viewW - ox) / cw));
    const y1 = Math.min(doc.height, Math.ceil((viewH - oy) / ch));
    context.fillStyle = rgb('black');
    context.fillRect(ox, oy, doc.width * cw, doc.height * ch);
    if (reference && referenceImage && reference.visible) {
      context.save();
      context.globalAlpha = reference.opacity;
      context.imageSmoothingEnabled = false;
      context.drawImage(
        referenceImage,
        ox + reference.x * cw,
        oy + reference.y * ch,
        reference.width * cw,
        reference.height * ch,
      );
      context.restore();
    }
    const flat = flattenSprite(doc, selectedFrame);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const entry = flat[y * doc.width + x];
        const px = ox + x * cw;
        const py = oy + y * ch;
        if (entry.bg !== 'black') {
          context.fillStyle = rgb(entry.bg);
          fillTerminalCell(context, grid, px, py);
        }
        if (entry.ch !== ' ') {
          context.fillStyle = rgb(entry.fg);
          drawTerminalGlyph(context, grid, entry.ch, px, py);
        }
      }
    }
    if (showGrid) drawGrid(cw, ch, x0, y0, x1, y1);
    context.strokeStyle = '#add1c3';
    context.lineWidth = 2;
    context.strokeRect(
      Math.round(ox) - 1,
      Math.round(oy) - 1,
      doc.width * cw + 2,
      doc.height * ch + 2,
    );
    if (referenceEdit && referenceShown()) drawReferenceHandles(cw, ch);
    if (editingOrigin()) box({ x: doc.originX, y: doc.originY, width: 1, height: 1 }, '#f2df9e');
    const march = (performance.now() / 60) % 12;
    if (selection) box(selection, '#f2df9e', [6, 6], march);
    if (gesture?.kind === 'select' || gesture?.kind === 'pick') {
      if (gesture.start && gesture.end)
        box(bounds(gesture.start, gesture.end), '#ffffff', [6, 6], march);
    }
    if (gesture?.kind === 'path' && gesture.start && gesture.end) {
      paintPathPreview(pathGestureCells(gesture.end, gesture.shift === true));
    }
    if (hover && inside(hover.x, hover.y) && !referenceEdit && tool !== 'move') {
      if (
        !gesture &&
        !paintBlocked() &&
        (tool === 'brush' || tool === 'fg-brush' || tool === 'bg-brush')
      ) {
        paintPreview(hover);
      }
      const rect =
        pasteMode && clipboard
          ? { x: hover.x, y: hover.y, width: clipboard.width, height: clipboard.height }
          : brushTools().includes(tool)
            ? brushRect(hover)
            : { x: hover.x, y: hover.y, width: 1, height: 1 };
      box(rect, pasteMode ? '#f2df9e' : '#ffffff');
    }
    if (marchingSelection()) redraw();
  }
  function drawGrid(cw: number, ch: number, x0: number, y0: number, x1: number, y1: number): void {
    if (!doc) return;
    const left = Math.round(ox + x0 * cw);
    const right = Math.round(ox + x1 * cw);
    const top = Math.round(oy + y0 * ch);
    const bottom = Math.round(oy + y1 * ch);
    context.save();
    context.strokeStyle = 'rgba(173, 209, 195, 0.35)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = Math.max(1, x0); x < Math.min(doc.width, x1); x++) {
      const px = Math.round(ox + x * cw) + 0.5;
      context.moveTo(px, top);
      context.lineTo(px, bottom);
    }
    for (let y = Math.max(1, y0); y < Math.min(doc.height, y1); y++) {
      const py = Math.round(oy + y * ch) + 0.5;
      context.moveTo(left, py);
      context.lineTo(right, py);
    }
    context.stroke();
    context.restore();
  }
  function toggleGrid(): void {
    showGrid = !showGrid;
    localStorage.setItem(GRID_KEY, showGrid ? '1' : '0');
    refreshControls();
    announce(showGrid ? 'Grid shown' : 'Grid hidden');
  }
  function paintPreview(origin: Point): void {
    const source = { ch: glyph, fg, bg };
    const grid = cell();
    context.save();
    context.globalAlpha = 0.45;
    const place = (x: number, y: number, value: SpriteCell | null) => {
      if (!value || !inside(x, y)) return;
      const px = ox + x * grid.width;
      const py = oy + y * grid.height;
      context.fillStyle = rgb(value.bg);
      fillTerminalCell(context, grid, px, py);
      if (value.ch !== ' ') {
        context.fillStyle = rgb(value.fg);
        drawTerminalGlyph(context, grid, value.ch, px, py);
      }
    };
    if (stamp) {
      for (let y = 0; y < stamp.height; y++) {
        for (let x = 0; x < stamp.width; x++) {
          const sample = stamp.cells[y * stamp.width + x];
          if (sample === null) continue;
          place(
            origin.x + x,
            origin.y + y,
            brushValue(tool, sample, layerCell(origin.x + x, origin.y + y)),
          );
        }
      }
    } else {
      const rect = brushRect(origin);
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          place(x, y, brushValue(tool, source, layerCell(x, y)));
        }
      }
    }
    context.restore();
  }
  function paintPathPreview(cells: GridPoint[]): void {
    const grid = cell();
    context.save();
    context.globalAlpha = 0.45;
    for (const write of applyPath(cells, pathStyle, (x, y) => layerCell(x, y)?.ch ?? null)) {
      if (!inside(write.x, write.y)) continue;
      const existing = layerCell(write.x, write.y);
      const value = write.stroke
        ? pathCellValue(write.ch, existing)
        : existing
          ? { ...existing, ch: write.ch }
          : null;
      if (!value) continue;
      const px = ox + write.x * grid.width;
      const py = oy + write.y * grid.height;
      context.fillStyle = rgb(value.bg);
      fillTerminalCell(context, grid, px, py);
      if (value.ch !== ' ') {
        context.fillStyle = rgb(value.fg);
        drawTerminalGlyph(context, grid, value.ch, px, py);
      }
    }
    context.restore();
  }
  function box(
    rect: { x: number; y: number; width: number; height: number },
    color: string,
    dash: number[] = [],
    offset = 0,
  ): void {
    const grid = cell();
    const x = Math.round(ox + rect.x * grid.width) + 0.5;
    const y = Math.round(oy + rect.y * grid.height) + 0.5;
    const width = Math.round(rect.width * grid.width);
    const height = Math.round(rect.height * grid.height);
    context.save();
    context.lineWidth = 2;
    if (dash.length > 0) {
      context.setLineDash(dash);
      context.lineDashOffset = -offset;
      context.strokeStyle = '#0c1f1e';
      context.strokeRect(x, y, width, height);
      context.lineDashOffset = -offset + dash[0];
    }
    context.strokeStyle = color;
    context.strokeRect(x, y, width, height);
    context.restore();
  }
  function bounds(a: Point, b: Point) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x) + 1,
      height: Math.abs(a.y - b.y) + 1,
    };
  }
  function selectionContains(rect: SelectionRect, point: Point): boolean {
    return point.x >= rect.x && point.x < rect.x + rect.width &&
      point.y >= rect.y && point.y < rect.y + rect.height;
  }
  function cancelMove(): void {
    if (gesture?.kind !== 'move') return;
    const layer = activeLayer();
    if (layer && gesture.sourceCells) layer.cells = gesture.sourceCells;
    if (gesture.rect) selection = gesture.rect;
  }
  function brushTools(): Tool[] {
    return ['brush', 'fg-brush', 'bg-brush', 'erase', 'fg-erase', 'bg-erase', 'fg', 'bg'];
  }
  function brushRect(point: Point) {
    if (stamp && ['brush', 'fg-brush', 'bg-brush'].includes(tool)) {
      return { x: point.x, y: point.y, width: stamp.width, height: stamp.height };
    }
    return {
      x: point.x - Math.floor((brushSize - 1) / 2),
      y: point.y - Math.floor((brushSize - 1) / 2),
      width: brushSize,
      height: brushSize,
    };
  }
  function resizeView(): void {
    const rect = wrap.getBoundingClientRect();
    viewW = rect.width;
    viewH = rect.height;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewW * ratio);
    canvas.height = Math.round(viewH * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (autoFit) fit();
    else redraw();
  }
  function fit(): void {
    if (!viewW || !viewH || !doc) return;
    autoFit = true;
    const grid = terminalCellAtZoom(context, 1, spriteFont());
    zoom = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        (viewW - 64) / (doc.width * grid.width),
        (viewH - 64) / (doc.height * grid.height),
      ),
    );
    ox = Math.round((viewW - doc.width * grid.width * zoom) / 2);
    oy = Math.round((viewH - doc.height * grid.height * zoom) / 2);
    refreshControls();
  }
  function setZoom(value: number, anchorX = viewW / 2, anchorY = viewH / 2): void {
    autoFit = false;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
    ox = anchorX - ((anchorX - ox) * next) / zoom;
    oy = anchorY - ((anchorY - oy) * next) / zoom;
    zoom = next;
    refreshControls();
  }
  function stepZoom(direction: number, x = viewW / 2, y = viewH / 2): void {
    const index =
      direction > 0
        ? ZOOM_STEPS.findIndex((step) => step > zoom + 0.001)
        : ZOOM_STEPS.reduce(
            (found, step, stepIndex) => (step < zoom - 0.001 ? stepIndex : found),
            -1,
          );
    if (index !== -1) setZoom(ZOOM_STEPS[index], x, y);
  }
  function point(event: MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const grid = cell();
    return {
      sx,
      sy,
      x: Math.floor((sx - ox) / grid.width),
      y: Math.floor((sy - oy) / grid.height),
    };
  }
  const REFERENCE_HANDLE = 8;
  function referencePixelRect(): { x: number; y: number; width: number; height: number } | null {
    if (!reference) return null;
    const grid = cell();
    return {
      x: ox + reference.x * grid.width,
      y: oy + reference.y * grid.height,
      width: reference.width * grid.width,
      height: reference.height * grid.height,
    };
  }
  function referenceHandles(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): { handle: ReferenceHandle; x: number; y: number }[] {
    return [
      { handle: 'nw', x: rect.x, y: rect.y },
      { handle: 'ne', x: rect.x + rect.width, y: rect.y },
      { handle: 'sw', x: rect.x, y: rect.y + rect.height },
      { handle: 'se', x: rect.x + rect.width, y: rect.y + rect.height },
    ];
  }
  function hitReference(sx: number, sy: number): ReferenceHandle | 'body' | null {
    const rect = referencePixelRect();
    if (!rect) return null;
    const reach = REFERENCE_HANDLE + 2;
    for (const corner of referenceHandles(rect)) {
      if (Math.abs(sx - corner.x) <= reach && Math.abs(sy - corner.y) <= reach)
        return corner.handle;
    }
    if (sx >= rect.x && sy >= rect.y && sx <= rect.x + rect.width && sy <= rect.y + rect.height) {
      return 'body';
    }
    return null;
  }
  function drawReferenceHandles(cw: number, ch: number): void {
    if (!reference) return;
    const x = ox + reference.x * cw;
    const y = oy + reference.y * ch;
    const width = reference.width * cw;
    const height = reference.height * ch;
    context.save();
    context.lineWidth = 2;
    context.strokeStyle = '#f2df9e';
    context.setLineDash([6, 4]);
    context.strokeRect(x + 0.5, y + 0.5, width, height);
    context.setLineDash([]);
    context.fillStyle = '#f2df9e';
    for (const corner of referenceHandles({ x, y, width, height })) {
      context.fillRect(
        corner.x - REFERENCE_HANDLE / 2,
        corner.y - REFERENCE_HANDLE / 2,
        REFERENCE_HANDLE,
        REFERENCE_HANDLE,
      );
    }
    context.restore();
  }
  function referenceShown(): boolean {
    return Boolean(reference && referenceImage && reference.visible);
  }
  function refreshReferenceControls(): void {
    const open = Boolean(doc && spriteId);
    const hasImage = Boolean(reference && referenceImage);
    const shownOnCanvas = hasImage && Boolean(reference?.visible);
    $<HTMLButtonElement>('#reference-open').disabled = !open;
    $<HTMLButtonElement>('#reference-edit').disabled = !shownOnCanvas;
    $<HTMLButtonElement>('#reference-clear').disabled = !hasImage;
    const shown = $<HTMLInputElement>('#reference-visible');
    shown.disabled = !hasImage;
    shown.checked = hasImage ? reference!.visible : true;
    const opacity = $<HTMLInputElement>('#reference-opacity');
    opacity.disabled = !hasImage;
    opacity.value = String(Math.round((reference?.opacity ?? DEFAULT_REFERENCE_OPACITY) * 100));
    $<HTMLElement>('#reference-opacity-label').textContent =
      `${Math.round(Number(opacity.value))}%`;
    $<HTMLButtonElement>('#reference-edit').setAttribute(
      'aria-pressed',
      String(referenceEdit && shownOnCanvas),
    );
    $<HTMLButtonElement>('#reference-edit').classList.toggle(
      'active',
      referenceEdit && shownOnCanvas,
    );
    $<HTMLElement>('#reference-status').textContent = reference
      ? `${reference.id}.${reference.ext}`
      : 'NO IMAGE';
  }
  function forgetReference(): void {
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    referenceUrl = null;
    reference = null;
    referenceBase = null;
    referenceRevision = null;
    referenceImage = null;
    referenceEdit = false;
  }
  async function persistReference(): Promise<void> {
    if (!spriteId || !reference) return;
    if (referenceSaving) return;
    const id = spriteId;
    const sent = structuredClone(reference);
    const base = referenceBase;
    referenceSaving = true;
    try {
      const stored = await saveDraft(`/api/references/${encodeURIComponent(id)}`, sent, base);
      if (spriteId === id && reference) {
        const merged = mergeJson(sent, reference, stored);
        if (merged.ok) {
          reference = merged.value;
          referenceBase = stored;
          redraw();
        } else announce('Reference saved, but newer edits need review');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save reference';
      announce(message);
      toast(message, true);
      if (error instanceof ApiError && error.status === 409) {
        await alertModal(`${message}. Your reference placement remains open.`);
      }
    } finally {
      referenceSaving = false;
      if (
        spriteId === id &&
        reference &&
        referenceBase &&
        JSON.stringify(reference) !== JSON.stringify(referenceBase)
      ) {
        // A drag may have produced more edits while the request was in flight.
        // Only retry automatically after a successful save with a new base.
        if (referenceBase !== base) void persistReference();
      }
    }
  }
  async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Could not read that image');
    }
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    referenceUrl = url;
    return image;
  }
  async function loadReference(id: string): Promise<void> {
    forgetReference();
    try {
      const meta = await requestJson<SpriteReference>(`/api/references/${encodeURIComponent(id)}`);
      const image = await getBytesWithRevision(
        `/api/references/${encodeURIComponent(id)}/image?t=${Date.now()}`,
      );
      if (!alive || spriteId !== id) return;
      reference = meta;
      referenceBase = meta;
      referenceRevision = image.revision;
      referenceImage = await blobToImage(image.blob);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        announce(error instanceof Error ? error.message : 'Could not load reference');
      }
    }
    if (!alive || spriteId !== id) return;
    refreshReferenceControls();
    redraw();
  }
  async function adoptReferenceBlob(blob: Blob): Promise<void> {
    if (!doc || !spriteId) {
      announce('Open or create a sprite');
      return;
    }
    const id = spriteId;
    try {
      const saved = await putBytes<{ ext: SpriteReference['ext']; revision: string }>(
        `/api/references/${encodeURIComponent(id)}/image`,
        blob,
        referenceRevision,
      );
      referenceRevision = saved.revision;
      const image = await blobToImage(blob);
      if (!alive || spriteId !== id || !doc) return;
      const grid = terminalCellAtZoom(context, 1, spriteFont());
      const rect = reference
        ? { x: reference.x, y: reference.y, width: reference.width, height: reference.height }
        : fitReferenceRect(
            doc.width,
            doc.height,
            image.naturalWidth,
            image.naturalHeight,
            grid.width,
            grid.height,
          );
      const next = createReference(
        id,
        saved.ext,
        rect,
        reference?.opacity ?? DEFAULT_REFERENCE_OPACITY,
      );
      reference = await saveDraft<SpriteReference>(
        `/api/references/${encodeURIComponent(id)}`,
        next,
        referenceBase,
      );
      referenceBase = reference;
      referenceImage = image;
      announce(`Reference ${id}.${saved.ext}`);
      refreshControls();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save reference';
      announce(message);
      toast(message, true);
      throw error instanceof Error ? error : new Error(message);
    }
  }
  function referenceDialog(): HTMLDialogElement {
    return $<HTMLDialogElement>('#reference-dialog');
  }
  function setReferenceDialogStatus(text: string, error = false): void {
    const status = $<HTMLElement>('#reference-dialog-status');
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  function closeReferenceDialog(): void {
    $<HTMLButtonElement>('#reference-dropper').classList.remove('dragover');
    setReferenceDialogStatus('Drop an image, click to browse, or press Ctrl+V.');
    referenceDialog().close();
  }
  function openReferenceDialog(): void {
    if (!doc || !spriteId) {
      announce('Open or create a sprite');
      return;
    }
    setReferenceDialogStatus('Drop an image, click to browse, or press Ctrl+V.');
    referenceDialog().showModal();
  }
  function isReferenceImage(file: File): boolean {
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) return true;
    return /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  }
  function imageFromClipboard(clipboard: DataTransfer | null): File | null {
    if (!clipboard) return null;
    const file = [...clipboard.files].find((entry) => isReferenceImage(entry));
    if (file) return file;
    for (const item of clipboard.items) {
      if (!item.type.startsWith('image/')) continue;
      return item.getAsFile();
    }
    return null;
  }
  async function takeReferenceImage(blob: Blob): Promise<void> {
    setReferenceDialogStatus('Saving…');
    try {
      await adoptReferenceBlob(blob);
      closeReferenceDialog();
    } catch (error) {
      setReferenceDialogStatus(
        error instanceof Error ? error.message : 'Could not save reference',
        true,
      );
    }
  }
  async function clearReference(): Promise<void> {
    if (!spriteId || !reference) return;
    const id = spriteId;
    try {
      await requestJson(`/api/references/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (spriteId === id) forgetReference();
      announce('Reference cleared');
      refreshControls();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not clear reference';
      announce(message);
      toast(message, true);
    }
  }
  function remember(before: HistoryEntry | null | undefined): void {
    if (!doc || !before) return;
    if (JSON.stringify(before.doc) === JSON.stringify(doc)) return;
    stopPlayback();
    undoStack.push(before);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateTitle();
    schedulePersist();
    redraw();
  }
  function restore(previous: HistoryEntry): void {
    renamingLayer = false;
    const resized = !doc || previous.doc.width !== doc.width || previous.doc.height !== doc.height;
    doc = cloneDoc(previous.doc);
    selectedFrame = previous.selectedFrame;
    activeLayerId = previous.activeLayerId;
    if (previous.selection !== undefined) selection = previous.selection;
    clampSelectedFrame();
    if (selectedFrame < playFrom || selectedFrame > playTo) {
      playFrom = selectedFrame;
      playTo = selectedFrame;
    }
    if (!frameLayers().some((layer) => layer.id === activeLayerId)) selectTopLayer();
    if (resized) {
      selection = null;
      fit();
      return;
    }
    refreshControls();
  }
  function setCell(x: number, y: number, value: SpriteCell | null): void {
    if (!doc || !inside(x, y)) return;
    const layer = activeLayer();
    if (!layer || layer.locked) return;
    layer.cells[y * doc.width + x] = value ? { ...value } : null;
  }
  function applyBrush(p: Point): void {
    if (!doc) return;
    if (playing) stopPlayback();
    const paint = (x: number, y: number, source: SpriteCell | null) => {
      if (!inside(x, y)) return;
      if (tool === 'erase' || (tool === 'brush' && source === null)) {
        setCell(x, y, null);
        return;
      }
      if (!source) return;
      const next = brushValue(tool, source, layerCell(x, y));
      if (next) setCell(x, y, next);
    };
    if (stamp && ['brush', 'fg-brush', 'bg-brush'].includes(tool)) {
      for (let y = 0; y < stamp.height; y++) {
        for (let x = 0; x < stamp.width; x++)
          paint(p.x + x, p.y + y, stamp.cells[y * stamp.width + x]);
      }
    } else {
      const rect = brushRect(p);
      const value = tool === 'erase' ? null : { ch: glyph, fg, bg };
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) paint(x, y, value);
      }
    }
    redraw();
  }
  function flood(p: Point): void {
    if (
      !doc ||
      !inside(p.x, p.y) ||
      (tool !== 'fill' && tool !== 'fg-fill' && tool !== 'bg-fill')
    ) return;
    if (playing) stopPlayback();
    const layer = activeLayer();
    if (!layer || layer.locked) return;
    const before = captureHistory();
    if (fillCells(layer.cells, doc.width, doc.height, p.x, p.y, tool, {
      ch: glyph,
      fg,
      bg,
    })) remember(before);
  }
  function capture(
    rect: { x: number; y: number; width: number; height: number },
    read: (x: number, y: number) => SpriteCell | null = layerCell,
  ): Stamp {
    const cells: (SpriteCell | null)[] = [];
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const entry = read(x, y);
        cells.push(entry ? { ...entry } : null);
      }
    }
    return { width: rect.width, height: rect.height, cells };
  }
  function toolBase(value: Tool): 'brush' | 'fill' | 'erase' | 'select' | 'path' | 'move' {
    if (value === 'select') return 'select';
    if (value === 'move') return 'move';
    if (value.endsWith('path')) return 'path';
    if (value.endsWith('fill')) return 'fill';
    if (value.endsWith('erase')) return 'erase';
    return 'brush';
  }
  function toolVariant(value: Tool): 'full' | 'fg' | 'bg' {
    if (value.startsWith('fg')) return 'fg';
    if (value.startsWith('bg')) return 'bg';
    return 'full';
  }
  function composeTool(
    base: 'brush' | 'fill' | 'erase' | 'select' | 'path' | 'move',
    variant: 'full' | 'fg' | 'bg',
  ): Tool {
    if (base === 'select' || base === 'move' || variant === 'full') return base;
    return `${variant}-${base}` as Tool;
  }
  function pathCellValue(ch: string, target: SpriteCell | null): SpriteCell {
    if (tool === 'fg-path') return target ? { ...target, ch, fg } : { ch, fg, bg: 'black' };
    if (tool === 'bg-path') return target ? { ...target, ch, bg } : { ch, fg: 'white', bg };
    return { ch, fg, bg };
  }
  function pathGestureCells(end: Point, shift: boolean): GridPoint[] {
    if (!gesture?.start) return [];
    return strokeCells({
      mode: pathMode,
      start: { x: gesture.start.x, y: gesture.start.y },
      end: { x: end.x, y: end.y },
      path: gesture.path,
      shift,
    });
  }
  function commitPath(cells: GridPoint[]): void {
    if (!doc || cells.length === 0) return;
    if (playing) stopPlayback();
    const before = captureHistory();
    for (const write of applyPath(cells, pathStyle, (x, y) => layerCell(x, y)?.ch ?? null)) {
      if (!inside(write.x, write.y)) continue;
      if (write.stroke) {
        setCell(write.x, write.y, pathCellValue(write.ch, layerCell(write.x, write.y)));
        continue;
      }
      const existing = layerCell(write.x, write.y);
      if (existing) setCell(write.x, write.y, { ...existing, ch: write.ch });
    }
    remember(before);
  }
  function cyclePathMode(): void {
    if (toolBase(tool) !== 'path') {
      const variant = toolBase(tool) === 'select' ? 'full' : toolVariant(tool);
      setTool(composeTool('path', variant));
      return;
    }
    pathMode = PATH_MODES[(PATH_MODES.indexOf(pathMode) + 1) % PATH_MODES.length];
    refreshControls();
    announce(`${pathMode} path mode`);
  }
  function cycleTool(base: 'brush' | 'fill' | 'erase'): void {
    if (toolBase(tool) !== base) {
      setTool(base);
      return;
    }
    const order = ['full', 'fg', 'bg'] as const;
    const next = order[(order.indexOf(toolVariant(tool)) + 1) % order.length];
    setTool(composeTool(base, next));
  }
  function setTool(value: Tool): void {
    tool = value;
    pasteMode = false;
    celMarked = false;
    if (value === 'fg' || value.startsWith('fg-')) colorTarget = 'fg';
    if (value === 'bg' || value.startsWith('bg-')) colorTarget = 'bg';
    refreshControls();
    announce(`${value} tool selected`);
  }
  function currentChrome(): ArtTabChrome {
    return {
      selectedFrame,
      playFrom,
      playTo,
      rangeSelected,
      moveArmed,
      activeLayerId,
      selection,
      stamp,
      pasteMode,
      celMarked,
      zoom,
      ox,
      oy,
      autoFit,
    };
  }
  function applyChrome(chrome: ArtTabChrome): void {
    selectedFrame = chrome.selectedFrame;
    playFrom = chrome.playFrom;
    playTo = chrome.playTo;
    rangeSelected = chrome.rangeSelected;
    moveArmed = chrome.moveArmed;
    activeLayerId = chrome.activeLayerId;
    selection = chrome.selection;
    // Keep the current sampled brush instead of restoring this tab's older stamp.
    pasteMode = chrome.pasteMode;
    celMarked = chrome.celMarked;
    zoom = chrome.zoom;
    ox = chrome.ox;
    oy = chrome.oy;
    autoFit = chrome.autoFit;
  }
  function persistableSession(session: TabSession): ArtTabDirtySession {
    return {
      doc: session.doc,
      savedState: session.savedState,
      selectedFrame: session.selectedFrame,
      playFrom: session.playFrom,
      playTo: session.playTo,
      rangeSelected: session.rangeSelected,
      moveArmed: session.moveArmed,
      activeLayerId: session.activeLayerId,
      selection: session.selection,
      stamp: session.stamp,
      pasteMode: session.pasteMode,
      celMarked: session.celMarked,
      zoom: session.zoom,
      ox: session.ox,
      oy: session.oy,
      autoFit: session.autoFit,
    };
  }
  function persistEntries(): Array<readonly [string, ArtTabDirtySession]> {
    const entries: Array<readonly [string, ArtTabDirtySession]> = [];
    if (spriteId && doc) {
      entries.push([spriteId, { doc, savedState, ...currentChrome() }]);
    }
    for (const [id, session] of sessions) {
      if (id === spriteId) continue;
      entries.push([id, persistableSession(session)]);
    }
    return entries;
  }
  function tabDirty(id: string): boolean {
    if (id === spriteId) return dirty();
    const session = sessions.get(id);
    return session ? sessionDirty(session.doc, session.savedState) : false;
  }
  function dirtyIds(): Set<string> {
    const ids = new Set<string>();
    if (spriteId && dirty()) ids.add(spriteId);
    for (const [id, session] of sessions) {
      if (sessionDirty(session.doc, session.savedState)) ids.add(id);
    }
    return ids;
  }
  function anyDirty(): boolean {
    return dirtyIds().size > 0;
  }
  function writeOpenTabs(): void {
    const result = writeArtTabStore(
      localStorage,
      buildArtTabStore(openTabs, spriteId, persistEntries()),
    );
    if (!result.ok && result.quota) {
      if (!persistWarned) {
        persistWarned = true;
        toast('Could not store unsaved drafts', true);
      }
      return;
    }
    persistWarned = false;
  }
  function schedulePersist(): void {
    if (discardOnLeave) return;
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writeOpenTabs();
    }, ART_TAB_PERSIST_MS);
  }
  function flushPersist(): void {
    if (discardOnLeave) return;
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    writeOpenTabs();
  }
  function discardDrafts(): void {
    discardOnLeave = true;
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    writeArtTabStore(localStorage, buildArtTabStore(openTabs, spriteId, []));
  }
  function dropSession(id: string): void {
    const session = sessions.get(id);
    if (session?.referenceUrl) URL.revokeObjectURL(session.referenceUrl);
    sessions.delete(id);
  }
  function stashCurrent(): void {
    if (!spriteId || !doc) return;
    stopPlayback();
    sessions.set(spriteId, {
      doc,
      savedState,
      undoStack,
      redoStack,
      ...currentChrome(),
      reference,
      referenceBase,
      referenceRevision,
      referenceImage,
      referenceUrl,
      referenceEdit,
    });
    reference = null;
    referenceBase = null;
    referenceRevision = null;
    referenceImage = null;
    referenceUrl = null;
    referenceEdit = false;
  }
  function sessionFromPersisted(stored: ArtTabDirtySession): TabSession {
    return {
      ...stored,
      undoStack: [],
      redoStack: [],
      reference: null,
      referenceBase: null,
      referenceRevision: null,
      referenceImage: null,
      referenceUrl: null,
      referenceEdit: false,
    };
  }
  function applySession(session: TabSession): void {
    stopPlayback();
    gesture = null;
    hover = null;
    renamingLayer = false;
    pressing = false;
    session.doc.label ??= session.doc.id;
    doc = session.doc;
    spriteId = session.doc.id;
    setEditorAssetUrl(session.doc.id);
    try {
      const snapshot = JSON.parse(session.savedState) as SpriteDocument;
      snapshot.label ??= snapshot.id;
      savedState = JSON.stringify(snapshot);
    } catch {
      savedState = session.savedState;
    }
    undoStack = session.undoStack;
    redoStack = session.redoStack;
    applyChrome(session);
    reference = session.reference;
    referenceBase = session.referenceBase;
    referenceRevision = session.referenceRevision;
    referenceImage = session.referenceImage;
    referenceUrl = session.referenceUrl;
    referenceEdit = session.referenceEdit;
    clampSelectedFrame();
    if (!frameLayers().some((layer) => layer.id === activeLayerId)) selectTopLayer();
    localStorage.setItem(LAST_SPRITE_KEY, session.doc.id);
    if (session.autoFit) fit();
    if (!session.referenceImage) void loadReference(session.doc.id);
    refreshControls();
  }
  function restoreSession(id: string): boolean {
    const session = sessions.get(id);
    if (!session) return false;
    sessions.delete(id);
    applySession(session);
    return true;
  }
  function clearWorkspace(): void {
    stopPlayback();
    forgetReference();
    doc = null;
    spriteId = null;
    setEditorAssetUrl(null);
    localStorage.removeItem(LAST_SPRITE_KEY);
    savedState = '';
    applyChrome(defaultArtTabChrome());
    undoStack = [];
    redoStack = [];
    gesture = null;
    hover = null;
    renamingLayer = false;
    pressing = false;
  }
  function renderTabs(): void {
    const host = $<HTMLElement>('#document-tabs');
    host.replaceChildren();
    if (openTabs.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'document-tabs-empty';
      empty.textContent = 'NO SPRITE';
      host.append(empty);
      return;
    }
    for (const id of openTabs) {
      const tab = document.createElement('div');
      tab.className = 'document-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === spriteId));
      if (id === spriteId) tab.classList.add('current');
      if (tabDirty(id)) tab.classList.add('dirty');
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'document-tab-label';
      label.append(document.createTextNode(`${displayName(id)} `));
      const mark = document.createElement('span');
      mark.className = 'dirty-mark';
      mark.textContent = '●';
      label.append(mark);
      label.addEventListener('click', () => {
        void activateSprite(id);
      });
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'document-tab-close';
      close.setAttribute('aria-label', `Close ${displayName(id)}`);
      close.textContent = '×';
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        void closeTab(id);
      });
      tab.append(label, close);
      tab.addEventListener('auxclick', (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        void closeTab(id);
      });
      host.append(tab);
    }
  }
  async function activateSprite(id: string): Promise<boolean> {
    if (id === spriteId) return true;
    const token = ++switchToken;
    if (sessions.has(id)) {
      stashCurrent();
      if (token !== switchToken || !alive) return false;
      restoreSession(id);
      openTabs = addOpenTab(openTabs, id);
      flushPersist();
      return true;
    }
    try {
      const next = await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`);
      if (token !== switchToken || !alive) return false;
      loadSprite(next);
      return true;
    } catch (error) {
      if (token !== switchToken || !alive) return false;
      announce(error instanceof Error ? error.message : 'Could not open sprite');
      return false;
    }
  }
  async function closeTab(id: string): Promise<void> {
    if (!openTabs.includes(id)) return;
    if (tabDirty(id) && !(await confirmModal('Discard unsaved changes?', 'DISCARD'))) return;
    const next = neighborTab(openTabs, id);
    const wasCurrent = spriteId === id;
    openTabs = closeOpenTab(openTabs, id);
    dropSession(id);
    if (wasCurrent) {
      spriteId = null;
      doc = null;
      savedState = '';
      forgetReference();
      if (next) {
        await activateSprite(next);
      } else {
        clearWorkspace();
        refreshControls();
      }
      setEditorAssetUrl(spriteId);
    }
    flushPersist();
    renderTabs();
  }
  async function discardUnsaved(): Promise<boolean> {
    flushPersist();
    const count = dirtyIds().size;
    if (count === 0) return true;
    const message =
      count === 1 ? 'Discard unsaved changes?' : `Discard unsaved changes in ${count} sprites?`;
    const confirmed = await confirmModal(message, 'DISCARD');
    if (confirmed) discardDrafts();
    return confirmed;
  }

  async function syncOpenTabs(files: string[]): Promise<void> {
    const nextTabs = pruneMissingTabs(openTabs, files, dirtyIds());
    if (
      nextTabs.length === openTabs.length &&
      nextTabs.every((id, index) => id === openTabs[index])
    ) {
      return;
    }
    for (const id of openTabs) {
      if (!nextTabs.includes(id)) dropSession(id);
    }
    openTabs = nextTabs;
    if (spriteId && !openTabs.includes(spriteId)) {
      const next = openTabs[openTabs.length - 1] ?? null;
      if (next) await activateSprite(next);
      else {
        clearWorkspace();
        refreshControls();
      }
    }
    flushPersist();
    renderTabs();
  }
  async function refreshFiles(): Promise<void> {
    const list = $<HTMLElement>('#file-list');
    try {
      const { files, labels } = await requestJson<{ files: string[]; labels: Record<string, string> }>('/api/sprites');
      for (const [id, label] of Object.entries(labels)) spriteLabels.set(id, label);
      await syncOpenTabs(files);
      list.replaceChildren();
      if (files.length === 0) {
        list.innerHTML = '<div class="empty-files">NO SAVED SPRITES YET</div>';
        return;
      }
      for (const file of files) {
        const row = document.createElement('div');
        row.className = 'file-item';
        row.classList.toggle('current', file === spriteId);
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = `▤  ${displayName(file)}`;
        open.addEventListener('click', () => void openSprite(file));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-file';
        remove.textContent = '×';
        remove.addEventListener('click', () => void deleteSprite(file));
        row.append(open, remove);
        list.append(row);
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not list sprites');
    }
  }
  function loadSprite(next: SpriteDocument): void {
    if (spriteId && spriteId !== next.id) stashCurrent();
    else if (referenceUrl) forgetReference();
    stopPlayback();
    sessions.delete(next.id);
    doc = next;
    spriteLabels.set(next.id, next.label);
    selectedFrame = 0;
    playFrom = 0;
    playTo = 0;
    rangeSelected = false;
    moveArmed = false;
    selectTopLayer();
    spriteId = next.id;
    setEditorAssetUrl(next.id);
    savedState = JSON.stringify(next);
    openTabs = addOpenTab(openTabs, next.id);
    localStorage.setItem(LAST_SPRITE_KEY, next.id);
    undoStack = [];
    redoStack = [];
    selection = null;
    pasteMode = false;
    celMarked = false;
    gesture = null;
    hover = null;
    void loadReference(next.id);
    fit();
    flushPersist();
    void refreshFiles();
    refreshControls();
    void document.fonts
      .load(terminalFont(spriteFontNativePx(next.font), spriteFontFamily(next.font)))
      .catch(() => undefined)
      .then(() => {
        if (!alive || spriteId !== next.id) return;
        if (autoFit) fit();
        refreshControls();
      });
  }
  async function openSprite(id: string): Promise<void> {
    if (await activateSprite(id)) {
      $<HTMLDialogElement>('#file-dialog').close();
      announce(`Opened ${displayName(id)}`);
    }
  }
  async function save(): Promise<void> {
    if (!doc || !spriteId) {
      announce('Open or create a sprite');
      return;
    }
    if (saving) return;
    const id = spriteId;
    const sent = cloneDoc(doc);
    let base: SpriteDocument | null;
    try {
      base = savedState ? (JSON.parse(savedState) as SpriteDocument) : null;
    } catch {
      announce('Saved snapshot is invalid; reopen or save as a new id');
      return;
    }
    saving = true;
    try {
      const saved = await saveDraft<SpriteDocument>(
        `/api/sprites/${encodeURIComponent(id)}`,
        sent,
        base,
      );
      const mergedOnDisk = JSON.stringify(sent) !== JSON.stringify(saved);
      let rebased = true;
      if (spriteId === id && doc) {
        const current = mergeSprite(sent, doc, saved);
        if (current.ok) {
          const resized = doc.width !== current.value.width || doc.height !== current.value.height;
          doc = current.value;
          savedState = JSON.stringify(saved);
          if (mergedOnDisk) {
            undoStack = [];
            redoStack = [];
          }
          if (resized) fit();
          refreshControls();
        } else {
          rebased = false;
        }
      } else {
        const session = sessions.get(id);
        if (session) {
          const current = mergeSprite(sent, session.doc, saved);
          if (current.ok) {
            session.doc = current.value;
            session.savedState = JSON.stringify(saved);
            if (mergedOnDisk) {
              session.undoStack = [];
              session.redoStack = [];
            }
          } else {
            rebased = false;
          }
        }
      }
      flushPersist();
      updateTitle();
      const message = rebased
        ? mergedOnDisk
          ? `Saved and merged ${displayName(id)}`
          : `Saved ${displayName(id)}`
        : `Saved ${displayName(id)}, but newer edits remain unsaved; review this draft`;
      announce(message);
      toast(message, !rebased);
      void refreshFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      announce(message);
      toast(message, true);
      if (error instanceof ApiError && error.status === 409) {
        await alertModal(`${message}. Your unsaved draft is still open. Review or use Save As.`);
      }
    } finally {
      saving = false;
    }
  }
  async function saveAs(): Promise<void> {
    if (!doc || !spriteId) {
      announce('Open or create a sprite');
      return;
    }
    if (saving) return;
    const from = spriteId;
    const entered = await askSaveAs(doc.label);
    if (entered === null) return;
    const label = entered.trim();
    const labelError = spriteLabelError(label);
    if (labelError) return void alertModal(labelError);
    if (spriteId !== from || !doc) return;
    const id = crypto.randomUUID();
    try {
      await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`);
      await alertModal('An asset with that id already exists');
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        await alertModal(error instanceof Error ? error.message : 'Could not save as');
        return;
      }
    }
    if (spriteId !== from || !doc) return;
    const next = cloneDoc(doc);
    next.id = id;
    next.label = label;
    try {
      const saved = await saveDraft<SpriteDocument>(
        `/api/sprites/${encodeURIComponent(id)}`,
        next,
        null,
      );
      if (spriteId !== from || !doc) return;
      const current = mergeSprite(next, doc, saved);
      doc = { ...(current.ok ? current.value : doc), id: saved.id };
      spriteLabels.set(saved.id, saved.label);
      spriteId = saved.id;
      setEditorAssetUrl(saved.id);
      savedState = JSON.stringify(saved);
      for (const entry of undoStack) entry.doc.id = saved.id;
      for (const entry of redoStack) entry.doc.id = saved.id;
      openTabs = renameOpenTab(openTabs, from, saved.id);
      dropSession(from);
      localStorage.setItem(LAST_SPRITE_KEY, saved.id);
      await copyOpenReference(from, saved.id);
      flushPersist();
      updateTitle();
      refreshControls();
      announce(`Saved as ${saved.label}`);
      toast(`Saved as ${saved.label}`);
      void refreshFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save as failed';
      announce(message);
      toast(message, true);
    }
  }
  async function copyOpenReference(from: string, to: string): Promise<void> {
    const current = reference;
    if (!current) return;
    try {
      let blob: Blob | null = null;
      if (referenceUrl) {
        const response = await fetch(referenceUrl);
        if (response.ok) blob = await response.blob();
      }
      if (!blob) blob = await getBytes(`/api/references/${encodeURIComponent(from)}/image`);
      const saved = await putBytes<{ ext: SpriteReference['ext']; revision: string }>(
        `/api/references/${encodeURIComponent(to)}/image`,
        blob,
        null,
      );
      referenceRevision = saved.revision;
      reference = await saveDraft<SpriteReference>(
        `/api/references/${encodeURIComponent(to)}`,
        { ...current, id: to, ext: saved.ext },
        null,
      );
      referenceBase = reference;
    } catch {
      if (reference) reference = { ...reference, id: to };
    }
  }
  async function deleteSprite(id: string): Promise<void> {
    if (!(await confirmModal(`Delete ${displayName(id)}? This cannot be undone.`, 'DELETE'))) return;
    await requestJson(`/api/sprites/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const next = neighborTab(openTabs, id);
    const wasCurrent = spriteId === id;
    openTabs = closeOpenTab(openTabs, id);
    dropSession(id);
    if (wasCurrent) {
      spriteId = null;
      doc = null;
      savedState = '';
      forgetReference();
      if (next) await activateSprite(next);
      else {
        clearWorkspace();
        refreshControls();
      }
      setEditorAssetUrl(spriteId);
    }
    flushPersist();
    await refreshFiles();
    announce(`Deleted ${displayName(id)}`);
  }
  function openResizeDialog(): void {
    if (!doc) {
      announce('Open or create a sprite');
      return;
    }
    $<HTMLElement>('#size-dialog-title').textContent = '▦   RESIZE CANVAS';
    $<HTMLElement>('#size-description').textContent =
      'Existing cells stay at the top-left. Shrinking clips cells outside the new canvas.';
    $<HTMLButtonElement>('#apply-size').textContent = 'RESIZE CANVAS';
    $<HTMLInputElement>('#canvas-width').value = String(doc.width);
    $<HTMLInputElement>('#canvas-height').value = String(doc.height);
    $<HTMLDialogElement>('#size-dialog').showModal();
  }
  function openFontDialog(): void {
    if (!doc) {
      announce('Open or create a sprite');
      return;
    }
    const current = spriteFont();
    root.querySelectorAll<HTMLInputElement>('#font-choices input').forEach((input) => {
      input.checked = input.value === current;
    });
    $<HTMLDialogElement>('#font-dialog').showModal();
    root.querySelector<HTMLInputElement>('#font-choices input:checked')?.focus();
  }
  function applySpriteFont(value: SpriteFontId): void {
    if (!doc || doc.font === value) return;
    const before = captureHistory();
    doc.font = value;
    remember(before);
    void document.fonts
      .load(terminalFont(spriteFontNativePx(value), spriteFontFamily(value)))
      .catch(() => undefined)
      .then(() => {
        if (!alive || !doc || doc.font !== value) return;
        if (autoFit) fit();
        refreshControls();
        announce(`Font ${SPRITE_FONTS.find((font) => font.id === value)?.label ?? value}`);
      });
  }
  async function newSprite(): Promise<void> {
    const draft = await askNewSprite();
    if (!draft) return;
    const id = crypto.randomUUID();
    const sprite = createSprite(id, draft.width, draft.height, draft.label);
    try {
      await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`);
      await alertModal('An asset with that id already exists');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        await alertModal('An asset with that id already exists');
        return;
      }
      try {
        const saved = await saveDraft<SpriteDocument>(
          `/api/sprites/${encodeURIComponent(id)}`,
          sprite,
          null,
        );
        loadSprite(saved);
        announce(`Created ${draft.label}`);
      } catch (createError) {
        announce(createError instanceof Error ? createError.message : 'Create failed');
      }
    }
  }
  async function generateCharacter(): Promise<void> {
    const form = $<HTMLFormElement>('#generate-character-form');
    const button = $<HTMLButtonElement>('#generate-character-submit');
    if (button.disabled) return;
    const id = crypto.randomUUID();
    let sprite: SpriteDocument;
    try {
      sprite = generateCharacter3x3(
        id,
        $<HTMLInputElement>('#generate-character-label').value,
        generatorColorValue('shirt'),
        $<HTMLInputElement>('#generate-shirt-letter').value,
        $<HTMLInputElement>('#generate-hair').checked,
        generatorColorValue('letter'),
      );
    } catch (error) {
      $<HTMLElement>('#generate-character-error').textContent = error instanceof Error ? error.message : 'Invalid character';
      return;
    }
    button.disabled = true;
    try {
      const saved = await saveDraft<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`, sprite, null);
      if (!alive) return;
      $<HTMLDialogElement>('#generate-character-dialog').close();
      form.reset();
      loadSprite(saved);
      announce(`Created ${saved.label}`);
    } catch (error) {
      $<HTMLElement>('#generate-character-error').textContent = error instanceof Error ? error.message : 'Create failed';
    } finally {
      button.disabled = false;
    }
  }
  async function duplicateSprite(): Promise<void> {
    if (!spriteId) {
      announce('Open or create a sprite');
      return;
    }
    const entered = await askId('Duplicate label', `${doc?.label ?? displayName(spriteId)} copy`);
    if (entered === null) return;
    const label = entered.trim();
    const labelError = spriteLabelError(label);
    if (labelError) return void alertModal(labelError);
    const id = crypto.randomUUID();
    const copy = await requestJson<SpriteDocument>(
      '/api/duplicate',
      jsonRequest('POST', { kind: 'sprite', from: spriteId, id, label }),
    );
    loadSprite(copy);
    announce(`Duplicated as ${label}`);
  }
  async function editSpriteLabel(): Promise<void> {
    if (!doc) return void announce('Open or create a sprite');
    const id = doc.id;
    const entered = await askAssetMeta('SPRITESHEET', doc.label, id);
    if (entered === null || doc?.id !== id) return;
    const label = entered.trim();
    const error = spriteLabelError(label);
    if (error) return void alertModal(error);
    if (doc.label === label) return;
    const before = captureHistory();
    doc.label = label;
    spriteLabels.set(id, label);
    remember(before);
    renderTabs();
    void refreshFiles();
  }
  function resizeCanvas(width: number, height: number): void {
    if (!doc) return;
    const current = doc;
    if (width === current.width && height === current.height) return;
    const before = captureHistory();
    const next = cloneDoc(current);
    next.width = width;
    next.height = height;
    next.originX = Math.min(current.originX, width - 1);
    next.originY = Math.min(current.originY, height - 1);
    next.sprites = current.sprites.map((frame) => ({
      layers: frame.layers.map((layer) => {
        const cells: (SpriteCell | null)[] = Array.from({ length: width * height }, () => null);
        for (let y = 0; y < Math.min(current.height, height); y++) {
          for (let x = 0; x < Math.min(current.width, width); x++) {
            const source = layer.cells[y * current.width + x];
            cells[y * width + x] = source ? { ...source } : null;
          }
        }
        return { ...layer, cells };
      }),
    }));
    doc = next;
    selection = null;
    pasteMode = false;
    fit();
    remember(before);
  }
  function commitDoc(before: HistoryEntry | null): void {
    remember(before);
    refreshControls();
  }
  function nextLayerId(): string {
    const used = new Set<string>();
    for (const frame of doc?.sprites ?? []) {
      for (const layer of frame.layers) used.add(layer.id);
    }
    let number = 1;
    while (used.has(`layer-${number}`)) number += 1;
    return `layer-${number}`;
  }
  function nextLayerName(): string {
    const used = new Set<string>();
    for (const frame of doc?.sprites ?? []) {
      for (const layer of frame.layers) used.add(layer.name);
    }
    let number = 1;
    while (used.has(`Layer ${number}`)) number += 1;
    return `Layer ${number}`;
  }
  function addLayer(): void {
    if (!doc) return announce('Open or create a sprite');
    if (sheetLayers().length >= MAX_LAYERS) return announce(`At most ${MAX_LAYERS} layers`);
    const before = captureHistory();
    const current = activeLayer();
    const id = nextLayerId();
    const name = nextLayerName();
    for (const frame of doc.sprites) {
      const index = current ? frame.layers.findIndex((layer) => layer.id === current.id) : -1;
      frame.layers.splice(index + 1, 0, {
        id,
        name,
        visible: true,
        locked: false,
        cells: Array.from({ length: doc.width * doc.height }, () => null),
      });
    }
    activeLayerId = id;
    commitDoc(before);
    announce(`Added ${name}`);
  }
  function deleteLayer(): void {
    if (!doc) return announce('Open or create a sprite');
    if (sheetLayers().length <= 1) return announce('The last layer stays');
    const current = activeLayer();
    if (!current) return;
    const before = captureHistory();
    let nextId: string | null = null;
    for (const frame of doc.sprites) {
      const index = frame.layers.findIndex((layer) => layer.id === current.id);
      if (index < 0) continue;
      frame.layers.splice(index, 1);
      nextId = frame.layers[Math.min(index, frame.layers.length - 1)]?.id ?? null;
    }
    activeLayerId = nextId;
    commitDoc(before);
    announce(`Removed ${current.name}`);
  }
  function moveLayer(id: string, direction: -1 | 1): void {
    if (!doc) return announce('Open or create a sprite');
    const index = sheetLayers().findIndex((layer) => layer.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sheetLayers().length) return;
    const before = captureHistory();
    for (const frame of doc.sprites) {
      const from = frame.layers.findIndex((layer) => layer.id === id);
      if (from < 0) continue;
      const [layer] = frame.layers.splice(from, 1);
      if (!layer) continue;
      frame.layers.splice(target, 0, layer);
    }
    commitDoc(before);
  }
  function toggleLayer(id: string): void {
    if (!doc || !sheetLayers().some((layer) => layer.id === id)) return;
    const before = captureHistory();
    eachNamedLayer(id, (layer) => {
      layer.visible = !layer.visible;
    });
    commitDoc(before);
  }
  function toggleLock(id: string): void {
    if (!doc || !sheetLayers().some((layer) => layer.id === id)) return;
    const before = captureHistory();
    eachNamedLayer(id, (layer) => {
      layer.locked = !layer.locked;
    });
    commitDoc(before);
  }
  function selectLayer(id: string): void {
    if (!doc || activeLayerId === id) return;
    activeLayerId = id;
    highlightCel();
    const layer = activeLayer();
    $<HTMLElement>('#layer-status').textContent = layer ? layerLabel(layer) : 'NO LAYER';
    syncCanvasCursor();
  }
  function highlightCel(): void {
    const layerId = activeLayer()?.id;
    root.querySelectorAll<HTMLElement>('.timeline-row').forEach((row) => {
      row.classList.toggle('active', row.dataset.layer === layerId);
    });
    highlightFrameRange();
    root.querySelectorAll<HTMLElement>('.cel').forEach((cel) => {
      const current = Number(cel.dataset.frame) === selectedFrame && cel.dataset.layer === layerId;
      cel.classList.toggle('active', current);
      cel.classList.toggle('marked', celMarked && current);
    });
  }
  function highlightFrameRange(): void {
    const { from, to } = playBounds();
    const shown = rangeSelected || frameGesture?.kind === 'range';
    const drop = frameGesture?.kind === 'reorder' ? frameGesture.last : null;
    root.querySelectorAll<HTMLElement>('.frame-head').forEach((head) => {
      const index = Number(head.dataset.frame);
      head.classList.toggle('active', shown && index === selectedFrame);
      head.classList.toggle('in-range', shown && index >= from && index <= to);
      head.classList.toggle('armed', shown && moveArmed && from === to && index === selectedFrame);
      head.classList.toggle('drop-target', drop === index);
    });
    const outline = root.querySelector<HTMLElement>('.frame-column-outline');
    if (!outline) return;
    outline.hidden = !shown;
    outline.style.left = `${220 + from * 28}px`;
    outline.style.width = `${(to - from + 1) * 28}px`;
  }
  function selectCel(frameIndex: number, layerId: string): void {
    if (!doc || frameIndex < 0 || frameIndex >= doc.sprites.length) return;
    const frame = doc.sprites[frameIndex];
    if (!frame?.layers.some((layer) => layer.id === layerId)) return;
    stopPlayback();
    const frameChanged = selectedFrame !== frameIndex;
    selectedFrame = frameIndex;
    activeLayerId = layerId;
    selection = null;
    pasteMode = false;
    celMarked = true;
    clearColumnRange();
    if (frameChanged) refreshControls();
    else {
      highlightCel();
      const layer = activeLayer();
      $<HTMLElement>('#layer-status').textContent = layer ? layerLabel(layer) : 'NO LAYER';
      syncCanvasCursor();
      redraw();
    }
  }
  function beginRename(id: string, nameButton: HTMLButtonElement): void {
    const layer = frameLayers().find((entry) => entry.id === id);
    if (!layer) return;
    renamingLayer = true;
    const input = document.createElement('input');
    input.className = 'layer-name-input';
    input.value = layer.name;
    input.maxLength = MAX_LAYER_NAME_LENGTH;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Layer name');
    nameButton.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      renamingLayer = false;
      if (save && doc) {
        const error = layerNameError(input.value);
        if (error) announce(error);
        else {
          const trimmed = input.value.trim();
          if (trimmed !== layer.name) {
            const before = captureHistory();
            eachNamedLayer(id, (entry) => {
              entry.name = trimmed;
            });
            remember(before);
          }
        }
      }
      refreshControls();
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }
  function selectFrame(index: number): void {
    if (!doc || index < 0 || index >= doc.sprites.length) return;
    stopPlayback();
    focusFrameColumn(index);
    if (!frameLayers().some((layer) => layer.id === activeLayerId)) selectTopLayer();
    selection = null;
    pasteMode = false;
    refreshControls();
    announce(`Frame ${index + 1}`);
  }
  function insertFrame(frame: SpriteFrame): void {
    if (!doc) return announce('Open or create a sprite');
    if (doc.sprites.length >= MAX_FRAMES) return announce(`At most ${MAX_FRAMES} frames`);
    stopPlayback();
    const before = captureHistory();
    const index = selectedFrame + 1;
    doc.sprites.splice(index, 0, frame);
    focusFrameColumn(index);
    selectTopLayer();
    selection = null;
    pasteMode = false;
    commitDoc(before);
    announce(`Frame ${selectedFrame + 1} of ${doc.sprites.length}`);
  }
  function addEmptyFrame(): void {
    if (!doc) return announce('Open or create a sprite');
    insertFrame(blankFrame());
  }
  function copyFrame(): void {
    const frame = activeFrame();
    if (!doc || !frame) return announce('Open or create a sprite');
    insertFrame(cloneFrame(frame));
  }
  function deleteFrame(): void {
    if (!doc) return announce('Open or create a sprite');
    if (doc.sprites.length <= 1) return announce('The last frame stays');
    stopPlayback();
    const before = captureHistory();
    doc.sprites.splice(selectedFrame, 1);
    clampSelectedFrame();
    focusFrameColumn(selectedFrame);
    selectTopLayer();
    selection = null;
    pasteMode = false;
    commitDoc(before);
    announce(`Frame ${selectedFrame + 1} of ${doc.sprites.length}`);
  }
  function reorderFrame(from: number, to: number): void {
    if (!doc || from === to) return;
    if (from < 0 || to < 0 || from >= doc.sprites.length || to >= doc.sprites.length) return;
    stopPlayback();
    const before = captureHistory();
    const [frame] = doc.sprites.splice(from, 1);
    if (!frame) return;
    doc.sprites.splice(to, 0, frame);
    focusFrameColumn(to);
    if (!frameLayers().some((layer) => layer.id === activeLayerId)) selectTopLayer();
    commitDoc(before);
  }
  function setAnimationSpeed(next: number): void {
    animationSpeed = next;
    localStorage.setItem(SPEED_KEY, String(next));
    if (!playing || !doc) return;
    if (playTimer !== null) clearTimeout(playTimer);
    playTimer = setTimeout(advancePlayback, animationSpeed);
  }
  async function changeAnimationSpeed(): Promise<void> {
    const next = await askAnimationSpeed(animationSpeed);
    if (next === null || next === animationSpeed) return;
    setAnimationSpeed(next);
    announce(`${next} ms per frame`);
  }
  function updatePlayButton(): void {
    const button = root.querySelector<HTMLButtonElement>('#frame-play');
    if (!button) return;
    button.textContent = playing ? '■' : '▶';
    button.title = playing ? 'Stop (Enter)' : 'Play (Enter)';
  }
  function advancePlayback(): void {
    if (!doc || !playing || !alive) return;
    const { from, to } = playBounds();
    selectedFrame = selectedFrame < from || selectedFrame >= to ? from : selectedFrame + 1;
    refreshControls();
    playTimer = setTimeout(advancePlayback, animationSpeed);
  }
  function togglePlayback(): void {
    if (!doc) return announce('Open or create a sprite');
    if (playing) {
      stopPlayback();
      announce('Animation stopped');
      refreshControls();
      return;
    }
    const { from, to } = playBounds();
    if (!rangeSelected || to <= from) {
      return announce(
        doc.sprites.length <= 1 ? 'Add another frame to play' : 'Select a range of frames to play',
      );
    }
    if (selectedFrame < from || selectedFrame > to) selectedFrame = from;
    playing = true;
    updatePlayButton();
    announce(`Playing frames ${from + 1}–${to + 1}`);
    playTimer = setTimeout(advancePlayback, animationSpeed);
  }
  function frameIndexAt(clientX: number, clientY: number): number | null {
    const target = document.elementFromPoint(clientX, clientY);
    const head = target instanceof Element ? target.closest('.frame-head') : null;
    if (!head || !root.contains(head)) return null;
    const index = Number((head as HTMLElement).dataset.frame);
    return Number.isInteger(index) ? index : null;
  }
  function finishFrameGesture(): void {
    const gesture = frameGesture;
    frameGesture = null;
    if (!gesture || !doc) return;
    if (gesture.kind === 'reorder') {
      if (gesture.origin === gesture.last) {
        highlightFrameRange();
        return;
      }
      reorderFrame(gesture.origin, gesture.last);
      return;
    }
    if (gesture.kind === 'range') {
      playFrom = Math.min(gesture.origin, gesture.last);
      playTo = Math.max(gesture.origin, gesture.last);
      selectedFrame = gesture.origin;
      rangeSelected = true;
      moveArmed = playFrom === playTo;
      refreshControls();
      announce(
        playFrom === playTo ? `Frame ${playFrom + 1}` : `Frames ${playFrom + 1}–${playTo + 1}`,
      );
      return;
    }
    selectFrame(gesture.origin);
  }
  function bindFramePointer(element: HTMLElement, index: number): void {
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      stopPlayback();
      element.setPointerCapture(event.pointerId);
      frameGesture = {
        origin: index,
        last: index,
        kind: 'pending',
        startX: event.clientX,
        startY: event.clientY,
      };
    });
    element.addEventListener('pointermove', (event) => {
      if (!frameGesture || frameGesture.origin !== index) return;
      const over = frameIndexAt(event.clientX, event.clientY);
      const next = over ?? frameGesture.last;
      const traveled =
        Math.abs(event.clientX - frameGesture.startX) > 4 ||
        Math.abs(event.clientY - frameGesture.startY) > 4 ||
        next !== frameGesture.origin;
      if (frameGesture.kind === 'pending' && traveled) {
        const canMove =
          moveArmed &&
          playFrom === playTo &&
          frameGesture.origin === selectedFrame &&
          playFrom === selectedFrame;
        frameGesture.kind = canMove ? 'reorder' : 'range';
      }
      frameGesture.last = next;
      if (frameGesture.kind === 'range') {
        playFrom = Math.min(frameGesture.origin, next);
        playTo = Math.max(frameGesture.origin, next);
        selectedFrame = frameGesture.origin;
        highlightFrameRange();
        $<HTMLElement>('#frame-status').textContent = frameStatusText();
        redraw();
      }
      if (frameGesture.kind === 'reorder') highlightFrameRange();
    });
    element.addEventListener('pointerup', finishFrameGesture);
    element.addEventListener('pointercancel', finishFrameGesture);
  }
  function renderTimeline(): void {
    if (renamingLayer) return;
    const timeline = $<HTMLElement>('#timeline');
    timeline.replaceChildren();
    updatePlayButton();
    if (!doc) return;
    const sprite = doc;
    const layers = sheetLayers();
    const columns = `220px repeat(${Math.max(1, sprite.sprites.length)}, 28px)`;
    const scroll = document.createElement('div');
    scroll.className = 'timeline-scroll';
    const sheet = document.createElement('div');
    sheet.className = 'timeline-sheet';
    const head = document.createElement('div');
    head.className = 'timeline-head';
    head.style.gridTemplateColumns = columns;
    const corner = document.createElement('div');
    corner.className = 'timeline-corner';
    head.append(corner);
    sprite.sprites.forEach((_frame, index) => {
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'frame-head';
      header.dataset.frame = String(index);
      header.textContent = String(index + 1);
      header.title = `Frame ${index + 1}`;
      bindFramePointer(header, index);
      head.append(header);
    });
    sheet.append(head);
    for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex--) {
      const layer = layers[layerIndex];
      if (!layer) continue;
      const row = document.createElement('div');
      row.className = 'timeline-row';
      row.dataset.layer = layer.id;
      row.style.gridTemplateColumns = columns;
      row.classList.toggle('active', layer.id === activeLayer()?.id);
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'layer-move';
      up.textContent = '↑';
      up.title = 'Move layer up';
      up.setAttribute('aria-label', `Move ${layer.name} up`);
      up.disabled = layerIndex === layers.length - 1;
      up.addEventListener('click', (event) => {
        event.stopPropagation();
        moveLayer(layer.id, 1);
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'layer-move';
      down.textContent = '↓';
      down.title = 'Move layer down';
      down.setAttribute('aria-label', `Move ${layer.name} down`);
      down.disabled = layerIndex === 0;
      down.addEventListener('click', (event) => {
        event.stopPropagation();
        moveLayer(layer.id, -1);
      });
      const shown = document.createElement('button');
      shown.type = 'button';
      shown.className = 'layer-eye';
      shown.classList.toggle('on', layer.visible);
      shown.title = layer.visible ? 'Hide layer' : 'Show layer';
      shown.setAttribute('aria-pressed', String(layer.visible));
      shown.setAttribute('aria-label', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
      shown.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleLayer(layer.id);
      });
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'layer-lock';
      lock.textContent = layer.locked ? '\uE72E' : '\uE785';
      lock.title = layer.locked ? 'Unlock layer' : 'Lock layer';
      lock.setAttribute('aria-pressed', String(layer.locked));
      lock.setAttribute('aria-label', `${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`);
      lock.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleLock(layer.id);
      });
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'layer-name';
      name.textContent = layer.name;
      name.title = layer.name;
      name.addEventListener('click', () => selectLayer(layer.id));
      name.addEventListener('dblclick', () => beginRename(layer.id, name));
      const rail = document.createElement('div');
      rail.className = 'layer-rail';
      rail.append(up, down, shown, lock, name);
      row.append(rail);
      sprite.sprites.forEach((frame, index) => {
        const celLayer = frame.layers.find((entry) => entry.id === layer.id);
        const cel = document.createElement('button');
        cel.type = 'button';
        cel.className = 'cel';
        cel.dataset.frame = String(index);
        cel.dataset.layer = layer.id;
        cel.classList.toggle('filled', layerPainted(celLayer));
        cel.classList.toggle('active', index === selectedFrame && layer.id === activeLayer()?.id);
        cel.classList.toggle(
          'marked',
          celMarked && index === selectedFrame && layer.id === activeLayer()?.id,
        );
        cel.title = `${layer.name} · frame ${index + 1}`;
        const dot = document.createElement('span');
        dot.className = 'cel-dot';
        cel.append(dot);
        cel.addEventListener('click', () => {
          selectCel(index, layer.id);
        });
        row.append(cel);
      });
      sheet.append(row);
    }
    const outline = document.createElement('div');
    outline.className = 'frame-column-outline';
    sheet.append(outline);
    scroll.append(sheet);
    timeline.append(scroll);
    highlightFrameRange();
  }
  function exportSprite(): void {
    if (!doc) {
      announce('Open or create a sprite');
      return;
    }
    const exported = exportTruecolor(doc, palette);
    if (!exported.ok) {
      announce(exported.error);
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob([exported.value], { type: 'text/plain;charset=utf-8' }),
    );
    link.download = `${doc.label.replace(/[\\/:*?"<>|]/g, '_')}.ans`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    announce('Truecolor file exported');
  }
  function renderedAscii(): string {
    if (!doc) return '';
    let output = '';
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) output += visibleEntry(x, y)?.ch ?? ' ';
      output += '\r\n';
    }
    return output;
  }
  async function copyAscii(): Promise<void> {
    if (!doc) {
      announce('Open or create a sprite');
      return;
    }
    try {
      await navigator.clipboard.writeText(renderedAscii());
      announce('Copied ascii');
      toast('Copied!');
    } catch {
      announce('Could not copy ascii');
    }
  }
  async function importSprite(file: File): Promise<void> {
    const entered = await askId('Import label', file.name.replace(/\.json$/i, ''));
    if (entered === null) return;
    const label = entered.trim();
    const labelError = spriteLabelError(label);
    if (labelError) return void alertModal(labelError);
    const id = crypto.randomUUID();
    const document = JSON.parse(await file.text()) as unknown;
    const sprite = await requestJson<SpriteDocument>(
      '/api/import/ed-ascii',
      jsonRequest('POST', { id, label, document }),
    );
    loadSprite(sprite);
    announce(`Imported ${label}`);
  }
  async function savePaletteColor(value: string): Promise<void> {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      announce('Use an #rrggbb color');
      return;
    }
    palette = {
      ...palette,
      colors: palette.colors.map((color) =>
        color.id === paletteEdit ? { ...color, rgb: value.toLowerCase() } : color,
      ),
    };
    refreshControls();
    await persistPalette();
  }
  async function persistPalette(): Promise<void> {
    if (paletteSaving || JSON.stringify(palette) === JSON.stringify(paletteSaved)) return;
    const sent = structuredClone(palette);
    paletteSaving = true;
    let committed = false;
    try {
      const stored = await saveDraft('/api/palette', sent, paletteSaved);
      const rebased = mergeJson(sent, palette, stored);
      if (rebased.ok) {
        palette = rebased.value;
        paletteSaved = stored;
        committed = true;
      } else announce('Palette saved, but newer edits need review');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save palette';
      announce(message);
      if (error instanceof ApiError && error.status === 409) await alertModal(message);
      return;
    } finally {
      paletteSaving = false;
    }
    refreshControls();
    if (committed) announce(`Recolored ${paletteEdit}`);
    if (committed && JSON.stringify(palette) !== JSON.stringify(paletteSaved)) {
      void persistPalette();
    }
  }

  const paletteHost = $<HTMLElement>('#palette');
  for (const color of [
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'bright-black',
    'bright-red',
    'bright-green',
    'bright-yellow',
    'bright-blue',
    'bright-magenta',
    'bright-cyan',
    'bright-white',
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.color = color;
    button.title = color;
    button.addEventListener('click', () => {
      paletteEdit = color;
      if (colorTarget === 'fg') fg = color;
      else bg = color;
      refreshControls();
    });
    paletteHost.append(button);
  }
  function refreshGenerateColors(): void {
    for (const kind of ['shirt', 'letter'] as const) {
      root.querySelectorAll<HTMLButtonElement>(`#generate-${kind}-colors button`).forEach((button) => {
        const selected = button.dataset.color === generateColors[kind];
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        const id = button.dataset.color ?? '';
        button.style.background =
          paletteRgb(palette, id) ??
          PALETTE_COLORS.find((entry) => entry.id === id)?.rgb ??
          '#000000';
      });
      $<HTMLElement>(`#generate-${kind}-color-name`).textContent = generateColors[kind];
      const input = $<HTMLInputElement>(`#generate-${kind}-hex`);
      if (document.activeElement !== input) input.value = generatorColorHex(kind);
    }
  }
  for (const kind of ['shirt', 'letter'] as const) {
    const host = $<HTMLElement>(`#generate-${kind}-colors`);
    for (const color of PALETTE_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.color = color;
      button.title = color;
      button.setAttribute('aria-label', color);
      button.addEventListener('click', () => {
        generateColors[kind] = color;
        refreshGenerateColors();
      });
      host.append(button);
    }
    $<HTMLInputElement>(`#generate-${kind}-hex`).addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        generateColors[kind] = value.toLowerCase();
        refreshGenerateColors();
      }
    });
  }
  refreshGenerateColors();
  const glyphSets = $<HTMLElement>('#glyph-sets');
  const glyphTabs = $<HTMLElement>('#glyph-tabs');
  let glyphTab: GlyphTabId = GLYPH_TABS[0].id;
  function showGlyphTab(id: GlyphTabId): void {
    glyphTab = id;
    glyphTabs.querySelectorAll<HTMLButtonElement>('[data-glyph-tab]').forEach((button) => {
      const selected = button.dataset.glyphTab === id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    glyphSets.querySelectorAll<HTMLElement>('[data-glyph-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.glyphPanel !== id;
    });
  }
  for (const tab of GLYPH_TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `glyph-tab-${tab.id}`;
    button.dataset.glyphTab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `glyph-panel-${tab.id}`);
    button.textContent = tab.label;
    button.addEventListener('click', () => showGlyphTab(tab.id));
    glyphTabs.append(button);
    const panel = document.createElement('div');
    panel.id = `glyph-panel-${tab.id}`;
    panel.className = 'glyph-list';
    panel.dataset.glyphPanel = tab.id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    for (const entry of tab.glyphs) {
      const glyphButton = document.createElement('button');
      glyphButton.type = 'button';
      glyphButton.textContent = entry;
      glyphButton.dataset.glyph = entry;
      glyphButton.addEventListener('click', () => {
        glyph = entry;
        stamp = null;
        refreshControls();
      });
      panel.append(glyphButton);
    }
    glyphSets.append(panel);
  }
  showGlyphTab(glyphTab);

  const actions: Record<string, () => void> = {
    new: () => void newSprite(),
    browse: () => {
      void refreshFiles();
      $<HTMLDialogElement>('#file-dialog').showModal();
    },
    save: () => void save(),
    'save-as': () => void saveAs(),
    duplicate: () => void duplicateSprite(),
    delete: () => {
      if (spriteId) void deleteSprite(spriteId);
    },
    import: () => $<HTMLInputElement>('#import-file').click(),
    export: exportSprite,
    'copy-ascii': () => void copyAscii(),
    undo: () => {
      const current = captureHistory();
      if (!current || undoStack.length === 0) return announce('Nothing to undo');
      redoStack.push(current);
      restore(undoStack.pop()!);
      announce('Undo');
    },
    redo: () => {
      const current = captureHistory();
      if (!current || redoStack.length === 0) return announce('Nothing to redo');
      undoStack.push(current);
      restore(redoStack.pop()!);
      announce('Redo');
    },
    resize: () => openResizeDialog(),
    generate: () => {
      $<HTMLElement>('#generate-character-error').textContent = '';
      generateColors.shirt = 'bright-yellow';
      generateColors.letter = 'bright-black';
      refreshGenerateColors();
      $<HTMLDialogElement>('#generate-character-dialog').showModal();
      $<HTMLInputElement>('#generate-character-label').focus();
    },
    font: () => openFontDialog(),
    'animation-speed': () => void changeAnimationSpeed(),
    'select-all': () => {
      if (!doc) return announce('Open or create a sprite');
      tool = 'select';
      pasteMode = false;
      celMarked = false;
      gesture = null;
      selection = { x: 0, y: 0, width: doc.width, height: doc.height };
      refreshControls();
      announce(`Selected ${selection.width} × ${selection.height} cells`);
    },
    copy: () => {
      if (celMarked) {
        const layer = activeLayer();
        if (!doc || !layer) return announce('Select a layer first');
        layerClipboard = layer.cells.map((cell) => (cell ? { ...cell } : null));
        clipboardKind = 'layer';
        announce(`Copied ${layer.name}`);
        return;
      }
      if (!selection) return announce('Select an area first');
      clipboard = capture(selection);
      clipboardKind = 'stamp';
      announce(`Copied ${selection.width} × ${selection.height} cells`);
    },
    paste: () => {
      if (clipboardKind === 'layer' && layerClipboard) {
        const layer = activeLayer();
        if (!doc || !layer) return announce('Select a layer first');
        if (layer.locked) return announce('Layer is locked');
        const before = captureHistory();
        const count = doc.width * doc.height;
        layer.cells = Array.from({ length: count }, (_, index) => {
          const cell = layerClipboard?.[index];
          return cell ? { ...cell } : null;
        });
        commitDoc(before);
        announce(`Pasted onto ${layer.name}`);
        return;
      }
      if (!clipboard) return announce('Nothing to paste');
      pasteMode = true;
      tool = 'brush';
      refreshControls();
    },
    clear: () => {
      if (celMarked) {
        const layer = activeLayer();
        if (!doc || !layer) return announce('Select a layer first');
        if (layer.locked) return announce('Layer is locked');
        const before = captureHistory();
        layer.cells = Array.from({ length: doc.width * doc.height }, () => null);
        commitDoc(before);
        announce(`Cleared ${layer.name}`);
        return;
      }
      if (!doc || !selection) return;
      if (activeLayer()?.locked) return announce('Layer is locked');
      const before = captureHistory();
      for (let y = selection.y; y < selection.y + selection.height; y++) {
        for (let x = selection.x; x < selection.x + selection.width; x++) setCell(x, y, null);
      }
      remember(before);
    },
    'zoom-in': () => stepZoom(1),
    'zoom-out': () => stepZoom(-1),
    fit,
    'toggle-grid': toggleGrid,
    'sprite-label': () => void editSpriteLabel(),
  };

  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      button.closest('details')?.removeAttribute('open');
      actions[button.dataset.action ?? '']?.();
    });
  });
  root.querySelectorAll<HTMLDetailsElement>('.menu').forEach((menu) => {
    menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      root.querySelectorAll<HTMLDetailsElement>('.menu').forEach((other) => {
        if (other !== menu) other.open = false;
      });
    });
  });
  listen(document, 'pointerdown', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.menu')) return;
    root.querySelectorAll<HTMLDetailsElement>('.menu').forEach((menu) => {
      menu.open = false;
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      const base = button.dataset.tool ?? 'brush';
      if (base === 'select') {
        setTool('select');
        return;
      }
      const variant = toolBase(tool) === 'select' ? 'full' : toolVariant(tool);
      setTool(composeTool(base as 'brush' | 'fill' | 'erase' | 'path' | 'move', variant));
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach((button) => {
    button.addEventListener('click', () => {
      const base = toolBase(tool);
      if (base === 'select' || base === 'move') return;
      const value = button.dataset.variant;
      if (value !== 'full' && value !== 'fg' && value !== 'bg') return;
      setTool(composeTool(base, value));
    });
  });
  $<HTMLInputElement>('#brush-size').addEventListener('input', (event) => {
    brushSize = Math.min(16, Math.max(1, Number((event.target as HTMLInputElement).value) || 1));
    refreshControls();
  });
  $<HTMLSelectElement>('#path-mode').addEventListener('change', () => {
    const value = $<HTMLSelectElement>('#path-mode').value;
    if (!isPathMode(value)) return;
    pathMode = value;
    refreshControls();
  });
  $<HTMLSelectElement>('#path-style').addEventListener('change', () => {
    const value = $<HTMLSelectElement>('#path-style').value;
    if (!isPathStyle(value)) return;
    pathStyle = value;
    refreshControls();
  });
  function setGlyphCapture(next: boolean): void {
    keyMode = next;
    refreshControls();
    announce(next ? 'Type a glyph. Click the glyph again to stop.' : 'Glyph typing off');
  }
  $<HTMLButtonElement>('#glyph-capture').addEventListener('click', () => {
    setGlyphCapture(!keyMode);
  });
  $<HTMLButtonElement>('#fg-target').addEventListener('click', () => {
    colorTarget = 'fg';
    refreshControls();
  });
  $<HTMLButtonElement>('#bg-target').addEventListener('click', () => {
    colorTarget = 'bg';
    refreshControls();
  });
  $<HTMLButtonElement>('#swap-colors').addEventListener('click', () => {
    [fg, bg] = [bg, fg];
    refreshControls();
  });
  $<HTMLInputElement>('#palette-rgb').addEventListener('change', (event) => {
    void savePaletteColor((event.target as HTMLInputElement).value.trim());
  });
  $<HTMLInputElement>('#paint-hex').addEventListener('change', (event) => {
    const value = (event.target as HTMLInputElement).value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      announce('Use an #rrggbb color');
      (event.target as HTMLInputElement).value = rgb(colorTarget === 'fg' ? fg : bg);
      return;
    }
    if (colorTarget === 'fg') fg = value.toLowerCase();
    else bg = value.toLowerCase();
    refreshControls();
  });
  $<HTMLInputElement>('#paint-hex').addEventListener('blur', refreshControls);
  for (const id of ['#origin-x', '#origin-y']) {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('focus', () => redraw());
    input.addEventListener('blur', () => {
      requestAnimationFrame(() => redraw());
    });
  }
  $<HTMLInputElement>('#origin-x').addEventListener('change', (event) => {
    if (!doc) return;
    const before = captureHistory();
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isInteger(value) && value >= 0 && value < doc.width) doc.originX = value;
    remember(before);
    refreshControls();
  });
  $<HTMLInputElement>('#origin-y').addEventListener('change', (event) => {
    if (!doc) return;
    const before = captureHistory();
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isInteger(value) && value >= 0 && value < doc.height) doc.originY = value;
    remember(before);
    refreshControls();
  });
  $<HTMLButtonElement>('#close-files').addEventListener('click', () =>
    $<HTMLDialogElement>('#file-dialog').close(),
  );
  $<HTMLButtonElement>('#close-size').addEventListener('click', () =>
    $<HTMLDialogElement>('#size-dialog').close(),
  );
  $<HTMLButtonElement>('#cancel-size').addEventListener('click', () =>
    $<HTMLDialogElement>('#size-dialog').close(),
  );
  $<HTMLButtonElement>('#close-generate-character').addEventListener('click', () =>
    $<HTMLDialogElement>('#generate-character-dialog').close(),
  );
  $<HTMLButtonElement>('#cancel-generate-character').addEventListener('click', () =>
    $<HTMLDialogElement>('#generate-character-dialog').close(),
  );
  $<HTMLFormElement>('#generate-character-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void generateCharacter();
  });
  $<HTMLButtonElement>('#close-font').addEventListener('click', () =>
    $<HTMLDialogElement>('#font-dialog').close(),
  );
  $<HTMLButtonElement>('#cancel-font').addEventListener('click', () =>
    $<HTMLDialogElement>('#font-dialog').close(),
  );
  $<HTMLFormElement>('#font-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const selected = root.querySelector<HTMLInputElement>('#font-choices input:checked');
    const value = selected?.value ?? '';
    $<HTMLDialogElement>('#font-dialog').close();
    if (isSpriteFontId(value)) applySpriteFont(value);
  });
  $<HTMLFormElement>('#size-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const width = Number($<HTMLInputElement>('#canvas-width').value);
    const height = Number($<HTMLInputElement>('#canvas-height').value);
    if (
      !Number.isInteger(width) ||
      width < 1 ||
      width > 256 ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > 128
    ) {
      announce('Invalid dimensions · max 256 × 128');
      return;
    }
    $<HTMLDialogElement>('#size-dialog').close();
    resizeCanvas(width, height);
  });
  $<HTMLInputElement>('#import-file').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file)
      void importSprite(file).catch((error: unknown) =>
        announce(error instanceof Error ? error.message : 'Import failed'),
      );
    (event.target as HTMLInputElement).value = '';
  });
  $<HTMLButtonElement>('#reference-open').addEventListener('click', () => {
    openReferenceDialog();
  });
  $<HTMLButtonElement>('#close-reference').addEventListener('click', () => closeReferenceDialog());
  $<HTMLButtonElement>('#reference-dropper').addEventListener('click', () => {
    $<HTMLInputElement>('#reference-file').click();
  });
  $<HTMLInputElement>('#reference-file').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      if (!isReferenceImage(file)) {
        setReferenceDialogStatus('Use a png, jpeg, webp, or gif image', true);
      } else void takeReferenceImage(file);
    }
    (event.target as HTMLInputElement).value = '';
  });
  const dropper = $<HTMLButtonElement>('#reference-dropper');
  dropper.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dropper.classList.add('dragover');
  });
  dropper.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  dropper.addEventListener('dragleave', (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && dropper.contains(next)) return;
    dropper.classList.remove('dragover');
  });
  const acceptDroppedImage = (event: DragEvent) => {
    event.preventDefault();
    dropper.classList.remove('dragover');
    const file = event.dataTransfer ? [...event.dataTransfer.files].find(isReferenceImage) : null;
    if (!file) {
      setReferenceDialogStatus('Use a png, jpeg, webp, or gif image', true);
      return;
    }
    void takeReferenceImage(file);
  };
  dropper.addEventListener('drop', acceptDroppedImage);
  referenceDialog().addEventListener('dragover', (event) => event.preventDefault());
  referenceDialog().addEventListener('drop', acceptDroppedImage);
  $<HTMLButtonElement>('#reference-edit').addEventListener('click', () => {
    if (!reference) return;
    referenceEdit = !referenceEdit;
    refreshControls();
    announce(referenceEdit ? 'Reference edit mode' : 'Reference edit off');
  });
  $<HTMLButtonElement>('#reference-clear').addEventListener('click', () => {
    void clearReference();
  });
  $<HTMLInputElement>('#reference-visible').addEventListener('change', () => {
    if (!reference) return;
    reference = { ...reference, visible: $<HTMLInputElement>('#reference-visible').checked };
    if (!reference.visible) referenceEdit = false;
    refreshControls();
    announce(reference.visible ? 'Reference shown' : 'Reference hidden');
    void persistReference();
  });
  $<HTMLInputElement>('#reference-opacity').addEventListener('input', () => {
    if (!reference) return;
    const value = Number($<HTMLInputElement>('#reference-opacity').value);
    reference = { ...reference, opacity: value / 100 };
    $<HTMLElement>('#reference-opacity-label').textContent = `${Math.round(value)}%`;
    redraw();
  });
  $<HTMLInputElement>('#reference-opacity').addEventListener('change', () => {
    void persistReference();
  });
  $<HTMLButtonElement>('#zoom-in').addEventListener('click', () => stepZoom(1));
  $<HTMLButtonElement>('#zoom-out').addEventListener('click', () => stepZoom(-1));
  $<HTMLButtonElement>('#fit').addEventListener('click', fit);
  $<HTMLButtonElement>('#layer-add').addEventListener('click', addLayer);
  $<HTMLButtonElement>('#layer-delete').addEventListener('click', deleteLayer);
  $<HTMLButtonElement>('#frame-play').addEventListener('click', togglePlayback);
  $<HTMLButtonElement>('#frame-add').addEventListener('click', addEmptyFrame);
  $<HTMLButtonElement>('#frame-copy').addEventListener('click', copyFrame);
  $<HTMLButtonElement>('#frame-delete').addEventListener('click', deleteFrame);
  function pickBrush(picked: SpriteCell, part: 'tile' | 'ink' | 'paper'): void {
    stamp = null;
    pasteMode = false;
    if (part !== 'paper') {
      glyph = picked.ch;
      fg = picked.fg;
      paletteEdit = picked.fg;
    }
    if (part !== 'ink') bg = picked.bg;
    const name = picked.ch === ' ' ? 'space' : picked.ch;
    announce(
      part === 'ink'
        ? `Glyph and foreground set to ${name}`
        : part === 'paper'
          ? 'Background copied'
          : `Brush set to ${name}`,
    );
    refreshControls();
  }

  listen(canvas, 'contextmenu', (event) => event.preventDefault());
  listen(canvas, 'pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if (!doc || ![0, 1, 2].includes(pointer.button)) return;
    pressing = true;
    sampling = false;
    canvas.focus({ preventScroll: true });
    const p = point(pointer);
    canvas.setPointerCapture(pointer.pointerId);
    if (pointer.button === 1 || (pointer.button === 0 && spaceHeld)) {
      autoFit = false;
      gesture = { kind: 'pan', sx: p.sx, sy: p.sy, ox, oy };
    } else if (
      referenceEdit &&
      reference &&
      referenceImage &&
      reference.visible &&
      pointer.button === 0
    ) {
      const hit = hitReference(p.sx, p.sy);
      if (hit === 'nw' || hit === 'ne' || hit === 'sw' || hit === 'se') {
        gesture = {
          kind: 'ref-resize',
          sx: p.sx,
          sy: p.sy,
          handle: hit,
          rect: {
            x: reference.x,
            y: reference.y,
            width: reference.width,
            height: reference.height,
          },
        };
      } else if (hit === 'body') {
        gesture = {
          kind: 'ref-move',
          sx: p.sx,
          sy: p.sy,
          rect: {
            x: reference.x,
            y: reference.y,
            width: reference.width,
            height: reference.height,
          },
        };
      }
    } else if (
      pointer.button === 2 &&
      inside(p.x, p.y) &&
      tool === 'brush' &&
      (pointer.ctrlKey || pointer.shiftKey)
    ) {
      sampling = true;
      const picked = visibleEntry(p.x, p.y) ?? blankCell();
      if (pointer.ctrlKey) pickBrush(picked, 'ink');
      else pickBrush(picked, 'paper');
    } else if (
      pointer.button === 0 &&
      pointer.shiftKey &&
      !pointer.ctrlKey &&
      !spaceHeld &&
      tool === 'brush' &&
      inside(p.x, p.y)
    ) {
      sampling = true;
      pickBrush(visibleEntry(p.x, p.y) ?? blankCell(), 'paper');
    } else if (pointer.button === 2 && inside(p.x, p.y)) {
      gesture = { kind: 'pick', start: p, end: p };
    } else if (inside(p.x, p.y)) {
      if (tool !== 'select' && paintBlocked()) {
        announce(activeLayer()?.locked ? 'Layer is locked' : 'Layer is hidden');
      } else if (tool === 'move') {
        if (!selection) announce('Select an area first');
        else if (!selectionContains(selection, p)) announce('Drag inside the selection to move it');
        else {
          gesture = {
            kind: 'move',
            start: p,
            rect: { ...selection },
            sourceCells: activeLayer()?.cells.slice(),
            before: captureHistory() ?? undefined,
          };
        }
      } else if (pasteMode && clipboard) {
        const before = captureHistory();
        for (let y = 0; y < clipboard.height; y++) {
          for (let x = 0; x < clipboard.width; x++)
            setCell(p.x + x, p.y + y, clipboard.cells[y * clipboard.width + x]);
        }
        remember(before);
        pasteMode = false;
      } else if (tool === 'fill' || tool === 'fg-fill' || tool === 'bg-fill') flood(p);
      else if (tool === 'select') {
        selection = null;
        gesture = { kind: 'select', start: p, end: p };
      } else if (toolBase(tool) === 'path') {
        gesture = {
          kind: 'path',
          start: p,
          end: p,
          path: [{ x: p.x, y: p.y }],
          shift: pointer.shiftKey,
        };
      } else {
        gesture = { kind: 'paint', before: captureHistory() ?? undefined, last: p };
        applyBrush(p);
      }
    }
    hover = p;
    redraw();
    syncCanvasCursor();
    pointer.preventDefault();
  });
  listen(canvas, 'pointermove', (event) => {
    const p = point(event as PointerEvent);
    hover = p;
    $<HTMLElement>('#cursor-status').textContent = inside(p.x, p.y)
      ? `X: ${String(p.x + 1).padStart(2, '0')}   Y: ${String(p.y + 1).padStart(2, '0')}`
      : 'X: --   Y: --';
    if (
      gesture?.kind === 'pan' &&
      gesture.sx !== undefined &&
      gesture.sy !== undefined &&
      gesture.ox !== undefined &&
      gesture.oy !== undefined
    ) {
      ox = gesture.ox + p.sx - gesture.sx;
      oy = gesture.oy + p.sy - gesture.sy;
    }
    if (
      gesture?.kind === 'ref-move' &&
      gesture.rect &&
      gesture.sx !== undefined &&
      gesture.sy !== undefined &&
      reference
    ) {
      const grid = cell();
      reference = {
        ...reference,
        x: gesture.rect.x + (p.sx - gesture.sx) / grid.width,
        y: gesture.rect.y + (p.sy - gesture.sy) / grid.height,
      };
    }
    if (gesture?.kind === 'ref-resize' && gesture.rect && gesture.handle && reference) {
      const grid = cell();
      const next = resizeReferenceRect(
        gesture.rect,
        gesture.handle,
        (p.sx - ox) / grid.width,
        (p.sy - oy) / grid.height,
        !(event as PointerEvent).shiftKey,
      );
      reference = { ...reference, ...next };
    }
    if (gesture?.kind === 'move' && gesture.start && gesture.rect && gesture.sourceCells && doc) {
      const moved = moveSelectedCells(
        gesture.sourceCells,
        doc.width,
        doc.height,
        gesture.rect,
        p.x - gesture.start.x,
        p.y - gesture.start.y,
      );
      const layer = activeLayer();
      if (layer) layer.cells = moved.cells;
      selection = moved.selection;
    }
    if (
      (gesture?.kind === 'select' || gesture?.kind === 'pick' || gesture?.kind === 'path') &&
      doc
    ) {
      gesture.end = {
        ...p,
        x: Math.max(0, Math.min(doc.width - 1, p.x)),
        y: Math.max(0, Math.min(doc.height - 1, p.y)),
      };
      gesture.shift = (event as PointerEvent).shiftKey;
      if (gesture.kind === 'path' && pathMode === 'draw' && inside(p.x, p.y)) {
        gesture.path = extendDrawPath(gesture.path ?? [], { x: p.x, y: p.y });
      }
    }
    if (gesture?.kind === 'paint' && gesture.last && inside(p.x, p.y)) {
      let x = gesture.last.x;
      let y = gesture.last.y;
      const dx = Math.abs(p.x - x);
      const dy = Math.abs(p.y - y);
      const sx = x < p.x ? 1 : -1;
      const sy = y < p.y ? 1 : -1;
      let error = dx - dy;
      while (x !== p.x || y !== p.y) {
        const twice = 2 * error;
        if (twice > -dy) {
          error -= dy;
          x += sx;
        }
        if (twice < dx) {
          error += dx;
          y += sy;
        }
        applyBrush({ x, y, sx: p.sx, sy: p.sy });
      }
      gesture.last = p;
    }
    redraw();
    syncCanvasCursor();
  });
  const finishGesture = (event: Event) => {
    const wasPressing = pressing;
    pressing = false;
    sampling = false;
    if (!gesture) {
      if (wasPressing) syncCanvasCursor();
      return;
    }
    if (gesture.kind === 'ref-move' || gesture.kind === 'ref-resize') void persistReference();
    if (gesture.kind === 'paint') remember(gesture.before);
    if (gesture.kind === 'move') {
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
        cancelMove();
      } else remember(gesture.before);
    }
    if (gesture.kind === 'path' && gesture.start && gesture.end) {
      const shift = event instanceof PointerEvent ? event.shiftKey : gesture.shift === true;
      commitPath(pathGestureCells(gesture.end, shift));
    }
    if (gesture.kind === 'select' && gesture.start && gesture.end) {
      selection = bounds(gesture.start, gesture.end);
      announce(`Selected ${selection.width} × ${selection.height} cells`);
    }
    if (gesture.kind === 'pick' && gesture.start && gesture.end) {
      const rect = bounds(gesture.start, gesture.end);
      const picked = visibleEntry(gesture.start.x, gesture.start.y) ?? blankCell();
      glyph = picked.ch;
      fg = picked.fg;
      bg = picked.bg;
      stamp = rect.width === 1 && rect.height === 1 ? null : capture(rect, visibleEntry);
      brushSize = 1;
      tool = 'brush';
      pasteMode = false;
      announce(
        stamp
          ? `Stamp selected · ${rect.width} × ${rect.height}`
          : `Brush set to ${picked.ch === ' ' ? 'space' : picked.ch}`,
      );
    }
    gesture = null;
    refreshControls();
  };
  listen(canvas, 'pointerup', finishGesture);
  listen(canvas, 'pointercancel', finishGesture);
  listen(canvas, 'lostpointercapture', finishGesture);
  listen(
    canvas,
    'wheel',
    (event) => {
      const wheel = event as WheelEvent;
      wheel.preventDefault();
      const p = point(wheel);
      stepZoom(wheel.deltaY < 0 ? 1 : -1, p.sx, p.sy);
    },
    { passive: false },
  );
  function isTextField(element: EventTarget | null): boolean {
    if (element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLInputElement) {
      return ['text', 'search', 'password', 'url', 'tel', 'email'].includes(element.type);
    }
    return element instanceof HTMLElement && element.isContentEditable;
  }
  listen(
    document,
    'keydown',
    (event) => {
      if (!root.isConnected) return;
      const keyEvent = event as KeyboardEvent;
      const key = keyEvent.key.toLowerCase();
      const ctrl = keyEvent.ctrlKey || keyEvent.metaKey;
      const typing = isTextField(keyEvent.target) || isTextField(document.activeElement);
      if (ctrl && !keyEvent.altKey && (key === 'a' || keyEvent.code === 'KeyA')) {
        if (typing) return;
        keyEvent.preventDefault();
        keyEvent.stopImmediatePropagation();
        window.getSelection()?.removeAllRanges();
        if (!isModalOpen()) actions['select-all']();
        return;
      }
      if (isModalOpen()) return;
      if (referenceDialog().open) {
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          closeReferenceDialog();
        }
        if (ctrl && key === 'v') return;
        if (!typing) keyEvent.preventDefault();
        return;
      }
      const controlShortcut =
        ctrl && !keyEvent.altKey && ['s', 'z', 'y', 'n', 'o', 'c', 'v', 'd', 'g'].includes(key);
      if (keyEvent.key === 'Alt') {
        if (!altDown) {
          altDown = true;
          altUsed = ctrl;
        }
        keyEvent.preventDefault();
        return;
      }
      if (altDown) altUsed = true;
      const modal = $<HTMLDialogElement>('#generate-character-dialog').open
        ? $<HTMLDialogElement>('#generate-character-dialog')
        : $<HTMLDialogElement>('#size-dialog').open
          ? $<HTMLDialogElement>('#size-dialog')
        : $<HTMLDialogElement>('#font-dialog').open
          ? $<HTMLDialogElement>('#font-dialog')
          : $<HTMLDialogElement>('#file-dialog').open
            ? $<HTMLDialogElement>('#file-dialog')
            : null;
      if (modal) {
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          modal.close();
        }
        return;
      }
      if (!keyMode && !typing && !ctrl && !keyEvent.altKey && key === 'q') {
        keyEvent.preventDefault();
        setGlyphCapture(true);
        return;
      }
      if (keyMode) {
        keyEvent.preventDefault();
        if (keyEvent.key === 'Escape') {
          setGlyphCapture(false);
          return;
        }
        if (keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey) return;
        if (isSingleWidthGlyph(keyEvent.key)) {
          glyph = keyEvent.key;
          stamp = null;
          setGlyphCapture(false);
          setTool('brush');
        }
        return;
      }
      if (key === ' ' && !typing && !ctrl) {
        spaceHeld = true;
        syncCanvasCursor();
        keyEvent.preventDefault();
      }
      if (controlShortcut) {
        if (typing && (key === 'c' || key === 'v' || key === 'a')) return;
        keyEvent.preventDefault();
        if (key === 's') {
          if (keyEvent.shiftKey) void saveAs();
          else void save();
        }
        if (key === 'z') {
          if (keyEvent.shiftKey) actions.redo();
          else actions.undo();
        }
        if (key === 'y') actions.redo();
        if (key === 'n') void newSprite();
        if (key === 'o') actions.browse();
        if (key === 'd') void duplicateSprite();
        if (key === 'c') actions.copy();
        if (key === 'v') actions.paste();
        if (key === 'g') toggleGrid();
        return;
      }
      if (!typing && ctrl && !keyEvent.altKey && (key === 'b' || key === 'f' || key === 'e')) {
        cycleTool({ b: 'brush', f: 'fill', e: 'erase' }[key] as 'brush' | 'fill' | 'erase');
        keyEvent.preventDefault();
        return;
      }
      if (!typing && !ctrl && !keyMode && keyEvent.altKey && (key === 'b' || key === 'n')) {
        keyEvent.preventDefault();
        if (key === 'b') addEmptyFrame();
        else copyFrame();
        return;
      }
      if (!typing && !ctrl && !keyMode && !keyEvent.altKey && keyEvent.key === 'Enter') {
        keyEvent.preventDefault();
        togglePlayback();
        return;
      }
      if (typing || ctrl || keyEvent.altKey) return;
      if (keyEvent.key === 'ArrowLeft' || keyEvent.key === 'ArrowRight') {
        if (
          keyEvent.target instanceof HTMLInputElement ||
          keyEvent.target instanceof HTMLSelectElement
        ) {
          return;
        }
        keyEvent.preventDefault();
        if (doc?.sprites.length) {
          selectFrame(
            wrappedFrameIndex(
              selectedFrame,
              keyEvent.key === 'ArrowLeft' ? -1 : 1,
              doc.sprites.length,
            ),
          );
        }
        return;
      }
      if (key === 'b' || key === 'f' || key === 'e') {
        setTool({ b: 'brush', f: 'fill', e: 'erase' }[key] as Tool);
        keyEvent.preventDefault();
      }
      if (key === 's') {
        setTool('select');
        keyEvent.preventDefault();
      }
      if (key === 'm') {
        setTool('move');
        keyEvent.preventDefault();
      }
      if (key === 'p') {
        cyclePathMode();
        keyEvent.preventDefault();
      }
      if (key === 'g') {
        toggleGrid();
        keyEvent.preventDefault();
      }
      if (key === '[' || key === ']') {
        const base = toolBase(tool) === 'select' ? 'brush' : toolBase(tool);
        setTool(composeTool(base, key === '[' ? 'fg' : 'bg'));
        keyEvent.preventDefault();
      }
      if (keyEvent.key === 'Delete' || keyEvent.key === 'Backspace') actions.clear();
      if (key === '+' || key === '=') stepZoom(1);
      if (key === '-') stepZoom(-1);
      if (keyEvent.key === 'Escape') {
        pasteMode = false;
        if (referenceEdit) referenceEdit = false;
        cancelMove();
        if (gesture?.kind !== 'move') selection = null;
        gesture = null;
        refreshControls();
        redraw();
        syncCanvasCursor();
      }
    },
    { capture: true },
  );
  listen(document, 'keyup', (event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === ' ') {
      spaceHeld = false;
      syncCanvasCursor();
    }
    if (keyEvent.key === 'Alt') {
      altDown = false;
      altUsed = false;
    }
  });
  listen(document, 'paste', (event) => {
    if (!referenceDialog().open) return;
    const item = imageFromClipboard((event as ClipboardEvent).clipboardData);
    if (!item) {
      setReferenceDialogStatus('No image on the clipboard', true);
      return;
    }
    event.preventDefault();
    void takeReferenceImage(item);
  });
  const observer = new ResizeObserver(resizeView);
  observer.observe(wrap);
  stops.push(() => observer.disconnect());
  setDirtyGuard(() => discardUnsaved());
  listen(window, 'beforeunload', (event) => {
    if (discardOnLeave || !anyDirty()) return;
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = '';
  });
  listen(window, 'pagehide', () => {
    discardDrafts();
  });
  listen(window, 'pageshow', (event) => {
    if (discardOnLeave && (event as PageTransitionEvent).persisted) location.reload();
  });
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist();
  });
  setupThemeToggle(root, redraw);
  syncCanvasCursor();

  void (async () => {
    palette = await requestJson<PaletteDocument>('/api/palette');
    paletteSaved = structuredClone(palette);
    const stored = readArtTabStore(localStorage);
    // Recover the last saved brush once; tab changes must not replace it.
    stamp = stored.active ? (stored.sessions[stored.active]?.stamp ?? null) : null;
    openTabs = stored.tabs;
    for (const [id, session] of Object.entries(stored.sessions)) {
      sessions.set(id, sessionFromPersisted(session));
    }
    refreshControls();
    const requestedFromUrl = new URLSearchParams(location.search).get('id');
    const requested = requestedFromUrl ?? stored.active ?? localStorage.getItem(LAST_SPRITE_KEY);
    if (requested && isAssetId(requested)) {
      openTabs = addOpenTab(openTabs, requested);
      try {
        if (sessions.has(requested)) {
          restoreSession(requested);
          flushPersist();
          announce(`Opened ${requested}`);
          return;
        }
        loadSprite(
          await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(requested)}`),
        );
        announce(`Opened ${requested}`);
        return;
      } catch {
        openTabs = closeOpenTab(openTabs, requested);
        dropSession(requested);
        localStorage.removeItem(LAST_SPRITE_KEY);
        setEditorAssetUrl(null);
        flushPersist();
      }
    }
    if (requestedFromUrl && !isAssetId(requestedFromUrl)) setEditorAssetUrl(null);
    await refreshFiles();
    announce('Open or create a sprite');
    resizeView();
  })();

  return () => {
    alive = false;
    if (discardOnLeave) discardDrafts();
    else flushPersist();
    stopPlayback();
    for (const id of [...sessions.keys()]) dropSession(id);
    forgetReference();
    setDirtyGuard(null);
    for (const stop of stops) stop();
  };
}

function artMarkup(): string {
  // Variant icons by Delapouite, CC BY 3.0:
  // https://game-icons.net/1x1/delapouite/pencil-brush.html
  // https://game-icons.net/1x1/delapouite/pencil.html
  // https://game-icons.net/1x1/delapouite/highlighter.html
  return `<div class="app">
    ${assetEditorTopbar()}
    <nav class="menubar" aria-label="Art editor">
      <details class="menu"><summary>FILE</summary><div class="menu-panel">
        <button type="button" data-action="new">New sprite <kbd>Ctrl+N</kbd></button>
        <button type="button" data-action="browse">Browse sprites <kbd>Ctrl+O</kbd></button>
        <button type="button" data-action="save">Save <kbd>Ctrl+S</kbd></button>
        <button type="button" data-action="save-as">Save as… <kbd>Ctrl+Shift+S</kbd></button>
        <button type="button" data-action="duplicate">Duplicate <kbd>Ctrl+D</kbd></button>
        <button type="button" data-action="delete">Delete</button>
        <hr><button type="button" data-action="import">Import ed-ascii…</button>
        <button type="button" data-action="export">Export truecolor</button>
        <button type="button" data-action="copy-ascii">Copy Ascii</button>
      </div></details>
      <details class="menu"><summary>EDIT</summary><div class="menu-panel">
        <button type="button" data-action="sprite-label">Spritesheet meta…</button>
        <button type="button" data-action="undo">Undo <kbd>Ctrl+Z</kbd></button>
        <button type="button" data-action="redo">Redo <kbd>Ctrl+Y</kbd></button>
        <button type="button" data-action="resize">Resize canvas…</button>
        <button type="button" data-action="generate">Generate…</button>
        <button type="button" data-action="font">Font…</button>
        <button type="button" data-action="animation-speed">Animation speed…</button>
        <hr><button type="button" data-action="select-all">Select all <kbd>Ctrl+A</kbd></button>
        <button type="button" data-action="copy">Copy selection <kbd>Ctrl+C</kbd></button>
        <button type="button" data-action="paste">Paste <kbd>Ctrl+V</kbd></button>
        <button type="button" data-action="clear">Clear selection <kbd>Del</kbd></button>
      </div></details>
      <details class="menu"><summary>VIEW</summary><div class="menu-panel">
        <button type="button" data-action="zoom-in">Zoom in</button>
        <button type="button" data-action="zoom-out">Zoom out</button>
        <button type="button" data-action="fit">Fit canvas</button>
        <hr><button type="button" data-action="toggle-grid">Hide grid <kbd>G</kbd></button>
      </div></details>
      <span class="menu-spacer"></span>
      <div id="document-tabs" class="document-tabs" role="tablist"></div>
    </nav>
    <main class="editor">
      <aside class="sidebar">
        <div class="sidebar-heading"><span>CONTROL PANEL</span><span class="tiny-box">ART</span></div>
        <section class="panel">
          <div class="section-title"><span>01</span> TOOLS</div>
          <div class="tools">
            <button class="tool active" type="button" data-tool="brush"><span>BRUSH</span><kbd>B</kbd></button>
            <button class="tool" type="button" data-tool="fill"><span>FILL</span><kbd>F</kbd></button>
            <button class="tool" type="button" data-tool="erase"><span>ERASE</span><kbd>E</kbd></button>
            <button class="tool" type="button" data-tool="select"><span>SELECT</span><kbd>S</kbd></button>
            <button class="tool" type="button" data-tool="move"><span>MOVE</span><kbd>M</kbd></button>
            <button class="tool" type="button" data-tool="path"><span>PATH</span><kbd>P</kbd></button>
          </div>
          <div class="tool-settings">
            <div class="tool-setting">
              <div class="field-head">VARIANT</div>
              <div class="variant-buttons" role="group" aria-label="Tool variant">
                <button class="variant-button active" type="button" data-variant="full" aria-label="Glyph, foreground and background" title="Glyph + FG + BG" aria-pressed="true"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M54.438 29.793a23.808 23.808 0 0 0-1.204.012c-4.688.157-7.914 1.734-10.113 3.933-2.932 2.932-4.76 7.689-3.588 15.305 1.174 7.616 5.683 17.754 15.272 28.941 67.894 79.21 132.935 155.56 183.703 211.97 12.273 13.636 23.693 26.079 34.125 37.134 12.095-31.902 34.57-54.144 62.902-64.715-10.825-10.199-22.936-21.313-36.197-33.248C242.93 178.357 166.578 113.314 87.369 45.42c-11.186-9.59-21.325-14.098-28.941-15.272a29.555 29.555 0 0 0-3.99-.355zm375.109 1.043c-.307-.003-.6.004-.875.023-2.212.147-3.34.654-4.576 1.891l-27.58 27.58 55.156 55.154 27.578-27.58c1.238-1.236 1.745-2.362 1.89-4.574.15-2.21-.37-5.434-1.804-9.164-2.87-7.46-9.277-16.667-17.055-24.445-7.778-7.778-16.985-14.185-24.445-17.055-3.264-1.255-6.138-1.81-8.287-1.83h-.002zm-45.758 42.22-9.9 9.901 9.9 9.898 12.727 12.729 9.9 9.898 12.729 12.729 9.898 9.9 9.9-9.9-55.154-55.154zm-22.627 22.628-87.389 87.39 10.467 9.332 86.822-86.822-9.9-9.9zm22.627 22.629-86.092 86.09 10.469 9.331 85.523-85.523-9.9-9.899zm22.629 22.624-84.795 84.795 10.469 9.332 84.226-84.226-9.898-9.9h-.002zm-213.857 123.35L72.664 384.186l9.898 9.898 119.342-119.342-9.343-10.455zm157.66 12.147c-30.461 7.627-53.24 29.184-63.608 65.218 5.652 5.785 10.956 11.085 15.78 15.707 7.58 7.264 14.096 13.007 19.21 16.957 1.777-17.225 10.045-33.062 21.645-44.691 10.601-10.628 24.496-18.006 39.125-19.092-3.87-4.836-9.139-10.75-15.629-17.523-4.838-5.047-10.416-10.623-16.523-16.576zm-136.303 11.748L95.289 406.809l9.9 9.902 118.075-118.074-9.346-10.455zm21.361 23.894L117.918 429.437l9.896 9.9 116.81-116.806-9.345-10.455zm150.293 16.307c-10.397.137-20.929 5.28-29.582 13.955-11.537 11.565-18.674 28.851-16.267 45.701 5.334 37.342 23.75 65.81 49.46 81.236 22.728 13.636 51.452 17.35 83.643 6.983-24.222-4.01-46.475-30.705-48.197-50.649 10.63 12.814 23.94 24.547 38.426 31.75-9.881-22.578-9.201-45.453-11.088-64.322-1.352-13.522-3.891-24.982-11.377-35.162-7.486-10.18-20.423-19.8-44.74-27.906a31.062 31.062 0 0 0-10.278-1.586zm-322.35 71.816-.003.002.002.002.002-.004zm-.001.004-12.117 30.3 30.392 30.395 30.305-12.12-6.61-6.612-12.732-12.727-9.898-9.898-12.73-12.728-6.61-6.61zm-19.395 48.485-12.992 32.476 32.478-12.992-19.486-19.485z"/></svg><span>ALL</span></button>
                <button class="variant-button" type="button" data-variant="fg" aria-label="Foreground" title="Foreground only" aria-pressed="false"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M429.548 30.836c-.307-.003-.6.005-.875.024-2.212.147-3.34.653-4.576 1.89l-27.58 27.58 55.156 55.154 27.578-27.58c1.238-1.236 1.744-2.363 1.89-4.575.15-2.21-.37-5.433-1.805-9.163-2.87-7.46-9.277-16.667-17.055-24.445-7.778-7.778-16.985-14.185-24.445-17.055-3.264-1.255-6.138-1.81-8.287-1.83zm-45.758 42.22-9.9 9.9 9.9 9.9 12.727 12.727 9.9 9.9 12.727 12.728 9.9 9.9 9.9-9.9-55.155-55.155zm-22.627 22.626L72.665 384.186l9.898 9.897 288.5-288.5-9.9-9.9zm22.627 22.63L95.29 406.808l9.9 9.902 288.5-288.5-9.9-9.9zm22.63 22.626-288.502 288.5 9.897 9.9 288.503-288.5-9.9-9.9zM63.223 400.198l-12.12 30.306 30.393 30.394 30.305-12.12-6.61-6.612L92.46 429.44l-9.9-9.9-12.73-12.728-6.61-6.612zm-19.395 48.488-12.993 32.478 32.478-12.992-19.486-19.485z"/></svg><span>FG</span></button>
                <button class="variant-button" type="button" data-variant="bg" aria-label="Background" title="Background only" aria-pressed="false"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="m414 22.77-10.8 5.41c14 9.72 29.1 22.93 43.4 37.19 14.3 14.24 27.5 29.48 37.2 43.33l5.4-10.71c-5.4-13.29-17.2-29.81-31.3-43.95-14.1-14.14-30.6-25.92-43.9-31.27zm-47.7 7.36L110.1 265.9 246 401.8l235.8-256.2c-.1 0 .1-.9-.7-3.9-1.1-4.1-4-10.2-8.4-17.1-8.8-13.8-23.1-30.83-38.8-46.5-15.7-15.68-32.8-30.07-46.6-38.86-6.9-4.39-13-7.33-17-8.43-3.4-.91-4.1-.56-4-.68zM96.89 278.1l-12.65 12.7L221.1 427.7l12.7-12.7zm-13.68 37.1c1.08 42.4-15.77 78.5-32.83 112.7l19.5 19.5 14.14 14.2c34.18-17.1 70.28-34 112.68-32.9zM39.56 442.5c-11.24 11.8-16.45 18.7-16.67 19.7-.12.7-.41.4 1.34 2.9s5.55 6.4 10.9 11.7c5.34 5.4 9.27 9.2 11.72 10.9 2.46 1.8 2.24 1.5 2.86 1.4 1.05-.2 7.91-5.4 19.66-16.7z"/></svg><span>BG</span></button>
              </div>
            </div>
            <div class="tool-setting">
              <div class="field-head"><label for="brush-size">SIZE</label><span id="brush-size-label">1 × 1</span></div>
              <div class="size-row"><input id="brush-size" type="range" min="1" max="16" value="1"></div>
            </div>
          </div>
          <div id="path-settings" class="tool-settings path-settings" hidden>
            <div class="tool-setting">
              <label class="field-head" for="path-mode">MODE</label>
              <select id="path-mode" class="tool-variant">
                <option value="draw">DRAW</option>
                <option value="line">LINE</option>
                <option value="box">BOX</option>
                <option value="circle">CIRCLE</option>
                <option value="dialog">DIALOG</option>
              </select>
            </div>
            <div class="tool-setting">
              <label class="field-head" for="path-style">STYLE</label>
              <select id="path-style" class="tool-variant">
                <option value="single">SINGLE</option>
                <option value="double">DOUBLE</option>
                <option value="heavy">HEAVY</option>
                <option value="rounded">ROUNDED</option>
              </select>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="section-title"><span>02</span> CHARACTER</div>
          <button type="button" id="glyph-capture" class="glyph-capture" aria-pressed="false" title="Press Q or click, then type a glyph. Typing a glyph, Escape, or clicking again stops."><span id="glyph-capture-char">█</span><span>ACTIVE GLYPH</span></button>
          <div id="glyph-sets">
            <div id="glyph-tabs" class="glyph-tabs" role="tablist" aria-label="Glyph lists"></div>
          </div>
        </section>
        <section class="panel">
          <div class="section-title"><span>03</span> PALETTE</div>
          <div class="color-targets"><button id="fg-target" class="color-target active" type="button"><span id="fg-chip" class="color-chip"></span><span>FG</span></button><button id="bg-target" class="color-target" type="button"><span id="bg-chip" class="color-chip"></span><span>BG</span></button><button id="swap-colors" type="button">⇄</button></div>
           <div id="palette" class="palette"></div>
           <label class="field-head" for="paint-hex">PAINT HEX · ACTIVE FG/BG</label>
           <input id="paint-hex" class="palette-rgb" spellcheck="false" value="#ffffff" maxlength="7">
           <label class="field-head" for="palette-rgb">SELECTED RGB</label>
          <input id="palette-rgb" class="palette-rgb" spellcheck="false" value="#000000">
        </section>
        <section class="panel">
          <div class="section-title"><span>04</span> ORIGIN</div>
          <div class="origin-row"><label>X<input id="origin-x" type="number" min="0" value="0"></label><label>Y<input id="origin-y" type="number" min="0" value="0"></label></div>
        </section>
        <section class="panel">
          <div class="section-title"><span>05</span> REFERENCE</div>
          <div class="reference-actions">
            <button id="reference-open" type="button" disabled>OPEN…</button>
            <button id="reference-edit" type="button" disabled aria-pressed="false">EDIT</button>
            <button id="reference-clear" type="button" disabled>CLEAR</button>
          </div>
          <label class="reference-visible"><input id="reference-visible" type="checkbox" checked disabled> SHOW</label>
          <div class="tool-setting reference-opacity">
            <div class="field-head"><label for="reference-opacity">OPACITY</label><span id="reference-opacity-label">55%</span></div>
            <div class="size-row"><input id="reference-opacity" type="range" min="5" max="100" value="55" disabled></div>
          </div>
          <div id="reference-status" class="reference-status">NO IMAGE</div>
        </section>
      </aside>
      <section class="workspace">
        <div class="workspace-toolbar"><div class="workspace-label">CANVAS <span id="dimensions">NO SPRITE</span> <span id="key-mode-hint" hidden>TYPE A GLYPH</span></div><div class="workspace-controls"><button id="zoom-out" type="button">−</button><span id="zoom-label">100%</span><button id="zoom-in" type="button">+</button><button id="fit" type="button">FIT</button></div></div>
        <div id="canvas-wrap" class="canvas-wrap"><canvas id="canvas" tabindex="0"></canvas></div>
      </section>
      <aside class="layers-bar">
        <div class="sidebar-heading">
          <div class="timeline-group">
            <span>FRAMES</span>
            <div class="layer-actions">
              <button id="frame-play" type="button" title="Play (Enter)">▶</button>
              <button id="frame-add" type="button" title="New empty frame (Alt+B)">+</button>
              <button id="frame-copy" type="button" title="Duplicate frame (Alt+N)">⧉</button>
              <button id="frame-delete" type="button" title="Delete frame">×</button>
            </div>
          </div>
          <div class="timeline-group">
            <span>LAYERS</span>
            <div class="layer-actions">
              <button id="layer-add" type="button" title="Add layer">+</button>
              <button id="layer-delete" type="button" title="Delete layer">×</button>
            </div>
          </div>
        </div>
        <div id="timeline" class="timeline"></div>
      </aside>
    </main>
    <input id="import-file" type="file" accept="application/json,.json" hidden>
    <input id="reference-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    <dialog id="reference-dialog"><div class="dialog-heading"><span>REFERENCE IMAGE</span><button id="close-reference" type="button">×</button></div><div class="reference-dialog-body"><button type="button" id="reference-dropper" class="reference-dropper"><span class="reference-dropper-title">DROP IMAGE</span><span class="reference-dropper-hint">or click to browse · Ctrl+V to paste</span></button><p id="reference-dialog-status" class="reference-dialog-status">Drop an image, click to browse, or press Ctrl+V.</p></div></dialog>
    <dialog id="file-dialog"><div class="dialog-heading"><span>SPRITES</span><button id="close-files" type="button">×</button></div><section class="panel files-panel"><div id="file-list" class="file-list"></div></section></dialog>
    <dialog id="size-dialog"><div class="dialog-heading"><span id="size-dialog-title">RESIZE</span><button id="close-size" type="button">×</button></div><form id="size-form"><p id="size-description"></p><div class="size-fields"><label>WIDTH<input id="canvas-width" type="number" min="1" max="256" required></label><span>×</span><label>HEIGHT<input id="canvas-height" type="number" min="1" max="128" required></label></div><div class="size-dialog-actions"><button id="apply-size" type="submit">RESIZE</button><button id="cancel-size" type="button">CANCEL</button></div></form></dialog>
    <dialog id="generate-character-dialog">
      <div class="dialog-heading"><span>GENERATE · 3×3 CHARACTER</span><button id="close-generate-character" type="button">×</button></div>
      <form id="generate-character-form">
        <p id="generate-description">Create a 22-frame spritesheet using the ada3x3 template.</p>
        <label>SPRITESHEET LABEL<input id="generate-character-label" type="text" maxlength="80" required></label>
        <div class="generate-shirt-field"><span>SHIRT COLOR · <span id="generate-shirt-color-name">bright-yellow</span></span><div id="generate-shirt-colors" class="palette" role="group" aria-label="Shirt color"></div></div>
        <label>SHIRT HEX<input id="generate-shirt-hex" type="text" spellcheck="false" maxlength="7" value="#ffff55" required></label>
        <label>SHIRT LETTER<input id="generate-shirt-letter" type="text" value="A" required></label>
        <div class="generate-shirt-field"><span>LETTER COLOR · <span id="generate-letter-color-name">bright-black</span></span><div id="generate-letter-colors" class="palette" role="group" aria-label="Shirt letter color"></div></div>
        <label>LETTER HEX<input id="generate-letter-hex" type="text" spellcheck="false" maxlength="7" value="#555555" required></label>
        <label class="generate-hair"><input id="generate-hair" type="checkbox" checked> HAIR (TOP CORNER MARKS)</label>
        <p id="generate-character-error" role="alert"></p>
        <div class="size-dialog-actions"><button id="generate-character-submit" type="submit">GENERATE</button><button id="cancel-generate-character" type="button">CANCEL</button></div>
      </form>
    </dialog>
    <dialog id="font-dialog"><div class="dialog-heading"><span>FONT</span><button id="close-font" type="button">×</button></div><form id="font-form"><p id="font-description">Preview this sprite in a terminal typeface. Cell size follows the font.</p><div id="font-choices" class="font-choices">${SPRITE_FONTS.map((font) => `<label><input type="radio" name="sprite-font" value="${font.id}"><span class="font-choice-name">${font.label}</span><span class="font-sample" style="font-family:${font.family}">█▓░ ╔═╗ Aa</span></label>`).join('')}</div><div class="size-dialog-actions"><button id="apply-font" type="submit">APPLY</button><button id="cancel-font" type="button">CANCEL</button></div></form></dialog>
    <div id="toast-stack" class="toast-stack"></div>
    <footer class="statusbar"><div><span id="status">READY</span></div><div><span id="tool-status">BRUSH</span><span class="status-separator">│</span><span id="frame-status">NO FRAME</span><span class="status-separator">│</span><span id="layer-status">NO LAYER</span><span class="status-separator">│</span><span id="cursor-status">X: --  Y: --</span></div></footer>
  </div>`;
}
