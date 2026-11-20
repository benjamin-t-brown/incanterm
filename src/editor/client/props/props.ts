import { projectStorage } from '../project.js';
import { getPaletteRgb, type PaletteDocument } from '../../palette.js';
import {
  createProp,
  flattenSprite,
  getPropLabelError,
  isAssetId,
  isInvisibleFrame,
  getAnimationFrameFlips,
  type AnimationDocument,
  type PropDocument,
  type PropVisual,
  type SpriteDocument,
} from '../../schema.js';
import { createSearchSelect } from '../search-select.js';
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
import { propVisualEditHref, getPropVisualSize } from '../../props/prop-picker.js';
import { updatePropCustomState } from '../../props/prop-custom-states.js';
import { ApiError, jsonRequest, requestJson } from '../api.js';
import { alertModal, askAssetMeta, confirmModal, isModalOpen } from '../modal.js';
import type { AssetFolders } from '../../asset-folders.js';
import { createAssetTree } from '../asset-tree.js';
import { FOLDER_ICON } from '../asset-tree-icons.js';
import { createPanelResizer } from '../panel-resizer.js';
import { createVisualAssetPicker } from '../visual-asset-picker.js';
import { saveDraft } from '../save.js';
import { askId, createPageShell, setDirtyGuard, setEditorAssetUrl } from '../shell.js';

export function mountProps(root: HTMLElement): () => void {
  root.innerHTML = createPageShell(
    'Props',
    `<aside class="anim-library prop-library" aria-label="Props">
      <input id="prop-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search props" autocomplete="off" spellcheck="false">
      <div class="asset-tree-toolbar"><span>FOLDERS</span><div class="asset-tree-toolbar-actions"><button id="new-prop-folder" type="button" title="New folder" aria-label="New folder">${FOLDER_ICON}</button></div></div>
      <div id="prop-list" class="anim-library-list"></div>
    </aside>
    <div id="prop-library-resizer" class="panel-resizer" role="separator" aria-label="Resize prop folders" aria-orientation="vertical" aria-controls="prop-list" tabindex="0" title="Drag to resize; double-click to reset"></div>
    <section class="prop-app" aria-label="Prop editor">
      <div class="toolbar-row asset-create-header"><button id="new-prop" type="button">NEW</button></div>
      <div id="prop-tabs" class="prop-tabs" role="tablist" aria-label="Open props"></div>
      <div class="toolbar-row">
        <button id="save-prop" type="button" disabled>SAVE</button>
        <button id="rename-prop" type="button" disabled>RENAME</button>
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
          <small>Z offset is set per instance in the Scene editor.</small>
          <label class="prop-checkbox"><input id="prop-foreground" type="checkbox" aria-describedby="prop-foreground-help"> FOREGROUND</label>
          <small id="prop-foreground-help">Always draws above normal props and characters. Z offset still orders foreground props relative to each other.</small>
          <h2>OTHER STATES</h2>
          <p class="page-copy">The appearance above is the <code>default</code> state. Add named states for <code>+setPropAnimState</code>.</p>
          <div id="prop-custom" class="character-state-list"></div>
          <button id="add-prop-state" type="button">+ CUSTOM STATE</button>
        </div>
        <div class="prop-preview"><h2>PREVIEW</h2><button id="play-prop-animation" type="button" aria-pressed="false" hidden>PLAY ANIMATION</button><button id="prop-show-blocks" type="button" aria-pressed="false">SHOW BLOCKED CELLS</button><canvas id="prop-canvas" width="360" height="240" tabindex="0" aria-label="Prop visual preview; press Tab to toggle blocked cells"></canvas><p>Show blocked cells, then click or drag on the preview to block or unblock them. Focus the preview and press Tab to toggle the overlay. Shift+Tab moves focus away.</p><p>Scene position and ordering are set in the Scene editor.</p></div>
      </div>
    </section>
    <dialog id="prop-custom-state-dialog" aria-labelledby="prop-custom-state-title">
      <form id="prop-custom-state-form">
        <h2 id="prop-custom-state-title">NEW CUSTOM STATE</h2>
        <label class="character-label">STATE NAME<input id="prop-custom-state-name" class="text-input" type="text" autocomplete="off" spellcheck="false" required></label>
        <label class="character-label">ANIMATION<span id="prop-custom-state-picker"></span></label>
        <p id="prop-custom-state-error" class="page-copy" role="alert" hidden></p>
        <div class="character-from-folder-actions"><button id="submit-prop-custom-state" type="submit">ADD STATE</button><button id="cancel-prop-custom-state" type="button">CANCEL</button></div>
      </form>
    </dialog>`,
  );
  root.querySelector('.simple-main')?.classList.add('prop-main');
  const get$ = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
  };
  const disposeResizer = createPanelResizer({
    container: get$<HTMLElement>('.prop-main'),
    panel: get$<HTMLElement>('.prop-library'),
    handle: get$<HTMLElement>('#prop-library-resizer'),
    storageKey: 'incanterm-prop-library-width',
    defaultWidth: 200,
  });
  const search = get$<HTMLInputElement>('#prop-search');
  const list = get$<HTMLElement>('#prop-list');
  const status = get$<HTMLElement>('#prop-status');
  const fields = get$<HTMLElement>('#prop-fields');
  const visualType = get$<HTMLSelectElement>('#prop-visual-type');
  const playButton = get$<HTMLButtonElement>('#play-prop-animation');
  const canvas = get$<HTMLCanvasElement>('#prop-canvas');
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('Canvas is unavailable');
  const context: CanvasRenderingContext2D = drawing;

  let alive = true;
  let loading = 0;
  let saving = false;
  let files: string[] = [];
  let propLabels: Record<string, string> = {};
  let sprites: string[] = [];
  let spriteLabels: Record<string, string> = {};
  let animations: string[] = [];
  let animationLabels: Record<string, string> = {};
  let palette: PaletteDocument | null = null;
  let current: PropDocument | null = null;
  let saved: PropDocument | null = null;
  const storedTabs = readPropTabs(projectStorage);
  let openTabs = storedTabs.tabs;
  const sessions = new Map<string, PropTabSession>(Object.entries(storedTabs.drafts));
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let previewToken = 0;
  let playbackToken = 0;
  let playbackTimer: ReturnType<typeof setTimeout> | null = null;
  let playbackAnimation: AnimationDocument | null = null;
  let playbackPropId: string | null = null;
  let playbackVisualId: string | null = null;
  let playbackIndex = 0;
  let defaultSizeToken = 0;
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
  const assetPicker = createVisualAssetPicker({
    root,
    loadSheet,
    paintSprite: (canvas, sprite, index, flips) =>
      paintSprite(canvas, sprite, index, undefined, false, flips),
  });

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
  let newPropFolder = '';
  const pendingPropFolders = new Map<string, string>();
  const assetTree = createAssetTree({
    list,
    search,
    label: 'PROPS',
    assetName: 'prop',
    storageKey: 'incanterm-prop-folders-expanded',
    onSelect: (id) => void open(id),
    onCreateAsset: (folder) => {
      newPropFolder = folder;
      get$<HTMLButtonElement>('#new-prop').click();
    },
    onChange: async (change) => {
      if (
        change.action === 'delete' &&
        (change.expectedIds.some(isTabDirty) ||
          [...pendingPropFolders.values()].some(
            (folder) => folder === change.folder || folder.startsWith(`${change.folder}/`),
          ))
      )
        throw new Error('Save or close unsaved prop drafts before deleting this folder');
      const folders = await requestJson<AssetFolders>(
        '/api/prop-folders',
        jsonRequest('POST', change),
      );
      if (change.action === 'delete') {
        for (const id of change.expectedIds) sessions.delete(id);
        openTabs = openTabs.filter((id) => !change.expectedIds.includes(id));
        if (current && change.expectedIds.includes(current.id)) {
          ++loading;
          current = null;
          saved = null;
          setEditorAssetUrl(null);
        }
        await refresh();
        const next = openTabs[openTabs.length - 1];
        if (!current && next) await open(next);
      }
      return folders;
    },
    askName: askId,
    confirmDelete: (folder, props, subfolders) =>
      confirmModal(
        props.length || subfolders.length
          ? `Delete folder ${folder} and everything inside it?${subfolders.length ? `\nSubfolders: ${subfolders.join(', ')}` : ''}${props.length ? `\nProps to delete:\n${props.map(({ label, id }) => `• ${label} (${id})`).join('\n')}` : ''}\nThis cannot be undone.`
          : `Delete empty folder ${folder}?`,
        'DELETE',
      ),
    onError: (message) => {
      status.textContent = message;
      toast(message, true);
    },
  });
  get$<HTMLButtonElement>('#new-prop-folder').addEventListener(
    'click',
    () => void assetTree.createFolder(),
  );

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
      projectStorage.setItem(
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
    renderTabCloseActions(host, { tabs: openTabs, active: current?.id ?? null, closeTab });
    host.replaceChildren();
    if (!openTabs.length) {
      const empty = document.createElement('span');
      empty.className = 'prop-tabs-empty';
      empty.textContent = 'NO PROP';
      host.append(empty);
    }
    for (const id of openTabs) {
      const tab = document.createElement('div');
      tab.className = 'prop-tab editor-document-tab';
      tab.dataset.tabId = id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(current?.id === id));
      tab.classList.toggle('current', current?.id === id);
      tab.classList.toggle('dirty', isTabDirty(id));
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'prop-tab-label';
      label.textContent =
        (id === current?.id ? current.label : sessions.get(id)?.doc.label) ?? propLabels[id] ?? id;
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
    renderTabReordering(host, {
      tabs: openTabs,
      onReorder: (tabs) => {
        openTabs = tabs;
        persistTabs();
        renderTabs();
      },
    });
  }
  function activateProp(prop: PropDocument, baseline: PropDocument | null): void {
    if (current) sessions.set(current.id, { doc: current, saved });
    sessions.delete(prop.id);
    if (!prop.customAnimations) prop.customAnimations = {};
    if (baseline && !baseline.customAnimations) baseline.customAnimations = {};
    current = prop;
    saved = baseline;
    openTabs = addOpenTab(openTabs, prop.id);
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
    assetTree.select(current?.id ?? null);
  }

  function loadSheet(id: string): Promise<SpriteDocument> {
    const cached = sheetCache.get(id);
    if (cached) return cached;
    const pending = requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`)
      .then(async (sprite) => {
        await document.fonts
          .load(
            getTerminalFont(getSpriteFontNativePx(sprite.font), getSpriteFontFamily(sprite.font)),
          )
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
      return requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(id)}`);
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

  async function loadVisualFrame(
    visual: PropVisual,
    clip?: AnimationDocument,
    frameIndex?: number,
  ): Promise<{
    sprite: SpriteDocument;
    index: number;
    flips?: { flipH: boolean; flipV: boolean };
  } | null> {
    if (visual.type === 'sprite')
      return { sprite: await loadSheet(visual.id), index: visual.index };
    const animation =
      clip ??
      (await requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(visual.id)}`));
    const first =
      frameIndex === undefined
        ? animation.frames.find((frame) => !isInvisibleFrame(frame))
        : animation.frames[frameIndex];
    if (!first || isInvisibleFrame(first)) return null;
    return {
      sprite: await loadSheet(first.sprite),
      index: first.index,
      flips: getAnimationFrameFlips(animation, first),
    };
  }

  async function openPicker(type: PropVisual['type']): Promise<void> {
    const prop = current;
    if (!prop || saving) return;
    try {
      const selected = await assetPicker.open(type, prop.visual);
      if (!selected || !alive || current !== prop || saving) return;
      const changed = JSON.stringify(prop.visual) !== JSON.stringify(selected);
      const size = changed ? await getVisualSize(selected) : null;
      if (!alive || current !== prop || saving) return;
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
      render();
    } catch (error) {
      if (alive) status.textContent = showMessage(error);
    }
  }

  function stopPreviewPlayback(): void {
    ++playbackToken;
    if (playbackTimer !== null) clearTimeout(playbackTimer);
    playbackTimer = null;
    playbackAnimation = null;
    playbackPropId = null;
    playbackVisualId = null;
    playButton.textContent = 'PLAY ANIMATION';
    playButton.setAttribute('aria-pressed', 'false');
  }

  async function playPreviewAnimation(): Promise<void> {
    if (current?.visual.type !== 'animation') return;
    const propId = current.id;
    const animationId = current.visual.id;
    const token = ++playbackToken;
    playbackPropId = propId;
    playbackVisualId = animationId;
    playButton.textContent = 'STOP ANIMATION';
    playButton.setAttribute('aria-pressed', 'true');
    try {
      const clip = await requestJson<AnimationDocument>(
        `/api/animations/${encodeURIComponent(animationId)}`,
      );
      if (!alive || token !== playbackToken) return;
      if (!clip.frames.length) {
        stopPreviewPlayback();
        status.textContent = 'Animation has no frames to preview';
        return;
      }
      playbackAnimation = clip;
      playbackIndex = 0;
      const advancePreviewFrame = async (): Promise<void> => {
        await drawPreview();
        if (!alive || token !== playbackToken) return;
        const duration = clip.frames[playbackIndex]?.durationMs ?? clip.defaultDurationMs;
        playbackTimer = setTimeout(() => {
          if (!alive || token !== playbackToken) return;
          if (playbackIndex + 1 === clip.frames.length && !clip.loop) {
            stopPreviewPlayback();
            void drawPreview();
            return;
          }
          playbackIndex = (playbackIndex + 1) % clip.frames.length;
          void advancePreviewFrame();
        }, duration);
      };
      await advancePreviewFrame();
    } catch (error) {
      if (!alive || token !== playbackToken) return;
      stopPreviewPlayback();
      status.textContent = showMessage(error);
    }
  }

  playButton.addEventListener('click', () => {
    if (playbackPropId !== null) {
      stopPreviewPlayback();
      void drawPreview();
    } else void playPreviewAnimation();
  });

  async function drawPreview(): Promise<void> {
    const token = ++previewToken;
    if (!current || !palette) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    try {
      const key = `${current.id}:${JSON.stringify(current.visual)}:${playbackAnimation ? playbackIndex : 'still'}`;
      if (previewFrame?.key !== key)
        previewFrame = {
          key,
          pending: loadVisualFrame(
            current.visual,
            playbackAnimation ?? undefined,
            playbackAnimation ? playbackIndex : undefined,
          ),
        };
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
    if (
      playbackPropId !== null &&
      (current?.id !== playbackPropId ||
        current?.visual.type !== 'animation' ||
        current.visual.id !== playbackVisualId)
    )
      stopPreviewPlayback();
    playButton.hidden = current?.visual.type !== 'animation';
    blockStroke = null;
    previewGrid = null;
    if (previewProp !== current) previewFrame = null;
    previewProp = current;
    renderList();
    renderTabs();
    scheduleTabs();
    fields.hidden = !current;
    get$<HTMLButtonElement>('#save-prop').disabled = !current;
    get$<HTMLButtonElement>('#rename-prop').disabled = !current;
    get$<HTMLButtonElement>('#delete-prop').disabled = !current;
    get$<HTMLElement>('#prop-id').textContent = current?.label ?? current?.id ?? 'NO PROP';
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
    get$<HTMLInputElement>('#prop-foreground').checked = current.foreground === true;
    if (!current.customAnimations) current.customAnimations = {};
    const custom = get$<HTMLElement>('#prop-custom');
    custom.replaceChildren();
    for (const [name, id] of Object.entries(current.customAnimations)) {
      const row = document.createElement('div');
      row.className = 'character-state-row prop-custom-state-row';
      const label = document.createElement('span');
      label.className = 'prop-custom-state-label';
      label.textContent = `${name} · ${animationLabels[id] ?? id}`;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'EDIT';
      edit.setAttribute('aria-label', `Edit custom state ${name}`);
      edit.addEventListener('click', () => openCustomStateDialog(name));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'REMOVE';
      remove.setAttribute('aria-label', `Remove custom state ${name}`);
      remove.addEventListener('click', () => {
        if (!current) return;
        delete current.customAnimations[name];
        render();
        void save();
      });
      row.append(edit, remove, label);
      custom.append(row);
    }
    void renderDefaultSize();
    void drawPreview();
  }

  async function refresh(): Promise<void> {
    const [props, sheets, clips, colors, folders] = await Promise.all([
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/props'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/sprites'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/animations'),
      requestJson<PaletteDocument>('/api/palette'),
      requestJson<AssetFolders>('/api/prop-folders'),
    ]);
    if (!alive) return;
    files = props.files;
    propLabels = props.labels;
    assetTree.setData(files, folders, propLabels);
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
      const pendingFolder = pendingPropFolders.get(sent.id);
      if (pendingFolder) {
        try {
          await requestJson<AssetFolders>(
            '/api/prop-folders',
            jsonRequest('POST', {
              action: 'move',
              id: sent.id,
              folder: pendingFolder,
            }),
          );
        } catch (error) {
          const message = `Saved ${sent.id}, but could not place it in ${pendingFolder}: ${showMessage(error)}`;
          status.textContent = message;
          toast(message, true);
        }
        pendingPropFolders.delete(sent.id);
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
  get$<HTMLInputElement>('#prop-foreground').addEventListener('change', (event) => {
    if (!current) return;
    current.foreground = (event.target as HTMLInputElement).checked;
    renderTabs();
    scheduleTabs();
  });
  for (const [selector, field] of [
    ['#prop-width', 'width'],
    ['#prop-height', 'height'],
    ['#prop-ground', 'groundOffsetY'],
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
  get$<HTMLButtonElement>('#save-prop').addEventListener('click', () => void save());
  get$<HTMLButtonElement>('#rename-prop').addEventListener('click', () => void renameProp());
  async function renameProp(): Promise<void> {
    const prop = current;
    if (!prop || saving) return;
    const previousLabel = prop.label ?? prop.id;
    const entered = await askAssetMeta('PROP', previousLabel, prop.id);
    if (entered === null || !alive || current !== prop || saving) return;
    const error = getPropLabelError(entered);
    if (error) return void alertModal(error);
    const label = entered.trim();
    if (label === previousLabel) return;
    prop.label = label;
    render();
    status.textContent = 'Prop renamed. Save to keep the change.';
  }
  get$<HTMLButtonElement>('#new-prop').addEventListener('click', () => {
    void (async () => {
      const folder = newPropFolder;
      newPropFolder = '';
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
      if (folder) pendingPropFolders.set(id, folder);
      status.textContent = `New prop ${id}`;
      await save();
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
        pendingPropFolders.delete(id);
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
  const customStateDialog = get$<HTMLDialogElement>('#prop-custom-state-dialog');
  const customStateName = get$<HTMLInputElement>('#prop-custom-state-name');
  const customStatePicker = get$<HTMLElement>('#prop-custom-state-picker');
  const customStateError = get$<HTMLElement>('#prop-custom-state-error');
  let customStateChoices = new Map<string, string>();
  let editingCustomState: string | null = null;
  let customStatePropId: string | null = null;
  function openCustomStateDialog(name: string | null = null): void {
    if (!current || saving) return;
    editingCustomState = name;
    customStatePropId = current.id;
    customStateError.hidden = true;
    customStateName.value = name ?? '';
    get$<HTMLElement>('#prop-custom-state-title').textContent =
      name === null ? 'NEW CUSTOM STATE' : 'EDIT CUSTOM STATE';
    get$<HTMLButtonElement>('#submit-prop-custom-state').textContent =
      name === null ? 'ADD STATE' : 'SAVE STATE';
    const animation = name === null ? null : current.customAnimations[name];
    customStateChoices = new Map(
      animations.map((animation) => [animationLabels[animation] ?? animation, animation]),
    );
    customStatePicker.replaceChildren(
      createSearchSelect({
        value:
          name === null
            ? (current.label ?? '')
            : animation
              ? (animationLabels[animation] ?? animation)
              : '',
        choices: [...customStateChoices.keys()],
        placeholder: 'Search animations…',
        ariaLabel: 'Custom state animation',
        onInput: () => {},
      }),
    );
    customStateDialog.showModal();
    customStateName.focus();
  }
  get$<HTMLButtonElement>('#add-prop-state').addEventListener('click', () =>
    openCustomStateDialog(),
  );
  get$<HTMLButtonElement>('#cancel-prop-custom-state').addEventListener('click', () =>
    customStateDialog.close(),
  );
  get$<HTMLFormElement>('#prop-custom-state-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || saving || !customStateDialog.open || current.id !== customStatePropId) return;
    const id = customStateName.value.trim();
    const input = customStatePicker.querySelector<HTMLInputElement>('input');
    const animation = customStateChoices.get(input?.value.trim() ?? '');
    if (!animation) {
      customStateError.textContent = 'Select an animation for this state.';
      customStateError.hidden = false;
      input?.focus();
      return;
    }
    try {
      updatePropCustomState(current, id, animation, editingCustomState);
    } catch (error) {
      customStateError.textContent = showMessage(error);
      customStateError.hidden = false;
      customStateName.focus();
      return;
    }
    customStateDialog.close();
    render();
    void save();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !root.isConnected ||
      isModalOpen() ||
      assetPicker.isOpen() ||
      customStateDialog.open ||
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
    stopPreviewPlayback();
    disposeResizer();
    persistTabs();
    ++loading;
    ++previewToken;
    ++defaultSizeToken;
    assetPicker.dispose();
    if (customStateDialog.open) customStateDialog.close();
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pagehide', persistTabs);
    setDirtyGuard(null);
  };
}
import { renderTabCloseActions } from '../tab-close-actions.js';
import { renderTabReordering } from '../tab-reordering.js';
import { addOpenTab } from '../../tab-order.js';
