import { paletteRgb, type PaletteDocument } from '../palette.js';
import {
  createAnimation,
  DEFAULT_ANIMATION_DURATION_MS,
  flattenSprite,
  isAssetId,
  isInvisibleFrame,
  MAX_FRAME_DURATION_MS,
  MAX_FRAMES,
  type AnimationDocument,
  type AnimationFrame,
  type SpriteDocument,
} from '../schema.js';
import {
  applyTerminalGlyphStyle,
  preloadSpriteFonts,
  spriteFontFamily,
  spriteFontNativePx,
  terminalCellAtZoom,
  terminalFont,
} from '../terminal-cell.js';
import { jsonRequest, requestJson } from './api.js';
import { alertModal, askFrameDuration, confirmModal, isModalOpen } from './modal.js';
import { askId, pageShell, setDirtyGuard } from './shell.js';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 8;
const ZOOM_STEPS = [MIN_ZOOM, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, MAX_ZOOM];
const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 72;
const ICON_WIDTH = 84;
const ICON_HEIGHT = 64;

type DragPayload =
  { kind: 'sprite'; sprite: string; index: number } | { kind: 'reel'; from: number };

export function mountAnimation(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Animation',
    `<aside class="anim-library" aria-label="Animations">
        <input id="anim-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search animations" autocomplete="off" spellcheck="false">
        <div id="anim-list" class="asset-list anim-library-list"></div>
      </aside>
      <div class="anim-app">
        <div class="toolbar-row">
          <button type="button" id="new-animation">NEW</button>
          <button type="button" id="save-animation">SAVE</button>
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
              <label class="anim-control-field">DEFAULT MS
                <input id="default-ms" class="text-input" type="number" min="1" max="600000" value="120" disabled>
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
            </div>
            <div id="sprite-icons" class="anim-sprites"></div>
          </section>
        </div>
      </div>
      <div id="toast-stack" class="toast-stack"></div>`,
  );
  root.querySelector('.simple-main')?.classList.add('animation-main');

  const $ = <T extends Element>(selector: string) => {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element as T;
  };
  const canvas = $<HTMLCanvasElement>('#preview');
  const wrap = $<HTMLElement>('.anim-preview-wrap');
  const reel = $<HTMLElement>('#reel');
  const sheetList = $<HTMLElement>('#sheet-list');
  const sheetSearch = $<HTMLInputElement>('#sheet-search');
  const iconList = $<HTMLElement>('#sprite-icons');
  const status = $<HTMLElement>('#animation-status');
  const idLabel = $<HTMLElement>('#animation-id');
  const loopInput = $<HTMLInputElement>('#loop');
  const defaultMsInput = $<HTMLInputElement>('#default-ms');
  const zoomLabel = $<HTMLElement>('#zoom-label');
  const animList = $<HTMLElement>('#anim-list');
  const animSearch = $<HTMLInputElement>('#anim-search');
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('Canvas is unavailable');
  const ctx: CanvasRenderingContext2D = drawing;

  let animations: string[] = [];
  let sprites: string[] = [];
  let palette: PaletteDocument | null = null;
  let current: AnimationDocument | null = null;
  let saved = '';
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
    idLabel.textContent = current?.id ?? 'NO CLIP';
    loopInput.checked = current?.loop ?? false;
    loopInput.disabled = !current;
    defaultMsInput.disabled = !current;
    defaultMsInput.value = String(current?.defaultDurationMs ?? DEFAULT_ANIMATION_DURATION_MS);
    const open = current !== null;
    setDisabled('#save-animation', !open);
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
  ): void {
    if (!palette) return;
    target.fillStyle = paletteRgb(palette, 'black') ?? '#000';
    target.fillRect(0, 0, width, height);
    const grid = terminalCellAtZoom(target, scale, sprite.font);
    const originX = Math.floor((width - sprite.width * grid.width) / 2);
    const originY = Math.floor((height - sprite.height * grid.height) / 2);
    applyTerminalGlyphStyle(target, grid);
    const cells = flattenSprite(sprite, frameIndex);
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index];
      if (!cell) continue;
      const x = originX + (index % sprite.width) * grid.width;
      const y = originY + Math.floor(index / sprite.width) * grid.height;
      target.fillStyle = paletteRgb(palette, cell.bg) ?? '#000';
      target.fillRect(x, y, grid.width, grid.height);
      if (cell.ch !== ' ') {
        target.fillStyle = paletteRgb(palette, cell.fg) ?? '#fff';
        target.fillText(cell.ch, x, y + grid.ascent);
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
  ): { sprite: string; index: number; durationMs?: number } | null {
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
    paintSprite(ctx, sprite, visible.index, viewW, viewH, zoom);
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
    current.frames.forEach((frame, index) => {
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
      else void paintThumb(thumb, frame.sprite, frame.index);
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
    return query === '' || id.toLowerCase().includes(query);
  }

  function renderSheets(): void {
    sheetList.replaceChildren();
    const used = usedSheetIds();
    const pinned = sprites.filter((id) => used.has(id) && sheetMatches(id));
    const rest = sprites.filter((id) => !used.has(id) && sheetMatches(id));
    if (!selectedSheet || !sprites.includes(selectedSheet)) {
      selectedSheet = pinned[0] ?? rest[0] ?? null;
    }
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
      button.textContent = id;
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

  async function save(): Promise<void> {
    if (!current) return;
    try {
      const stored = await requestJson<AnimationDocument>(
        `/api/animations/${encodeURIComponent(current.id)}`,
        jsonRequest('PUT', current),
      );
      current = stored;
      saved = JSON.stringify(stored);
      const message = `Saved ${stored.id}`;
      setStatus(message);
      toast(message);
      refreshToolbar();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      setStatus(message);
      toast(message, true);
    }
  }

  async function openAnimation(id: string): Promise<void> {
    if (current?.id === id) return;
    if (dirty() && !(await confirmModal('Discard unsaved animation changes?', 'DISCARD'))) return;
    stop();
    current = await requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(id)}`);
    saved = JSON.stringify(current);
    inspect = null;
    playIndex = 0;
    autoFit = true;
    renderReel();
    renderAnimList();
    refreshToolbar();
    void drawPreview();
  }

  function renderAnimList(): void {
    animList.replaceChildren();
    const query = animSearch.value.trim().toLowerCase();
    const shown = animations.filter((id) => query === '' || id.toLowerCase().includes(query));
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anim-picker-empty';
      empty.textContent = animations.length === 0 ? 'No animations.' : 'No matches.';
      animList.append(empty);
      return;
    }
    for (const id of shown) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id;
      button.classList.toggle('active', current?.id === id);
      button.addEventListener('click', () => void openAnimation(id));
      animList.append(button);
    }
  }

  async function reloadLists(): Promise<void> {
    const [animationFiles, spriteFiles, colors] = await Promise.all([
      requestJson<{ files: string[] }>('/api/animations'),
      requestJson<{ files: string[] }>('/api/sprites'),
      requestJson<PaletteDocument>('/api/palette'),
    ]);
    animations = animationFiles.files;
    sprites = spriteFiles.files;
    palette = colors;
    renderAnimList();
    renderSheets();
    void renderIcons();
  }

  animSearch.addEventListener('input', () => {
    renderAnimList();
  });
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

  root.querySelector('#new-animation')?.addEventListener('click', () => {
    void (async () => {
      const id = await askId('New animation id');
      if (!id || !isAssetId(id)) return;
      if (animations.includes(id)) {
        await alertModal('An asset with that id already exists');
        return;
      }
      if (dirty() && !(await confirmModal('Discard unsaved animation changes?', 'DISCARD'))) return;
      stop();
      current = createAnimation(id);
      saved = '';
      inspect = null;
      playIndex = 0;
      autoFit = true;
      renderReel();
      refreshToolbar();
      await save();
      await reloadLists();
    })();
  });
  root.querySelector('#save-animation')?.addEventListener('click', () => void save());
  root.querySelector('#delete-animation')?.addEventListener('click', () => {
    void (async () => {
      if (!current || !(await confirmModal(`Delete ${current.id}?`, 'DELETE'))) return;
      await requestJson(`/api/animations/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
      current = null;
      saved = '';
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
  });
  root.querySelector('#play')?.addEventListener('click', () => void play());
  root.querySelector('#stop')?.addEventListener('click', stop);

  function onKeyDown(event: KeyboardEvent): void {
    if (!root.isConnected) return;
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey || event.metaKey;
    const typing = isTextField(event.target) || isTextField(document.activeElement);
    if (isModalOpen()) return;
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
      selectFrame(playIndex + (event.key === 'ArrowLeft' ? -1 : 1));
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
    .then(() => reloadLists())
    .then(() => {
      renderReel();
      sizePreview();
      return drawPreview();
    });

  return () => {
    alive = false;
    stop();
    observer.disconnect();
    document.removeEventListener('keydown', onKeyDown, true);
    setDirtyGuard(null);
  };
}
