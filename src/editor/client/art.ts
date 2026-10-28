import { artCursorKind, type ArtCursorGesture, type ArtTool } from '../art-cursor.js';
import { isSingleWidthGlyph } from '../glyph.js';
import { paletteRgb, type PaletteDocument } from '../palette.js';
import {
  blankCell,
  createSprite,
  DEFAULT_FRAME_DURATION_MS,
  emptySpriteFrame,
  exportTruecolor,
  flattenSprite,
  isAssetId,
  layerNameError,
  MAX_FRAME_DURATION_MS,
  MAX_FRAMES,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYERS,
  type SpriteCell,
  type SpriteDocument,
  type SpriteFrame,
  type SpriteLayer,
} from '../schema.js';
import { jsonRequest, requestJson, ApiError } from './api.js';
import { artCursorCss } from './cursors.js';
import { alertModal, askAnimationSpeed, askNewSprite, confirmModal, isModalOpen } from './modal.js';
import { askId, brandLink, setDirtyGuard } from './shell.js';

type Stamp = { width: number; height: number; cells: (SpriteCell | null)[] };
type Point = { x: number; y: number; sx: number; sy: number };
type Tool = ArtTool;
type HistoryEntry = {
  doc: SpriteDocument;
  selectedFrame: number;
  activeLayerId: string | null;
};

const GLYPHS = [
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
  '┳',
  '┻',
  '┣',
  '┫',
  '▲',
  '▼',
  '◄',
  '►',
  '★',
  '☆',
  '♥',
  '◆',
];
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 8;
const ZOOM_STEPS = [MIN_ZOOM, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, MAX_ZOOM];
const LAST_KEY = 'incanterm-editor-last-sprite';
const SPEED_KEY = 'incanterm-editor-animation-ms';

function readAnimationSpeed(): number {
  const raw = Number(localStorage.getItem(SPEED_KEY));
  if (Number.isInteger(raw) && raw >= 1 && raw <= MAX_FRAME_DURATION_MS) return raw;
  return DEFAULT_FRAME_DURATION_MS;
}

export function mountArt(root: HTMLElement): () => void {
  root.innerHTML = artMarkup();
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
  let spriteId: string | null = null;
  let tool: Tool = 'brush';
  let brushSize = 1;
  let glyph = '█';
  let fg = 'bright-white';
  let bg = 'black';
  let colorTarget: 'fg' | 'bg' = 'fg';
  let paletteEdit = 'bright-white';
  let stamp: Stamp | null = null;
  let clipboard: Stamp | null = null;
  let layerClipboard: (SpriteCell | null)[] | null = null;
  let clipboardKind: 'layer' | 'stamp' | null = null;
  let celMarked = false;
  let selection: { x: number; y: number; width: number; height: number } | null = null;
  let pasteMode = false;
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
  } | null = null;
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
    if (!layer?.locked || spaceHeld) return false;
    if (pasteMode) return true;
    const base = toolBase(tool);
    return base === 'brush' || base === 'fill' || base === 'erase';
  }
  function syncCanvasCursor(): void {
    const kind = gesture?.kind;
    const cursorGesture: ArtCursorGesture | null =
      kind === 'pan' || kind === 'pick' || kind === 'paint' || kind === 'select' ? kind : null;
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
    return { doc: cloneDoc(doc), selectedFrame, activeLayerId };
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
    $<HTMLElement>('#document-title').classList.toggle('dirty', dirty());
    $<HTMLElement>('#document-title').firstChild!.textContent = spriteId
      ? `${spriteId.toUpperCase()} `
      : 'NO SPRITE ';
    $<HTMLElement>('#dimensions').textContent = doc
      ? `${doc.width} × ${doc.height} CELLS`
      : 'NO SPRITE';
  }
  function refreshControls(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === toolBase(tool));
    });
    const variant = $<HTMLSelectElement>('#tool-variant');
    variant.value = toolVariant(tool);
    variant.disabled = toolBase(tool) === 'select';
    $<HTMLElement>('#fg-target').classList.toggle('active', colorTarget === 'fg');
    $<HTMLElement>('#bg-target').classList.toggle('active', colorTarget === 'bg');
    $<HTMLElement>('#fg-chip').style.background = rgb(fg);
    $<HTMLElement>('#bg-chip').style.background = rgb(bg);
    $<HTMLElement>('#glyph-capture-char').textContent = glyph;
    $<HTMLButtonElement>('#glyph-capture').setAttribute('aria-pressed', String(keyMode));
    $<HTMLElement>('#key-mode-hint').hidden = !keyMode;
    $<HTMLInputElement>('#brush-size').value = String(brushSize);
    $<HTMLElement>('#brush-size-label').textContent = `${brushSize} × ${brushSize}`;
    const variantLabel = { full: 'GLYPH', fg: 'FG', bg: 'BG' }[toolVariant(tool)];
    $<HTMLElement>('#tool-status').textContent =
      `${toolBase(tool).toUpperCase()} / ${variantLabel} / ${brushSize} × ${brushSize}`;
    const layer = activeLayer();
    $<HTMLElement>('#frame-status').textContent = frameStatusText();
    $<HTMLElement>('#layer-status').textContent = layer ? layerLabel(layer) : 'NO LAYER';
    syncCanvasCursor();
    renderTimeline();
    $<HTMLElement>('#zoom-label').textContent = `${Math.round(zoom * 100)}%`;
    $<HTMLInputElement>('#palette-rgb').value = rgb(paletteEdit);
    if (doc) {
      $<HTMLInputElement>('#origin-x').value = String(doc.originX);
      $<HTMLInputElement>('#origin-y').value = String(doc.originY);
    }
    root.querySelectorAll<HTMLButtonElement>('#palette button').forEach((button) => {
      const id = button.dataset.color ?? '';
      button.classList.toggle('selected', id === fg || id === bg || id === paletteEdit);
      button.style.background = rgb(id);
    });
    updateTitle();
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
  function draw(): void {
    if (!viewW || !viewH) return;
    context.clearRect(0, 0, viewW, viewH);
    context.fillStyle = getComputedStyle(wrap).backgroundColor;
    context.fillRect(0, 0, viewW, viewH);
    if (!doc) return;
    const cw = 16 * zoom;
    const ch = 22 * zoom;
    const x0 = Math.max(0, Math.floor(-ox / cw));
    const y0 = Math.max(0, Math.floor(-oy / ch));
    const x1 = Math.min(doc.width, Math.ceil((viewW - ox) / cw));
    const y1 = Math.min(doc.height, Math.ceil((viewH - oy) / ch));
    context.fillStyle = rgb('black');
    context.fillRect(ox, oy, doc.width * cw, doc.height * ch);
    context.font = `${Math.max(6, Math.round(16 * zoom))}px 'Courier New', monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const flat = flattenSprite(doc, selectedFrame);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const entry = flat[y * doc.width + x];
        const px = ox + x * cw;
        const py = oy + y * ch;
        if (entry.bg !== 'black') {
          context.fillStyle = rgb(entry.bg);
          context.fillRect(px, py, cw + 0.3, ch + 0.3);
        }
        if (entry.ch !== ' ') {
          context.fillStyle = rgb(entry.fg);
          context.fillText(entry.ch, px + cw / 2, py + ch / 2 + zoom * 0.7);
        }
      }
    }
    context.strokeStyle = '#add1c3';
    context.lineWidth = 2;
    context.strokeRect(
      Math.round(ox) - 1,
      Math.round(oy) - 1,
      doc.width * cw + 2,
      doc.height * ch + 2,
    );
    if (editingOrigin()) box({ x: doc.originX, y: doc.originY, width: 1, height: 1 }, '#f2df9e');
    const march = (performance.now() / 60) % 12;
    if (selection) box(selection, '#f2df9e', [6, 6], march);
    if (gesture?.kind === 'select' || gesture?.kind === 'pick') {
      if (gesture.start && gesture.end)
        box(bounds(gesture.start, gesture.end), '#ffffff', [6, 6], march);
    }
    if (hover && inside(hover.x, hover.y)) {
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
  function paintPreview(origin: Point): void {
    const source = { ch: glyph, fg, bg };
    context.save();
    context.globalAlpha = 0.45;
    context.font = `${Math.max(6, Math.round(16 * zoom))}px 'Courier New', monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const place = (x: number, y: number, value: SpriteCell | null) => {
      if (!value || !inside(x, y)) return;
      const px = ox + x * 16 * zoom;
      const py = oy + y * 22 * zoom;
      context.fillStyle = rgb(value.bg);
      context.fillRect(px, py, 16 * zoom + 0.3, 22 * zoom + 0.3);
      if (value.ch !== ' ') {
        context.fillStyle = rgb(value.fg);
        context.fillText(value.ch, px + (16 * zoom) / 2, py + (22 * zoom) / 2 + zoom * 0.7);
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
            brushValue(sample, layerCell(origin.x + x, origin.y + y)),
          );
        }
      }
    } else {
      const rect = brushRect(origin);
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          place(x, y, brushValue(source, layerCell(x, y)));
        }
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
    const x = Math.round(ox + rect.x * 16 * zoom) + 0.5;
    const y = Math.round(oy + rect.y * 22 * zoom) + 0.5;
    const width = Math.round(rect.width * 16 * zoom);
    const height = Math.round(rect.height * 22 * zoom);
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
    zoom = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, (viewW - 64) / (doc.width * 16), (viewH - 64) / (doc.height * 22)),
    );
    ox = Math.round((viewW - doc.width * 16 * zoom) / 2);
    oy = Math.round((viewH - doc.height * 22 * zoom) / 2);
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
    return {
      sx,
      sy,
      x: Math.floor((sx - ox) / (16 * zoom)),
      y: Math.floor((sy - oy) / (22 * zoom)),
    };
  }
  function remember(before: HistoryEntry | null | undefined): void {
    if (!doc || !before) return;
    if (JSON.stringify(before.doc) === JSON.stringify(doc)) return;
    stopPlayback();
    undoStack.push(before);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateTitle();
    redraw();
  }
  function restore(previous: HistoryEntry): void {
    renamingLayer = false;
    const resized = !doc || previous.doc.width !== doc.width || previous.doc.height !== doc.height;
    doc = cloneDoc(previous.doc);
    selectedFrame = previous.selectedFrame;
    activeLayerId = previous.activeLayerId;
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
  function brushValue(source: SpriteCell, target: SpriteCell | null): SpriteCell | null {
    if (tool === 'erase') return null;
    const partial =
      tool === 'fg-brush' ||
      tool === 'bg-brush' ||
      tool === 'fg' ||
      tool === 'bg' ||
      tool === 'fg-erase' ||
      tool === 'bg-erase';
    if (!target) return partial ? null : source;
    if (tool === 'fg-brush') return { ...target, ch: source.ch, fg: source.fg };
    if (tool === 'bg-brush' || tool === 'bg') return { ...target, bg: source.bg };
    if (tool === 'fg') return { ...target, fg: source.fg };
    if (tool === 'fg-erase') return { ...target, ch: ' ', fg: 'white' };
    if (tool === 'bg-erase') return { ...target, bg: 'black' };
    return source;
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
      const next = brushValue(source, layerCell(x, y));
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
  function sameCell(left: SpriteCell | null, right: SpriteCell | null): boolean {
    if (left === null || right === null) return left === right;
    return left.ch === right.ch && left.fg === right.fg && left.bg === right.bg;
  }
  function flood(p: Point): void {
    if (!doc || !inside(p.x, p.y)) return;
    if (playing) stopPlayback();
    const layer = activeLayer();
    if (!layer || layer.locked) return;
    const original = layer.cells[p.y * doc.width + p.x] ?? null;
    if (tool === 'fg-fill' || tool === 'bg-fill') {
      if (!original) return;
      if (tool === 'fg-fill' ? original.fg === fg : original.bg === bg) return;
    } else if (
      original !== null &&
      original.ch === glyph &&
      original.fg === fg &&
      original.bg === bg
    ) {
      return;
    }
    const before = captureHistory();
    const visited = new Uint8Array(doc.width * doc.height);
    const stack = [p.y * doc.width + p.x];
    while (stack.length) {
      const index = stack.pop();
      if (index === undefined || visited[index]) continue;
      visited[index] = 1;
      const entry = layer.cells[index] ?? null;
      if (tool === 'fg-fill' || tool === 'bg-fill') {
        if (!entry || !original) continue;
        if (tool === 'fg-fill' ? entry.fg !== original.fg : entry.bg !== original.bg) continue;
        layer.cells[index] = tool === 'fg-fill' ? { ...entry, fg } : { ...entry, bg };
      } else {
        if (!sameCell(entry, original)) continue;
        layer.cells[index] = { ch: glyph, fg, bg };
      }
      const x = index % doc.width;
      const y = Math.floor(index / doc.width);
      if (x > 0) stack.push(index - 1);
      if (x < doc.width - 1) stack.push(index + 1);
      if (y > 0) stack.push(index - doc.width);
      if (y < doc.height - 1) stack.push(index + doc.width);
    }
    remember(before);
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
  function toolBase(value: Tool): 'brush' | 'fill' | 'erase' | 'select' {
    if (value === 'select') return 'select';
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
    base: 'brush' | 'fill' | 'erase' | 'select',
    variant: 'full' | 'fg' | 'bg',
  ): Tool {
    if (base === 'select' || variant === 'full') return base === 'select' ? 'select' : base;
    return `${variant}-${base}` as Tool;
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
  async function refreshFiles(): Promise<void> {
    const list = $<HTMLElement>('#file-list');
    try {
      const { files } = await requestJson<{ files: string[] }>('/api/sprites');
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
        open.textContent = `▤  ${file}.json`;
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
    stopPlayback();
    doc = next;
    selectedFrame = 0;
    playFrom = 0;
    playTo = 0;
    rangeSelected = false;
    moveArmed = false;
    selectTopLayer();
    spriteId = next.id;
    savedState = JSON.stringify(next);
    localStorage.setItem(LAST_KEY, next.id);
    undoStack = [];
    redoStack = [];
    selection = null;
    stamp = null;
    pasteMode = false;
    fit();
    void refreshFiles();
    refreshControls();
  }
  async function openSprite(id: string): Promise<void> {
    if (!(await allowReplace())) return;
    const next = await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`);
    loadSprite(next);
    $<HTMLDialogElement>('#file-dialog').close();
    announce(`Opened ${id}`);
  }
  async function save(): Promise<void> {
    if (!doc || !spriteId) {
      announce('Open or create a sprite');
      return;
    }
    try {
      const saved = await requestJson<SpriteDocument>(
        `/api/sprites/${encodeURIComponent(spriteId)}`,
        jsonRequest('PUT', doc),
      );
      doc = saved;
      savedState = JSON.stringify(saved);
      updateTitle();
      announce(`Saved ${spriteId}`);
      toast(`Saved ${spriteId}`);
      void refreshFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      announce(message);
      toast(message, true);
    }
  }
  async function deleteSprite(id: string): Promise<void> {
    if (!(await confirmModal(`Delete ${id}? This cannot be undone.`, 'DELETE'))) return;
    await requestJson(`/api/sprites/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY);
    if (spriteId === id) {
      stopPlayback();
      doc = null;
      selectedFrame = 0;
      playFrom = 0;
      playTo = 0;
      rangeSelected = false;
      moveArmed = false;
      activeLayerId = null;
      spriteId = null;
      savedState = '';
      refreshControls();
    }
    await refreshFiles();
    announce(`Deleted ${id}`);
  }
  async function allowReplace(): Promise<boolean> {
    return !dirty() || confirmModal('Discard unsaved changes?', 'DISCARD');
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
  async function newSprite(): Promise<void> {
    if (!(await allowReplace())) return;
    const draft = await askNewSprite();
    if (!draft) return;
    const sprite = createSprite(draft.id, draft.width, draft.height);
    try {
      await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(draft.id)}`);
      await alertModal('An asset with that id already exists');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        await alertModal('An asset with that id already exists');
        return;
      }
      try {
        const saved = await requestJson<SpriteDocument>(
          `/api/sprites/${encodeURIComponent(draft.id)}`,
          jsonRequest('PUT', sprite),
        );
        loadSprite(saved);
        announce(`Created ${draft.id}`);
      } catch (createError) {
        announce(createError instanceof Error ? createError.message : 'Create failed');
      }
    }
  }
  async function duplicateSprite(): Promise<void> {
    if (!spriteId) {
      announce('Open or create a sprite');
      return;
    }
    if (!(await allowReplace())) return;
    const id = await askId('Duplicate as', `${spriteId}-copy`);
    if (id === null) return;
    if (!isAssetId(id)) {
      announce('Use a short lowercase id');
      return;
    }
    const copy = await requestJson<SpriteDocument>(
      '/api/duplicate',
      jsonRequest('POST', { kind: 'sprite', from: spriteId, id }),
    );
    loadSprite(copy);
    announce(`Duplicated as ${id}`);
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
      const current =
        Number(cel.dataset.frame) === selectedFrame && cel.dataset.layer === layerId;
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
      head.classList.toggle(
        'armed',
        shown && moveArmed && from === to && index === selectedFrame,
      );
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
        playFrom === playTo
          ? `Frame ${playFrom + 1}`
          : `Frames ${playFrom + 1}–${playTo + 1}`,
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
    link.download = `${spriteId ?? 'sprite'}.ans`;
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
    const id = await askId('Import as');
    if (id === null) return;
    if (!isAssetId(id)) {
      announce('Use a short lowercase id');
      return;
    }
    const document = JSON.parse(await file.text()) as unknown;
    const sprite = await requestJson<SpriteDocument>(
      '/api/import/ed-ascii',
      jsonRequest('POST', { id, document }),
    );
    loadSprite(sprite);
    announce(`Imported ${id}`);
  }
  async function savePaletteColor(value: string): Promise<void> {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      announce('Use an #rrggbb color');
      return;
    }
    const next = {
      ...palette,
      colors: palette.colors.map((color) =>
        color.id === paletteEdit ? { ...color, rgb: value.toLowerCase() } : color,
      ),
    };
    palette = await requestJson<PaletteDocument>('/api/palette', jsonRequest('PUT', next));
    refreshControls();
    announce(`Recolored ${paletteEdit}`);
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
  const glyphHost = $<HTMLElement>('#glyph-list');
  for (const entry of GLYPHS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry;
    button.addEventListener('click', () => {
      glyph = entry;
      stamp = null;
      refreshControls();
    });
    glyphHost.append(button);
  }

  const actions: Record<string, () => void> = {
    new: () => void newSprite(),
    browse: () => {
      void refreshFiles();
      $<HTMLDialogElement>('#file-dialog').showModal();
    },
    save: () => void save(),
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
      setTool(composeTool(base as 'brush' | 'fill' | 'erase', variant));
    });
  });
  $<HTMLSelectElement>('#tool-variant').addEventListener('change', () => {
    const base = toolBase(tool);
    if (base === 'select') return;
    const value = $<HTMLSelectElement>('#tool-variant').value;
    const variant = value === 'fg' || value === 'bg' ? value : 'full';
    setTool(composeTool(base, variant));
  });
  $<HTMLInputElement>('#brush-size').addEventListener('input', (event) => {
    brushSize = Math.min(16, Math.max(1, Number((event.target as HTMLInputElement).value) || 1));
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
  $<HTMLButtonElement>('#zoom-in').addEventListener('click', () => stepZoom(1));
  $<HTMLButtonElement>('#zoom-out').addEventListener('click', () => stepZoom(-1));
  $<HTMLButtonElement>('#fit').addEventListener('click', fit);
  $<HTMLButtonElement>('#layer-add').addEventListener('click', addLayer);
  $<HTMLButtonElement>('#layer-delete').addEventListener('click', deleteLayer);
  $<HTMLButtonElement>('#frame-play').addEventListener('click', togglePlayback);
  $<HTMLButtonElement>('#frame-add').addEventListener('click', addEmptyFrame);
  $<HTMLButtonElement>('#frame-copy').addEventListener('click', copyFrame);
  $<HTMLButtonElement>('#frame-delete').addEventListener('click', deleteFrame);
  $<HTMLButtonElement>('#theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('light');
    const light = document.body.classList.contains('light');
    $<HTMLButtonElement>('#theme-toggle').textContent = light ? '◐ DARK MODE' : '☼ LIGHT MODE';
    localStorage.setItem('incanterm-editor-theme', light ? 'light' : 'dark');
    redraw();
  });
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
    } else if (pointer.button === 2 && inside(p.x, p.y) && tool === 'brush') {
      sampling = true;
      const picked = visibleEntry(p.x, p.y) ?? blankCell();
      if (pointer.ctrlKey) pickBrush(picked, 'ink');
      else if (pointer.shiftKey) pickBrush(picked, 'paper');
      else pickBrush(picked, 'tile');
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
        announce('Layer is locked');
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
    if ((gesture?.kind === 'select' || gesture?.kind === 'pick') && doc) {
      gesture.end = {
        ...p,
        x: Math.max(0, Math.min(doc.width - 1, p.x)),
        y: Math.max(0, Math.min(doc.height - 1, p.y)),
      };
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
  });
  const finishGesture = () => {
    const wasPressing = pressing;
    pressing = false;
    sampling = false;
    if (!gesture) {
      if (wasPressing) syncCanvasCursor();
      return;
    }
    if (gesture.kind === 'paint') remember(gesture.before);
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
      const controlShortcut =
        ctrl && !keyEvent.altKey && ['s', 'z', 'y', 'n', 'o', 'c', 'v', 'd'].includes(key);
      if (keyEvent.key === 'Alt') {
        if (!altDown) {
          altDown = true;
          altUsed = ctrl;
        }
        keyEvent.preventDefault();
        return;
      }
      if (altDown) altUsed = true;
      const modal = $<HTMLDialogElement>('#size-dialog').open
        ? $<HTMLDialogElement>('#size-dialog')
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
          refreshControls();
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
        if (key === 's') void save();
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
      if (key === 'b' || key === 'f' || key === 'e') {
        cycleTool({ b: 'brush', f: 'fill', e: 'erase' }[key] as 'brush' | 'fill' | 'erase');
        keyEvent.preventDefault();
      }
      if (key === 's') {
        setTool('select');
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
        selection = null;
        gesture = null;
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
  const observer = new ResizeObserver(resizeView);
  observer.observe(wrap);
  stops.push(() => observer.disconnect());
  setDirtyGuard(() => allowReplace());
  if (localStorage.getItem('incanterm-editor-theme') === 'light') {
    document.body.classList.add('light');
    $<HTMLButtonElement>('#theme-toggle').textContent = '◐ DARK MODE';
  }
  syncCanvasCursor();

  void (async () => {
    palette = await requestJson<PaletteDocument>('/api/palette');
    refreshControls();
    const requested =
      new URLSearchParams(location.search).get('id') ?? localStorage.getItem(LAST_KEY);
    if (requested && isAssetId(requested)) {
      try {
        loadSprite(
          await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(requested)}`),
        );
        announce(`Opened ${requested}`);
        return;
      } catch {
        localStorage.removeItem(LAST_KEY);
      }
    }
    await refreshFiles();
    announce('Open or create a sprite');
    resizeView();
  })();

  return () => {
    alive = false;
    stopPlayback();
    setDirtyGuard(null);
    for (const stop of stops) stop();
  };
}

function artMarkup(): string {
  return `<div class="app">
    <header class="topbar">
      ${brandLink('ART')}
      <div class="top-right"><a class="text-button" href="/">INDEX</a><button id="theme-toggle" class="text-button" type="button">☼ LIGHT MODE</button></div>
    </header>
    <nav class="menubar" aria-label="Art editor">
      <details class="menu"><summary>FILE</summary><div class="menu-panel">
        <button type="button" data-action="new">New sprite <kbd>Ctrl+N</kbd></button>
        <button type="button" data-action="browse">Browse sprites <kbd>Ctrl+O</kbd></button>
        <button type="button" data-action="save">Save <kbd>Ctrl+S</kbd></button>
        <button type="button" data-action="duplicate">Duplicate <kbd>Ctrl+D</kbd></button>
        <button type="button" data-action="delete">Delete</button>
        <hr><button type="button" data-action="import">Import ed-ascii…</button>
        <button type="button" data-action="export">Export truecolor</button>
        <button type="button" data-action="copy-ascii">Copy Ascii</button>
      </div></details>
      <details class="menu"><summary>EDIT</summary><div class="menu-panel">
        <button type="button" data-action="undo">Undo <kbd>Ctrl+Z</kbd></button>
        <button type="button" data-action="redo">Redo <kbd>Ctrl+Y</kbd></button>
        <button type="button" data-action="resize">Resize canvas…</button>
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
      </div></details>
      <span class="menu-spacer"></span>
      <span id="document-title" class="document-title">NO SPRITE <span class="dirty-mark">●</span></span>
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
          </div>
          <label class="field-head" for="tool-variant">VARIANT</label>
          <select id="tool-variant" class="tool-variant">
            <option value="full">GLYPH + FG + BG</option>
            <option value="fg">FG</option>
            <option value="bg">BG</option>
          </select>
          <div class="field-head"><label for="brush-size">BRUSH SIZE</label><span id="brush-size-label">1 × 1</span></div>
          <div class="size-row"><input id="brush-size" type="range" min="1" max="16" value="1"></div>
        </section>
        <section class="panel">
          <div class="section-title"><span>02</span> CHARACTER</div>
          <button type="button" id="glyph-capture" class="glyph-capture" aria-pressed="false" title="Press Q or click, then type a glyph. Click again or press Escape to stop."><span id="glyph-capture-char">█</span><span>ACTIVE GLYPH</span></button>
          <div id="glyph-list" class="glyph-list"></div>
        </section>
        <section class="panel">
          <div class="section-title"><span>03</span> PALETTE</div>
          <div class="color-targets"><button id="fg-target" class="color-target active" type="button"><span id="fg-chip" class="color-chip"></span><span>FG</span></button><button id="bg-target" class="color-target" type="button"><span id="bg-chip" class="color-chip"></span><span>BG</span></button><button id="swap-colors" type="button">⇄</button></div>
          <div id="palette" class="palette"></div>
          <label class="field-head" for="palette-rgb">SELECTED RGB</label>
          <input id="palette-rgb" class="palette-rgb" spellcheck="false" value="#000000">
        </section>
        <section class="panel">
          <div class="section-title"><span>04</span> ORIGIN</div>
          <div class="origin-row"><label>X<input id="origin-x" type="number" min="0" value="0"></label><label>Y<input id="origin-y" type="number" min="0" value="0"></label></div>
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
    <dialog id="file-dialog"><div class="dialog-heading"><span>SPRITES</span><button id="close-files" type="button">×</button></div><section class="panel files-panel"><div id="file-list" class="file-list"></div></section></dialog>
    <dialog id="size-dialog"><div class="dialog-heading"><span id="size-dialog-title">RESIZE</span><button id="close-size" type="button">×</button></div><form id="size-form"><p id="size-description"></p><div class="size-fields"><label>WIDTH<input id="canvas-width" type="number" min="1" max="256" required></label><span>×</span><label>HEIGHT<input id="canvas-height" type="number" min="1" max="128" required></label></div><div class="size-dialog-actions"><button id="cancel-size" type="button">CANCEL</button><button id="apply-size" type="submit">RESIZE</button></div></form></dialog>
    <div id="toast-stack" class="toast-stack"></div>
    <footer class="statusbar"><div><span id="status">READY</span></div><div><span id="tool-status">BRUSH</span><span class="status-separator">│</span><span id="frame-status">NO FRAME</span><span class="status-separator">│</span><span id="layer-status">NO LAYER</span><span class="status-separator">│</span><span id="cursor-status">X: --  Y: --</span></div></footer>
  </div>`;
}
