import { firstAnimationSheet, wrappedFrameIndex } from '../../animation/animation-navigation.js';
import { paletteRgb, type PaletteDocument } from '../../palette.js';
import {
  createAnimation,
  animationFrameFlips,
  animationLabelError,
  DEFAULT_ANIMATION_DURATION_MS,
  flattenSprite,
  isAssetId,
  isInvisibleFrame,
  MAX_FRAME_DURATION_MS,
  MAX_FRAMES,
  type AnimationDocument,
  type AnimationFrame,
  type SpriteDocument,
} from '../../schema.js';
import {
  preloadSpriteFonts,
  spriteFontFamily,
  spriteFontNativePx,
  terminalCellAtZoom,
  terminalFont,
} from '../../terminal-cell.js';
import { drawTerminalGlyph, fillTerminalCell } from '../terminal-renderer.js';
import { ApiError, jsonRequest, requestJson } from '../api.js';
import { saveDraft } from '../save.js';
import { mergeJson } from '../../safe-save.js';
import { alertModal, askAssetMeta, askFrameDuration, confirmModal, isModalOpen } from '../modal.js';
import { askId, pageShell, setDirtyGuard, setEditorAssetUrl } from '../shell.js';
import { createAssetTree } from '../asset-tree.js';
import type { AssetFolders } from '../../asset-folders.js';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 8;
const ZOOM_STEPS = [MIN_ZOOM, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, MAX_ZOOM];
const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 72;
const ICON_WIDTH = 84;
const ICON_HEIGHT = 64;

type DragPayload =
  | { kind: 'sprite'; sprite: string; index: number }
  | { kind: 'reel'; from: number };

export function mountAnimation(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Animation',
    `<aside class="anim-library" aria-label="Animations">
        <input id="anim-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search animations" autocomplete="off" spellcheck="false">
        <div class="asset-tree-toolbar"><span>FOLDERS</span><div class="asset-tree-toolbar-actions"><button id="new-animation-folder" type="button" title="New folder" aria-label="New folder">+ FOLDER</button><button id="new-character-animations" type="button" title="Create character animations" aria-label="Create character animations">+ CHAR</button></div></div>
        <div id="anim-list" class="anim-library-list"></div>
      </aside>
      <div id="animation-library-resizer" class="animation-library-resizer" role="separator" aria-label="Resize animation folders" aria-orientation="vertical" aria-controls="anim-list" tabindex="0" title="Drag to resize folders; double-click to reset"></div>
      <div class="anim-app">
        <div class="toolbar-row">
          <button type="button" id="new-animation">NEW</button>
          <button type="button" id="save-animation">SAVE</button>
          <button type="button" id="rename-animation">META…</button>
          <button type="button" id="copy-animation">COPY</button>
          <button type="button" id="delete-animation">DELETE</button>
          <div class="anim-play-controls">
            <span id="animation-id" class="animation-id">NO CLIP</span>
            <button type="button" id="play" disabled>PLAY</button>
            <button type="button" id="stop" disabled>STOP</button>
          </div>
        </div>
        <div class="anim-workspace">
          <div class="anim-stage">
            <aside class="anim-controls" aria-label="Clip controls">
              <label class="anim-control-check"><input id="loop" type="checkbox" disabled> LOOP</label>
              <label class="anim-control-check"><input id="anim-flip-h" type="checkbox" disabled> FLIP-H</label>
              <label class="anim-control-check"><input id="anim-flip-v" type="checkbox" disabled> FLIP-V</label>
              <label class="anim-control-field">DEFAULT MS
                <input id="default-ms" class="text-input" type="number" min="1" max="600000" value="135" disabled>
              </label>
              <button type="button" id="modify-ms-all" disabled>MODIFY MS ALL</button>
              <button type="button" id="add-invisible" disabled>ADD INVISIBLE</button>
            </aside>
            <section class="anim-preview">
              <div class="anim-preview-bar">
                <p id="animation-status" class="page-copy">Create an animation or open one.</p>
                <div class="workspace-controls">
                  <button type="button" id="zoom-out">−</button>
                  <span id="zoom-label">100%</span>
                  <button type="button" id="zoom-in">+</button>
                  <button type="button" id="fit">FIT</button>
                </div>
              </div>
              <div class="anim-preview-wrap"><canvas id="preview"></canvas></div>
            </section>
          </div>
          <section id="reel" class="anim-reel"></section>
          <section class="anim-picker">
            <div class="anim-sheet-pane">
               <input id="sheet-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search spritesheets" autocomplete="off" spellcheck="false">
               <div id="sheet-list" class="anim-sheets asset-list"></div>
               <a id="edit-selected-sheet" class="anim-edit-sheet" href="/art" target="_blank" rel="noopener noreferrer" hidden>EDIT SPRITESHEET ↗</a>
            </div>
            <div id="sprite-icons" class="anim-sprites"></div>
          </section>
        </div>
      </div>
      <dialog id="character-animation-dialog" aria-labelledby="character-animation-title">
        <form id="character-animation-form">
          <h2 id="character-animation-title">NEW CHARACTER ANIMATIONS</h2>
          <label class="character-animation-field">FOLDER NAME
            <input id="character-animation-name" class="text-input" type="text" autocomplete="off" spellcheck="false" required>
          </label>
          <label class="character-animation-field">BASE SPRITE SHEET
            <input id="character-animation-search" class="text-input" type="search" placeholder="SEARCH SPRITE SHEETS" autocomplete="off" spellcheck="false">
          </label>
          <p class="page-copy">Use a 3×3 sheet with at least 16 frames in the ada3x3 order.</p>
          <div id="character-animation-sheets" class="character-animation-sheets" role="group" aria-label="Base sprite sheet"></div>
          <p id="character-animation-error" class="character-animation-error" role="alert" hidden></p>
          <div class="character-animation-actions">
            <button id="character-animation-cancel" type="button">CANCEL</button>
            <button id="character-animation-create" type="submit">CREATE 12 ANIMATIONS</button>
          </div>
        </form>
      </dialog>
      <div id="toast-stack" class="toast-stack"></div>`,
  );
  root.querySelector('.simple-main')?.classList.add('animation-main');

  const main = root.querySelector<HTMLElement>('.animation-main');
  const library = root.querySelector<HTMLElement>('.anim-library');
  const resizer = root.querySelector<HTMLElement>('#animation-library-resizer');
  if (!main || !library || !resizer) throw new Error('Missing animation library layout');
  const widthKey = 'incanterm-animation-library-width';
  const defaultWidth = 200;
  const minimumWidth = 160;
  const clampWidth = (width: number) =>
    Math.max(minimumWidth, Math.min(width, Math.max(minimumWidth, main.clientWidth - 330)));
  const setLibraryWidth = (width: number, persist = true) => {
    const next = clampWidth(width);
    library.style.width = `${next}px`;
    resizer.setAttribute('aria-valuenow', String(next));
    if (persist) localStorage.setItem(widthKey, String(next));
  };
  resizer.setAttribute('aria-valuemin', String(minimumWidth));
  resizer.setAttribute('aria-valuemax', String(clampWidth(Number.MAX_SAFE_INTEGER)));
  const storedWidth = Number(localStorage.getItem(widthKey));
  setLibraryWidth(
    Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : defaultWidth,
    false,
  );
  let drag: { pointerId: number; startX: number; startWidth: number } | null = null;
  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: library.getBoundingClientRect().width,
    };
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add('dragging');
  });
  resizer.addEventListener('pointermove', (event) => {
    if (drag?.pointerId === event.pointerId)
      setLibraryWidth(drag.startWidth + event.clientX - drag.startX, false);
  });
  const endResize = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    resizer.classList.remove('dragging');
    setLibraryWidth(library.getBoundingClientRect().width);
  };
  resizer.addEventListener('pointerup', endResize);
  resizer.addEventListener('pointercancel', endResize);
  resizer.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    setLibraryWidth(
      event.key === 'Home'
        ? defaultWidth
        : library.getBoundingClientRect().width + (event.key === 'ArrowRight' ? step : -step),
    );
  });
  resizer.addEventListener('dblclick', () => setLibraryWidth(defaultWidth));
  const resizeObserver = new ResizeObserver(() => {
    resizer.setAttribute('aria-valuemax', String(clampWidth(Number.MAX_SAFE_INTEGER)));
    setLibraryWidth(library.getBoundingClientRect().width, false);
  });
  resizeObserver.observe(main);

  const $ = <T extends Element>(selector: string) => {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element as T;
  };
  const canvas = $<HTMLCanvasElement>('#preview');
  const wrap = $<HTMLElement>('.anim-preview-wrap');
  const reel = $<HTMLElement>('#reel');
  const sheetList = $<HTMLElement>('#sheet-list');
  const editSelectedSheet = $<HTMLAnchorElement>('#edit-selected-sheet');
  const sheetSearch = $<HTMLInputElement>('#sheet-search');
  const iconList = $<HTMLElement>('#sprite-icons');
  const status = $<HTMLElement>('#animation-status');
  const idLabel = $<HTMLElement>('#animation-id');
  const loopInput = $<HTMLInputElement>('#loop');
  const flipHInput = $<HTMLInputElement>('#anim-flip-h');
  const flipVInput = $<HTMLInputElement>('#anim-flip-v');
  const defaultMsInput = $<HTMLInputElement>('#default-ms');
  const zoomLabel = $<HTMLElement>('#zoom-label');
  const animList = $<HTMLElement>('#anim-list');
  const animSearch = $<HTMLInputElement>('#anim-search');
  const characterDialog = $<HTMLDialogElement>('#character-animation-dialog');
  const characterName = $<HTMLInputElement>('#character-animation-name');
  const characterSearch = $<HTMLInputElement>('#character-animation-search');
  const characterSheets = $<HTMLElement>('#character-animation-sheets');
  const characterError = $<HTMLElement>('#character-animation-error');
  const characterCreate = $<HTMLButtonElement>('#character-animation-create');
  let characterSprite: string | null = null;
  const assetTree = createAssetTree({
    list: animList,
    search: animSearch,
    label: 'ANIMATIONS',
    storageKey: 'incanterm-animation-folders-expanded',
    onSelect: (id) => void openAnimation(id),
    onCreateAsset: (folder) => void createNewAnimation(folder),
    onChange: async (change) => {
      const folders = await requestJson<AssetFolders>('/api/animation-folders', jsonRequest('POST', change));
      if (change.action === 'delete') {
        if (current && change.expectedIds.includes(current.id)) {
          ++openToken;
          current = null;
          assetTree.select(null);
          saved = '';
          setEditorAssetUrl(null);
          inspect = null;
          playIndex = 0;
          stop();
          renderReel();
          refreshToolbar();
          void drawPreview();
        }
        await reloadLists();
      }
      return folders;
    },
    askName: askId,
    confirmDelete: (folder, clips, subfolders) => confirmModal(
      clips.length || subfolders.length
        ? `Delete folder ${folder} and everything inside it?${subfolders.length ? `\nSubfolders: ${subfolders.join(', ')}` : ''}${clips.length ? `\nAnimations to delete (${clips.length}):\n${clips.map(({ label, id }) => `• ${label} (${id})`).join('\n')}` : ''}\nThis cannot be undone.`
        : `Delete empty folder ${folder}?`,
      'DELETE',
    ),
    onError: (message) => {
      setStatus(message);
      toast(message, true);
    },
  });
  $<HTMLButtonElement>('#new-animation-folder').addEventListener(
    'click',
    () => void assetTree.createFolder(),
  );
  $<HTMLButtonElement>('#new-character-animations').addEventListener('click', () => {
    if (assetOperation || characterDialog.open) return;
    characterName.value = '';
    characterSearch.value = '';
    characterSprite = null;
    characterError.hidden = true;
    characterSheets.replaceChildren();
    if (sprites.length === 0) characterSheets.textContent = 'No sprite sheets available.';
    for (const id of sprites) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'character-animation-sheet';
      button.dataset.id = id;
      button.setAttribute('aria-label', `Select ${spriteLabels[id] ?? id}`);
      button.setAttribute('aria-pressed', 'false');
      const preview = document.createElement('canvas');
      preview.width = THUMB_WIDTH;
      preview.height = THUMB_HEIGHT;
      const label = document.createElement('span');
      label.textContent = spriteLabels[id] ?? id;
      button.append(preview, label);
      button.addEventListener('click', () => {
        characterSprite = id;
        characterSheets.querySelectorAll<HTMLButtonElement>('button').forEach((option) => {
          const selected = option === button;
          option.classList.toggle('selected', selected);
          option.setAttribute('aria-pressed', String(selected));
        });
        characterError.hidden = true;
      });
      characterSheets.append(button);
      void paintThumb(preview, id, 0);
    }
    characterDialog.showModal();
    characterName.focus();
  });
  characterSearch.addEventListener('input', () => {
    const query = characterSearch.value.trim().toLowerCase();
    let matches = 0;
    characterSheets.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.hidden = !(spriteLabels[button.dataset.id ?? ''] ?? button.dataset.id ?? '')
        .toLowerCase()
        .includes(query);
      if (!button.hidden) matches++;
    });
    const empty = characterSheets.querySelector<HTMLElement>('.character-animation-empty');
    empty?.remove();
    if (matches === 0 && sprites.length > 0) {
      const message = document.createElement('p');
      message.className = 'character-animation-empty';
      message.textContent = 'No matching sprite sheets.';
      characterSheets.append(message);
    }
  });
  $<HTMLButtonElement>('#character-animation-cancel').addEventListener('click', () => {
    if (!assetOperation) characterDialog.close();
  });
  characterDialog.addEventListener('cancel', (event) => {
    if (assetOperation) event.preventDefault();
  });
  $<HTMLFormElement>('#character-animation-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (assetOperation) return;
    const name = characterName.value.trim();
    if (!isAssetId(name)) {
      characterError.textContent = 'Use a short lowercase folder name.';
      characterError.hidden = false;
      characterName.focus();
      return;
    }
    if (!characterSprite) {
      characterError.textContent = 'Select a base sprite sheet.';
      characterError.hidden = false;
      characterSearch.focus();
      return;
    }
    const sprite = characterSprite;
    assetOperation = true;
    characterCreate.disabled = true;
    refreshToolbar();
    void (async () => {
      try {
        const result = await requestJson<{ folder: string; ids: string[] }>(
          '/api/animation-folders',
          jsonRequest('POST', { action: 'create-character-animations', folder: '', name, sprite }),
        );
        if (!alive) return;
        characterDialog.close();
        await reloadLists();
        assetTree.expand(result.folder);
        toast(`Created ${result.ids.length} character animations in ${result.folder}`);
      } catch (error) {
        characterError.textContent =
          error instanceof Error ? error.message : 'Could not create animations';
        characterError.hidden = false;
      } finally {
        assetOperation = false;
        characterCreate.disabled = false;
        refreshToolbar();
      }
    })();
  });
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('Canvas is unavailable');
  const ctx: CanvasRenderingContext2D = drawing;

  let animations: string[] = [];
  let animationLabels: Record<string, string> = {};
  let sprites: string[] = [];
  let spriteLabels: Record<string, string> = {};
  let palette: PaletteDocument | null = null;
  let current: AnimationDocument | null = null;
  let saved = '';
  let saving = false;
  let autoSavePending: string | null = null;
  let assetOperation = false;
  let openToken = 0;
  let timer = 0;
  let playing = false;
  let playIndex = 0;
  let inspect: { sprite: string; index: number } | null = null;
  let selectedSheet: string | null = null;
  let zoom = 1;
  let autoFit = true;
  let viewW = 0;
  let viewH = 0;
  let drawToken = 0;
  let iconToken = 0;
  let alive = true;
  const spriteCache = new Map<string, SpriteDocument>();

  const dirty = () => current !== null && JSON.stringify(current) !== saved;
  setDirtyGuard(
    async () => !dirty() || confirmModal('Discard unsaved animation changes?', 'DISCARD'),
  );

  function setStatus(message: string): void {
    status.textContent = message;
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

  function isTextField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    if (target instanceof HTMLInputElement) {
      return ['text', 'search', 'password', 'url', 'tel', 'email', 'number'].includes(target.type);
    }
    return target.isContentEditable;
  }

  function refreshToolbar(): void {
    idLabel.textContent = current?.label ?? 'NO CLIP';
    loopInput.checked = current?.loop ?? false;
    loopInput.disabled = !current;
    flipHInput.checked = current?.flipH ?? false;
    flipHInput.disabled = !current;
    flipVInput.checked = current?.flipV ?? false;
    flipVInput.disabled = !current;
    defaultMsInput.disabled = !current;
    defaultMsInput.value = String(current?.defaultDurationMs ?? DEFAULT_ANIMATION_DURATION_MS);
    const open = current !== null;
    setDisabled('#save-animation', !open);
    setDisabled('#rename-animation', !open || assetOperation);
    setDisabled('#copy-animation', !open || assetOperation);
    setDisabled('#delete-animation', !open);
    setDisabled('#play', !current || current.frames.length === 0);
    setDisabled('#stop', !playing);
    setDisabled('#modify-ms-all', !current || current.frames.length === 0);
    setDisabled('#add-invisible', !open);
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setDisabled(selector: string, disabled: boolean): void {
    const button = root.querySelector<HTMLButtonElement>(selector);
    if (button) button.disabled = disabled;
  }

  async function loadSprite(id: string): Promise<SpriteDocument | null> {
    const cached = spriteCache.get(id);
    if (cached) return cached;
    if (!sprites.includes(id)) return null;
    try {
      const sprite = await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`);
      spriteCache.set(id, sprite);
      await document.fonts
        .load(terminalFont(spriteFontNativePx(sprite.font), spriteFontFamily(sprite.font)))
        .catch(() => undefined);
      return sprite;
    } catch {
      return null;
    }
  }

  function containZoom(
    sprite: SpriteDocument,
    width: number,
    height: number,
    cap = MAX_ZOOM,
  ): number {
    const unit = terminalCellAtZoom(ctx, 1, sprite.font);
    const fitted = Math.min(
      width / (sprite.width * unit.width),
      height / (sprite.height * unit.height),
    );
    return Math.max(0.1, Math.min(cap, fitted));
  }

  function paintSprite(
    target: CanvasRenderingContext2D,
    sprite: SpriteDocument,
    frameIndex: number,
    width: number,
    height: number,
    scale: number,
    flipH = false,
    flipV = false,
  ): void {
    if (!palette) return;
    target.fillStyle = paletteRgb(palette, 'black') ?? '#000';
    target.fillRect(0, 0, width, height);
    const grid = terminalCellAtZoom(target, scale, sprite.font);
    const originX = Math.floor((width - sprite.width * grid.width) / 2);
    const originY = Math.floor((height - sprite.height * grid.height) / 2);
    const cells = flattenSprite(sprite, frameIndex);
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index];
      if (!cell) continue;
      const column = index % sprite.width;
      const row = Math.floor(index / sprite.width);
      const x = originX + (flipH ? sprite.width - 1 - column : column) * grid.width;
      const y = originY + (flipV ? sprite.height - 1 - row : row) * grid.height;
      target.fillStyle = paletteRgb(palette, cell.bg) ?? '#000';
      fillTerminalCell(target, grid, x, y);
      if (cell.ch !== ' ') {
        target.fillStyle = paletteRgb(palette, cell.fg) ?? '#fff';
        drawTerminalGlyph(target, grid, cell.ch, x, y);
      }
    }
  }

  function sizePreview(): void {
    const rect = wrap.getBoundingClientRect();
    viewW = rect.width;
    viewH = rect.height;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewW * ratio));
    canvas.height = Math.max(1, Math.round(viewH * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function clearPreview(): void {
    ctx.fillStyle = palette ? (paletteRgb(palette, 'black') ?? '#000') : '#000';
    ctx.fillRect(0, 0, viewW, viewH);
  }

  function viewedFrame(): AnimationFrame | { sprite: string; index: number } | null {
    if (inspect) return inspect;
    if (!current || current.frames.length === 0) return null;
    return current.frames[Math.min(playIndex, current.frames.length - 1)] ?? null;
  }

  function visibleSprite(
    frame: AnimationFrame | { sprite: string; index: number },
  ): {
    sprite: string;
    index: number;
    durationMs?: number;
    flipH?: boolean;
    flipV?: boolean;
  } | null {
    if ('invisible' in frame && frame.invisible === true) return null;
    if (!('sprite' in frame)) return null;
    return frame;
  }

  async function drawPreview(): Promise<void> {
    const token = ++drawToken;
    if (!viewW || !viewH) sizePreview();
    clearPreview();
    refreshToolbar();
    const frame = viewedFrame();
    if (!current) {
      setStatus('Create an animation or open one.');
      return;
    }
    if (!frame) {
      setStatus('This clip has no frames.');
      return;
    }
    const visible = visibleSprite(frame);
    if (!visible) {
      setStatus(
        `Invisible · ${'durationMs' in frame ? frame.durationMs : DEFAULT_ANIMATION_DURATION_MS} ms`,
      );
      return;
    }
    if (!sprites.includes(visible.sprite)) {
      setStatus(
        `Missing sprite ${visible.sprite}. Save is blocked until every frame has a sprite.`,
      );
      return;
    }
    const sprite = await loadSprite(visible.sprite);
    if (!alive || token !== drawToken) return;
    if (!sprite) {
      setStatus(
        `Missing sprite ${visible.sprite}. Save is blocked until every frame has a sprite.`,
      );
      return;
    }
    if (visible.index >= sprite.sprites.length) {
      setStatus(`Sprite ${visible.sprite} has no frame ${visible.index + 1}.`);
      return;
    }
    if (autoFit && !playing) {
      zoom = containZoom(sprite, viewW, viewH);
    }
    const flips = inspect ? { flipH: false, flipV: false } : animationFrameFlips(current, visible);
    paintSprite(ctx, sprite, visible.index, viewW, viewH, zoom, flips.flipH, flips.flipV);
    const duration = visible.durationMs !== undefined ? ` · ${visible.durationMs} ms` : '';
    setStatus(
      `${visible.sprite} · ${visible.index + 1} · ${sprite.width} × ${sprite.height}${duration}`,
    );
    refreshToolbar();
  }

  function stepZoom(direction: number): void {
    const index =
      direction > 0
        ? ZOOM_STEPS.findIndex((step) => step > zoom + 0.001)
        : ZOOM_STEPS.reduce(
            (found, step, stepIndex) => (step < zoom - 0.001 ? stepIndex : found),
            -1,
          );
    if (index === -1) return;
    autoFit = false;
    zoom = ZOOM_STEPS[index] ?? zoom;
    void drawPreview();
  }

  function markPlayhead(): void {
    reel.querySelectorAll('.anim-reel-cell').forEach((cell, index) => {
      cell.classList.toggle('selected', index === playIndex);
      cell.classList.toggle('playing', playing && index === playIndex);
    });
  }

  function selectFrame(index: number): void {
    if (!current || index < 0 || index >= current.frames.length) return;
    if (playing) stop();
    inspect = null;
    playIndex = index;
    markPlayhead();
    reel
      .querySelectorAll('.anim-reel-cell')
      [index]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    void drawPreview();
  }

  function renderReel(): void {
    renderSheets();
    reel.replaceChildren();
    reel.classList.toggle('drag-over', false);
    if (!current) {
      const empty = document.createElement('div');
      empty.className = 'anim-reel-empty';
      empty.textContent = 'Create an animation to start a reel.';
      reel.append(empty);
      return;
    }
    if (current.frames.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anim-reel-empty';
      empty.textContent = 'Drag sprites here.';
      reel.append(empty);
      return;
    }
    const animation = current;
    animation.frames.forEach((frame, index) => {
      const cell = document.createElement('div');
      cell.className = 'anim-reel-cell';
      cell.draggable = true;
      cell.dataset.index = String(index);
      const thumb = document.createElement('canvas');
      thumb.width = THUMB_WIDTH;
      thumb.height = THUMB_HEIGHT;
      const meta = document.createElement('div');
      meta.className = 'anim-reel-meta';
      const label = document.createElement('span');
      if (isInvisibleFrame(frame)) {
        cell.classList.add('invisible-frame');
        label.textContent = 'INVISIBLE';
      } else {
        label.textContent = sprites.includes(frame.sprite)
          ? `${frame.sprite} · ${frame.index + 1}`
          : `${frame.sprite} (missing)`;
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'anim-reel-remove';
      remove.textContent = '×';
      remove.title = 'Remove frame';
      remove.addEventListener('click', () => removeFrame(index));
      meta.append(label, remove);
      if (!isInvisibleFrame(frame)) {
        const flips = document.createElement('div');
        flips.className = 'anim-frame-flips';
        for (const [axis, text] of [
          ['flipH', 'H'],
          ['flipV', 'V'],
        ] as const) {
          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.checked = frame[axis] ?? false;
          toggle.title = `Flip ${axis === 'flipH' ? 'horizontally' : 'vertically'} (cancels animation flip)`;
          toggle.setAttribute('aria-label', `Frame ${index + 1} flip ${text}`);
          toggle.addEventListener('change', () => {
            if (!current) return;
            frame[axis] = toggle.checked;
            void drawPreview();
            const effective = animationFrameFlips(current, frame);
            void paintThumb(thumb, frame.sprite, frame.index, effective.flipH, effective.flipV);
            autoSave();
          });
          const field = document.createElement('label');
          field.append(toggle, text);
          flips.append(field);
        }
        cell.append(flips);
      }
      const duration = document.createElement('input');
      duration.className = 'text-input';
      duration.type = 'number';
      duration.min = '1';
      duration.max = String(MAX_FRAME_DURATION_MS);
      duration.value = String(frame.durationMs);
      duration.addEventListener('pointerdown', (event) => event.stopPropagation());
      duration.addEventListener('input', () => {
        const value = Number(duration.value);
        if (!current || !Number.isInteger(value) || value < 1 || value > MAX_FRAME_DURATION_MS) {
          return;
        }
        const target = current.frames[index];
        if (target) target.durationMs = value;
      });
      duration.addEventListener('change', () => {
        if (!current) return;
        const target = current.frames[index];
        if (!target) return;
        const value = Number(duration.value);
        if (!Number.isInteger(value) || value < 1 || value > MAX_FRAME_DURATION_MS) {
          duration.value = String(target.durationMs);
          return;
        }
        target.durationMs = value;
        if (!inspect && playIndex === index) void drawPreview();
      });
      cell.append(thumb, meta, duration);
      cell.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('input, button')) return;
        selectFrame(index);
      });
      cell.addEventListener('dragstart', (event) => {
        if ((event.target as HTMLElement).closest('input, button')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData('text/plain', JSON.stringify({ kind: 'reel', from: index }));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      reel.append(cell);
      if (isInvisibleFrame(frame)) paintInvisible(thumb);
      else {
        const flips = animationFrameFlips(animation, frame);
        void paintThumb(thumb, frame.sprite, frame.index, flips.flipH, flips.flipV);
      }
    });
    markPlayhead();
  }

  function paintInvisible(target: HTMLCanvasElement): void {
    const context = target.getContext('2d');
    if (!context) return;
    const size = 8;
    for (let y = 0; y < target.height; y += size) {
      for (let x = 0; x < target.width; x += size) {
        context.fillStyle = ((x / size + y / size) | 0) % 2 === 0 ? '#143837' : '#0b2424';
        context.fillRect(x, y, size, size);
      }
    }
  }

  async function paintThumb(
    target: HTMLCanvasElement,
    spriteId: string,
    frameIndex: number,
    flipH = false,
    flipV = false,
  ): Promise<void> {
    const context = target.getContext('2d');
    if (!context || !palette) return;
    context.fillStyle = paletteRgb(palette, 'black') ?? '#000';
    context.fillRect(0, 0, target.width, target.height);
    const sprite = await loadSprite(spriteId);
    if (!alive || !sprite || frameIndex >= sprite.sprites.length) return;
    paintSprite(
      context,
      sprite,
      frameIndex,
      target.width,
      target.height,
      containZoom(sprite, target.width, target.height, 2),
      flipH,
      flipV,
    );
  }

  function usedSheetIds(): Set<string> {
    const used = new Set<string>();
    if (!current) return used;
    for (const frame of current.frames) {
      if (!isInvisibleFrame(frame)) used.add(frame.sprite);
    }
    return used;
  }

  function sheetMatches(id: string): boolean {
    const query = sheetSearch.value.trim().toLowerCase();
    return query === '' || (spriteLabels[id] ?? id).toLowerCase().includes(query);
  }

  function renderSheets(): void {
    sheetList.replaceChildren();
    const used = usedSheetIds();
    const pinned = sprites.filter((id) => used.has(id) && sheetMatches(id));
    const rest = sprites.filter((id) => !used.has(id) && sheetMatches(id));
    if (!selectedSheet || !sprites.includes(selectedSheet)) {
      selectedSheet = pinned[0] ?? rest[0] ?? null;
    }
    editSelectedSheet.hidden = selectedSheet === null;
    if (selectedSheet)
      editSelectedSheet.href = `/art?id=${encodeURIComponent(selectedSheet)}`;
    if (pinned.length === 0 && rest.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anim-picker-empty';
      empty.textContent = sprites.length === 0 ? 'No spritesheets.' : 'No matches.';
      sheetList.append(empty);
      return;
    }
    const appendSheet = (id: string, inClip: boolean) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = spriteLabels[id] ?? id;
      button.classList.toggle('active', selectedSheet === id);
      if (inClip) {
        button.classList.add('anim-sheet-used');
        button.title = 'Used in this clip';
      }
      button.addEventListener('click', () => {
        selectedSheet = id;
        renderSheets();
        void renderIcons();
      });
      sheetList.append(button);
    };
    for (const id of pinned) appendSheet(id, true);
    if (pinned.length > 0 && rest.length > 0) {
      const split = document.createElement('div');
      split.className = 'anim-sheet-split';
      sheetList.append(split);
    }
    for (const id of rest) appendSheet(id, false);
  }

  async function renderIcons(): Promise<void> {
    const token = ++iconToken;
    iconList.replaceChildren();
    if (!selectedSheet) {
      const empty = document.createElement('div');
      empty.className = 'anim-picker-empty';
      empty.textContent = 'Select a spritesheet.';
      iconList.append(empty);
      return;
    }
    const sprite = await loadSprite(selectedSheet);
    if (!alive || token !== iconToken) return;
    if (!sprite) {
      const empty = document.createElement('div');
      empty.className = 'anim-picker-empty';
      empty.textContent = `Could not load ${selectedSheet}.`;
      iconList.append(empty);
      return;
    }
    sprite.sprites.forEach((_frame, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'anim-sprite-icon';
      button.draggable = true;
      const thumb = document.createElement('canvas');
      thumb.width = ICON_WIDTH;
      thumb.height = ICON_HEIGHT;
      const label = document.createElement('span');
      label.textContent = String(index + 1);
      button.append(thumb, label);
      button.addEventListener('click', () => {
        inspect = { sprite: sprite.id, index };
        void drawPreview();
      });
      button.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData(
          'text/plain',
          JSON.stringify({ kind: 'sprite', sprite: sprite.id, index }),
        );
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
      });
      iconList.append(button);
      void paintThumb(thumb, sprite.id, index);
    });
  }

  function readPayload(event: DragEvent): DragPayload | null {
    const raw = event.dataTransfer?.getData('text/plain');
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as DragPayload;
      if (
        value.kind === 'sprite' &&
        typeof value.sprite === 'string' &&
        Number.isInteger(value.index)
      ) {
        return value;
      }
      if (value.kind === 'reel' && Number.isInteger(value.from)) return value;
      return null;
    } catch {
      return null;
    }
  }

  function dropIndex(event: DragEvent): number {
    const cells = [...reel.querySelectorAll<HTMLElement>('.anim-reel-cell')];
    if (cells.length === 0) return 0;
    for (let index = 0; index < cells.length; index++) {
      const rect = cells[index]?.getBoundingClientRect();
      if (!rect) continue;
      if (event.clientX < rect.left + rect.width / 2) return index;
    }
    return cells.length;
  }

  function markDrop(event: DragEvent): void {
    const cells = [...reel.querySelectorAll<HTMLElement>('.anim-reel-cell')];
    const index = dropIndex(event);
    cells.forEach((cell, cellIndex) => {
      cell.classList.toggle('drop-target', cellIndex === index);
    });
    reel.classList.toggle('drop-end', cells.length > 0 && index === cells.length);
    reel.classList.add('drag-over');
  }

  function clearDrop(): void {
    reel.classList.remove('drag-over', 'drop-end');
    reel.querySelectorAll('.drop-target').forEach((cell) => cell.classList.remove('drop-target'));
  }

  function insertFrame(sprite: string, index: number, at: number): void {
    if (!current) return;
    if (current.frames.length >= MAX_FRAMES) {
      setStatus(`At most ${MAX_FRAMES} frames`);
      return;
    }
    stop();
    const frame: AnimationFrame = {
      sprite,
      index,
      durationMs: current.defaultDurationMs,
    };
    current.frames.splice(at, 0, frame);
    inspect = null;
    playIndex = at;
    renderReel();
    refreshToolbar();
    void drawPreview();
    autoSave();
  }

  function moveFrame(from: number, to: number): void {
    if (!current) return;
    if (from === to || from + 1 === to) return;
    stop();
    const frames = current.frames;
    const [frame] = frames.splice(from, 1);
    if (!frame) return;
    const insert = to > from ? to - 1 : to;
    frames.splice(insert, 0, frame);
    inspect = null;
    playIndex = insert;
    renderReel();
    void drawPreview();
    autoSave();
  }

  function removeFrame(index: number): void {
    if (!current) return;
    stop();
    current.frames.splice(index, 1);
    inspect = null;
    playIndex = Math.max(0, Math.min(playIndex, current.frames.length - 1));
    renderReel();
    refreshToolbar();
    void drawPreview();
    autoSave();
  }

  function autoSave(): void {
    if (!current) return;
    if (saving) {
      autoSavePending = current.id;
      return;
    }
    void save(false);
  }

  function togglePlayback(): void {
    if (playing) stop();
    else void play();
  }

  async function play(): Promise<void> {
    if (playing) return;
    if (!current || current.frames.length === 0) return;
    inspect = null;
    if (!current.loop && playIndex >= current.frames.length - 1) playIndex = 0;
    playing = true;
    refreshToolbar();
    const step = async () => {
      if (!current || !playing) return;
      const frame = current.frames[playIndex];
      markPlayhead();
      await drawPreview();
      if (!current || !playing) return;
      const duration = frame?.durationMs ?? current.defaultDurationMs;
      timer = window.setTimeout(() => {
        if (!current || !playing) return;
        const next = playIndex + 1;
        if (next >= current.frames.length) {
          if (!current.loop) {
            playing = false;
            refreshToolbar();
            markPlayhead();
            return;
          }
          playIndex = 0;
        } else {
          playIndex = next;
        }
        void step();
      }, duration);
    };
    await step();
  }

  function stop(): void {
    window.clearTimeout(timer);
    playing = false;
    refreshToolbar();
    markPlayhead();
  }

  async function save(showToast = true): Promise<boolean> {
    if (!current || saving) return false;
    const sent = structuredClone(current);
    const base = saved ? (JSON.parse(saved) as AnimationDocument) : null;
    saving = true;
    try {
      const stored = await saveDraft(`/api/animations/${encodeURIComponent(sent.id)}`, sent, base);
      let rebased = true;
      if (current?.id === sent.id) {
        setEditorAssetUrl(sent.id);
        const result = mergeJson(sent, current, stored);
        if (result.ok) {
          current = result.value;
          saved = JSON.stringify(stored);
          animationLabels[stored.id] = current.label;
          assetTree.setLabels(animationLabels);
          renderReel();
          void drawPreview();
        } else rebased = false;
      }
      const message = rebased
        ? `Saved ${stored.label}`
        : `Saved ${stored.label}; newer edits need review`;
      setStatus(message);
      if (showToast || !rebased) toast(message, !rebased);
      refreshToolbar();
      return rebased;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      setStatus(message);
      toast(message, true);
      if (error instanceof ApiError && error.status === 409) {
        await alertModal(`${message}. Your unsaved animation is still open.`);
      }
      return false;
    } finally {
      saving = false;
      const pending = autoSavePending;
      autoSavePending = null;
      if (pending && current?.id === pending && dirty()) autoSave();
    }
  }

  async function openAnimation(id: string): Promise<void> {
    if (current?.id === id) return;
    if (dirty() && !(await confirmModal('Discard unsaved animation changes?', 'DISCARD'))) return;
    const token = ++openToken;
    try {
      const animation = await requestJson<AnimationDocument>(
        `/api/animations/${encodeURIComponent(id)}`,
      );
      if (!alive || token !== openToken) return;
      stop();
      current = animation;
      animationLabels[id] = animation.label;
      assetTree.setLabels(animationLabels);
      saved = JSON.stringify(animation);
      setEditorAssetUrl(id);
      inspect = null;
      playIndex = 0;
      autoFit = true;
      renderReel();
      assetTree.select(id);
      const firstSheet = firstAnimationSheet(animation, sprites);
      if (firstSheet) {
        selectedSheet = firstSheet;
        if (!sheetMatches(firstSheet)) sheetSearch.value = '';
      }
      renderSheets();
      void renderIcons();
      refreshToolbar();
      void drawPreview();
    } catch (error) {
      if (alive && token === openToken)
        setStatus(error instanceof Error ? error.message : 'Could not open animation');
    }
  }

  async function reloadLists(): Promise<void> {
    const [animationFiles, spriteFiles, colors, folders] = await Promise.all([
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/animations'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/sprites'),
      requestJson<PaletteDocument>('/api/palette'),
      requestJson<AssetFolders>('/api/animation-folders'),
    ]);
    animations = animationFiles.files;
    animationLabels = animationFiles.labels;
    sprites = spriteFiles.files;
    spriteLabels = spriteFiles.labels;
    palette = colors;
    assetTree.setData(animations, folders, animationLabels);
    assetTree.select(current?.id ?? null);
    renderSheets();
    void renderIcons();
  }

  sheetSearch.addEventListener('input', () => {
    renderSheets();
  });
  reel.addEventListener('dragenter', (event) => {
    if (!current) return;
    event.preventDefault();
  });
  reel.addEventListener('dragover', (event) => {
    if (!current) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    markDrop(event);
  });
  reel.addEventListener('dragleave', (event) => {
    if (event.relatedTarget instanceof Node && reel.contains(event.relatedTarget)) return;
    clearDrop();
  });
  reel.addEventListener('drop', (event) => {
    event.preventDefault();
    const at = dropIndex(event);
    clearDrop();
    if (!current) return;
    const payload = readPayload(event);
    if (!payload) return;
    if (payload.kind === 'sprite') {
      if (!isAssetId(payload.sprite) || payload.index < 0) return;
      insertFrame(payload.sprite, payload.index, at);
      return;
    }
    if (payload.from < 0 || payload.from >= current.frames.length) return;
    moveFrame(payload.from, at);
  });
  root.addEventListener('dragend', clearDrop);

  wrap.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      stepZoom(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  let creatingAnimation = false;
  async function createNewAnimation(folder = ''): Promise<void> {
    if (assetOperation || saving || creatingAnimation) return;
    creatingAnimation = true;
    try {
      const entered = await askId('New animation label');
      if (entered === null || !alive) return;
      const label = entered.trim();
      const labelError = animationLabelError(label);
      if (labelError) return void alertModal(labelError);
      if (dirty() && !(await confirmModal('Discard unsaved animation changes?', 'DISCARD'))) return;
      if (!alive) return;
      ++openToken;
      stop();
      current = createAnimation(crypto.randomUUID(), label);
      const id = current.id;
      assetTree.select(null);
      saved = '';
      setEditorAssetUrl(null);
      inspect = null;
      playIndex = 0;
      autoFit = true;
      renderReel();
      refreshToolbar();
      if (!(await save())) return;
      if (folder) {
        try {
          await requestJson<AssetFolders>(
            '/api/animation-folders',
            jsonRequest('POST', { action: 'move', id, folder }),
          );
        } catch (error) {
          const message = `${label} was saved, but could not be placed in ${folder}: ${error instanceof Error ? error.message : 'Folder update failed'}`;
          setStatus(message);
          toast(message, true);
        }
      }
      if (!alive) return;
      await reloadLists();
      if (current?.id === id) assetTree.select(id);
    } finally {
      creatingAnimation = false;
    }
  }
  root.querySelector('#new-animation')?.addEventListener('click', () => void createNewAnimation());
  root.querySelector('#save-animation')?.addEventListener('click', () => void save());
  root.querySelector('#copy-animation')?.addEventListener('click', () => {
    void (async () => {
      if (!current || assetOperation) return;
      const source = current;
      const entered = await askId('Copy animation label', `${source.label} copy`);
      if (entered === null || current !== source) return;
      const label = entered.trim();
      const labelError = animationLabelError(label);
      if (labelError) return void alertModal(labelError);
      const id = crypto.randomUUID();
      assetOperation = true;
      refreshToolbar();
      try {
        const copy = await requestJson<AnimationDocument>(
          `/api/animations/${encodeURIComponent(source.id)}/copy`,
          jsonRequest('POST', { id, doc: { ...structuredClone(source), id, label } }),
        );
        if (!alive || current !== source) return;
        ++openToken;
        stop();
        current = copy;
        assetTree.select(id);
        saved = JSON.stringify(copy);
        setEditorAssetUrl(id);
        inspect = null;
        playIndex = 0;
        renderReel();
        await reloadLists();
        void drawPreview();
        toast(`Copied ${source.label} to ${label}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Copy failed';
        setStatus(message);
        toast(message, true);
      } finally {
        assetOperation = false;
        refreshToolbar();
      }
    })();
  });
  root.querySelector('#rename-animation')?.addEventListener('click', () => {
    void (async () => {
      if (!current || assetOperation) return;
      const clip = current;
      const entered = await askAssetMeta('ANIMATION', clip.label, clip.id);
      if (entered === null || !alive || current !== clip) return;
      const label = entered.trim();
      const error = animationLabelError(label);
      if (error) return void alertModal(error);
      if (label === clip.label) return;
      clip.label = label;
      animationLabels[clip.id] = label;
      assetTree.setLabels(animationLabels);
      assetTree.select(clip.id);
      refreshToolbar();
    })();
  });
  root.querySelector('#delete-animation')?.addEventListener('click', () => {
    void (async () => {
      if (!current || !(await confirmModal(`Delete ${current.label}?`, 'DELETE'))) return;
      const id = current.id;
      await requestJson(`/api/animations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!alive || current?.id !== id) return;
      ++openToken;
      current = null;
      assetTree.select(null);
      saved = '';
      setEditorAssetUrl(null);
      inspect = null;
      playIndex = 0;
      stop();
      renderReel();
      refreshToolbar();
      await reloadLists();
      void drawPreview();
    })();
  });
  loopInput.addEventListener('change', () => {
    if (current) current.loop = loopInput.checked;
  });
  for (const [input, axis] of [
    [flipHInput, 'flipH'],
    [flipVInput, 'flipV'],
  ] as const) {
    input.addEventListener('change', () => {
      if (!current) return;
      current[axis] = input.checked;
      renderReel();
      void drawPreview();
      autoSave();
    });
  }
  defaultMsInput.addEventListener('input', () => {
    if (!current) return;
    const value = Number(defaultMsInput.value);
    if (!Number.isInteger(value) || value < 1 || value > MAX_FRAME_DURATION_MS) return;
    current.defaultDurationMs = value;
  });
  defaultMsInput.addEventListener('change', () => {
    if (!current) return;
    const value = Number(defaultMsInput.value);
    if (!Number.isInteger(value) || value < 1 || value > MAX_FRAME_DURATION_MS) {
      defaultMsInput.value = String(current.defaultDurationMs);
      return;
    }
    current.defaultDurationMs = value;
  });
  root.querySelector('#modify-ms-all')?.addEventListener('click', () => {
    void (async () => {
      if (!current || current.frames.length === 0) return;
      const next = await askFrameDuration(current.defaultDurationMs);
      if (next === null || !current) return;
      for (const frame of current.frames) frame.durationMs = next;
      renderReel();
      void drawPreview();
    })();
  });
  root.querySelector('#add-invisible')?.addEventListener('click', () => {
    if (!current) return;
    if (current.frames.length >= MAX_FRAMES) {
      setStatus(`At most ${MAX_FRAMES} frames`);
      return;
    }
    stop();
    const at = current.frames.length === 0 ? 0 : playIndex + 1;
    current.frames.splice(at, 0, {
      invisible: true,
      durationMs: current.defaultDurationMs,
    });
    inspect = null;
    playIndex = at;
    renderReel();
    refreshToolbar();
    void drawPreview();
    autoSave();
  });
  root.querySelector('#play')?.addEventListener('click', () => void play());
  root.querySelector('#stop')?.addEventListener('click', stop);

  function onKeyDown(event: KeyboardEvent): void {
    if (!root.isConnected) return;
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey || event.metaKey;
    const typing = isTextField(event.target) || isTextField(document.activeElement);
    if (isModalOpen() || characterDialog.open) return;
    if (ctrl && !event.altKey && key === 's') {
      event.preventDefault();
      void save();
      return;
    }
    if (typing || ctrl || event.altKey) return;
    if (event.key === ' ') {
      event.preventDefault();
      togglePlayback();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!current || current.frames.length === 0) return;
      event.preventDefault();
      const count = current.frames.length;
      selectFrame(wrappedFrameIndex(playIndex, event.key === 'ArrowLeft' ? -1 : 1, count));
    }
  }
  document.addEventListener('keydown', onKeyDown, true);
  root.querySelector('#zoom-in')?.addEventListener('click', () => stepZoom(1));
  root.querySelector('#zoom-out')?.addEventListener('click', () => stepZoom(-1));
  root.querySelector('#fit')?.addEventListener('click', () => {
    autoFit = true;
    void drawPreview();
  });

  const observer = new ResizeObserver(() => {
    sizePreview();
    void drawPreview();
  });
  observer.observe(wrap);

  void preloadSpriteFonts()
    .then(async () => {
      await reloadLists();
      if (!alive) return;
      const requested = new URLSearchParams(location.search).get('id');
      if (requested) {
        if (isAssetId(requested) && animations.includes(requested)) await openAnimation(requested);
        else setStatus(`Animation ${requested} not found`);
      }
    })
    .then(() => {
      if (!alive) return;
      renderReel();
      sizePreview();
      return drawPreview();
    })
    .catch((error: unknown) => {
      if (alive) setStatus(error instanceof Error ? error.message : 'Could not load animations');
    });

  return () => {
    resizeObserver.disconnect();
    alive = false;
    ++openToken;
    stop();
    observer.disconnect();
    document.removeEventListener('keydown', onKeyDown, true);
    setDirtyGuard(null);
  };
}
