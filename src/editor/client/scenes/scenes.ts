import { paletteRgb, type PaletteDocument } from '../../palette.js';
import { terminalCellAtZoom } from '../../terminal-cell.js';
import { drawTerminalGlyph, fillTerminalCell } from '../terminal-renderer.js';
import { compareSceneDrawRank, sceneDepth } from '../../../game/scene-order.js';
import {
  renderStandardUiPreview,
  STANDARD_UI_HEIGHT,
  STANDARD_WIDTH,
} from '../../../renderer/ui/standard-ui.js';
import {
  animationFrameFlips,
  characterAnimation,
  createScene,
  flattenSprite,
  isAssetId,
  isInvisibleFrame,
  type AnimationDocument,
  type CharacterDocument,
  type PropDocument,
  type SceneDocument,
  type SceneEntity,
  type SceneTrigger,
  type SpriteDocument,
  spriteLabelError,
} from '../../schema.js';
import { rebaseJsonDraft } from '../../safe-save.js';
import { resizeBlockedCells } from '../../props/prop-blocking.js';
import { setSceneBackground } from '../../scenes/scene-background.js';
import {
  neighborSceneTab,
  OPEN_SCENES_KEY,
  readSceneTabs,
  type SceneTabSession,
} from '../../scenes/scene-tabs.js';
import { paintSceneBlockedCells, propBlockedSceneCells } from '../../scenes/scene-blocked-cells.js';
import { removeSelectedSceneObjects } from '../../scenes/scene-delete.js';
import {
  copySceneObjects,
  pasteSceneObjects,
  type SceneClipboard,
} from '../../scenes/scene-clipboard.js';
import { addSceneProp } from '../../scenes/scene-props.js';
import { addSceneCharacter } from '../../scenes/scene-characters.js';
import { sceneTriggerColors } from '../../scenes/scene-trigger-colors.js';
import {
  newSceneTrigger,
  resizeTrigger,
  triggerRegion,
  type ResizeHandle,
} from '../../scenes/scene-triggers.js';
import {
  boxesInSceneRect,
  canSelectSceneObject,
  moveSceneGroup,
  sameSceneObject,
  selectableSceneObjects,
  type SceneHitBox,
  type SceneObjectRef,
} from '../../scenes/scene-selection.js';
import {
  fitSceneView,
  sceneCellAt,
  SCENE_ZOOM_STEPS,
  zoomSceneView,
  type SceneView,
} from '../../scenes/scene-viewport.js';
import { ApiError, requestJson } from '../api.js';
import { alertModal, confirmModal, isModalOpen } from '../modal.js';
import { saveDraft } from '../save.js';
import { createSearchSelect } from '../search-select.js';
import { pageShell, setDirtyGuard, setEditorAssetUrl } from '../shell.js';

type ObjectRef = SceneObjectRef;

export function mountScenes(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Scene',
    `<aside class="scene-library" aria-label="Scenes">
    <label for="scene-search">SCENES</label><input id="scene-search" class="text-input" type="search" placeholder="SEARCH">
    <div id="scene-list" class="asset-list"></div></aside>
    <section class="scene-app" aria-label="Scene editor">
      <div class="toolbar-row"><strong id="scene-title">NO SCENE</strong></div>
      <div id="scene-workspace" class="scene-workspace" hidden>
           <section class="scene-stage"><div class="scene-tools"><span>Box select · Ctrl+click to add · Ctrl+A all · Ctrl+C, then hover scene &amp; Ctrl+V · Hold Tab for names, triggers &amp; blocked cells · Esc deselect</span><div class="scene-zoom-controls workspace-controls"><button type="button" id="scene-zoom-out" aria-label="Zoom out">−</button><span id="scene-zoom-label">100%</span><button type="button" id="scene-zoom-in" aria-label="Zoom in">+</button><button type="button" id="scene-fit">FIT</button></div></div>
           <div class="scene-scroll" id="scene-viewport"><canvas id="scene-canvas" tabindex="0" aria-label="Scene placement canvas"></canvas><canvas id="scene-hover" aria-hidden="true"></canvas></div></section>
        <aside class="scene-sidebar"><h2>SCENE</h2><label class="scene-overlay-toggle"><input id="scene-show-triggers" type="checkbox" checked>SHOW TRIGGERS</label><label class="scene-overlay-toggle"><input id="scene-show-blocked" type="checkbox">SHOW BLOCKED CELLS</label><label class="scene-overlay-toggle"><input id="scene-show-ui" type="checkbox">SHOW UI</label><div class="scene-pair"><label>WIDTH<input id="scene-width" type="number" min="1" max="256"></label><label>HEIGHT<input id="scene-height" type="number" min="1" max="128"></label></div>
          <label>DEPTH MODE<select id="scene-depth"><option value="bottom-up">BOTTOM UP</option><option value="regular-z">REGULAR Z</option></select></label>
          <div class="scene-background-controls"><h2>BACKGROUND</h2><div class="scene-background-actions-row">
            <!-- Icons by Delapouite, CC BY 3.0: https://game-icons.net/1x1/delapouite/horizon-road.html and https://game-icons.net/1x1/delapouite/walk.html -->
            <button type="button" id="scene-add-background" aria-label="Add background sprite" title="Add background sprite"><span class="scene-background-icon"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M129.8 19.64 64.66 113.4H32v18h272.8c12.3 23.5 21.4 40.3 28.1 68.3-118 19.8-137.8 26.8-247.03 65.1C126.4 344.9 167 425 232.8 492.4l246.2-.3c-87.1-63.9-203.5-127.6-260.1-201.3 64.2-33.7 98.8-49.9 155.5-74.6-11.5-28.8-30.3-59.7-53.9-84.8H480v-18H251.2l-54.5-67.85-35.6 23.16z"/></svg><span class="scene-background-plus" aria-hidden="true">+</span></span></button>
            <button type="button" id="scene-background-mode" aria-label="Edit background" title="Edit background" aria-pressed="false"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M129.8 19.64 64.66 113.4H32v18h272.8c12.3 23.5 21.4 40.3 28.1 68.3-118 19.8-137.8 26.8-247.03 65.1C126.4 344.9 167 425 232.8 492.4l246.2-.3c-87.1-63.9-203.5-127.6-260.1-201.3 64.2-33.7 98.8-49.9 155.5-74.6-11.5-28.8-30.3-59.7-53.9-84.8H480v-18H251.2l-54.5-67.85-35.6 23.16z"/></svg></button>
            <button type="button" id="scene-blocked-mode" aria-label="Edit blocked cells" title="Edit blocked cells" aria-pressed="false"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M271.9 25.85c-18.4 0-36 16.73-39.2 40.97-3.4 25.83 11.3 47.48 30.9 49.88 19.7 2.4 39.5-14.9 43-40.77 3.5-25.86-11.5-47.43-31-49.85-1.2-.15-2.5-.23-3.7-.23zm-38.2 95.75c-38 6.3-75.2 41.9-94 66-11.5 33.4-14.5 66.7-20.7 100l28.2-.8c6.6-25.2 8.2-51.9 21-75.4 14.8-8.2 26.9-20.6 38.4-33.8-6.4 32.9-14 72.3-13.2 101.8 29.8 70.9 95.7 140.4 133 206.4l29.9-24.3c-28.8-55.7-57.5-106.4-94.3-160.2 2.1-7.1 43.3-163.5 28-171.9-20.2 9-40.9 6-56.3-7.8zm71.9 58.6c-3.1 17.8-5.3 35.1-10 52.8 4.5 5.4 7.5 10.5 14.3 15.3 26 15.3 52 26.3 78 36.7l9.2-29.9-77.5-37.6c-4.3-12.5-7.9-25.2-14-37.3zM187.1 310.1c-5.1 25-9.8 50.2-11.6 76.5-15.9 31.7-35.7 51.6-60.5 76.4l30 23.2c23.1-25 49.9-47 66.7-73.8l14-42.6c-15.7-19-28.4-38.8-38.6-59.7z"/></svg></button>
          </div><a id="scene-background-link" href="/art" target="_blank" rel="noopener noreferrer" hidden>EDIT BACKGROUND ↗</a></div>
          <div id="scene-inspector"></div></aside>
      </div></section>
      <dialog id="scene-new-dialog" class="scene-new-dialog" aria-labelledby="scene-new-title">
        <form id="scene-new-form">
          <h2 id="scene-new-title">NEW SCENE</h2>
          <label>LABEL<input id="scene-new-label" type="text" maxlength="80" required autocomplete="off"></label>
          <div class="scene-pair"><label>WIDTH<input id="scene-new-width" type="number" min="1" max="256" step="1" value="120" required></label><label>HEIGHT<input id="scene-new-height" type="number" min="1" max="128" step="1" value="40" required></label></div>
          <label>DEPTH MODE<select id="scene-new-depth"><option value="bottom-up">BOTTOM UP</option><option value="regular-z">REGULAR Z</option></select></label>
          <p id="scene-new-error" role="alert" hidden></p>
          <div class="scene-new-actions"><button type="submit">CREATE</button><button type="button" id="scene-new-cancel">CANCEL</button></div>
        </form>
      </dialog>
      <dialog id="scene-background-picker" class="scene-background-picker" aria-labelledby="scene-background-picker-title">
        <h2 id="scene-background-picker-title">ADD BACKGROUND SPRITE</h2>
        <p>Choose a sprite frame. It becomes a movable, non-blocking background prop in this scene.</p>
        <label for="scene-background-search">SEARCH SPRITE SHEETS</label>
        <input id="scene-background-search" type="search" placeholder="Search by name or id…" autocomplete="off">
        <div id="scene-background-results" class="scene-background-results" aria-label="Sprite sheets"></div>
        <div id="scene-background-frames" class="scene-background-frames"></div>
        <p id="scene-background-status" role="status"></p>
        <div class="scene-background-actions"><button id="scene-background-add" type="button" disabled>ADD SPRITE</button><button id="scene-background-cancel" type="button">CANCEL</button></div>
      </dialog>
      <dialog id="scene-prop-picker" class="scene-prop-picker" aria-labelledby="scene-prop-picker-title">
        <h2 id="scene-prop-picker-title">ADD EXISTING PROP</h2>
        <label for="scene-prop-search">SEARCH PROPS</label>
        <input id="scene-prop-search" type="search" placeholder="Search by name…" autocomplete="off">
        <div id="scene-prop-results" class="scene-prop-results"></div>
        <p id="scene-prop-status" role="status"></p>
        <div class="scene-background-actions"><button id="scene-prop-add" type="button" disabled>ADD TO SCENE</button><button id="scene-prop-cancel" type="button">CANCEL</button></div>
      </dialog>
      <dialog id="scene-character-picker" class="scene-prop-picker" aria-labelledby="scene-character-picker-title">
        <h2 id="scene-character-picker-title">ADD EXISTING CHARACTER</h2>
        <label for="scene-character-search">SEARCH CHARACTERS</label>
        <input id="scene-character-search" type="search" placeholder="Search characters…" autocomplete="off">
        <div id="scene-character-results" class="scene-prop-results"></div>
        <p id="scene-character-status" role="status"></p>
        <div class="scene-background-actions"><button id="scene-character-add" type="button" disabled>ADD TO SCENE</button><button id="scene-character-cancel" type="button">CANCEL</button></div>
      </dialog>
      <div id="toast-stack" class="toast-stack" aria-live="polite"></div>`,
  );
  root.querySelector('.simple-main')?.classList.add('scene-main');
  const menubar = document.createElement('nav');
  menubar.className = 'scene-menubar';
  menubar.setAttribute('aria-label', 'Scene editor');
  menubar.innerHTML = `<details class="scene-menu"><summary>FILE</summary><div class="scene-menu-panel">
    <button id="scene-new" type="button">New scene</button>
    <button id="scene-save" type="button">Save</button>
    <button id="scene-delete" type="button">Delete</button>
  </div></details><details class="scene-menu"><summary>ENTITIES</summary><div class="scene-menu-panel">
    <button id="scene-add-prop" type="button">Add Prop…</button>
    <button id="scene-add-character" type="button">Add Character…</button>
    <button id="scene-add-trigger" type="button">Add Trigger</button>
  </div></details>`;
  const tabs = document.createElement('div');
  tabs.id = 'scene-tabs';
  tabs.className = 'scene-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Open scenes');
  menubar.append(tabs);
  root.querySelector('.simple-main')?.before(menubar);
  const statusbar = document.createElement('footer');
  statusbar.className = 'scene-statusbar';
  statusbar.innerHTML = `<div class="scene-status-row"><button id="scene-cancel-trigger" type="button" hidden>CANCEL</button><span id="scene-status" role="status">Create a scene or open one from the list.</span></div>`;
  root.querySelector('.simple-main')?.after(statusbar);
  const $ = <T extends Element>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const list = $<HTMLElement>('#scene-list');
  const inspector = $<HTMLElement>('#scene-inspector');
  const status = $<HTMLElement>('#scene-status');
  const newDialog = $<HTMLDialogElement>('#scene-new-dialog');
  const canvas = $<HTMLCanvasElement>('#scene-canvas');
  const hoverCanvas = $<HTMLCanvasElement>('#scene-hover');
  const viewport = $<HTMLElement>('#scene-viewport');
  const backgroundPicker = $<HTMLDialogElement>('#scene-background-picker');
  const backgroundSearch = $<HTMLInputElement>('#scene-background-search');
  const backgroundResults = $<HTMLElement>('#scene-background-results');
  const backgroundFrames = $<HTMLElement>('#scene-background-frames');
  const backgroundStatus = $<HTMLElement>('#scene-background-status');
  const backgroundAdd = $<HTMLButtonElement>('#scene-background-add');
  const propPicker = $<HTMLDialogElement>('#scene-prop-picker');
  const propSearch = $<HTMLInputElement>('#scene-prop-search');
  const propResults = $<HTMLElement>('#scene-prop-results');
  const propStatus = $<HTMLElement>('#scene-prop-status');
  const propAdd = $<HTMLButtonElement>('#scene-prop-add');
  const characterPicker = $<HTMLDialogElement>('#scene-character-picker');
  const characterSearch = $<HTMLInputElement>('#scene-character-search');
  const characterResults = $<HTMLElement>('#scene-character-results');
  const characterStatus = $<HTMLElement>('#scene-character-status');
  const characterAdd = $<HTMLButtonElement>('#scene-character-add');
  const showTriggersInput = $<HTMLInputElement>('#scene-show-triggers');
  const showBlockedInput = $<HTMLInputElement>('#scene-show-blocked');
  const showUiInput = $<HTMLInputElement>('#scene-show-ui');
  const toastStack = $<HTMLElement>('#toast-stack');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Scene canvas unavailable');
  const context: CanvasRenderingContext2D = ctx;
  const hoverDrawing = hoverCanvas.getContext('2d');
  if (!hoverDrawing) throw new Error('Scene hover canvas unavailable');
  const hoverContext: CanvasRenderingContext2D = hoverDrawing;
  let cell = terminalCellAtZoom(context, 1);
  let alive = true;
  let token = 0;
  let saving = false;
  let files: string[] = [];
  let sceneLabels: Record<string, string> = {};
  let props: string[] = [];
  let rpgTriggers: string[] = [];
  let sprites: string[] = [];
  let spriteLabels: Record<string, string> = {};
  let palette: PaletteDocument | null = null;
  let current: SceneDocument | null = null;
  let saved: SceneDocument | null = null;
  const storedTabs = readSceneTabs(localStorage);
  let openTabs = storedTabs.tabs;
  const sessions = new Map<string, SceneTabSession>(Object.entries(storedTabs.drafts));
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let switchToken = 0;
  let selected: ObjectRef[] = [];
  let objectClipboard: SceneClipboard | null = null;
  let canvasMouse: { clientX: number; clientY: number } | null = null;
  let hovered: ObjectRef | null = null;
  let showPropNames = false;
  let showTriggers = true;
  let showBlockedCells = false;
  let showUi = false;
  const triggersVisible = () => showTriggers || showPropNames;
  const blockedVisible = () => showBlockedCells || showPropNames;
  let propLabels: Array<{ id: string; name: string; x: number; y: number; width: number }> = [];
  let triggerLabels: Array<{ id: string; name: string; x: number; y: number; width: number }> = [];
  let backgroundEdit = false;
  let blockedEdit = false;
  let blockStroke: { pointerId: number; point: { x: number; y: number }; blocked: boolean } | null =
    null;
  let hitBoxes: SceneHitBox[] = [];
  let backgroundChoice: { sprite: string; index: number } | null = null;
  let backgroundSheetId: string | null = null;
  let pickerToken = 0;
  let propPickerToken = 0;
  let propLoadToken = 0;
  let propChoice: string | null = null;
  let characterChoice: CharacterDocument | null = null;
  let characterPickerToken = 0;
  let drag: {
    pointerId: number;
    x: number;
    y: number;
    items: Array<{ ref: ObjectRef; x: number; y: number; width: number; height: number }>;
  } | null = null;
  let marquee: {
    pointerId: number;
    x: number;
    y: number;
    endX: number;
    endY: number;
    additive: boolean;
  } | null = null;
  let view: SceneView = { zoom: 1, x: 0, y: 0 };
  let autoFit = true;
  let spaceHeld = false;
  let pan: { pointerId: number; x: number; y: number; startX: number; startY: number } | null =
    null;
  let placingTrigger = false;
  let drawingTrigger: {
    pointerId: number;
    x: number;
    y: number;
    endX: number;
    endY: number;
  } | null = null;
  let resizing: {
    pointerId: number;
    id: string;
    handle: ResizeHandle;
    start: { x: number; y: number; width: number; height: number };
  } | null = null;
  const sheetCache = new Map<string, Promise<SpriteDocument | null>>();
  const propCache = new Map<string, Promise<PropDocument | null>>();
  const animationCache = new Map<string, Promise<AnimationDocument | null>>();
  const characterCache = new Map<string, Promise<CharacterDocument | null>>();
  const dirty = () => current !== null && JSON.stringify(current) !== JSON.stringify(saved);
  const sceneName = (id: string) =>
    id === current?.id
      ? (current.label ?? id)
      : (sessions.get(id)?.doc.label ?? sceneLabels[id] ?? id);
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'Scene request failed';
  const tabDirty = (id: string) =>
    id === current?.id
      ? dirty()
      : !!sessions.get(id) &&
        JSON.stringify(sessions.get(id)?.doc) !== JSON.stringify(sessions.get(id)?.saved);
  setDirtyGuard(
    async () =>
      !openTabs.some(tabDirty) || confirmModal('Discard unsaved scene changes?', 'DISCARD'),
  );

  function persistTabs(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    const drafts: Record<string, SceneTabSession> = {};
    for (const id of openTabs) {
      const session = id === current?.id && current ? { doc: current, saved } : sessions.get(id);
      if (session && JSON.stringify(session.doc) !== JSON.stringify(session.saved))
        drafts[id] = session;
    }
    try {
      localStorage.setItem(
        OPEN_SCENES_KEY,
        JSON.stringify({ version: 1, tabs: openTabs, active: current?.id ?? null, drafts }),
      );
    } catch {
      status.textContent = 'Could not store open scene drafts locally';
    }
  }
  function scheduleTabs(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistTabs, 400);
  }
  function stashCurrent(): void {
    if (current) sessions.set(current.id, { doc: current, saved });
  }
  function renderTabs(): void {
    const host = $<HTMLElement>('#scene-tabs');
    host.replaceChildren();
    if (!openTabs.length) {
      const empty = document.createElement('span');
      empty.className = 'scene-tabs-empty';
      empty.textContent = 'NO SCENE';
      host.append(empty);
    }
    for (const id of openTabs) {
      const tab = document.createElement('div');
      tab.className = 'scene-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(current?.id === id));
      tab.classList.toggle('current', current?.id === id);
      tab.classList.toggle('dirty', tabDirty(id));
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'scene-tab-label';
      label.textContent = sceneName(id);
      const mark = document.createElement('span');
      mark.className = 'scene-dirty-mark';
      mark.textContent = ' ●';
      label.append(mark);
      label.addEventListener('click', () => void open(id));
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'scene-tab-close';
      close.setAttribute('aria-label', `Close ${sceneName(id)}`);
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
  function activateScene(scene: SceneDocument, baseline: SceneDocument | null): void {
    stashCurrent();
    sessions.delete(scene.id);
    current = scene;
    saved = baseline;
    if (!openTabs.includes(scene.id)) openTabs.push(scene.id);
    backgroundEdit = false;
    blockedEdit = false;
    blockStroke = null;
    placingTrigger = false;
    selected = [];
    hovered = null;
    setEditorAssetUrl(baseline ? scene.id : null);
    render();
    fitView();
    persistTabs();
  }
  async function closeTab(id: string): Promise<void> {
    if (!openTabs.includes(id) || saving) return;
    if (tabDirty(id) && !(await confirmModal('Discard unsaved scene changes?', 'DISCARD'))) return;
    const next = neighborSceneTab(openTabs, id);
    openTabs = openTabs.filter((tab) => tab !== id);
    sessions.delete(id);
    if (current?.id === id) {
      ++switchToken;
      current = null;
      saved = null;
      setEditorAssetUrl(null);
      if (next) await open(next);
      else {
        status.textContent = 'Open a scene from the list.';
        render();
      }
    } else renderTabs();
    persistTabs();
  }

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
    toastStack.append(item);
    setTimeout(() => item.remove(), 4000);
  }

  function cache<T>(
    map: Map<string, Promise<T | null>>,
    id: string,
    url: string,
  ): Promise<T | null> {
    let pending = map.get(id);
    if (!pending) {
      pending = requestJson<T>(url).catch(() => null);
      map.set(id, pending);
    }
    return pending;
  }
  const sheet = (id: string) => cache(sheetCache, id, `/api/sprites/${encodeURIComponent(id)}`);
  const prop = (id: string) => cache(propCache, id, `/api/props/${encodeURIComponent(id)}`);
  const animation = (id: string) =>
    cache(animationCache, id, `/api/animations/${encodeURIComponent(id)}`);
  const character = (id: string) =>
    cache(characterCache, id, `/api/characters/${encodeURIComponent(id)}`);

  function background(): Extract<SceneEntity, { type: 'Background' }> | undefined {
    return current?.entities.find((entity) => entity.type === 'Background') as
      | Extract<SceneEntity, { type: 'Background' }>
      | undefined;
  }

  function selectable(ref: ObjectRef): boolean {
    return current !== null && canSelectSceneObject(current, ref, backgroundEdit);
  }

  const isSelected = (ref: ObjectRef) => selected.some((entry) => sameSceneObject(entry, ref));
  const onlySelected = () => (selected.length === 1 ? selected[0] : null);

  function positioned(ref: ObjectRef): (SceneEntity | Exclude<SceneTrigger, string>) | null {
    if (!current) return null;
    return ref.kind === 'entity'
      ? (current.entities.find((entry) => entry.id === ref.id) ?? null)
      : (current.triggers.find(
          (entry): entry is Exclude<SceneTrigger, string> =>
            typeof entry !== 'string' && entry.id === ref.id,
        ) ?? null);
  }

  function handlePositions(region: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Array<{ handle: ResizeHandle; x: number; y: number }> {
    const left = region.x;
    const middleX = region.x + region.width / 2;
    const right = region.x + region.width;
    const top = region.y;
    const middleY = region.y + region.height / 2;
    const bottom = region.y + region.height;
    return [
      { handle: 'nw', x: left, y: top },
      { handle: 'n', x: middleX, y: top },
      { handle: 'ne', x: right, y: top },
      { handle: 'e', x: right, y: middleY },
      { handle: 'se', x: right, y: bottom },
      { handle: 's', x: middleX, y: bottom },
      { handle: 'sw', x: left, y: bottom },
      { handle: 'w', x: left, y: middleY },
    ];
  }

  function handleAt(event: MouseEvent): ResizeHandle | null {
    const ref = onlySelected();
    if (backgroundEdit || !triggersVisible() || ref?.kind !== 'trigger') return null;
    const trigger = positioned(ref);
    if (!trigger || !('event' in trigger) || trigger.event === 'load') return null;
    const pixel = viewportPixel(event);
    let nearest: ResizeHandle | null = null;
    let distance = 9 * 9;
    for (const point of handlePositions(trigger)) {
      const dx = pixel.x - (view.x + point.x * cell.width * view.zoom);
      const dy = pixel.y - (view.y + point.y * cell.height * view.zoom);
      const candidate = dx * dx + dy * dy;
      if (candidate < distance) {
        nearest = point.handle;
        distance = candidate;
      }
    }
    return nearest;
  }

  let drawPending = false;
  function redraw(): void {
    if (drawPending || !alive) return;
    drawPending = true;
    requestAnimationFrame(() => {
      drawPending = false;
      if (alive) void draw();
    });
  }

  function applyView(): void {
    $<HTMLElement>('#scene-zoom-label').textContent = `${Math.round(view.zoom * 100)}%`;
    redraw();
  }

  function fitView(repaint = true): void {
    if (!current || !viewport.clientWidth || !viewport.clientHeight) return;
    autoFit = true;
    view = fitSceneView(
      viewport.clientWidth,
      viewport.clientHeight,
      current.width * cell.width,
      current.height * cell.height,
    );
    if (repaint) applyView();
  }

  function setZoom(
    zoom: number,
    x = viewport.clientWidth / 2,
    y = viewport.clientHeight / 2,
  ): void {
    autoFit = false;
    view = zoomSceneView(view, zoom, x, y);
    applyView();
  }

  function stepZoom(direction: number, x?: number, y?: number): void {
    const index =
      direction > 0
        ? SCENE_ZOOM_STEPS.findIndex((step) => step > view.zoom + 0.001)
        : SCENE_ZOOM_STEPS.reduce((found, step, at) => (step < view.zoom - 0.001 ? at : found), -1);
    if (index !== -1) setZoom(SCENE_ZOOM_STEPS[index], x, y);
  }

  function viewportPixel(event: Pick<MouseEvent, 'clientX' | 'clientY'>): { x: number; y: number } {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function syncCursor(event?: MouseEvent): void {
    const point = event ? canvasPoint(event) : null;
    const handle = event ? handleAt(event) : null;
    const cursor = pan
      ? 'grabbing'
      : spaceHeld
        ? 'grab'
        : blockedEdit
          ? 'crosshair'
          : placingTrigger
            ? 'crosshair'
            : handle
              ? `${handle}-resize`
              : point && hitAt(point.x, point.y)
                ? 'move'
                : 'default';
    viewport.style.cursor = cursor;
    canvas.style.cursor = cursor;
  }

  /** Rasterize directly at viewport resolution; zoom belongs in the drawing transform. */
  function prepareCanvas(target: HTMLCanvasElement, drawing: CanvasRenderingContext2D): void {
    const ratio = window.devicePixelRatio || 1;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (target.width !== pixelWidth) target.width = pixelWidth;
    if (target.height !== pixelHeight) target.height = pixelHeight;
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    drawing.resetTransform();
    drawing.clearRect(0, 0, target.width, target.height);
    drawing.setTransform(
      ratio * view.zoom,
      0,
      0,
      ratio * view.zoom,
      ratio * view.x,
      ratio * view.y,
    );
  }

  function clipScene(drawing: CanvasRenderingContext2D): void {
    drawing.beginPath();
    drawing.rect(0, 0, (current?.width ?? 0) * cell.width, (current?.height ?? 0) * cell.height);
    drawing.clip();
  }

  function paintHover(): void {
    prepareCanvas(hoverCanvas, hoverContext);
    hoverContext.save();
    clipScene(hoverContext);
    paintHoverContents();
    hoverContext.restore();
  }

  function paintHoverContents(): void {
    if (blockedEdit) {
      const point = canvasMouse && !pan && !spaceHeld ? canvasPoint(canvasMouse) : null;
      if (point) {
        const inset = 1 / view.zoom;
        hoverContext.strokeStyle = '#ffffff';
        hoverContext.lineWidth = 2 / view.zoom;
        hoverContext.strokeRect(
          point.x * cell.width + inset,
          point.y * cell.height + inset,
          cell.width - inset * 2,
          cell.height - inset * 2,
        );
      }
      return;
    }
    const sceneWidth = (current?.width ?? 0) * cell.width;
    if (!backgroundEdit && (showPropNames || hovered)) {
      hoverContext.font = 'bold 12px sans-serif';
      hoverContext.textBaseline = 'top';
      for (const label of [
        ...propLabels
          .filter(
            (entry) => showPropNames || (hovered?.kind === 'entity' && hovered.id === entry.id),
          )
          .map((entry) => ({ ...entry, trigger: false })),
        ...(triggersVisible() ? triggerLabels : [])
          .filter(
            (entry) => showPropNames || (hovered?.kind === 'trigger' && hovered.id === entry.id),
          )
          .map((entry) => ({ ...entry, trigger: true })),
      ]) {
        const y = Math.max(0, (label.y - (label.trigger ? 0 : 1)) * cell.height);
        const width = Math.min(sceneWidth, hoverContext.measureText(label.name).width + 8);
        const center = (label.x + label.width / 2) * cell.width;
        const x = Math.max(0, Math.min(sceneWidth - width, center - width / 2));
        hoverContext.fillStyle = 'rgba(12, 14, 13, 0.9)';
        hoverContext.fillRect(x, y, width, 17);
        const trigger = label.trigger
          ? current?.triggers.find((entry) => typeof entry !== 'string' && entry.id === label.id)
          : null;
        hoverContext.fillStyle =
          trigger && typeof trigger !== 'string' ? sceneTriggerColors(trigger).selected : '#ffe1a1';
        hoverContext.fillText(label.name, x + 4, y + 2, Math.max(0, width - 8));
      }
    }
    if (drawingTrigger && current) {
      const region = triggerRegion(
        drawingTrigger.x,
        drawingTrigger.y,
        drawingTrigger.endX,
        drawingTrigger.endY,
        current.width,
        current.height,
      );
      hoverContext.fillStyle = 'rgba(235, 88, 79, 0.25)';
      hoverContext.strokeStyle = '#ffae95';
      hoverContext.fillRect(
        region.x * cell.width,
        region.y * cell.height,
        region.width * cell.width,
        region.height * cell.height,
      );
      hoverContext.strokeRect(
        region.x * cell.width + 0.5,
        region.y * cell.height + 0.5,
        region.width * cell.width - 1,
        region.height * cell.height - 1,
      );
      return;
    }
    if (marquee) {
      const { x, y, endX, endY } = marquee;
      const left = Math.min(x, endX) * cell.width;
      const top = Math.min(y, endY) * cell.height;
      const width = Math.abs(endX - x) * cell.width;
      const height = Math.abs(endY - y) * cell.height;
      hoverContext.fillStyle = 'rgba(255, 174, 149, 0.18)';
      hoverContext.fillRect(left, top, width, height);
      hoverContext.strokeStyle = '#ffae95';
      hoverContext.setLineDash([4, 3]);
      hoverContext.strokeRect(left, top, width, height);
      hoverContext.setLineDash([]);
      return;
    }
    const active = onlySelected();
    const region = active?.kind === 'trigger' ? positioned(active) : null;
    if (
      region &&
      triggersVisible() &&
      'width' in region &&
      (!('event' in region) || region.event !== 'load')
    ) {
      hoverContext.fillStyle = 'event' in region ? sceneTriggerColors(region).selected : '#ffae95';
      hoverContext.strokeStyle = '#102b2a';
      for (const { x, y } of handlePositions(region)) {
        const size = 8 / view.zoom;
        hoverContext.fillRect(x * cell.width - size / 2, y * cell.height - size / 2, size, size);
        hoverContext.strokeRect(x * cell.width - size / 2, y * cell.height - size / 2, size, size);
      }
    }
    if (!hovered || !selectable(hovered)) return;
    const box = [...hitBoxes]
      .reverse()
      .find((hit) => hit.ref.kind === hovered?.kind && hit.ref.id === hovered?.id);
    if (!box) return;
    const hoverItem = positioned(hovered);
    hoverContext.strokeStyle =
      hovered.kind === 'trigger' && hoverItem && 'event' in hoverItem
        ? sceneTriggerColors(hoverItem).selected
        : '#ffe1a1';
    hoverContext.lineWidth = 1;
    hoverContext.setLineDash([3, 3]);
    hoverContext.strokeRect(
      box.x * cell.width + 0.5,
      box.y * cell.height + 0.5,
      box.width * cell.width - 1,
      box.height * cell.height - 1,
    );
    hoverContext.setLineDash([]);
  }

  function setHover(ref: ObjectRef | null): void {
    if (hovered?.kind === ref?.kind && hovered?.id === ref?.id) return;
    hovered = ref;
    paintHover();
  }

  const resizeObserver = new ResizeObserver(() => {
    if (autoFit) fitView();
    else redraw();
  });
  resizeObserver.observe(viewport);

  function renderList(): void {
    list.replaceChildren();
    const query = $<HTMLInputElement>('#scene-search').value.toLowerCase();
    for (const id of files.filter(
      (file) => file.includes(query) || sceneName(file).toLowerCase().includes(query),
    )) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = sceneName(id);
      button.title = id;
      button.classList.toggle('active', current?.id === id);
      button.addEventListener('click', () => void open(id));
      list.append(button);
    }
    if (!list.childElementCount) list.textContent = files.length ? 'No matches.' : 'No scenes.';
  }

  function picked(): SceneEntity | SceneTrigger | null {
    const ref = onlySelected();
    if (!current || !ref || !selectable(ref)) return null;
    return ref.kind === 'entity'
      ? (current.entities.find((entry) => entry.id === ref.id) ?? null)
      : (current.triggers.find(
          (entry) => (typeof entry === 'string' ? entry : entry.id) === ref.id,
        ) ?? null);
  }

  function field(
    label: string,
    value: string | number,
    onChange: (value: string) => void,
    options: { min?: number; max?: number } = {},
    container: HTMLElement = inspector,
  ): void {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement('input');
    input.type = typeof value === 'number' ? 'number' : 'text';
    input.value = String(value);
    if (typeof value === 'string' && options.max !== undefined) input.maxLength = options.max;
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    input.addEventListener('change', () => onChange(input.value));
    wrapper.append(input);
    container.append(wrapper);
  }
  function numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    set: (value: number) => void,
    container: HTMLElement = inspector,
  ): void {
    field(
      label,
      value,
      (raw) => {
        const next = Number(raw);
        if (!Number.isInteger(next) || next < min || next > max) {
          status.textContent = `${label} must be ${min} to ${max}`;
          renderInspector();
          return;
        }
        set(next);
        render();
      },
      { min, max },
      container,
    );
  }
  function selectField(
    label: string,
    value: string,
    choices: string[],
    set: (value: string) => void,
    labels: Record<string, string> = {},
  ): void {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const select = document.createElement('select');
    for (const choice of [...new Set([value, ...choices])]) {
      const option = document.createElement('option');
      option.value = choice;
      option.textContent = labels[choice] ?? choice;
      select.append(option);
    }
    select.value = value;
    select.addEventListener('change', () => {
      set(select.value);
      render();
    });
    wrapper.append(select);
    inspector.append(wrapper);
  }

  function renderInspector(): void {
    inspector.replaceChildren();
    if (selected.length > 1) {
      const heading = document.createElement('h2');
      heading.textContent = `${selected.length} OBJECTS SELECTED`;
      inspector.append(heading);
      return;
    }
    const item = picked();
    if (!item || !current) return;
    const heading = document.createElement('h2');
    heading.textContent =
      onlySelected()?.kind === 'trigger'
        ? 'TRIGGER'
        : typeof item !== 'string' && 'type' in item && item.type === 'Background'
          ? 'BACKGROUND'
          : typeof item !== 'string' && 'type' in item && item.type === 'Character'
            ? 'CHARACTER'
            : 'PROP';
    inspector.append(heading);
    const id = typeof item === 'string' ? item : item.id;
    const idRow = document.createElement('div');
    idRow.className = 'scene-id-row';
    const idText = document.createElement('span');
    idText.className = 'scene-id-text';
    idText.textContent = `ID: ${id}`;
    idText.title = id;
    const copyId = document.createElement('button');
    copyId.type = 'button';
    copyId.textContent = 'COPY';
    copyId.setAttribute('aria-label', 'Copy ID');
    copyId.addEventListener('click', () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(id);
          toast('Copied ID to clipboard');
        } catch {
          status.textContent = 'Could not copy ID to clipboard';
          toast(status.textContent, true);
        }
      })();
    });
    idRow.append(idText, copyId);
    inspector.append(idRow);
    if (typeof item === 'string') {
      const note = document.createElement('p');
      note.textContent = 'Legacy load trigger. The ID matches an RPGScript #trigger name.';
      inspector.append(note);
    } else if ('event' in item) {
      const binding = document.createElement('label');
      binding.textContent = 'RPGTRIGGER';
      const updateBinding = (value: string) => {
        item.trigger = value.trim();
        const label = triggerLabels.find((entry) => entry.id === item.id);
        if (label && !item.trigger)
          triggerLabels = triggerLabels.filter((entry) => entry.id !== item.id);
        else if (label) label.name = item.trigger;
        else if (item.trigger)
          triggerLabels.push({
            id: item.id,
            name: item.trigger,
            x: item.x,
            y: item.y,
            width: item.event === 'action' ? item.width : 1,
          });
        paintHover();
      };
      binding.append(
        createSearchSelect({
          value: item.trigger,
          choices: rpgTriggers,
          placeholder: 'Search or paste RPGTrigger…',
          ariaLabel: 'RPGTrigger',
          onInput: updateBinding,
          onCommit: updateBinding,
        }),
      );
      inspector.append(binding);
      if (item.event === 'load') {
        const note = document.createElement('p');
        note.textContent = 'Legacy scene-load trigger (no region).';
        inspector.append(note);
      } else {
        for (const [label, key, initial] of [
          ['ACTION', 'actionEnabled', true],
          ['STEP', 'stepEnabled', false],
        ] as const) {
          const wrapper = document.createElement('label');
          wrapper.className = 'scene-trigger-toggle';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = item[key] ?? initial;
          checkbox.addEventListener('change', () => {
            item[key] = checkbox.checked;
            render();
          });
          wrapper.append(checkbox, document.createTextNode(label));
          inspector.append(wrapper);
        }
        if (item.actionEnabled ?? true) {
          const description = document.createElement('label');
          description.textContent = 'DESCRIPTION';
          const textarea = document.createElement('textarea');
          textarea.value = item.description ?? '';
          textarea.maxLength = 1000;
          textarea.rows = 4;
          textarea.placeholder = 'Describe this action trigger…';
          textarea.addEventListener('input', () => {
            item.description = textarea.value;
          });
          description.append(textarea);
          inspector.append(description);
        }
        const note = document.createElement('p');
        note.textContent =
          'Uncheck both to disable this region. Region behavior in the game is not yet implemented.';
        inspector.append(note);
      }
    } else {
      if (item.type === 'Prop' || item.type === 'Character')
        field(
          'INSTANCE NAME',
          item.name ?? item.id,
          (value) => {
            const name = value.trim();
            if (!name || name.length > 80) {
              status.textContent = 'Instance name must be 1 to 80 characters';
              renderInspector();
              return;
            }
            item.name = name;
            render();
          },
          { max: 80 },
        );
      if (item.type === 'Background') {
        selectField(
          'SPRITE SHEET',
          item.sprite,
          sprites,
          (v) => {
            item.sprite = v;
            item.index = 0;
          },
          spriteLabels,
        );
        numberField('FRAME (ZERO BASED)', item.index, 0, 255, (v) => {
          item.index = v;
        });
        const footprint = document.createElement('p');
        footprint.textContent = 'Footprint: loading sprite…';
        inspector.append(footprint);
        const spriteId = item.sprite;
        const itemId = item.id;
        void sheet(spriteId).then((sprite) => {
          if (
            !alive ||
            !footprint.isConnected ||
            onlySelected()?.id !== itemId ||
            item.sprite !== spriteId
          )
            return;
          footprint.textContent = sprite
            ? `Footprint: ${sprite.width} × ${sprite.height} cells (sprite size). No blocked cells. Background depth.`
            : 'Sprite unavailable.';
        });
      } else if (item.type === 'Character') {
        const assetId = item.character;
        const assetLabel = document.createElement('p');
        assetLabel.textContent = `Character asset: ${assetId}`;
        inspector.append(assetLabel);
        const link = document.createElement('a');
        link.href = `/characters?id=${encodeURIComponent(assetId)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'EDIT CHARACTER ↗';
        inspector.append(link);
        const facingLabel = document.createElement('div');
        facingLabel.className = 'scene-facing-label';
        facingLabel.textContent = 'FACING';
        const facingButtons = document.createElement('div');
        facingButtons.className = 'scene-facing-buttons';
        facingButtons.setAttribute('role', 'group');
        facingButtons.setAttribute('aria-label', 'Facing direction');
        for (const [direction, arrow] of [
          ['up', '↑'],
          ['left', '←'],
          ['right', '→'],
          ['down', '↓'],
        ] as const) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `scene-facing-${direction}`;
          button.textContent = arrow;
          button.setAttribute('aria-label', `Face ${direction}`);
          button.setAttribute('aria-pressed', String(item.facing === direction));
          button.addEventListener('click', () => {
            item.facing = direction;
            render();
          });
          facingButtons.append(button);
        }
        inspector.append(facingLabel, facingButtons);
        const itemId = item.id;
        const stateLabel = document.createElement('label');
        stateLabel.textContent = 'STARTING ANIMATION STATE';
        const stateSelect = document.createElement('select');
        stateSelect.disabled = true;
        stateSelect.append(new Option(item.state, item.state));
        stateLabel.append(stateSelect);
        inspector.append(stateLabel);
        void character(assetId).then((asset) => {
          if (
            !alive ||
            !stateLabel.isConnected ||
            onlySelected()?.id !== itemId ||
            item.character !== assetId
          )
            return;
          if (!asset) return;
          stateSelect.replaceChildren();
          for (const choice of [
            ...new Set([
              item.state,
              'idle',
              'walk',
              'talking',
              ...Object.keys(asset.customAnimations),
            ]),
          ])
            stateSelect.append(new Option(choice, choice));
          stateSelect.value = item.state;
          stateSelect.disabled = false;
        });
        stateSelect.addEventListener('change', () => {
          item.state = stateSelect.value;
          render();
        });
      } else if ('prop' in item) {
        selectField('PROP ASSET', item.prop, props, (v) => {
          item.prop = v;
        });
        const link = document.createElement('a');
        link.href = `/props?id=${encodeURIComponent(item.prop)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'EDIT PROP ↗';
        inspector.append(link);
      } else {
        const note = document.createElement('p');
        note.textContent = `Legacy sprite: ${spriteLabels[item.sprite] ?? item.sprite}`;
        inspector.append(note);
      }
      const positionRow =
        item.type === 'Prop' || item.type === 'Character'
          ? document.createElement('div')
          : inspector;
      if (positionRow !== inspector) {
        positionRow.className = 'scene-position-row';
        inspector.append(positionRow);
      }
      numberField(
        'X',
        item.x,
        0,
        current.width - 1,
        (v) => {
          item.x = v;
        },
        positionRow,
      );
      numberField(
        'Y',
        item.y,
        0,
        current.height - 1,
        (v) => {
          item.y = v;
        },
        positionRow,
      );
      if (item.type === 'Prop' || item.type === 'Character')
        numberField(
          'Z',
          item.z,
          -1000,
          1000,
          (v) => {
            item.z = v;
          },
          positionRow,
        );
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'REMOVE OBJECT';
    remove.addEventListener('click', () => {
      const ref = onlySelected();
      if (!current || !ref) return;
      if (ref.kind === 'entity')
        current.entities = current.entities.filter((entry) => entry.id !== ref.id);
      else
        current.triggers = current.triggers.filter(
          (entry) => (typeof entry === 'string' ? entry : entry.id) !== ref.id,
        );
      if (backgroundEdit && !background()) backgroundEdit = false;
      selected = [];
      render();
    });
    inspector.append(remove);
  }

  async function draw(): Promise<void> {
    const scene = current;
    const drawToken = ++token;
    if (!scene) return;
    if (autoFit) fitView(false);
    $<HTMLElement>('#scene-zoom-label').textContent = `${Math.round(view.zoom * 100)}%`;
    const composed = Array.from({ length: scene.width * scene.height }, () => ({
      ch: ' ',
      fg: '#000000',
      bg: '#000000',
    }));
    const visuals = await Promise.all(
      scene.entities.map(async (entry) => {
        if (entry.type === 'Background')
          return { entry, sprite: await sheet(entry.sprite), index: entry.index, depth: 0 };
        if (entry.type === 'Character') {
          const asset = await character(entry.character);
          const animationId = asset && characterAnimation(asset, entry.state, entry.facing);
          const clip = animationId ? await animation(animationId) : null;
          const first = clip?.frames.find((frame) => !isInvisibleFrame(frame));
          if (!clip || !first || isInvisibleFrame(first))
            return {
              entry,
              sprite: null,
              index: 0,
              depth: sceneDepth(scene.depthMode, entry.y, entry.z, 0),
            };
          return {
            entry,
            sprite: await sheet(first.sprite),
            index: first.index,
            flips: animationFrameFlips(clip, first),
            depth: sceneDepth(scene.depthMode, entry.y, entry.z, 0),
          };
        }
        if ('sprite' in entry)
          return {
            entry,
            sprite: await sheet(entry.sprite),
            index: 0,
            depth: sceneDepth(scene.depthMode, entry.y, entry.z, entry.depthOffset),
          };
        const asset = await prop(entry.prop);
        if (!asset) return { entry, sprite: null, index: 0, depth: entry.y };
        let spriteId: string;
        let index: number;
        let flips: { flipH: boolean; flipV: boolean } | undefined;
        if (asset.visual.type === 'sprite') {
          spriteId = asset.visual.id;
          index = asset.visual.index;
        } else {
          const clip = await animation(asset.visual.id);
          const first = clip?.frames.find((frame) => !isInvisibleFrame(frame));
          if (!clip || !first || isInvisibleFrame(first))
            return { entry, sprite: null, index: 0, depth: entry.y, asset };
          spriteId = first.sprite;
          index = first.index;
          flips = animationFrameFlips(clip, first);
        }
        return {
          entry,
          asset,
          sprite: await sheet(spriteId),
          index,
          flips,
          depth: sceneDepth(
            scene.depthMode,
            entry.y,
            entry.z,
            asset.depthOffset,
            asset.groundOffsetY,
          ),
        };
      }),
    );
    if (!alive || drawToken !== token || scene !== current) return;
    prepareCanvas(canvas, context);
    context.save();
    clipScene(context);
    hitBoxes = [];
    propLabels = [];
    triggerLabels = [];
    const outlines: SceneHitBox[] = [];
    const missing: { x: number; y: number }[] = [];
    const order = new Map(scene.entities.map((entry, index) => [entry.id, index]));
    visuals.sort((a, b) =>
      compareSceneDrawRank(
        {
          background: a.entry.type === 'Background',
          depth: a.depth,
          order: order.get(a.entry.id) ?? 0,
        },
        {
          background: b.entry.type === 'Background',
          depth: b.depth,
          order: order.get(b.entry.id) ?? 0,
        },
      ),
    );
    for (const visual of visuals) {
      const { entry, sprite, index } = visual;
      if (entry.type === 'Prop' || entry.type === 'Character')
        propLabels.push({
          id: entry.id,
          name: entry.name ?? entry.id,
          x: sprite ? entry.x - sprite.originX : entry.x,
          y: sprite ? entry.y - sprite.originY : entry.y,
          width: sprite?.width ?? 1,
        });
      if (!sprite || index >= sprite.sprites.length) {
        missing.push({ x: entry.x, y: entry.y });
        continue;
      }
      const left = entry.x - sprite.originX;
      const top = entry.y - sprite.originY;
      const ref: ObjectRef = { kind: 'entity', id: entry.id };
      if (selectable(ref)) {
        const box = { ref, x: left, y: top, width: sprite.width, height: sprite.height };
        hitBoxes.push(box);
        if (isSelected(ref)) outlines.push(box);
      }
      const flips = 'flips' in visual ? visual.flips : undefined;
      flattenSprite(sprite, index).forEach((glyph, at) => {
        const column = at % sprite.width;
        const row = Math.floor(at / sprite.width);
        const x = left + (flips?.flipH ? sprite.width - 1 - column : column);
        const y = top + (flips?.flipV ? sprite.height - 1 - row : row);
        if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) return;
        const bg = palette ? (paletteRgb(palette, glyph.bg) ?? '#000') : '#000';
        const transparent = bg.toLowerCase() === '#000000' || bg.toLowerCase() === '#000';
        if (transparent && glyph.ch === ' ') return;
        const target = composed[y * scene.width + x];
        target.ch = glyph.ch;
        target.fg = palette ? (paletteRgb(palette, glyph.fg) ?? '#fff') : '#fff';
        if (!transparent) target.bg = bg;
      });
    }
    const cw = cell.width * view.zoom;
    const ch = cell.height * view.zoom;
    const x0 = Math.max(0, Math.floor(-view.x / cw));
    const y0 = Math.max(0, Math.floor(-view.y / ch));
    const x1 = Math.min(scene.width, Math.ceil((viewport.clientWidth - view.x) / cw));
    const y1 = Math.min(scene.height, Math.ceil((viewport.clientHeight - view.y) / ch));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const glyph = composed[y * scene.width + x];
        context.fillStyle = glyph.bg;
        fillTerminalCell(context, cell, x * cell.width, y * cell.height);
        if (glyph.ch !== ' ') {
          context.fillStyle = glyph.fg;
          drawTerminalGlyph(context, cell, glyph.ch, x * cell.width, y * cell.height);
        }
      }
    }
    context.fillStyle = '#dca665';
    for (const { x, y } of missing)
      drawTerminalGlyph(context, cell, '?', x * cell.width, y * cell.height);
    for (const trigger of backgroundEdit || !triggersVisible() ? [] : scene.triggers) {
      if (typeof trigger === 'string') continue;
      const width = trigger.event === 'action' ? trigger.width : 1;
      const height = trigger.event === 'action' ? trigger.height : 1;
      if (trigger.trigger)
        triggerLabels.push({
          id: trigger.id,
          name: trigger.trigger,
          x: trigger.x,
          y: trigger.y,
          width,
        });
      hitBoxes.push({
        ref: { kind: 'trigger', id: trigger.id },
        x: trigger.x,
        y: trigger.y,
        width,
        height,
      });
      const colors = sceneTriggerColors(trigger);
      context.fillStyle = colors.fill;
      context.strokeStyle = isSelected({ kind: 'trigger', id: trigger.id })
        ? colors.selected
        : colors.stroke;
      context.fillRect(
        trigger.x * cell.width,
        trigger.y * cell.height,
        width * cell.width,
        height * cell.height,
      );
      context.strokeRect(
        trigger.x * cell.width + 1,
        trigger.y * cell.height + 1,
        width * cell.width - 2,
        height * cell.height - 2,
      );
    }
    if ((blockedVisible() || blockedEdit) && !backgroundEdit) {
      const blocked = new Set<number>(scene.blockedCells);
      for (const visual of blockedEdit ? [] : visuals) {
        const { entry, sprite } = visual;
        if (entry.type !== 'Prop' || !('prop' in entry) || !('asset' in visual) || !visual.asset)
          continue;
        for (const { x, y } of propBlockedSceneCells(
          entry,
          visual.asset,
          sprite ?? { originX: 0, originY: 0 },
          scene,
        ))
          blocked.add(y * scene.width + x);
      }
      context.fillStyle = blockedEdit ? 'rgba(235, 88, 79, 0.55)' : 'rgba(235, 88, 79, 0.28)';
      for (const index of blocked) {
        const x = (index % scene.width) * cell.width;
        const y = Math.floor(index / scene.width) * cell.height;
        context.fillRect(x, y, cell.width, cell.height);
      }
    }
    for (const outline of outlines) {
      context.strokeStyle = '#ffae95';
      context.lineWidth = 2;
      context.strokeRect(
        outline.x * cell.width + 1,
        outline.y * cell.height + 1,
        outline.width * cell.width - 2,
        outline.height * cell.height - 2,
      );
    }
    if (showUi) {
      const uiWidth = Math.min(STANDARD_WIDTH, scene.width);
      const left = Math.floor((scene.width - uiWidth) / 2);
      const top = Math.max(0, scene.height - STANDARD_UI_HEIGHT);
      const preview = renderStandardUiPreview(uiWidth);
      for (let y = 0; y < Math.min(STANDARD_UI_HEIGHT, scene.height); y++) {
        for (let x = 0; x < uiWidth; x++) {
          const { ch, fg, bg } = preview.get(x, y);
          const px = (left + x) * cell.width;
          const py = (top + y) * cell.height;
          context.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
          fillTerminalCell(context, cell, px, py);
          if (ch !== ' ') {
            context.fillStyle = `rgb(${fg.r}, ${fg.g}, ${fg.b})`;
            drawTerminalGlyph(context, cell, ch, px, py);
          }
        }
      }
    }
    context.restore();
    paintHover();
  }

  function render(): void {
    ++token;
    if (hovered && !selectable(hovered)) setHover(null);
    renderList();
    renderTabs();
    scheduleTabs();
    $<HTMLElement>('#scene-title').textContent = current ? sceneName(current.id) : 'NO SCENE';
    $<HTMLElement>('#scene-workspace').hidden = !current;
    $<HTMLButtonElement>('#scene-cancel-trigger').hidden = !placingTrigger;
    $<HTMLButtonElement>('#scene-save').disabled = !current || saving;
    $<HTMLButtonElement>('#scene-delete').disabled = !current;
    $<HTMLButtonElement>('#scene-add-prop').disabled = !current || backgroundEdit || blockedEdit;
    $<HTMLButtonElement>('#scene-add-character').disabled =
      !current || backgroundEdit || blockedEdit;
    $<HTMLButtonElement>('#scene-add-trigger').disabled = !current || backgroundEdit || blockedEdit;
    if (!current) return;
    const bg = background();
    const backgroundLink = $<HTMLAnchorElement>('#scene-background-link');
    backgroundLink.hidden = !bg;
    if (bg) backgroundLink.href = `/art?id=${encodeURIComponent(bg.sprite)}`;
    if (backgroundEdit && !bg) {
      backgroundEdit = false;
      selected = [];
    }
    const modeButton = $<HTMLButtonElement>('#scene-background-mode');
    modeButton.disabled = !bg;
    modeButton.setAttribute('aria-pressed', String(backgroundEdit));
    const blockedButton = $<HTMLButtonElement>('#scene-blocked-mode');
    blockedButton.setAttribute('aria-pressed', String(blockedEdit));
    const addBackgroundButton = $<HTMLButtonElement>('#scene-add-background');
    addBackgroundButton.setAttribute(
      'aria-label',
      bg ? 'REPLACE BACKGROUND SPRITE' : 'ADD BACKGROUND SPRITE',
    );
    addBackgroundButton.title = bg ? 'Replace background sprite' : 'Add background sprite';
    const addTriggerButton = $<HTMLButtonElement>('#scene-add-trigger');
    addTriggerButton.setAttribute('aria-pressed', String(placingTrigger));
    addTriggerButton.textContent = placingTrigger ? 'Cancel Trigger' : 'Add Trigger';
    $<HTMLInputElement>('#scene-width').value = String(current.width);
    $<HTMLInputElement>('#scene-height').value = String(current.height);
    $<HTMLSelectElement>('#scene-depth').value = current.depthMode;
    renderInspector();
    redraw();
  }

  async function refresh(): Promise<void> {
    const [sceneList, propList, sheetList, colors, triggers] = await Promise.all([
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/scenes'),
      requestJson<{ files: string[] }>('/api/props'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/sprites'),
      requestJson<PaletteDocument>('/api/palette'),
      requestJson<{ names: string[] }>('/api/rpg-triggers'),
    ]);
    if (!alive) return;
    files = sceneList.files;
    sceneLabels = sceneList.labels;
    openTabs = openTabs.filter(
      (id) => files.includes(id) || id === current?.id || (sessions.has(id) && tabDirty(id)),
    );
    for (const id of sessions.keys()) if (!openTabs.includes(id)) sessions.delete(id);
    props = propList.files;
    sprites = sheetList.files;
    spriteLabels = sheetList.labels;
    palette = colors;
    rpgTriggers = triggers.names;
    render();
  }
  async function open(id: string): Promise<void> {
    if (current?.id === id || saving) return;
    const openToken = ++switchToken;
    const cached = sessions.get(id);
    if (cached) {
      activateScene(cached.doc, cached.saved);
      status.textContent = `Opened ${id}`;
      return;
    }
    try {
      const scene = await requestJson<SceneDocument>(`/api/scenes/${encodeURIComponent(id)}`);
      if (!alive || openToken !== switchToken) return;
      activateScene(scene, structuredClone(scene));
      status.textContent = `Opened ${id}`;
    } catch (error) {
      if (alive && openToken === switchToken) status.textContent = message(error);
    }
  }
  async function save(): Promise<void> {
    if (!current || saving) return;
    if (current.triggers.some((entry) => typeof entry !== 'string' && !entry.trigger)) {
      status.textContent = 'Select an RPGTrigger for every region before saving.';
      toast(status.textContent, true);
      return;
    }
    const sent = structuredClone(current);
    const base = saved;
    saving = true;
    $<HTMLButtonElement>('#scene-save').disabled = true;
    try {
      const stored = await saveDraft(`/api/scenes/${encodeURIComponent(sent.id)}`, sent, base);
      if (alive && current?.id === sent.id) {
        const mergedOnDisk = JSON.stringify(stored) !== JSON.stringify(sent);
        const rebased = rebaseJsonDraft(sent, current, stored);
        if (rebased.ok) {
          current = rebased.value.draft;
          saved = rebased.value.baseline;
          status.textContent = mergedOnDisk ? `Saved and merged ${sent.id}` : `Saved ${sent.id}`;
        } else status.textContent = `Saved ${sent.id}; newer edits need review`;
        toast(status.textContent, !rebased.ok);
        setEditorAssetUrl(sent.id);
        render();
      }
      if (alive) await refresh();
    } catch (error) {
      if (alive) {
        status.textContent = message(error);
        toast(status.textContent, true);
        if (error instanceof ApiError && error.status === 409)
          await alertModal(`${message(error)}. Your draft is still open.`);
      }
    } finally {
      saving = false;
      if (alive) render();
    }
  }

  function drawThumbnail(
    canvas: HTMLCanvasElement,
    sprite: SpriteDocument,
    index: number,
    flips: { flipH: boolean; flipV: boolean } = { flipH: false, flipV: false },
  ): void {
    const preview = canvas.getContext('2d');
    if (!preview) return;
    preview.fillStyle = '#000';
    preview.fillRect(0, 0, canvas.width, canvas.height);
    const native = terminalCellAtZoom(preview, 1, sprite.font);
    const scale = Math.min(
      3,
      (canvas.width - 8) / (sprite.width * native.width),
      (canvas.height - 8) / (sprite.height * native.height),
    );
    const grid = terminalCellAtZoom(preview, scale, sprite.font);
    const x0 = (canvas.width - sprite.width * grid.width) / 2;
    const y0 = (canvas.height - sprite.height * grid.height) / 2;
    flattenSprite(sprite, index).forEach((cell, at) => {
      const column = at % sprite.width;
      const row = Math.floor(at / sprite.width);
      const x = x0 + (flips.flipH ? sprite.width - 1 - column : column) * grid.width;
      const y = y0 + (flips.flipV ? sprite.height - 1 - row : row) * grid.height;
      preview.fillStyle = palette ? (paletteRgb(palette, cell.bg) ?? '#000') : '#000';
      fillTerminalCell(preview, grid, x, y);
      if (cell.ch !== ' ') {
        preview.fillStyle = palette ? (paletteRgb(palette, cell.fg) ?? '#fff') : '#fff';
        drawTerminalGlyph(preview, grid, cell.ch, x, y);
      }
    });
  }

  async function renderBackgroundFrames(): Promise<void> {
    const token = ++pickerToken;
    const id = backgroundSheetId;
    backgroundChoice = null;
    backgroundAdd.disabled = true;
    backgroundFrames.replaceChildren();
    if (!id) return;
    backgroundStatus.textContent = 'Loading sprite frames…';
    const sprite = await sheet(id);
    if (!alive || !backgroundPicker.open || token !== pickerToken) return;
    if (!sprite) {
      backgroundStatus.textContent = `Could not load sprite ${id}`;
      return;
    }
    backgroundStatus.textContent = `${sprite.width} × ${sprite.height} cells · ${sprite.sprites.length} frame${sprite.sprites.length === 1 ? '' : 's'}`;
    sprite.sprites.forEach((_frame, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-background-frame';
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 160;
      thumbnail.height = 100;
      drawThumbnail(thumbnail, sprite, index);
      const label = document.createElement('span');
      label.textContent = `FRAME ${index + 1}`;
      button.append(thumbnail, label);
      button.addEventListener('click', () => {
        backgroundChoice = { sprite: id, index };
        backgroundAdd.disabled = false;
        backgroundFrames.querySelectorAll('.scene-background-frame').forEach((card) => {
          card.classList.toggle('active', card === button);
        });
      });
      backgroundFrames.append(button);
    });
  }

  function renderBackgroundResults(): void {
    const query = backgroundSearch.value.trim().toLowerCase();
    const matches = sprites.filter(
      (id) =>
        id.toLowerCase().includes(query) || (spriteLabels[id] ?? '').toLowerCase().includes(query),
    );
    if (!matches.includes(backgroundSheetId ?? '')) backgroundSheetId = matches[0] ?? null;
    backgroundResults.replaceChildren();
    for (const id of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = spriteLabels[id] ?? id;
      button.title = id;
      button.classList.toggle('active', id === backgroundSheetId);
      button.setAttribute('aria-pressed', String(id === backgroundSheetId));
      button.addEventListener('click', () => {
        backgroundSheetId = id;
        backgroundResults.querySelectorAll('button').forEach((result) => {
          result.classList.toggle('active', result === button);
          result.setAttribute('aria-pressed', String(result === button));
        });
        void renderBackgroundFrames();
      });
      backgroundResults.append(button);
    }
    if (!matches.length) {
      backgroundResults.textContent = 'No matching sprites.';
      backgroundChoice = null;
      backgroundAdd.disabled = true;
      backgroundFrames.replaceChildren();
      backgroundStatus.textContent = 'No matching sprites.';
      ++pickerToken;
    }
  }

  function openBackgroundPicker(): void {
    if (!current) return;
    if (!sprites.length) {
      void alertModal('Create a sprite sheet in Art first');
      return;
    }
    const replacing = !!background();
    $<HTMLElement>('#scene-background-picker-title').textContent = replacing
      ? 'REPLACE BACKGROUND SPRITE'
      : 'ADD BACKGROUND SPRITE';
    backgroundAdd.textContent = replacing ? 'REPLACE SPRITE' : 'ADD SPRITE';
    backgroundSearch.value = '';
    backgroundSheetId = sprites[0] ?? null;
    backgroundChoice = null;
    backgroundPicker.showModal();
    renderBackgroundResults();
    void renderBackgroundFrames();
    backgroundSearch.focus();
  }

  backgroundSearch.addEventListener('input', () => {
    const previous = backgroundSheetId;
    renderBackgroundResults();
    if (backgroundSheetId && backgroundSheetId !== previous) void renderBackgroundFrames();
  });
  $<HTMLButtonElement>('#scene-background-cancel').addEventListener('click', () =>
    backgroundPicker.close(),
  );
  backgroundPicker.addEventListener('close', () => {
    ++pickerToken;
    backgroundChoice = null;
  });
  backgroundAdd.addEventListener('click', () => {
    if (!current || !backgroundChoice) return;
    const existing = background();
    const entry = setSceneBackground(current, backgroundChoice.sprite, backgroundChoice.index);
    backgroundEdit = true;
    blockedEdit = false;
    selected = [{ kind: 'entity', id: entry.id }];
    backgroundPicker.close();
    status.textContent = `${existing ? 'Replaced' : 'Added'} ${entry.id}. Drag it to position it in the scene.`;
    render();
  });

  async function renderPropResults(): Promise<void> {
    const token = ++propPickerToken;
    propChoice = null;
    propAdd.disabled = true;
    propResults.replaceChildren();
    const query = propSearch.value.trim().toLowerCase();
    const matches = props.filter((id) => id.toLowerCase().includes(query));
    propStatus.textContent = matches.length
      ? `${matches.length} prop${matches.length === 1 ? '' : 's'}`
      : 'No matching props.';
    for (const id of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-prop-card';
      button.disabled = true;
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 160;
      thumbnail.height = 100;
      const name = document.createElement('strong');
      name.textContent = id;
      const details = document.createElement('span');
      details.textContent = 'Loading preview…';
      button.append(thumbnail, name, details);
      propResults.append(button);
      button.addEventListener('click', () => {
        propChoice = id;
        propAdd.disabled = false;
        propResults.querySelectorAll('.scene-prop-card').forEach((card) => {
          card.classList.toggle('active', card === button);
        });
      });
      void (async () => {
        const asset = await prop(id);
        if (!alive || !propPicker.open || token !== propPickerToken) return;
        if (!asset) {
          details.textContent = 'Prop unavailable';
          return;
        }
        let frame: { sprite: string; index: number } | null = null;
        if (asset.visual.type === 'sprite')
          frame = { sprite: asset.visual.id, index: asset.visual.index };
        else {
          const clip = await animation(asset.visual.id);
          const first = clip?.frames.find((entry) => !isInvisibleFrame(entry));
          if (first && !isInvisibleFrame(first)) frame = first;
        }
        if (!alive || !propPicker.open || token !== propPickerToken) return;
        const sprite = frame ? await sheet(frame.sprite) : null;
        if (!alive || !propPicker.open || token !== propPickerToken) return;
        if (!sprite || !frame || frame.index >= sprite.sprites.length) {
          details.textContent = 'No visible sprite frame';
          return;
        }
        drawThumbnail(thumbnail, sprite, frame.index);
        details.textContent = `${asset.width} × ${asset.height} cells · ${asset.visual.type}`;
        button.disabled = false;
      })();
    }
  }

  async function openPropPicker(): Promise<void> {
    if (!current || backgroundEdit) return;
    propCache.clear();
    animationCache.clear();
    sheetCache.clear();
    propPicker.showModal();
    propSearch.value = '';
    propChoice = null;
    propAdd.disabled = true;
    propResults.replaceChildren();
    propStatus.textContent = 'Loading props…';
    const token = ++propLoadToken;
    try {
      const result = await requestJson<{ files: string[] }>('/api/props');
      if (!alive || !propPicker.open || token !== propLoadToken) return;
      props = result.files;
      void renderPropResults();
      propSearch.focus();
    } catch (error) {
      if (alive && propPicker.open && token === propLoadToken)
        propStatus.textContent = message(error);
    }
  }

  propSearch.addEventListener('input', () => void renderPropResults());
  $<HTMLButtonElement>('#scene-prop-cancel').addEventListener('click', () => propPicker.close());
  propPicker.addEventListener('close', () => {
    ++propPickerToken;
    ++propLoadToken;
    propChoice = null;
  });
  propAdd.addEventListener('click', () => {
    if (!current || !propChoice || backgroundEdit) return;
    const assetId = propChoice;
    const center = sceneCellAt(
      view,
      viewport.clientWidth / 2,
      viewport.clientHeight / 2,
      cell.width,
      cell.height,
    );
    const entry = addSceneProp(current, assetId, center.x, center.y);
    selected = [{ kind: 'entity', id: entry.id }];
    propPicker.close();
    status.textContent = `Added ${assetId} to the scene. Drag it to position it.`;
    render();
  });

  async function openCharacterPicker(): Promise<void> {
    if (!current || backgroundEdit) return;
    characterCache.clear();
    animationCache.clear();
    sheetCache.clear();
    characterPicker.showModal();
    characterSearch.value = '';
    characterChoice = null;
    characterAdd.disabled = true;
    characterStatus.textContent = 'Loading characters…';
    const picker = ++characterPickerToken;
    try {
      const result = await requestJson<{ files: string[]; labels: Record<string, string> }>(
        '/api/characters',
      );
      if (!alive || !characterPicker.open || picker !== characterPickerToken) return;
      const renderResults = () => {
        characterResults.replaceChildren();
        characterChoice = null;
        characterAdd.disabled = true;
        const matches = result.files.filter(
          (id) =>
            id.toLowerCase().includes(characterSearch.value.trim().toLowerCase()) ||
            (result.labels[id] ?? id)
              .toLowerCase()
              .includes(characterSearch.value.trim().toLowerCase()),
        );
        characterStatus.textContent = matches.length
          ? `${matches.length} character${matches.length === 1 ? '' : 's'}`
          : 'No matching characters.';
        for (const id of matches) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'scene-prop-card';
          const thumbnail = document.createElement('canvas');
          thumbnail.width = 160;
          thumbnail.height = 100;
          const name = document.createElement('strong');
          name.textContent = result.labels[id] ?? id;
          const details = document.createElement('span');
          details.textContent = 'Loading idle-down preview…';
          button.append(thumbnail, name, details);
          button.disabled = true;
          characterResults.append(button);
          void (async () => {
            const asset = await character(id);
            if (
              !alive ||
              !characterPicker.open ||
              !button.isConnected ||
              picker !== characterPickerToken
            )
              return;
            if (!asset) {
              details.textContent = 'Character unavailable';
              return;
            }
            button.disabled = false;
            button.addEventListener('click', () => {
              characterChoice = asset;
              characterAdd.disabled = false;
              characterResults.querySelectorAll('.scene-prop-card').forEach((card) => {
                card.classList.toggle('active', card === button);
              });
            });
            const clip = await animation(asset.animations['idle-down']);
            const first = clip?.frames.find((frame) => !isInvisibleFrame(frame));
            const sprite = first && !isInvisibleFrame(first) ? await sheet(first.sprite) : null;
            if (
              !alive ||
              !characterPicker.open ||
              !button.isConnected ||
              picker !== characterPickerToken
            )
              return;
            if (
              !clip ||
              !first ||
              isInvisibleFrame(first) ||
              !sprite ||
              first.index >= sprite.sprites.length
            ) {
              details.textContent = 'No idle-down preview';
              return;
            }
            drawThumbnail(thumbnail, sprite, first.index, animationFrameFlips(clip, first));
            details.textContent = 'IDLE DOWN';
          })().catch(() => {
            if (alive && button.isConnected && picker === characterPickerToken)
              details.textContent = 'Preview unavailable';
          });
        }
      };
      characterSearch.oninput = renderResults;
      renderResults();
      characterSearch.focus();
    } catch (error) {
      if (alive && picker === characterPickerToken) characterStatus.textContent = message(error);
    }
  }
  $<HTMLButtonElement>('#scene-character-cancel').addEventListener('click', () =>
    characterPicker.close(),
  );
  characterPicker.addEventListener('close', () => {
    ++characterPickerToken;
    characterChoice = null;
  });
  characterAdd.addEventListener('click', () => {
    if (!current || !characterChoice || backgroundEdit) return;
    const center = sceneCellAt(
      view,
      viewport.clientWidth / 2,
      viewport.clientHeight / 2,
      cell.width,
      cell.height,
    );
    const entry = addSceneCharacter(current, characterChoice, center.x, center.y);
    selected = [{ kind: 'entity', id: entry.id }];
    characterPicker.close();
    status.textContent = `Added ${entry.character} to the scene. Drag it to position it.`;
    render();
  });

  $<HTMLButtonElement>('#scene-background-mode').addEventListener('click', () => {
    const bg = background();
    if (!bg) return;
    backgroundEdit = !backgroundEdit;
    blockedEdit = false;
    blockStroke = null;
    placingTrigger = false;
    selected = backgroundEdit ? [{ kind: 'entity', id: bg.id }] : [];
    drag = null;
    render();
  });

  $<HTMLButtonElement>('#scene-blocked-mode').addEventListener('click', () => {
    if (!current) return;
    blockedEdit = !blockedEdit;
    backgroundEdit = false;
    placingTrigger = false;
    blockStroke = null;
    drag = null;
    selected = [];
    status.textContent = blockedEdit
      ? 'Click or drag to block cells; click blocked cells to erase them. Save to keep changes.'
      : 'Blocked-cell editing off';
    render();
    syncCursor();
  });

  function addTrigger(): void {
    if (!current || backgroundEdit || blockedEdit) return;
    if (placingTrigger) {
      cancelTrigger();
      return;
    }
    placingTrigger = true;
    selected = [];
    status.textContent = 'Drag on the scene to draw a trigger region. Esc cancels.';
    render();
    syncCursor();
    canvas.focus();
    void requestJson<{ names: string[] }>('/api/rpg-triggers').then(
      (result) => {
        if (alive) {
          rpgTriggers = result.names;
          renderInspector();
        }
      },
      () => {
        if (alive && placingTrigger) status.textContent = 'Could not refresh RPGTrigger names.';
      },
    );
  }
  function cancelTrigger(): void {
    placingTrigger = false;
    drawingTrigger = null;
    status.textContent = 'Trigger placement cancelled.';
    render();
    syncCursor();
  }
  $<HTMLButtonElement>('#scene-cancel-trigger').addEventListener('click', cancelTrigger);
  function canvasPoint(
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  ): { x: number; y: number } | null {
    if (!current) return null;
    const pixel = viewportPixel(event);
    const { x, y } = sceneCellAt(view, pixel.x, pixel.y, cell.width, cell.height);
    const uiWidth = Math.min(STANDARD_WIDTH, current.width);
    const uiLeft = Math.floor((current.width - uiWidth) / 2);
    return x >= 0 &&
      y >= 0 &&
      x < current.width &&
      y < current.height &&
      !(
        showUi &&
        y >= Math.max(0, current.height - STANDARD_UI_HEIGHT) &&
        x >= uiLeft &&
        x < uiLeft + uiWidth
      )
      ? { x, y }
      : null;
  }
  function hitAt(x: number, y: number): ObjectRef | null {
    return (
      [...hitBoxes]
        .reverse()
        .find(
          (box) =>
            selectable(box.ref) &&
            (box.ref.kind !== 'trigger' || triggersVisible()) &&
            x >= box.x &&
            y >= box.y &&
            x < box.x + box.width &&
            y < box.y + box.height,
        )?.ref ?? null
    );
  }
  function scenePixel(event: PointerEvent): { x: number; y: number } {
    const pixel = viewportPixel(event);
    return {
      x: (pixel.x - view.x) / (view.zoom * cell.width),
      y: (pixel.y - view.y) / (view.zoom * cell.height),
    };
  }

  function updateTriggerResize(event: PointerEvent): void {
    if (!resizing || resizing.pointerId !== event.pointerId || !current) return;
    const point = scenePixel(event);
    const next = resizeTrigger(
      resizing.start,
      resizing.handle,
      point.x,
      point.y,
      current.width,
      current.height,
    );
    const trigger = positioned({ kind: 'trigger', id: resizing.id });
    if (
      trigger &&
      'width' in trigger &&
      (trigger.x !== next.x ||
        trigger.y !== next.y ||
        trigger.width !== next.width ||
        trigger.height !== next.height)
    ) {
      Object.assign(trigger, next);
      render();
    }
  }
  canvas.addEventListener('pointerdown', (event) => {
    canvasMouse = { clientX: event.clientX, clientY: event.clientY };
    if (event.button !== 0 || spaceHeld) return;
    const point = canvasPoint(event);
    if (blockedEdit) {
      if (!current || !point) return;
      event.preventDefault();
      const index = point.y * current.width + point.x;
      blockStroke = {
        pointerId: event.pointerId,
        point,
        blocked: !current.blockedCells.includes(index),
      };
      current.blockedCells = paintSceneBlockedCells(
        current.blockedCells,
        current.width,
        point,
        point,
        blockStroke.blocked,
      );
      canvas.setPointerCapture(event.pointerId);
      render();
      return;
    }
    if (placingTrigger) {
      if (!point) return;
      event.preventDefault();
      drawingTrigger = {
        pointerId: event.pointerId,
        x: point.x,
        y: point.y,
        endX: point.x,
        endY: point.y,
      };
      canvas.setPointerCapture(event.pointerId);
      paintHover();
      return;
    }
    const handle = handleAt(event);
    const ref = onlySelected();
    if (handle && ref?.kind === 'trigger') {
      const trigger = positioned(ref);
      if (trigger && 'width' in trigger) {
        resizing = {
          pointerId: event.pointerId,
          id: ref.id,
          handle,
          start: {
            x: trigger.x,
            y: trigger.y,
            width: trigger.width,
            height: trigger.height,
          },
        };
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        syncCursor(event);
        return;
      }
    }
    if (!point) return;
    const hit = hitAt(point.x, point.y);
    if (hit) {
      setHover(null);
      if ((event.ctrlKey || event.metaKey) && !backgroundEdit) {
        selected = isSelected(hit)
          ? selected.filter((ref) => !sameSceneObject(ref, hit))
          : [...selected, hit];
      } else if (!isSelected(hit)) selected = [hit];
      else if (backgroundEdit) selected = [hit];
      const items = selected.flatMap((ref) => {
        const item = positioned(ref);
        return item
          ? [
              {
                ref,
                x: item.x,
                y: item.y,
                width: 'width' in item ? item.width : 1,
                height: 'height' in item ? item.height : 1,
              },
            ]
          : [];
      });
      if (!(event.ctrlKey || event.metaKey) && isSelected(hit) && items.length) {
        drag = { pointerId: event.pointerId, x: point.x, y: point.y, items };
        canvas.setPointerCapture(event.pointerId);
      }
      render();
      syncCursor(event);
    } else if (!backgroundEdit) {
      const { x, y } = scenePixel(event);
      marquee = {
        pointerId: event.pointerId,
        x,
        y,
        endX: x,
        endY: y,
        additive: event.ctrlKey || event.metaKey,
      };
      setHover(null);
      canvas.setPointerCapture(event.pointerId);
      paintHover();
    } else if (selected.length) {
      selected = [];
      render();
    }
  });
  function updateDrag(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId || !current) return;
    const pixel = scenePixel(event);
    if (
      moveSceneGroup(
        current,
        drag.items,
        Math.floor(pixel.x) - drag.x,
        Math.floor(pixel.y) - drag.y,
      )
    )
      render();
  }
  canvas.addEventListener('pointermove', (event) => {
    canvasMouse = { clientX: event.clientX, clientY: event.clientY };
    if (pan) return;
    if (blockStroke?.pointerId === event.pointerId && current) {
      const point = canvasPoint(event);
      if (point) {
        current.blockedCells = paintSceneBlockedCells(
          current.blockedCells,
          current.width,
          blockStroke.point,
          point,
          blockStroke.blocked,
        );
        blockStroke.point = point;
        render();
      }
      return;
    }
    if (blockedEdit) {
      paintHover();
      return;
    }
    if (drawingTrigger?.pointerId === event.pointerId && current) {
      const point = scenePixel(event);
      drawingTrigger.endX = point.x;
      drawingTrigger.endY = point.y;
      paintHover();
      return;
    }
    if (resizing?.pointerId === event.pointerId && current) {
      updateTriggerResize(event);
      return;
    }
    if (marquee && marquee.pointerId === event.pointerId) {
      const point = scenePixel(event);
      marquee.endX = Math.max(0, Math.min(current?.width ?? 0, point.x));
      marquee.endY = Math.max(0, Math.min(current?.height ?? 0, point.y));
      paintHover();
      return;
    }
    if (!drag) {
      const point = canvasPoint(event);
      setHover(point ? hitAt(point.x, point.y) : null);
      syncCursor(event);
    }
    updateDrag(event);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (blockStroke?.pointerId === event.pointerId) {
      const point = canvasPoint(event);
      if (point && current)
        current.blockedCells = paintSceneBlockedCells(
          current.blockedCells,
          current.width,
          blockStroke.point,
          point,
          blockStroke.blocked,
        );
      blockStroke = null;
      render();
      return;
    }
    if (drawingTrigger?.pointerId === event.pointerId && current) {
      const drawing = drawingTrigger;
      drawingTrigger = null;
      const point = scenePixel(event);
      const region = triggerRegion(
        drawing.x,
        drawing.y,
        point.x,
        point.y,
        current.width,
        current.height,
      );
      const entry = newSceneTrigger(current, region);
      selected = [{ kind: 'trigger', id: entry.id }];
      placingTrigger = false;
      status.textContent = 'Trigger created. Select its RPGTrigger in the inspector before saving.';
      render();
      syncCursor(event);
      return;
    }
    if (resizing?.pointerId === event.pointerId) {
      updateTriggerResize(event);
      resizing = null;
      syncCursor(event);
      return;
    }
    if (drag?.pointerId === event.pointerId) {
      updateDrag(event);
      drag = null;
    }
    if (marquee?.pointerId !== event.pointerId) return;
    const box = marquee;
    marquee = null;
    const moved =
      Math.abs(box.endX - box.x) * cell.width * view.zoom > 3 ||
      Math.abs(box.endY - box.y) * cell.height * view.zoom > 3;
    if (moved) {
      const hits = boxesInSceneRect(hitBoxes, box.x, box.y, box.endX, box.endY);
      selected = box.additive ? [...selected, ...hits.filter((ref) => !isSelected(ref))] : hits;
    } else if (!box.additive) selected = [];
    render();
    paintHover();
  });
  canvas.addEventListener('pointercancel', () => {
    blockStroke = null;
    drag = null;
    marquee = null;
    drawingTrigger = null;
    resizing = null;
    paintHover();
  });
  canvas.addEventListener('pointerleave', () => {
    canvasMouse = null;
    if (blockedEdit) paintHover();
    if (!drag && !drawingTrigger && !resizing) {
      setHover(null);
      syncCursor();
    }
  });
  viewport.addEventListener('pointerdown', (event) => {
    if (!current || (event.button !== 1 && !(event.button === 0 && spaceHeld))) return;
    event.preventDefault();
    const pixel = viewportPixel(event);
    pan = { pointerId: event.pointerId, x: pixel.x, y: pixel.y, startX: view.x, startY: view.y };
    setHover(null);
    autoFit = false;
    viewport.setPointerCapture(event.pointerId);
    syncCursor();
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    const pixel = viewportPixel(event);
    view = { ...view, x: pan.startX + pixel.x - pan.x, y: pan.startY + pixel.y - pan.y };
    applyView();
  });
  const endPan = () => {
    pan = null;
    syncCursor();
  };
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);
  viewport.addEventListener('lostpointercapture', endPan);
  viewport.addEventListener('auxclick', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  viewport.addEventListener(
    'wheel',
    (event) => {
      if (!current) return;
      event.preventDefault();
      const pixel = viewportPixel(event);
      stepZoom(event.deltaY < 0 ? 1 : -1, pixel.x, pixel.y);
    },
    { passive: false },
  );
  $<HTMLButtonElement>('#scene-zoom-out').addEventListener('click', () => stepZoom(-1));
  $<HTMLButtonElement>('#scene-zoom-in').addEventListener('click', () => stepZoom(1));
  $<HTMLButtonElement>('#scene-fit').addEventListener('click', () => fitView());
  $<HTMLButtonElement>('#scene-add-background').addEventListener('click', openBackgroundPicker);
  $<HTMLButtonElement>('#scene-add-prop').addEventListener('click', () => void openPropPicker());
  $<HTMLButtonElement>('#scene-add-character').addEventListener(
    'click',
    () => void openCharacterPicker(),
  );
  $<HTMLButtonElement>('#scene-add-trigger').addEventListener('click', addTrigger);
  for (const dimension of ['width', 'height'] as const) {
    const input = $<HTMLInputElement>(`#scene-${dimension}`);
    input.addEventListener('change', () => {
      if (!current) return;
      const value = Number(input.value);
      if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > (dimension === 'width' ? 256 : 128) ||
        current.entities.some((entry) => entry[dimension === 'width' ? 'x' : 'y'] >= value) ||
        current.triggers.some(
          (entry) =>
            typeof entry !== 'string' &&
            entry[dimension === 'width' ? 'x' : 'y'] + entry[dimension] > value,
        )
      ) {
        status.textContent = 'Size must contain every object and trigger region';
        render();
        return;
      }
      const oldWidth = current.width;
      current[dimension] = value;
      current.blockedCells = resizeBlockedCells(
        current.blockedCells,
        oldWidth,
        current.width,
        current.height,
      );
      render();
      if (autoFit) fitView();
    });
  }
  $<HTMLSelectElement>('#scene-depth').addEventListener('change', (event) => {
    if (!current) return;
    current.depthMode = (event.target as HTMLSelectElement).value as SceneDocument['depthMode'];
    render();
  });
  showTriggersInput.addEventListener('change', () => {
    showTriggers = showTriggersInput.checked;
    if (!triggersVisible() && hovered?.kind === 'trigger') hovered = null;
    render();
  });
  showBlockedInput.addEventListener('change', () => {
    showBlockedCells = showBlockedInput.checked;
    render();
  });
  showUiInput.addEventListener('change', () => {
    showUi = showUiInput.checked;
    setHover(null);
    render();
  });
  $<HTMLInputElement>('#scene-search').addEventListener('input', renderList);
  const menus = [...root.querySelectorAll<HTMLDetailsElement>('.scene-menu')];
  for (const menu of menus) {
    menu.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        menu.open = false;
      });
    });
    menu.addEventListener('toggle', () => {
      if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
    });
  }
  const closeMenus = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && menus.some((menu) => menu.contains(target))) return;
    for (const menu of menus) menu.open = false;
  };
  document.addEventListener('pointerdown', closeMenus);
  $<HTMLButtonElement>('#scene-save').addEventListener('click', () => void save());
  $<HTMLButtonElement>('#scene-new').addEventListener('click', () => {
    $<HTMLInputElement>('#scene-new-label').value = '';
    $<HTMLInputElement>('#scene-new-width').value = '120';
    $<HTMLInputElement>('#scene-new-height').value = '40';
    $<HTMLSelectElement>('#scene-new-depth').value = 'bottom-up';
    $<HTMLElement>('#scene-new-error').hidden = true;
    newDialog.showModal();
    $<HTMLInputElement>('#scene-new-label').focus();
  });
  $<HTMLButtonElement>('#scene-new-cancel').addEventListener('click', () => newDialog.close());
  $<HTMLFormElement>('#scene-new-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const label = $<HTMLInputElement>('#scene-new-label').value.trim();
    const width = Number($<HTMLInputElement>('#scene-new-width').value);
    const height = Number($<HTMLInputElement>('#scene-new-height').value);
    const depthMode = $<HTMLSelectElement>('#scene-new-depth').value;
    const error = $<HTMLElement>('#scene-new-error');
    const labelError = spriteLabelError(label);
    if (
      labelError ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > 256 ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > 128 ||
      (depthMode !== 'bottom-up' && depthMode !== 'regular-z')
    ) {
      error.textContent =
        labelError?.replace('Sprite', 'Scene') ?? 'Width must be 1–256 and height 1–128';
      error.hidden = false;
      return;
    }
    const id = crypto.randomUUID();
    ++switchToken;
    activateScene(createScene(id, label, width, height, depthMode), null);
    status.textContent = `New scene ${label}`;
    newDialog.close();
  });
  $<HTMLButtonElement>('#scene-delete').addEventListener(
    'click',
    () =>
      void (async () => {
        if (!current || !(await confirmModal(`Delete ${current.id}?`, 'DELETE'))) return;
        try {
          if (saved)
            await requestJson(`/api/scenes/${encodeURIComponent(current.id)}`, {
              method: 'DELETE',
            });
          const deleted = current.id;
          ++switchToken;
          current = null;
          saved = null;
          sessions.delete(deleted);
          openTabs = openTabs.filter((id) => id !== deleted);
          backgroundEdit = false;
          blockedEdit = false;
          blockStroke = null;
          placingTrigger = false;
          selected = [];
          setEditorAssetUrl(null);
          status.textContent = 'Scene deleted';
          await refresh();
          const next = openTabs[openTabs.length - 1];
          if (next) await open(next);
          else persistTabs();
        } catch (error) {
          status.textContent = message(error);
        }
      })(),
  );
  const onKey = (event: KeyboardEvent) => {
    if (!root.isConnected || newDialog.open) return;
    if (
      event.key === 'Delete' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      current &&
      !backgroundEdit &&
      !blockedEdit &&
      !backgroundPicker.open &&
      !propPicker.open &&
      !characterPicker.open &&
      !isModalOpen() &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(event.target instanceof HTMLSelectElement) &&
      !(event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      const removed = removeSelectedSceneObjects(current, selected);
      if (removed.length) {
        event.preventDefault();
        selected = selected.filter((ref) => !removed.some((item) => sameSceneObject(ref, item)));
        const hoveredRef = hovered;
        if (hoveredRef && removed.some((item) => sameSceneObject(hoveredRef, item))) hovered = null;
        drag = null;
        status.textContent = `Removed ${removed.length} object${removed.length === 1 ? '' : 's'} from the scene · save to keep changes`;
        render();
        return;
      }
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      current &&
      !backgroundEdit &&
      !backgroundPicker.open &&
      !propPicker.open &&
      !characterPicker.open &&
      !isModalOpen() &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(event.target instanceof HTMLSelectElement) &&
      !(event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      const key = event.key.toLowerCase();
      if (key === 'c') {
        const copied = copySceneObjects(current, selected);
        if (copied.entities.length || copied.triggers.length) {
          objectClipboard = copied;
          event.preventDefault();
          status.textContent = `Copied ${copied.entities.length + copied.triggers.length} scene objects`;
        }
        return;
      }
      if (key === 'v' && objectClipboard) {
        event.preventDefault();
        const point = canvasMouse && canvasPoint(canvasMouse);
        if (!point) {
          status.textContent = 'Move the mouse over the scene to paste objects';
          return;
        }
        const pasted = pasteSceneObjects(current, objectClipboard, point);
        if (!pasted.length) {
          status.textContent = 'Copied objects do not fit in this scene';
          return;
        }
        selected = pasted;
        status.textContent = `Pasted ${pasted.length} scene objects · drag to move`;
        render();
        return;
      }
    }
    if (
      event.key === 'Tab' &&
      current &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !backgroundPicker.open &&
      !propPicker.open &&
      !characterPicker.open &&
      !isModalOpen() &&
      !(
        event.target instanceof HTMLInputElement &&
        event.target !== showTriggersInput &&
        event.target !== showBlockedInput
      ) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(event.target instanceof HTMLSelectElement) &&
      !(event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      event.preventDefault();
      if (!showPropNames) {
        showPropNames = true;
        render();
      }
      return;
    }
    if (
      event.key === 'Escape' &&
      !backgroundPicker.open &&
      !propPicker.open &&
      !characterPicker.open &&
      !isModalOpen() &&
      (placingTrigger || blockedEdit || selected.length)
    ) {
      event.preventDefault();
      if (placingTrigger) cancelTrigger();
      blockedEdit = false;
      blockStroke = null;
      drawingTrigger = null;
      resizing = null;
      selected = [];
      drag = null;
      marquee = null;
      setHover(null);
      render();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'a' &&
      !event.altKey &&
      current &&
      !blockedEdit &&
      !backgroundPicker.open &&
      !propPicker.open &&
      !characterPicker.open &&
      !isModalOpen() &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(event.target instanceof HTMLSelectElement) &&
      !(event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      event.preventDefault();
      selected = selectableSceneObjects(current, backgroundEdit).filter(
        (ref) => ref.kind !== 'trigger' || triggersVisible(),
      );
      render();
      return;
    }
    if (
      event.key === ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !backgroundPicker.open &&
      !propPicker.open &&
      !characterPicker.open &&
      !isModalOpen() &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(event.target instanceof HTMLButtonElement) &&
      !(event.target instanceof HTMLSelectElement) &&
      !(event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      spaceHeld = true;
      syncCursor();
      event.preventDefault();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && showPropNames) {
      event.preventDefault();
      showPropNames = false;
      if (!triggersVisible() && hovered?.kind === 'trigger') hovered = null;
      render();
    }
    if (event.key === ' ') {
      spaceHeld = false;
      syncCursor();
    }
  };
  const onBlur = () => {
    const wasShowingNames = showPropNames;
    showPropNames = false;
    if (!triggersVisible() && hovered?.kind === 'trigger') hovered = null;
    if (wasShowingNames) render();
    else paintHover();
    spaceHeld = false;
    pan = null;
    blockStroke = null;
    syncCursor();
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', persistTabs);
  void document.fonts.ready.then(() => {
    if (!alive) return;
    cell = terminalCellAtZoom(context, 1);
    if (current) render();
  });
  void refresh()
    .then(async () => {
      const id = new URLSearchParams(location.search).get('id');
      if (id && alive) {
        if (isAssetId(id) && (files.includes(id) || sessions.has(id))) await open(id);
        else status.textContent = `Scene ${id} not found`;
      } else if (alive) {
        const preferred =
          storedTabs.active && openTabs.includes(storedTabs.active)
            ? storedTabs.active
            : openTabs[openTabs.length - 1];
        if (preferred) await open(preferred);
      }
    })
    .catch((error: unknown) => {
      if (alive) status.textContent = message(error);
    });
  return () => {
    alive = false;
    persistTabs();
    ++token;
    ++pickerToken;
    ++propPickerToken;
    ++propLoadToken;
    ++characterPickerToken;
    if (backgroundPicker.open) backgroundPicker.close();
    if (newDialog.open) newDialog.close();
    if (propPicker.open) propPicker.close();
    if (characterPicker.open) characterPicker.close();
    resizeObserver.disconnect();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('pointerdown', closeMenus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pagehide', persistTabs);
    setDirtyGuard(null);
  };
}
