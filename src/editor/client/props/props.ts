import { getPaletteRgb, type PaletteDocument } from '../../palette.js';
import {
  createProp,
  flattenSprite,
  isAssetId,
  isInvisibleFrame,
  getAnimationFrameFlips,
  type AnimationDocument,
  type PropDocument,
  type PropVisual,
  type SpriteDocument,
  type VisibleAnimationFrame,
} from '../../schema.js';
import {
  preloadSpriteFonts,
  getSpriteFontFamily,
  getSpriteFontNativePx,
  terminalCellAtZoom,
  getTerminalFont,
} from '../../terminal-cell.js';
import { drawTerminalGlyph, fillTerminalCell } from '../terminal-renderer.js';
import { rebaseJsonDraft } from '../../safe-save.js';
import {
  getNeighborPropTab,
  OPEN_PROPS_KEY,
  readPropTabs,
  type PropTabSession,
} from '../../props/prop-tabs.js';
import {
  blockPreviewGrid,
  blockPreviewPoint,
  paintPropBlockedCells,
  resizeBlockedCells,
  type BlockPreviewGrid,
} from '../../props/prop-blocking.js';
import {
  getAnimationsUsingSheet,
  propVisualEditHref,
  getPropVisualSize,
} from '../../props/prop-picker.js';
import { ApiError, requestJson } from '../api.js';
import { alertModal, confirmModal } from '../modal.js';
import { saveDraft } from '../save.js';
import { askId, createPageShell, setDirtyGuard, setEditorAssetUrl } from '../shell.js';

export function mountProps(root: HTMLElement): () => void {
  root.innerHTML = createPageShell(
    'Props',
    `<aside class="anim-library prop-library" aria-label="Props">
      <input id="prop-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search props" autocomplete="off" spellcheck="false">
      <div id="prop-list" class="asset-list anim-library-list"></div>
    </aside>
    <section class="prop-app" aria-label="Prop editor">
      <div id="prop-tabs" class="prop-tabs" role="tablist" aria-label="Open props"></div>
      <div class="toolbar-row">
        <button id="new-prop" type="button">NEW</button>
        <button id="save-prop" type="button" disabled>SAVE</button>
        <button id="delete-prop" type="button" disabled>DELETE</button>
        <strong id="prop-id">NO PROP</strong>
      </div>
      <p id="prop-status" class="page-copy" role="status">Create a prop or select one from the list.</p>
      <div id="toast-stack" class="toast-stack" aria-live="polite"></div>
      <div id="prop-fields" class="prop-fields" hidden>
        <div class="prop-form">
          <h2>APPEARANCE</h2>
          <label>VISUAL TYPE <select id="prop-visual-type" class="text-input"><option value="sprite">SPRITE</option><option value="animation">ANIMATION</option></select></label>
          <div class="prop-asset-field"><span>ASSET</span><span id="prop-visual-label"></span><a id="edit-prop-visual" class="prop-edit-link" target="_blank" rel="noopener noreferrer" href="/art">EDIT SPRITESHEET ↗</a><small id="prop-default-size" class="prop-default-size"></small><button id="choose-prop-visual" type="button">CHOOSE ASSET…</button></div>
          <h2>SPACE &amp; DEPTH</h2>
          <div class="prop-field-row">
            <label>WIDTH <input id="prop-width" class="text-input" type="number" min="1" max="256"></label>
            <label>HEIGHT <input id="prop-height" class="text-input" type="number" min="1" max="128"></label>
          </div>
          <div class="prop-block-field"><span>BLOCKED CELLS</span><span id="prop-block-count"></span></div>
          <label>GROUND OFFSET Y <input id="prop-ground" class="text-input" type="number" min="-1024" max="1024"></label>
          <label>DEPTH OFFSET <input id="prop-depth" class="text-input" type="number" min="-1024" max="1024"></label>
        </div>
        <div class="prop-preview"><h2>PREVIEW</h2><button id="prop-show-blocks" type="button" aria-pressed="false">SHOW BLOCKED CELLS</button><canvas id="prop-canvas" width="360" height="240" tabindex="0" aria-label="Prop visual preview; press Tab to toggle blocked cells"></canvas><p>Show blocked cells, then click or drag on the preview to block or unblock them. Focus the preview and press Tab to toggle the overlay. Shift+Tab moves focus away.</p><p>Scene position and ordering are set in the Scene editor.</p></div>
      </div>
    </section>
    <dialog id="prop-asset-dialog" class="prop-asset-dialog" aria-labelledby="prop-picker-title">
      <div class="dialog-heading"><span id="prop-picker-title">CHOOSE SPRITE</span><button id="prop-picker-close" type="button" aria-label="Close">×</button></div>
      <div class="prop-picker-body">
        <section class="prop-picker-sheets" aria-label="Sprite sheets"><label for="prop-picker-search">SPRITE SHEETS</label><input id="prop-picker-search" class="text-input" type="search" placeholder="SEARCH" autocomplete="off"><div id="prop-picker-sheets" class="asset-list"></div></section>
        <section class="prop-picker-results" aria-label="Assets"><h3 id="prop-picker-results-title">SPRITES</h3><div id="prop-picker-results" class="prop-picker-grid"></div></section>
      </div>
      <p id="prop-picker-status" class="prop-picker-status" role="status"></p>
      <div class="prop-picker-actions"><button id="prop-picker-ok" type="button" disabled>OK</button><button id="prop-picker-cancel" type="button">CANCEL</button></div>
    </dialog>`,
  );
  root.querySelector('.simple-main')?.classList.add('prop-main');
  const get$ = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
  };
  const search = get$<HTMLInputElement>('#prop-search');
  const list = get$<HTMLElement>('#prop-list');
  const status = get$<HTMLElement>('#prop-status');
  const fields = get$<HTMLElement>('#prop-fields');
  const visualType = get$<HTMLSelectElement>('#prop-visual-type');
  const picker = get$<HTMLDialogElement>('#prop-asset-dialog');
  const pickerSearch = get$<HTMLInputElement>('#prop-picker-search');
  const pickerSheets = get$<HTMLElement>('#prop-picker-sheets');
  const pickerResults = get$<HTMLElement>('#prop-picker-results');
  const pickerStatus = get$<HTMLElement>('#prop-picker-status');
  const pickerOk = get$<HTMLButtonElement>('#prop-picker-ok');
  const canvas = get$<HTMLCanvasElement>('#prop-canvas');
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('Canvas is unavailable');
  const context: CanvasRenderingContext2D = drawing;

  let alive = true;
  let loading = 0;
  let saving = false;
  let files: string[] = [];
  let sprites: string[] = [];
  let spriteLabels: Record<string, string> = {};
  let animations: string[] = [];
  let animationLabels: Record<string, string> = {};
  let palette: PaletteDocument | null = null;
  let current: PropDocument | null = null;
  let saved: PropDocument | null = null;
  const storedTabs = readPropTabs(localStorage);
  let openTabs = storedTabs.tabs;
  const sessions = new Map<string, PropTabSession>(Object.entries(storedTabs.drafts));
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let previewToken = 0;
  let defaultSizeToken = 0;
  let pickerToken = 0;
  let pickerType: PropVisual['type'] = 'sprite';
  let pickerSheet: string | null = null;
  let pickerChoice: PropVisual | null = null;
  let pickerClips: AnimationDocument[] = [];
  let showBlocked = false;
  let previewGrid: BlockPreviewGrid | null = null;
  let previewFrame: { key: string; pending: ReturnType<typeof loadVisualFrame> } | null = null;
  let previewProp: PropDocument | null = null;
  let blockStroke: {
    pointerId: number;
    prop: PropDocument;
    blocked: boolean;
    last: { x: number; y: number };
  } | null = null;
  const sheetCache = new Map<string, Promise<SpriteDocument>>();

  const isTabDirty = (id: string) => {
    const session = id === current?.id ? { doc: current, saved } : sessions.get(id);
    return !!session && JSON.stringify(session.doc) !== JSON.stringify(session.saved);
  };
  setDirtyGuard(
    async () =>
      !openTabs.some(isTabDirty) || confirmModal('Discard unsaved prop changes?', 'DISCARD'),
  );
  const showMessage = (error: unknown) =>
    error instanceof Error ? error.message : 'Prop request failed';

  function toast(text: string, error = false): void {
    const item = document.createElement('div');
    item.className = error ? 'save-toast error' : 'save-toast';
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = error ? '!' : '✓';
    const label = document.createElement('span');
    label.className = 'toast-message';
    label.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close-toast';
    close.textContent = '×';
    close.addEventListener('click', () => item.remove());
    item.append(icon, label, close);
    get$<HTMLElement>('#toast-stack').append(item);
    setTimeout(() => item.remove(), 4000);
  }

  function persistTabs(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    const drafts: Record<string, PropTabSession> = {};
    for (const id of openTabs) {
      const session = id === current?.id && current ? { doc: current, saved } : sessions.get(id);
      if (session && JSON.stringify(session.doc) !== JSON.stringify(session.saved))
        drafts[id] = session;
    }
    try {
      localStorage.setItem(
        OPEN_PROPS_KEY,
        JSON.stringify({ version: 1, tabs: openTabs, active: current?.id ?? null, drafts }),
      );
    } catch {
      toast('Could not store open prop drafts locally', true);
    }
  }
  function scheduleTabs(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistTabs, 400);
  }
  function renderTabs(): void {
    const host = get$<HTMLElement>('#prop-tabs');
    host.replaceChildren();
    if (!openTabs.length) {
      const empty = document.createElement('span');
      empty.className = 'prop-tabs-empty';
      empty.textContent = 'NO PROP';
      host.append(empty);
    }
    for (const id of openTabs) {
      const tab = document.createElement('div');
      tab.className = 'prop-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(current?.id === id));
      tab.classList.toggle('current', current?.id === id);
      tab.classList.toggle('dirty', isTabDirty(id));
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'prop-tab-label';
      label.textContent = id;
      const mark = document.createElement('span');
      mark.className = 'prop-dirty-mark';
      mark.textContent = ' ●';
      label.append(mark);
      label.addEventListener('click', () => void open(id));
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'prop-tab-close';
      close.setAttribute('aria-label', `Close ${id}`);
      close.textContent = '×';
      close.addEventListener('click', () => void closeTab(id));
      tab.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          void closeTab(id);
        }
      });
      tab.append(label, close);
      host.append(tab);
    }
  }
  function activateProp(prop: PropDocument, baseline: PropDocument | null): void {
    if (current) sessions.set(current.id, { doc: current, saved });
    sessions.delete(prop.id);
    current = prop;
    saved = baseline;
    if (!openTabs.includes(prop.id)) openTabs.push(prop.id);
    setEditorAssetUrl(baseline ? prop.id : null);
    render();
    persistTabs();
  }
  async function closeTab(id: string): Promise<void> {
    if (!openTabs.includes(id) || saving) return;
    if (isTabDirty(id) && !(await confirmModal('Discard unsaved prop changes?', 'DISCARD'))) return;
    const next = getNeighborPropTab(openTabs, id);
    openTabs = openTabs.filter((tab) => tab !== id);
    sessions.delete(id);
    if (current?.id === id) {
      ++loading;
      current = null;
      saved = null;
      setEditorAssetUrl(null);
      if (next) await open(next);
      else {
        status.textContent = 'Open a prop from the list.';
        render();
      }
    } else renderTabs();
    persistTabs();
  }

  function renderList(): void {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const matches = files.filter((id) => id.toLowerCase().includes(query));
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anim-picker-empty';
      empty.textContent = files.length === 0 ? 'No props.' : 'No matches.';
      list.append(empty);
    }
    for (const id of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id;
      button.classList.toggle('active', current?.id === id);
      button.addEventListener('click', () => void open(id));
      list.append(button);
    }
  }

  function loadSheet(id: string): Promise<SpriteDocument> {
    const cached = sheetCache.get(id);
    if (cached) return cached;
    const pending = requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`)
      .then(async (sprite) => {
        await document.fonts
          .load(getTerminalFont(getSpriteFontNativePx(sprite.font), getSpriteFontFamily(sprite.font)))
          .catch(() => undefined);
        return sprite;
      })
      .catch((error: unknown) => {
        sheetCache.delete(id);
        throw error;
      });
    sheetCache.set(id, pending);
    return pending;
  }

  function getVisualSize(visual: PropVisual): Promise<{ width: number; height: number } | null> {
    return getPropVisualSize(visual, loadSheet, (id) => {
      const clip = pickerClips.find((animation) => animation.id === id);
      return clip
        ? Promise.resolve(clip)
        : requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(id)}`);
    });
  }

  function paintSprite(
    target: HTMLCanvasElement,
    sprite: SpriteDocument,
    index: number,
    footprint?: PropDocument,
    showOverlay = false,
    flips?: { flipH: boolean; flipV: boolean },
  ): void {
    const ctx = target.getContext('2d');
    if (!ctx || !palette) return;
    const colors = palette;
    ctx.fillStyle = getPaletteRgb(colors, 'black') ?? '#000';
    ctx.fillRect(0, 0, target.width, target.height);
    if (index >= sprite.sprites.length) return;
    const native = terminalCellAtZoom(ctx, 1, sprite.font);
    const grid = blockPreviewGrid(target, footprint ?? sprite, {
      width: sprite.width,
      height: sprite.height,
      cellWidth: native.width,
      cellHeight: native.height,
    });
    const scale = grid.cellWidth / native.width;
    const cell = terminalCellAtZoom(ctx, scale, sprite.font);
    const x0 = grid.x;
    const y0 = grid.y;
    flattenSprite(sprite, index).forEach((entry, at) => {
      const column = at % sprite.width;
      const row = Math.floor(at / sprite.width);
      const x = x0 + (flips?.flipH ? sprite.width - 1 - column : column) * cell.width;
      const y = y0 + (flips?.flipV ? sprite.height - 1 - row : row) * cell.height;
      ctx.fillStyle = getPaletteRgb(colors, entry.bg) ?? '#000';
      fillTerminalCell(ctx, cell, x, y);
      if (entry.ch !== ' ') {
        ctx.fillStyle = getPaletteRgb(colors, entry.fg) ?? '#fff';
        drawTerminalGlyph(ctx, cell, entry.ch, x, y);
      }
    });
    if (footprint && showOverlay) paintBlockedOverlay(ctx, footprint, grid);
  }

  function paintBlockedOverlay(
    ctx: CanvasRenderingContext2D,
    prop: PropDocument,
    grid: BlockPreviewGrid,
  ): void {
    const { x: x0, y: y0, cellWidth: width, cellHeight: height } = grid;
    ctx.strokeStyle = 'rgba(255, 174, 149, 0.45)';
    ctx.lineWidth = 1;
    for (let y = 0; y < prop.height; y++)
      for (let x = 0; x < prop.width; x++)
        ctx.strokeRect(
          x0 + x * width + 0.5,
          y0 + y * height + 0.5,
          Math.max(0, width - 1),
          Math.max(0, height - 1),
        );
    ctx.fillStyle = 'rgba(235, 88, 79, 0.55)';
    ctx.strokeStyle = '#ffae95';
    for (const index of prop.blockedCells) {
      const x = x0 + (index % prop.width) * width;
      const y = y0 + Math.floor(index / prop.width) * height;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    }
  }

  async function loadVisualFrame(visual: PropVisual): Promise<{
    sprite: SpriteDocument;
    index: number;
    flips?: { flipH: boolean; flipV: boolean };
  } | null> {
    if (visual.type === 'sprite')
      return { sprite: await loadSheet(visual.id), index: visual.index };
    const animation = await requestJson<AnimationDocument>(
      `/api/animations/${encodeURIComponent(visual.id)}`,
    );
    const first = animation.frames.find((frame) => !isInvisibleFrame(frame));
    if (!first || isInvisibleFrame(first)) return null;
    return {
      sprite: await loadSheet(first.sprite),
      index: first.index,
      flips: getAnimationFrameFlips(animation, first),
    };
  }

  function renderPickerSheets(): void {
    pickerSheets.replaceChildren();
    const query = pickerSearch.value.trim().toLowerCase();
    const visible = sprites.filter((id) => (spriteLabels[id] ?? id).toLowerCase().includes(query));
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.textContent = sprites.length ? 'No matches.' : 'No sprite sheets.';
      pickerSheets.append(empty);
    }
    for (const id of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = spriteLabels[id] ?? id;
      button.classList.toggle('active', pickerSheet === id);
      button.addEventListener('click', () => {
        if (pickerSheet === id) return;
        pickerSheet = id;
        pickerChoice = null;
        renderPickerSheets();
        void renderPickerResults();
      });
      pickerSheets.append(button);
    }
  }

  async function renderPickerResults(): Promise<void> {
    const token = ++pickerToken;
    pickerResults.replaceChildren();
    pickerOk.disabled = true;
    if (!pickerSheet) return;
    const sheetId = pickerSheet;
    pickerStatus.textContent = 'Loading previews…';
    const entries = pickerType === 'animation' ? getAnimationsUsingSheet(pickerClips, sheetId) : [];
    if (pickerType === 'animation' && entries.length === 0) {
      pickerStatus.textContent = 'No animations use this sprite sheet.';
      return;
    }
    try {
      const sheet = await loadSheet(sheetId);
      if (!alive || !picker.open || token !== pickerToken) return;
      pickerStatus.textContent = '';
      const items: {
        visual: PropVisual;
        frame: number;
        title: string;
        flips?: { flipH: boolean; flipV: boolean };
      }[] =
        pickerType === 'sprite'
          ? sheet.sprites.map((_frame, index) => ({
              visual: { type: 'sprite', id: sheetId, index },
              frame: index,
              title: `FRAME ${index + 1}`,
            }))
          : entries.map(({ animation, frame }) => ({
              visual: { type: 'animation', id: animation.id },
              frame: frame.index,
              flips: getAnimationFrameFlips(animation, frame),
              title: animation.label,
            }));
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'prop-picker-card';
        button.title = item.title;
        const thumb = document.createElement('canvas');
        thumb.width = 144;
        thumb.height = 100;
        paintSprite(thumb, sheet, item.frame, undefined, false, item.flips);
        const label = document.createElement('span');
        label.textContent = item.title;
        button.append(thumb, label);
        button.classList.toggle(
          'active',
          JSON.stringify(pickerChoice) === JSON.stringify(item.visual),
        );
        button.addEventListener('click', () => {
          pickerChoice = item.visual;
          pickerResults.querySelectorAll('.prop-picker-card').forEach((card) => {
            card.classList.toggle('active', card === button);
          });
          pickerOk.disabled = false;
        });
        pickerResults.append(button);
      }
      pickerOk.disabled =
        !pickerChoice ||
        !items.some((item) => JSON.stringify(item.visual) === JSON.stringify(pickerChoice));
      if (items.length === 0) pickerStatus.textContent = 'No sprites in this sheet.';
    } catch (error) {
      if (alive && picker.open && token === pickerToken) pickerStatus.textContent = showMessage(error);
    }
  }

  async function openPicker(type: PropVisual['type']): Promise<void> {
    if (!current || picker.open) return;
    pickerType = type;
    pickerChoice = null;
    pickerSheet = null;
    pickerClips = [];
    pickerSearch.value = '';
    get$<HTMLElement>('#prop-picker-title').textContent =
      type === 'sprite' ? 'CHOOSE SPRITE' : 'CHOOSE ANIMATION';
    get$<HTMLElement>('#prop-picker-results-title').textContent =
      type === 'sprite' ? 'SPRITES' : 'ANIMATIONS';
    pickerStatus.textContent = 'Loading assets…';
    pickerResults.replaceChildren();
    pickerSheets.replaceChildren();
    pickerOk.disabled = true;
    picker.showModal();
    const token = ++pickerToken;
    try {
      const [sheets, clips] = await Promise.all([
        requestJson<{ files: string[]; labels: Record<string, string> }>('/api/sprites'),
        type === 'animation'
          ? requestJson<{ files: string[]; labels: Record<string, string> }>('/api/animations')
          : Promise.resolve({ files: [], labels: {} }),
      ]);
      if (!alive || !picker.open || token !== pickerToken) return;
      sprites = sheets.files;
      spriteLabels = sheets.labels;
      animations = type === 'animation' ? clips.files : animations;
      if (type === 'animation') animationLabels = clips.labels;
      if (type === 'animation') {
        const results = await Promise.allSettled(
          clips.files.map((id) =>
            requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(id)}`),
          ),
        );
        if (!alive || !picker.open || token !== pickerToken) return;
        pickerClips = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
      }
      const existing = current?.visual;
      pickerSheet =
        existing?.type === 'sprite' && type === 'sprite' && sprites.includes(existing.id)
          ? existing.id
          : type === 'animation' && existing?.type === 'animation'
            ? (pickerClips
                .find((clip) => clip.id === existing.id)
                ?.frames.find(
                  (frame): frame is VisibleAnimationFrame =>
                    !isInvisibleFrame(frame) && sprites.includes(frame.sprite),
                )?.sprite ??
              sprites[0] ??
              null)
            : (sprites[0] ?? null);
      if (
        existing?.type === type &&
        (type === 'sprite'
          ? pickerSheet === existing.id
          : pickerClips.some(
              (clip) =>
                clip.id === existing.id &&
                getAnimationsUsingSheet([clip], pickerSheet ?? '').length > 0,
            ))
      )
        pickerChoice = { ...existing };
      renderPickerSheets();
      if (!pickerSheet) pickerStatus.textContent = 'Create a sprite sheet first.';
      else void renderPickerResults();
    } catch (error) {
      if (alive && picker.open && token === pickerToken) pickerStatus.textContent = showMessage(error);
    }
  }

  async function drawPreview(): Promise<void> {
    const token = ++previewToken;
    if (!current || !palette) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    try {
      const key = `${current.id}:${JSON.stringify(current.visual)}`;
      if (previewFrame?.key !== key)
        previewFrame = { key, pending: loadVisualFrame(current.visual) };
      const frame = await previewFrame.pending;
      if (!alive || token !== previewToken) return;
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (frame) {
        paintSprite(canvas, frame.sprite, frame.index, current, showBlocked, frame.flips);
        if (showBlocked) {
          const native = terminalCellAtZoom(context, 1, frame.sprite.font);
          previewGrid = blockPreviewGrid(canvas, current, {
            width: frame.sprite.width,
            height: frame.sprite.height,
            cellWidth: native.width,
            cellHeight: native.height,
          });
        }
      } else if (showBlocked) {
        previewGrid = blockPreviewGrid(canvas, current, null);
        paintBlockedOverlay(context, current, previewGrid);
      }
    } catch (error) {
      previewFrame = null;
      if (alive && token === previewToken) status.textContent = showMessage(error);
    }
  }

  async function renderDefaultSize(): Promise<void> {
    const hint = get$<HTMLElement>('#prop-default-size');
    const visual = current?.visual;
    const token = ++defaultSizeToken;
    if (!visual) {
      hint.textContent = '';
      return;
    }
    hint.textContent = 'Default size: loading…';
    try {
      const size = await getVisualSize(visual);
      if (!alive || token !== defaultSizeToken) return;
      hint.textContent = size
        ? `Default size: ${size.width} × ${size.height} cells${visual.type === 'animation' ? ' (first visible frame)' : ''}`
        : 'Default size unavailable: animation has no visible frame.';
    } catch (error) {
      if (alive && token === defaultSizeToken)
        hint.textContent = `Default size unavailable: ${showMessage(error)}`;
    }
  }

  function render(): void {
    blockStroke = null;
    previewGrid = null;
    if (previewProp !== current) previewFrame = null;
    previewProp = current;
    renderList();
    renderTabs();
    scheduleTabs();
    fields.hidden = !current;
    get$<HTMLButtonElement>('#save-prop').disabled = !current;
    get$<HTMLButtonElement>('#delete-prop').disabled = !current;
    get$<HTMLElement>('#prop-id').textContent = current?.id ?? 'NO PROP';
    if (!current) {
      ++defaultSizeToken;
      return;
    }
    visualType.value = current.visual.type;
    get$<HTMLElement>('#prop-visual-label').textContent =
      current.visual.type === 'sprite'
        ? `${spriteLabels[current.visual.id] ?? current.visual.id} · frame ${current.visual.index + 1}`
        : (animationLabels[current.visual.id] ?? current.visual.id);
    const editLink = get$<HTMLAnchorElement>('#edit-prop-visual');
    editLink.href = propVisualEditHref(current.visual);
    editLink.textContent =
      current.visual.type === 'sprite' ? 'EDIT SPRITESHEET ↗' : 'EDIT ANIMATION ↗';
    get$<HTMLInputElement>('#prop-width').value = String(current.width);
    get$<HTMLInputElement>('#prop-height').value = String(current.height);
    get$<HTMLElement>('#prop-block-count').textContent =
      `${current.blockedCells.length} of ${current.width * current.height} cells blocked`;
    const showBlocksButton = get$<HTMLButtonElement>('#prop-show-blocks');
    showBlocksButton.textContent = showBlocked ? 'HIDE BLOCKED CELLS' : 'SHOW BLOCKED CELLS';
    showBlocksButton.setAttribute('aria-pressed', String(showBlocked));
    get$<HTMLInputElement>('#prop-ground').value = String(current.groundOffsetY);
    get$<HTMLInputElement>('#prop-depth').value = String(current.depthOffset);
    void renderDefaultSize();
    void drawPreview();
  }

  async function refresh(): Promise<void> {
    const [props, sheets, clips, colors] = await Promise.all([
      requestJson<{ files: string[] }>('/api/props'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/sprites'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/animations'),
      requestJson<PaletteDocument>('/api/palette'),
    ]);
    if (!alive) return;
    files = props.files;
    openTabs = openTabs.filter(
      (id) => files.includes(id) || id === current?.id || (sessions.has(id) && isTabDirty(id)),
    );
    for (const id of sessions.keys()) if (!openTabs.includes(id)) sessions.delete(id);
    sprites = sheets.files;
    spriteLabels = sheets.labels;
    animations = clips.files;
    animationLabels = clips.labels;
    palette = colors;
    render();
  }

  async function open(id: string): Promise<void> {
    if (current?.id === id || saving) return;
    const token = ++loading;
    const cached = sessions.get(id);
    if (cached) {
      activateProp(cached.doc, cached.saved);
      status.textContent = `Opened ${id}`;
      return;
    }
    try {
      const prop = await requestJson<PropDocument>(`/api/props/${encodeURIComponent(id)}`);
      if (!alive || token !== loading) return;
      activateProp(prop, structuredClone(prop));
      status.textContent = `Opened ${id}`;
    } catch (error) {
      if (alive && token === loading) status.textContent = showMessage(error);
    }
  }

  async function save(): Promise<void> {
    if (!current || saving) return;
    const sent = structuredClone(current);
    const base = saved;
    saving = true;
    try {
      const stored = await saveDraft(`/api/props/${encodeURIComponent(sent.id)}`, sent, base);
      if (alive && current?.id === sent.id) {
        setEditorAssetUrl(sent.id);
        const merged = rebaseJsonDraft(sent, current, stored);
        if (merged.ok) {
          current = merged.value.draft;
          saved = merged.value.baseline;
          status.textContent = `Saved ${stored.id}`;
          render();
        } else status.textContent = `Saved ${stored.id}; newer edits need review`;
        toast(status.textContent, !merged.ok);
        renderTabs();
        scheduleTabs();
      }
      if (alive) await refresh();
    } catch (error) {
      if (!alive) return;
      status.textContent = showMessage(error);
      toast(status.textContent, true);
      if (error instanceof ApiError && error.status === 409) {
        await alertModal(`${showMessage(error)}. Your unsaved prop is still open.`);
      }
    } finally {
      saving = false;
    }
  }

  visualType.addEventListener('change', () => {
    if (!current) return;
    const type = visualType.value === 'animation' ? 'animation' : 'sprite';
    visualType.value = current.visual.type;
    void openPicker(type);
  });
  get$<HTMLButtonElement>('#choose-prop-visual').addEventListener('click', () => {
    if (current) void openPicker(current.visual.type);
  });
  pickerSearch.addEventListener('input', renderPickerSheets);
  const closePicker = () => picker.close();
  get$<HTMLButtonElement>('#prop-picker-close').addEventListener('click', closePicker);
  get$<HTMLButtonElement>('#prop-picker-cancel').addEventListener('click', closePicker);
  picker.addEventListener('close', () => {
    ++pickerToken;
    pickerChoice = null;
    visualType.value = current?.visual.type ?? 'sprite';
  });
  pickerOk.addEventListener('click', () => {
    if (!current || !pickerChoice || pickerOk.disabled) return;
    const selected = pickerChoice;
    const prop = current;
    const changed = JSON.stringify(prop.visual) !== JSON.stringify(selected);
    const token = ++pickerToken;
    pickerOk.disabled = true;
    void (async () => {
      try {
        const size = changed ? await getVisualSize(selected) : null;
        if (!alive || !picker.open || token !== pickerToken || current !== prop) return;
        prop.visual = selected;
        if (size) {
          prop.blockedCells = resizeBlockedCells(
            prop.blockedCells,
            prop.width,
            size.width,
            size.height,
          );
          prop.width = size.width;
          prop.height = size.height;
        } else if (changed) {
          status.textContent = 'Animation has no visible frame; kept the current footprint.';
        }
        picker.close();
        render();
      } catch (error) {
        if (alive && picker.open && token === pickerToken) {
          pickerStatus.textContent = showMessage(error);
          pickerOk.disabled = false;
        }
      }
    })();
  });
  function toggleBlockedPreview(): void {
    showBlocked = !showBlocked;
    blockStroke = null;
    previewGrid = null;
    const button = get$<HTMLButtonElement>('#prop-show-blocks');
    button.textContent = showBlocked ? 'HIDE BLOCKED CELLS' : 'SHOW BLOCKED CELLS';
    button.setAttribute('aria-pressed', String(showBlocked));
    canvas.classList.toggle('editing-blocks', showBlocked);
    canvas.setAttribute(
      'aria-label',
      showBlocked
        ? 'Prop preview; click or drag cells to block or unblock them; press Tab to hide blocked cells'
        : 'Prop visual preview; press Tab to show blocked cells',
    );
    void drawPreview();
  }
  get$<HTMLButtonElement>('#prop-show-blocks').addEventListener('click', toggleBlockedPreview);
  function previewPoint(event: PointerEvent): { x: number; y: number } | null {
    if (!current || !showBlocked || !previewGrid) return null;
    const rect = canvas.getBoundingClientRect();
    return blockPreviewPoint(
      {
        x: ((event.clientX - rect.left - canvas.clientLeft) * canvas.width) / canvas.clientWidth,
        y: ((event.clientY - rect.top - canvas.clientTop) * canvas.height) / canvas.clientHeight,
      },
      previewGrid,
      current,
    );
  }
  canvas.addEventListener('pointerdown', (event) => {
    canvas.focus();
    if (event.button !== 0 || !current) return;
    const point = previewPoint(event);
    if (!point) return;
    event.preventDefault();
    blockStroke = {
      pointerId: event.pointerId,
      prop: current,
      blocked: !current.blockedCells.includes(point.y * current.width + point.x),
      last: point,
    };
    canvas.setPointerCapture(event.pointerId);
    current.blockedCells = paintPropBlockedCells(
      current.blockedCells,
      current.width,
      point,
      point,
      blockStroke.blocked,
    );
    get$<HTMLElement>('#prop-block-count').textContent =
      `${current.blockedCells.length} of ${current.width * current.height} cells blocked`;
    renderTabs();
    scheduleTabs();
    void drawPreview();
  });
  canvas.addEventListener('pointermove', (event) => {
    const stroke = blockStroke;
    if (!stroke || stroke.pointerId !== event.pointerId || current !== stroke.prop) return;
    const point = previewPoint(event);
    if (!point) return;
    current.blockedCells = paintPropBlockedCells(
      current.blockedCells,
      current.width,
      stroke.last,
      point,
      stroke.blocked,
    );
    stroke.last = point;
    get$<HTMLElement>('#prop-block-count').textContent =
      `${current.blockedCells.length} of ${current.width * current.height} cells blocked`;
    renderTabs();
    scheduleTabs();
    void drawPreview();
  });
  const finishBlockStroke = (event: PointerEvent) => {
    if (blockStroke?.pointerId !== event.pointerId) return;
    const point = previewPoint(event);
    if (point && current === blockStroke.prop) {
      current.blockedCells = paintPropBlockedCells(
        current.blockedCells,
        current.width,
        blockStroke.last,
        point,
        blockStroke.blocked,
      );
      get$<HTMLElement>('#prop-block-count').textContent =
        `${current.blockedCells.length} of ${current.width * current.height} cells blocked`;
      renderTabs();
      scheduleTabs();
      void drawPreview();
    }
    blockStroke = null;
  };
  canvas.addEventListener('pointerup', finishBlockStroke);
  canvas.addEventListener('pointercancel', () => {
    blockStroke = null;
  });
  canvas.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    toggleBlockedPreview();
  });
  for (const [selector, field] of [
    ['#prop-width', 'width'],
    ['#prop-height', 'height'],
    ['#prop-ground', 'groundOffsetY'],
    ['#prop-depth', 'depthOffset'],
  ] as const) {
    const input = get$<HTMLInputElement>(selector);
    input.addEventListener('change', () => {
      if (!current) return;
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < Number(input.min) || value > Number(input.max)) {
        input.value = String(current[field]);
        status.textContent = `${field} must be between ${input.min} and ${input.max}`;
        return;
      }
      if (field === 'width' || field === 'height') {
        current.blockedCells = resizeBlockedCells(
          current.blockedCells,
          current.width,
          field === 'width' ? value : current.width,
          field === 'height' ? value : current.height,
        );
      }
      current[field] = value;
      if (field === 'width' || field === 'height') render();
      else {
        renderTabs();
        scheduleTabs();
      }
    });
  }
  search.addEventListener('input', renderList);
  get$<HTMLButtonElement>('#save-prop').addEventListener('click', () => void save());
  get$<HTMLButtonElement>('#new-prop').addEventListener('click', () => {
    void (async () => {
      const id = await askId('New prop id');
      if (!id) return;
      if (!isAssetId(id)) return void alertModal('Use a short lowercase id');
      if (files.includes(id) || openTabs.includes(id))
        return void alertModal('An asset with that id already exists');
      const visual: PropVisual | null = sprites[0]
        ? { type: 'sprite', id: sprites[0], index: 0 }
        : animations[0]
          ? { type: 'animation', id: animations[0] }
          : null;
      if (!visual) return void alertModal('Create a sprite or animation before creating a prop');
      const token = ++loading;
      let size: { width: number; height: number } | null;
      try {
        size = await getVisualSize(visual);
      } catch (error) {
        if (alive && token === loading) status.textContent = showMessage(error);
        return;
      }
      if (!alive || token !== loading) return;
      activateProp({ ...createProp(id, visual), ...(size ?? {}) }, null);
      status.textContent = `New prop ${id}`;
    })();
  });
  get$<HTMLButtonElement>('#delete-prop').addEventListener('click', () => {
    void (async () => {
      if (!current || !(await confirmModal(`Delete ${current.id}?`, 'DELETE'))) return;
      const id = current.id;
      try {
        if (saved) {
          await requestJson(`/api/props/${encodeURIComponent(id)}`, { method: 'DELETE' });
        }
        if (!alive) return;
        if (current?.id !== id) return;
        ++loading;
        openTabs = openTabs.filter((tab) => tab !== id);
        sessions.delete(id);
        current = null;
        saved = null;
        status.textContent = 'Prop deleted';
        setEditorAssetUrl(null);
        await refresh();
        const next = openTabs[openTabs.length - 1];
        if (next) await open(next);
        else persistTabs();
      } catch (error) {
        if (alive) status.textContent = showMessage(error);
      }
    })();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !root.isConnected ||
      picker.open ||
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== 's'
    )
      return;
    event.preventDefault();
    void save();
  };
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('pagehide', persistTabs);
  void preloadSpriteFonts()
    .then(async () => {
      await refresh();
      if (!alive) return;
      const requested = new URLSearchParams(location.search).get('id');
      if (requested) {
        if (isAssetId(requested) && (files.includes(requested) || sessions.has(requested)))
          await open(requested);
        else status.textContent = `Prop ${requested} not found`;
      } else {
        const preferred =
          storedTabs.active && openTabs.includes(storedTabs.active)
            ? storedTabs.active
            : openTabs[openTabs.length - 1];
        if (preferred) await open(preferred);
      }
    })
    .catch((error: unknown) => {
      if (alive) status.textContent = showMessage(error);
    });
  return () => {
    alive = false;
    persistTabs();
    ++loading;
    ++pickerToken;
    ++previewToken;
    ++defaultSizeToken;
    if (picker.open) picker.close();
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pagehide', persistTabs);
    setDirtyGuard(null);
  };
}
