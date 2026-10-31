import { paletteRgb, type PaletteDocument } from '../palette.js';
import {
  createProp,
  flattenSprite,
  isAssetId,
  isInvisibleFrame,
  type AnimationDocument,
  type PropDocument,
  type PropVisual,
  type SpriteDocument,
  type VisibleAnimationFrame,
} from '../schema.js';
import {
  preloadSpriteFonts,
  spriteFontFamily,
  spriteFontNativePx,
  terminalCellAtZoom,
  terminalFont,
} from '../terminal-cell.js';
import { drawTerminalGlyph, fillTerminalCell } from './terminal-renderer.js';
import { mergeJson } from '../safe-save.js';
import { resizeBlockedCells } from '../prop-blocking.js';
import { animationsUsingSheet, propVisualEditHref, propVisualSize } from '../prop-picker.js';
import { ApiError, requestJson } from './api.js';
import { alertModal, confirmModal } from './modal.js';
import { saveDraft } from './save.js';
import { askId, pageShell, setDirtyGuard, setEditorAssetUrl } from './shell.js';

export function mountProps(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Props',
    `<aside class="anim-library prop-library" aria-label="Props">
      <input id="prop-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search props" autocomplete="off" spellcheck="false">
      <div id="prop-list" class="asset-list anim-library-list"></div>
    </aside>
    <section class="prop-app" aria-label="Prop editor">
      <div class="toolbar-row">
        <button id="new-prop" type="button">NEW</button>
        <button id="save-prop" type="button" disabled>SAVE</button>
        <button id="delete-prop" type="button" disabled>DELETE</button>
        <strong id="prop-id">NO PROP</strong>
      </div>
      <p id="prop-status" class="page-copy" role="status">Create a prop or select one from the list.</p>
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
          <div class="prop-block-field"><span>BLOCKED CELLS</span><span id="prop-block-count"></span><button id="edit-prop-blocks" type="button">EDIT BLOCKED CELLS…</button></div>
          <label>GROUND OFFSET Y <input id="prop-ground" class="text-input" type="number" min="-1024" max="1024"></label>
          <label>DEPTH OFFSET <input id="prop-depth" class="text-input" type="number" min="-1024" max="1024"></label>
        </div>
        <div class="prop-preview"><h2>PREVIEW</h2><button id="prop-show-blocks" type="button" aria-pressed="false">SHOW BLOCKED CELLS</button><canvas id="prop-canvas" width="360" height="240" tabindex="0" aria-label="Prop visual preview; press Tab to toggle blocked cells"></canvas><p>Focus the preview and press Tab to toggle blocked cells. Shift+Tab moves focus away.</p><p>Scene position and ordering are set in the Scene editor.</p></div>
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
    </dialog>
    <dialog id="prop-block-dialog" class="prop-block-dialog" aria-labelledby="prop-block-title">
      <div class="dialog-heading"><span id="prop-block-title">BLOCKED CELLS</span><button id="prop-block-close" type="button" aria-label="Close">×</button></div>
      <p class="prop-block-help">Click or drag cells to mark them blocked. The grid matches the prop footprint.</p>
      <div class="prop-block-scroll"><canvas id="prop-block-canvas" tabindex="0" aria-label="Blocked cell editor"></canvas></div>
      <div class="prop-block-actions"><span id="prop-block-status" role="status"></span><button id="prop-block-clear" type="button">CLEAR ALL</button><button id="prop-block-all" type="button">BLOCK ALL</button><button id="prop-block-apply" type="button">APPLY</button><button id="prop-block-cancel" type="button">CANCEL</button></div>
    </dialog>`,
  );
  root.querySelector('.simple-main')?.classList.add('prop-main');
  const $ = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
  };
  const search = $<HTMLInputElement>('#prop-search');
  const list = $<HTMLElement>('#prop-list');
  const status = $<HTMLElement>('#prop-status');
  const fields = $<HTMLElement>('#prop-fields');
  const visualType = $<HTMLSelectElement>('#prop-visual-type');
  const picker = $<HTMLDialogElement>('#prop-asset-dialog');
  const pickerSearch = $<HTMLInputElement>('#prop-picker-search');
  const pickerSheets = $<HTMLElement>('#prop-picker-sheets');
  const pickerResults = $<HTMLElement>('#prop-picker-results');
  const pickerStatus = $<HTMLElement>('#prop-picker-status');
  const pickerOk = $<HTMLButtonElement>('#prop-picker-ok');
  const canvas = $<HTMLCanvasElement>('#prop-canvas');
  const blockDialog = $<HTMLDialogElement>('#prop-block-dialog');
  const blockCanvas = $<HTMLCanvasElement>('#prop-block-canvas');
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('Canvas is unavailable');
  const context: CanvasRenderingContext2D = drawing;

  let alive = true;
  let loading = 0;
  let saving = false;
  let files: string[] = [];
  let sprites: string[] = [];
  let animations: string[] = [];
  let palette: PaletteDocument | null = null;
  let current: PropDocument | null = null;
  let saved: PropDocument | null = null;
  let previewToken = 0;
  let defaultSizeToken = 0;
  let pickerToken = 0;
  let pickerType: PropVisual['type'] = 'sprite';
  let pickerSheet: string | null = null;
  let pickerChoice: PropVisual | null = null;
  let pickerClips: AnimationDocument[] = [];
  let showBlocked = false;
  let blockDraft: Set<number> | null = null;
  let blockProp: PropDocument | null = null;
  let blockSprite: { sprite: SpriteDocument; index: number } | null = null;
  let blockToken = 0;
  let blockPainting: boolean | null = null;
  let blockLast: { x: number; y: number } | null = null;
  let blockCellPx = 40;
  const sheetCache = new Map<string, Promise<SpriteDocument>>();
  const BLOCK_CELL_PX = 40;

  const dirty = () => current !== null && JSON.stringify(current) !== JSON.stringify(saved);
  setDirtyGuard(async () => !dirty() || confirmModal('Discard unsaved prop changes?', 'DISCARD'));
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'Prop request failed';

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
          .load(terminalFont(spriteFontNativePx(sprite.font), spriteFontFamily(sprite.font)))
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

  function visualSize(visual: PropVisual): Promise<{ width: number; height: number } | null> {
    return propVisualSize(visual, loadSheet, (id) => {
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
  ): void {
    const ctx = target.getContext('2d');
    if (!ctx || !palette) return;
    const colors = palette;
    ctx.fillStyle = paletteRgb(colors, 'black') ?? '#000';
    ctx.fillRect(0, 0, target.width, target.height);
    if (index >= sprite.sprites.length) return;
    const width = Math.max(sprite.width, footprint?.width ?? 0);
    const height = Math.max(sprite.height, footprint?.height ?? 0);
    const native = terminalCellAtZoom(ctx, 1, sprite.font);
    const scale = Math.min(
      4,
      (target.width - 12) / (width * native.width),
      (target.height - 12) / (height * native.height),
    );
    const cell = terminalCellAtZoom(ctx, scale, sprite.font);
    const x0 = Math.floor((target.width - width * cell.width) / 2);
    const y0 = Math.floor((target.height - height * cell.height) / 2);
    flattenSprite(sprite, index).forEach((entry, at) => {
      const x = x0 + (at % sprite.width) * cell.width;
      const y = y0 + Math.floor(at / sprite.width) * cell.height;
      ctx.fillStyle = paletteRgb(colors, entry.bg) ?? '#000';
      fillTerminalCell(ctx, cell, x, y);
      if (entry.ch !== ' ') {
        ctx.fillStyle = paletteRgb(colors, entry.fg) ?? '#fff';
        drawTerminalGlyph(ctx, cell, entry.ch, x, y);
      }
    });
    if (footprint && showOverlay)
      paintBlockedOverlay(ctx, footprint, x0, y0, cell.width, cell.height);
  }

  function paintBlockedOverlay(
    ctx: CanvasRenderingContext2D,
    prop: PropDocument,
    x0: number,
    y0: number,
    width: number,
    height: number,
  ): void {
    ctx.fillStyle = 'rgba(235, 88, 79, 0.55)';
    ctx.strokeStyle = '#ffae95';
    for (const index of prop.blockedCells) {
      const x = x0 + (index % prop.width) * width;
      const y = y0 + Math.floor(index / prop.width) * height;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    }
  }

  async function loadVisualFrame(
    visual: PropVisual,
  ): Promise<{ sprite: SpriteDocument; index: number } | null> {
    if (visual.type === 'sprite')
      return { sprite: await loadSheet(visual.id), index: visual.index };
    const animation = await requestJson<AnimationDocument>(
      `/api/animations/${encodeURIComponent(visual.id)}`,
    );
    const first = animation.frames.find((frame) => !isInvisibleFrame(frame));
    if (!first || isInvisibleFrame(first)) return null;
    return { sprite: await loadSheet(first.sprite), index: first.index };
  }

  function renderPickerSheets(): void {
    pickerSheets.replaceChildren();
    const query = pickerSearch.value.trim().toLowerCase();
    const visible = sprites.filter((id) => id.toLowerCase().includes(query));
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.textContent = sprites.length ? 'No matches.' : 'No sprite sheets.';
      pickerSheets.append(empty);
    }
    for (const id of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id;
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
    const entries = pickerType === 'animation' ? animationsUsingSheet(pickerClips, sheetId) : [];
    if (pickerType === 'animation' && entries.length === 0) {
      pickerStatus.textContent = 'No animations use this sprite sheet.';
      return;
    }
    try {
      const sheet = await loadSheet(sheetId);
      if (!alive || !picker.open || token !== pickerToken) return;
      pickerStatus.textContent = '';
      const items: { visual: PropVisual; frame: number; title: string }[] =
        pickerType === 'sprite'
          ? sheet.sprites.map((_frame, index) => ({
              visual: { type: 'sprite', id: sheetId, index },
              frame: index,
              title: `FRAME ${index + 1}`,
            }))
          : entries.map(({ animation, frame }) => ({
              visual: { type: 'animation', id: animation.id },
              frame: frame.index,
              title: animation.id,
            }));
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'prop-picker-card';
        button.title = item.title;
        const thumb = document.createElement('canvas');
        thumb.width = 144;
        thumb.height = 100;
        paintSprite(thumb, sheet, item.frame);
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
      if (alive && picker.open && token === pickerToken) pickerStatus.textContent = message(error);
    }
  }

  async function openPicker(type: PropVisual['type']): Promise<void> {
    if (!current || picker.open) return;
    pickerType = type;
    pickerChoice = null;
    pickerSheet = null;
    pickerClips = [];
    pickerSearch.value = '';
    $<HTMLElement>('#prop-picker-title').textContent =
      type === 'sprite' ? 'CHOOSE SPRITE' : 'CHOOSE ANIMATION';
    $<HTMLElement>('#prop-picker-results-title').textContent =
      type === 'sprite' ? 'SPRITES' : 'ANIMATIONS';
    pickerStatus.textContent = 'Loading assets…';
    pickerResults.replaceChildren();
    pickerSheets.replaceChildren();
    pickerOk.disabled = true;
    picker.showModal();
    const token = ++pickerToken;
    try {
      const [sheets, clips] = await Promise.all([
        requestJson<{ files: string[] }>('/api/sprites'),
        type === 'animation'
          ? requestJson<{ files: string[] }>('/api/animations')
          : Promise.resolve({ files: [] }),
      ]);
      if (!alive || !picker.open || token !== pickerToken) return;
      sprites = sheets.files;
      animations = type === 'animation' ? clips.files : animations;
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
                animationsUsingSheet([clip], pickerSheet ?? '').length > 0,
            ))
      )
        pickerChoice = { ...existing };
      renderPickerSheets();
      if (!pickerSheet) pickerStatus.textContent = 'Create a sprite sheet first.';
      else void renderPickerResults();
    } catch (error) {
      if (alive && picker.open && token === pickerToken) pickerStatus.textContent = message(error);
    }
  }

  async function drawPreview(): Promise<void> {
    const token = ++previewToken;
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!current || !palette) return;
    try {
      const frame = await loadVisualFrame(current.visual);
      if (!alive || token !== previewToken) return;
      if (frame) paintSprite(canvas, frame.sprite, frame.index, current, showBlocked);
      else if (showBlocked) {
        const size = Math.min(
          30,
          (canvas.width - 12) / current.width,
          (canvas.height - 12) / current.height,
        );
        paintBlockedOverlay(
          context,
          current,
          Math.floor((canvas.width - current.width * size) / 2),
          Math.floor((canvas.height - current.height * size) / 2),
          size,
          size,
        );
      }
    } catch (error) {
      if (alive && token === previewToken) status.textContent = message(error);
    }
  }

  function renderBlockEditor(): void {
    if (!blockProp || !blockDraft) return;
    const ctx = blockCanvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = blockProp;
    const sprite = blockSprite?.sprite;
    const cells = sprite && blockSprite ? flattenSprite(sprite, blockSprite.index) : null;
    const native = terminalCellAtZoom(ctx, 1, sprite?.font);
    const scale = Math.min((blockCellPx - 6) / native.width, (blockCellPx - 6) / native.height);
    const grid = terminalCellAtZoom(ctx, scale, sprite?.font);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const cell =
          sprite && cells && x < sprite.width && y < sprite.height
            ? cells[y * sprite.width + x]
            : null;
        const px = x * blockCellPx;
        const py = y * blockCellPx;
        ctx.fillStyle = cell && palette ? (paletteRgb(palette, cell.bg) ?? '#102b2a') : '#102b2a';
        ctx.fillRect(px, py, blockCellPx, blockCellPx);
        if (cell && cell.ch !== ' ') {
          ctx.fillStyle = palette ? (paletteRgb(palette, cell.fg) ?? '#e0e9db') : '#e0e9db';
          drawTerminalGlyph(
            ctx,
            grid,
            cell.ch,
            px + (blockCellPx - grid.width) / 2,
            py + (blockCellPx - grid.height) / 2,
          );
        }
        if (blockDraft.has(index)) {
          ctx.fillStyle = 'rgba(235, 88, 79, 0.55)';
          ctx.fillRect(px, py, blockCellPx, blockCellPx);
        }
        ctx.strokeStyle = blockDraft.has(index) ? '#ffae95' : '#5b786c';
        ctx.strokeRect(px + 0.5, py + 0.5, blockCellPx - 1, blockCellPx - 1);
      }
    }
    $<HTMLElement>('#prop-block-status').textContent =
      `${blockDraft.size} of ${width * height} cells blocked`;
  }

  function blockPoint(event: PointerEvent): { x: number; y: number } | null {
    if (!blockProp) return null;
    const rect = blockCanvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * blockProp.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * blockProp.height);
    return x >= 0 && x < blockProp.width && y >= 0 && y < blockProp.height ? { x, y } : null;
  }

  function paintBlockLine(
    from: { x: number; y: number },
    to: { x: number; y: number },
    blocked: boolean,
  ): void {
    if (!blockProp || !blockDraft) return;
    let { x, y } = from;
    const dx = Math.abs(to.x - x);
    const dy = Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let error = dx - dy;
    while (true) {
      const index = y * blockProp.width + x;
      if (blocked) blockDraft.add(index);
      else blockDraft.delete(index);
      if (x === to.x && y === to.y) break;
      const twice = 2 * error;
      if (twice > -dy) {
        error -= dy;
        x += sx;
      }
      if (twice < dx) {
        error += dx;
        y += sy;
      }
    }
    renderBlockEditor();
  }

  async function openBlockEditor(): Promise<void> {
    if (!current || blockDialog.open) return;
    blockProp = current;
    blockDraft = new Set(current.blockedCells);
    blockSprite = null;
    // Keep the visible cells large without allocating an enormous backing canvas for big props.
    blockCellPx = Math.min(
      BLOCK_CELL_PX,
      Math.floor(4096 / Math.max(current.width, current.height)),
    );
    blockCanvas.width = current.width * blockCellPx;
    blockCanvas.height = current.height * blockCellPx;
    blockCanvas.style.width = `${current.width * BLOCK_CELL_PX}px`;
    blockCanvas.style.height = `${current.height * BLOCK_CELL_PX}px`;
    blockCanvas.style.imageRendering = blockCellPx < BLOCK_CELL_PX ? 'pixelated' : '';
    blockDialog.showModal();
    renderBlockEditor();
    const token = ++blockToken;
    try {
      const frame = await loadVisualFrame(current.visual);
      if (!alive || !blockDialog.open || token !== blockToken) return;
      blockSprite = frame;
      renderBlockEditor();
    } catch (error) {
      if (alive && blockDialog.open && token === blockToken)
        $<HTMLElement>('#prop-block-status').textContent =
          `Could not load visual: ${message(error)}`;
    }
  }

  async function renderDefaultSize(): Promise<void> {
    const hint = $<HTMLElement>('#prop-default-size');
    const visual = current?.visual;
    const token = ++defaultSizeToken;
    if (!visual) {
      hint.textContent = '';
      return;
    }
    hint.textContent = 'Default size: loading…';
    try {
      const size = await visualSize(visual);
      if (!alive || token !== defaultSizeToken) return;
      hint.textContent = size
        ? `Default size: ${size.width} × ${size.height} cells${visual.type === 'animation' ? ' (first visible frame)' : ''}`
        : 'Default size unavailable: animation has no visible frame.';
    } catch (error) {
      if (alive && token === defaultSizeToken)
        hint.textContent = `Default size unavailable: ${message(error)}`;
    }
  }

  function render(): void {
    renderList();
    fields.hidden = !current;
    $<HTMLButtonElement>('#save-prop').disabled = !current;
    $<HTMLButtonElement>('#delete-prop').disabled = !current;
    $<HTMLElement>('#prop-id').textContent = current?.id ?? 'NO PROP';
    if (!current) {
      ++defaultSizeToken;
      return;
    }
    visualType.value = current.visual.type;
    $<HTMLElement>('#prop-visual-label').textContent =
      current.visual.type === 'sprite'
        ? `${current.visual.id} · frame ${current.visual.index + 1}`
        : current.visual.id;
    const editLink = $<HTMLAnchorElement>('#edit-prop-visual');
    editLink.href = propVisualEditHref(current.visual);
    editLink.textContent =
      current.visual.type === 'sprite' ? 'EDIT SPRITESHEET ↗' : 'EDIT ANIMATION ↗';
    $<HTMLInputElement>('#prop-width').value = String(current.width);
    $<HTMLInputElement>('#prop-height').value = String(current.height);
    $<HTMLElement>('#prop-block-count').textContent =
      `${current.blockedCells.length} of ${current.width * current.height} cells blocked`;
    const showBlocksButton = $<HTMLButtonElement>('#prop-show-blocks');
    showBlocksButton.textContent = showBlocked ? 'HIDE BLOCKED CELLS' : 'SHOW BLOCKED CELLS';
    showBlocksButton.setAttribute('aria-pressed', String(showBlocked));
    $<HTMLInputElement>('#prop-ground').value = String(current.groundOffsetY);
    $<HTMLInputElement>('#prop-depth').value = String(current.depthOffset);
    void renderDefaultSize();
    void drawPreview();
  }

  async function refresh(): Promise<void> {
    const [props, sheets, clips, colors] = await Promise.all([
      requestJson<{ files: string[] }>('/api/props'),
      requestJson<{ files: string[] }>('/api/sprites'),
      requestJson<{ files: string[] }>('/api/animations'),
      requestJson<PaletteDocument>('/api/palette'),
    ]);
    if (!alive) return;
    files = props.files;
    sprites = sheets.files;
    animations = clips.files;
    palette = colors;
    render();
  }

  async function open(id: string): Promise<void> {
    if (current?.id === id) return;
    if (dirty() && !(await confirmModal('Discard unsaved prop changes?', 'DISCARD'))) return;
    const token = ++loading;
    try {
      const prop = await requestJson<PropDocument>(`/api/props/${encodeURIComponent(id)}`);
      if (!alive || token !== loading) return;
      current = prop;
      saved = structuredClone(prop);
      status.textContent = `Opened ${id}`;
      setEditorAssetUrl(id);
      render();
    } catch (error) {
      if (alive && token === loading) status.textContent = message(error);
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
        const merged = mergeJson(sent, current, stored);
        if (merged.ok) {
          current = merged.value;
          saved = stored;
          status.textContent = `Saved ${stored.id}`;
          render();
        } else status.textContent = `Saved ${stored.id}; newer edits need review`;
      }
      if (alive) await refresh();
    } catch (error) {
      if (!alive) return;
      status.textContent = message(error);
      if (error instanceof ApiError && error.status === 409) {
        await alertModal(`${message(error)}. Your unsaved prop is still open.`);
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
  $<HTMLButtonElement>('#choose-prop-visual').addEventListener('click', () => {
    if (current) void openPicker(current.visual.type);
  });
  pickerSearch.addEventListener('input', renderPickerSheets);
  const closePicker = () => picker.close();
  $<HTMLButtonElement>('#prop-picker-close').addEventListener('click', closePicker);
  $<HTMLButtonElement>('#prop-picker-cancel').addEventListener('click', closePicker);
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
        const size = changed ? await visualSize(selected) : null;
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
          pickerStatus.textContent = message(error);
          pickerOk.disabled = false;
        }
      }
    })();
  });
  function toggleBlockedPreview(): void {
    showBlocked = !showBlocked;
    const button = $<HTMLButtonElement>('#prop-show-blocks');
    button.textContent = showBlocked ? 'HIDE BLOCKED CELLS' : 'SHOW BLOCKED CELLS';
    button.setAttribute('aria-pressed', String(showBlocked));
    void drawPreview();
  }
  $<HTMLButtonElement>('#prop-show-blocks').addEventListener('click', toggleBlockedPreview);
  canvas.addEventListener('pointerdown', () => canvas.focus());
  canvas.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    toggleBlockedPreview();
  });
  $<HTMLButtonElement>('#edit-prop-blocks').addEventListener('click', () => void openBlockEditor());
  const closeBlockEditor = () => blockDialog.close();
  $<HTMLButtonElement>('#prop-block-close').addEventListener('click', closeBlockEditor);
  $<HTMLButtonElement>('#prop-block-cancel').addEventListener('click', closeBlockEditor);
  blockDialog.addEventListener('close', () => {
    ++blockToken;
    blockDraft = null;
    blockProp = null;
    blockPainting = null;
    blockLast = null;
  });
  $<HTMLButtonElement>('#prop-block-clear').addEventListener('click', () => {
    if (!blockDraft) return;
    blockDraft.clear();
    renderBlockEditor();
  });
  $<HTMLButtonElement>('#prop-block-all').addEventListener('click', () => {
    if (!blockDraft || !blockProp) return;
    blockDraft = new Set(
      Array.from({ length: blockProp.width * blockProp.height }, (_, index) => index),
    );
    renderBlockEditor();
  });
  $<HTMLButtonElement>('#prop-block-apply').addEventListener('click', () => {
    if (!blockDraft || !blockProp || current !== blockProp) return;
    current.blockedCells = [...blockDraft].sort((a, b) => a - b);
    blockDialog.close();
    render();
  });
  blockCanvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !blockDraft || !blockProp) return;
    const point = blockPoint(event);
    if (!point) return;
    event.preventDefault();
    blockCanvas.focus();
    blockCanvas.setPointerCapture(event.pointerId);
    blockPainting = !blockDraft.has(point.y * blockProp.width + point.x);
    blockLast = point;
    paintBlockLine(point, point, blockPainting);
  });
  blockCanvas.addEventListener('pointermove', (event) => {
    if (blockPainting === null || !blockLast) return;
    const point = blockPoint(event);
    if (!point) return;
    paintBlockLine(blockLast, point, blockPainting);
    blockLast = point;
  });
  const finishBlockStroke = () => {
    blockPainting = null;
    blockLast = null;
  };
  blockCanvas.addEventListener('pointerup', finishBlockStroke);
  blockCanvas.addEventListener('pointercancel', finishBlockStroke);
  for (const [selector, field] of [
    ['#prop-width', 'width'],
    ['#prop-height', 'height'],
    ['#prop-ground', 'groundOffsetY'],
    ['#prop-depth', 'depthOffset'],
  ] as const) {
    const input = $<HTMLInputElement>(selector);
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
    });
  }
  search.addEventListener('input', renderList);
  $<HTMLButtonElement>('#save-prop').addEventListener('click', () => void save());
  $<HTMLButtonElement>('#new-prop').addEventListener('click', () => {
    void (async () => {
      const id = await askId('New prop id');
      if (!id) return;
      if (!isAssetId(id)) return void alertModal('Use a short lowercase id');
      if (files.includes(id)) return void alertModal('An asset with that id already exists');
      if (dirty() && !(await confirmModal('Discard unsaved prop changes?', 'DISCARD'))) return;
      const visual: PropVisual | null = sprites[0]
        ? { type: 'sprite', id: sprites[0], index: 0 }
        : animations[0]
          ? { type: 'animation', id: animations[0] }
          : null;
      if (!visual) return void alertModal('Create a sprite or animation before creating a prop');
      const token = ++loading;
      let size: { width: number; height: number } | null;
      try {
        size = await visualSize(visual);
      } catch (error) {
        if (alive && token === loading) status.textContent = message(error);
        return;
      }
      if (!alive || token !== loading) return;
      current = { ...createProp(id, visual), ...(size ?? {}) };
      saved = null;
      status.textContent = `New prop ${id}`;
      setEditorAssetUrl(null);
      render();
    })();
  });
  $<HTMLButtonElement>('#delete-prop').addEventListener('click', () => {
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
        current = null;
        saved = null;
        status.textContent = 'Prop deleted';
        setEditorAssetUrl(null);
        await refresh();
      } catch (error) {
        if (alive) status.textContent = message(error);
      }
    })();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !root.isConnected ||
      picker.open ||
      blockDialog.open ||
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== 's'
    )
      return;
    event.preventDefault();
    void save();
  };
  document.addEventListener('keydown', onKeyDown);
  void preloadSpriteFonts()
    .then(async () => {
      await refresh();
      if (!alive) return;
      const requested = new URLSearchParams(location.search).get('id');
      if (requested) {
        if (isAssetId(requested) && files.includes(requested)) await open(requested);
        else status.textContent = `Prop ${requested} not found`;
      }
    })
    .catch((error: unknown) => {
      if (alive) status.textContent = message(error);
    });
  return () => {
    alive = false;
    ++loading;
    ++pickerToken;
    ++previewToken;
    ++defaultSizeToken;
    ++blockToken;
    if (picker.open) picker.close();
    if (blockDialog.open) blockDialog.close();
    document.removeEventListener('keydown', onKeyDown);
    setDirtyGuard(null);
  };
}
