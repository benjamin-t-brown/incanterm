import { paletteRgb, type PaletteDocument } from '../palette.js';
import { terminalCellAtZoom } from '../terminal-cell.js';
import { drawTerminalGlyph, fillTerminalCell } from './terminal-renderer.js';
import { compareSceneDrawRank, sceneDepth } from '../../game/scene-order.js';
import {
  createScene,
  flattenSprite,
  isAssetId,
  isInvisibleFrame,
  type AnimationDocument,
  type PropDocument,
  type SceneDocument,
  type SceneEntity,
  type SceneTrigger,
  type SpriteDocument,
} from '../schema.js';
import { mergeJson } from '../safe-save.js';
import { setSceneBackground } from '../scene-background.js';
import { addSceneProp } from '../scene-props.js';
import { sceneTriggerColors } from '../scene-trigger-colors.js';
import {
  newSceneTrigger,
  resizeTrigger,
  triggerRegion,
  type ResizeHandle,
} from '../scene-triggers.js';
import {
  boxesInSceneRect,
  canSelectSceneObject,
  groupSceneDelta,
  sameSceneObject,
  selectableSceneObjects,
  type SceneHitBox,
  type SceneObjectRef,
} from '../scene-selection.js';
import {
  fitSceneView,
  sceneCellAt,
  SCENE_ZOOM_STEPS,
  zoomSceneView,
  type SceneView,
} from '../scene-viewport.js';
import { ApiError, requestJson } from './api.js';
import { alertModal, confirmModal, isModalOpen } from './modal.js';
import { saveDraft } from './save.js';
import { createSearchSelect } from './search-select.js';
import { askId, pageShell, setDirtyGuard, setEditorAssetUrl } from './shell.js';

type ObjectRef = SceneObjectRef;

export function mountScenes(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Scene',
    `<aside class="scene-library" aria-label="Scenes">
    <label for="scene-search">SCENES</label><input id="scene-search" class="text-input" type="search" placeholder="SEARCH">
    <div id="scene-list" class="asset-list"></div></aside>
    <section class="scene-app" aria-label="Scene editor">
      <div class="toolbar-row"><button id="scene-new" type="button">NEW</button><button id="scene-save" type="button">SAVE</button><button id="scene-delete" type="button">DELETE</button><strong id="scene-title">NO SCENE</strong></div>
      <p id="scene-status" role="status">Create a scene or open one from the list.</p>
      <div id="scene-workspace" class="scene-workspace" hidden>
        <section class="scene-stage"><div class="scene-tools"><button type="button" id="scene-add-prop">+ PROP</button><button type="button" id="scene-add-trigger">+ TRIGGER</button><span>Box select · Ctrl+click to add · Ctrl+A all · Hold Tab for names · Esc deselect</span><div class="scene-zoom-controls workspace-controls"><button type="button" id="scene-zoom-out" aria-label="Zoom out">−</button><span id="scene-zoom-label">100%</span><button type="button" id="scene-zoom-in" aria-label="Zoom in">+</button><button type="button" id="scene-fit">FIT</button></div></div>
          <div class="scene-scroll" id="scene-viewport"><canvas id="scene-canvas" aria-label="Scene placement canvas"></canvas><canvas id="scene-hover" aria-hidden="true"></canvas></div></section>
        <aside class="scene-sidebar"><h2>SCENE</h2><div class="scene-pair"><label>WIDTH<input id="scene-width" type="number" min="1" max="256"></label><label>HEIGHT<input id="scene-height" type="number" min="1" max="128"></label></div>
          <label>DEPTH MODE<select id="scene-depth"><option value="bottom-up">BOTTOM UP</option><option value="regular-z">REGULAR Z</option></select></label>
          <div class="scene-background-controls"><h2>BACKGROUND</h2><button type="button" id="scene-add-background">ADD BACKGROUND SPRITE</button><button type="button" id="scene-background-mode" aria-pressed="false">EDIT BACKGROUND: OFF</button></div>
          <div id="scene-inspector"></div></aside>
      </div></section>
      <dialog id="scene-background-picker" class="scene-background-picker" aria-labelledby="scene-background-picker-title">
        <h2 id="scene-background-picker-title">ADD BACKGROUND SPRITE</h2>
        <p>Choose a sprite frame. It becomes a movable, non-blocking background prop in this scene.</p>
        <label>SPRITE SHEET <select id="scene-background-sheet"></select></label>
        <div id="scene-background-frames" class="scene-background-frames"></div>
        <p id="scene-background-status" role="status"></p>
        <div class="scene-background-actions"><button id="scene-background-cancel" type="button">CANCEL</button><button id="scene-background-add" type="button" disabled>ADD SPRITE</button></div>
      </dialog>
      <dialog id="scene-prop-picker" class="scene-prop-picker" aria-labelledby="scene-prop-picker-title">
        <h2 id="scene-prop-picker-title">ADD EXISTING PROP</h2>
        <label for="scene-prop-search">SEARCH PROPS</label>
        <input id="scene-prop-search" type="search" placeholder="Search by name…" autocomplete="off">
        <div id="scene-prop-results" class="scene-prop-results"></div>
        <p id="scene-prop-status" role="status"></p>
        <div class="scene-background-actions"><button id="scene-prop-cancel" type="button">CANCEL</button><button id="scene-prop-add" type="button" disabled>ADD TO SCENE</button></div>
      </dialog>
      <div id="toast-stack" class="toast-stack" aria-live="polite"></div>`,
  );
  root.querySelector('.simple-main')?.classList.add('scene-main');
  const $ = <T extends Element>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const list = $<HTMLElement>('#scene-list');
  const inspector = $<HTMLElement>('#scene-inspector');
  const status = $<HTMLElement>('#scene-status');
  const canvas = $<HTMLCanvasElement>('#scene-canvas');
  const hoverCanvas = $<HTMLCanvasElement>('#scene-hover');
  const viewport = $<HTMLElement>('#scene-viewport');
  const backgroundPicker = $<HTMLDialogElement>('#scene-background-picker');
  const backgroundSheet = $<HTMLSelectElement>('#scene-background-sheet');
  const backgroundFrames = $<HTMLElement>('#scene-background-frames');
  const backgroundStatus = $<HTMLElement>('#scene-background-status');
  const backgroundAdd = $<HTMLButtonElement>('#scene-background-add');
  const propPicker = $<HTMLDialogElement>('#scene-prop-picker');
  const propSearch = $<HTMLInputElement>('#scene-prop-search');
  const propResults = $<HTMLElement>('#scene-prop-results');
  const propStatus = $<HTMLElement>('#scene-prop-status');
  const propAdd = $<HTMLButtonElement>('#scene-prop-add');
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
  let props: string[] = [];
  let rpgTriggers: string[] = [];
  let sprites: string[] = [];
  let palette: PaletteDocument | null = null;
  let current: SceneDocument | null = null;
  let saved: SceneDocument | null = null;
  let selected: ObjectRef[] = [];
  let hovered: ObjectRef | null = null;
  let showPropNames = false;
  let propLabels: Array<{ id: string; name: string; x: number; y: number; width: number }> = [];
  let triggerLabels: Array<{ id: string; name: string; x: number; y: number; width: number }> = [];
  let backgroundEdit = false;
  let hitBoxes: SceneHitBox[] = [];
  let backgroundChoice: { sprite: string; index: number } | null = null;
  let pickerToken = 0;
  let propPickerToken = 0;
  let propLoadToken = 0;
  let propChoice: string | null = null;
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
  const dirty = () => current !== null && JSON.stringify(current) !== JSON.stringify(saved);
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'Scene request failed';
  setDirtyGuard(async () => !dirty() || confirmModal('Discard unsaved scene changes?', 'DISCARD'));

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
    if (backgroundEdit || ref?.kind !== 'trigger') return null;
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

  function applyView(): void {
    canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    hoverCanvas.style.transform = canvas.style.transform;
    $<HTMLElement>('#scene-zoom-label').textContent = `${Math.round(view.zoom * 100)}%`;
    paintHover();
  }

  function fitView(): void {
    if (!current || !viewport.clientWidth || !viewport.clientHeight) return;
    autoFit = true;
    view = fitSceneView(
      viewport.clientWidth,
      viewport.clientHeight,
      current.width * cell.width,
      current.height * cell.height,
    );
    applyView();
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

  function viewportPixel(event: MouseEvent): { x: number; y: number } {
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

  function paintHover(): void {
    hoverContext.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
    if (!backgroundEdit && (showPropNames || hovered)) {
      hoverContext.font = 'bold 12px sans-serif';
      hoverContext.textBaseline = 'top';
      for (const label of [
        ...propLabels
          .filter(
            (entry) => showPropNames || (hovered?.kind === 'entity' && hovered.id === entry.id),
          )
          .map((entry) => ({ ...entry, trigger: false })),
        ...triggerLabels
          .filter(
            (entry) => showPropNames || (hovered?.kind === 'trigger' && hovered.id === entry.id),
          )
          .map((entry) => ({ ...entry, trigger: true })),
      ]) {
        const y = Math.max(0, (label.y - (label.trigger ? 0 : 1)) * cell.height);
        const width = Math.min(hoverCanvas.width, hoverContext.measureText(label.name).width + 8);
        const center = (label.x + label.width / 2) * cell.width;
        const x = Math.max(0, Math.min(hoverCanvas.width - width, center - width / 2));
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
    if (region && 'width' in region && (!('event' in region) || region.event !== 'load')) {
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
  });
  resizeObserver.observe(viewport);

  function renderList(): void {
    list.replaceChildren();
    const query = $<HTMLInputElement>('#scene-search').value.toLowerCase();
    for (const id of files.filter((file) => file.includes(query))) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id;
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
    inspector.append(wrapper);
  }
  function numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    set: (value: number) => void,
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
    );
  }
  function selectField(
    label: string,
    value: string,
    choices: string[],
    set: (value: string) => void,
  ): void {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const select = document.createElement('select');
    for (const choice of [...new Set([value, ...choices])]) {
      const option = document.createElement('option');
      option.value = choice;
      option.textContent = choice;
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
      if (item.type === 'Prop')
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
        selectField('SPRITE SHEET', item.sprite, sprites, (v) => {
          item.sprite = v;
          item.index = 0;
        });
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
        note.textContent = `Legacy sprite: ${item.sprite}`;
        inspector.append(note);
      }
      numberField('X', item.x, 0, current.width - 1, (v) => {
        item.x = v;
      });
      numberField('Y', item.y, 0, current.height - 1, (v) => {
        item.y = v;
      });
      if (item.type === 'Prop')
        numberField('Z', item.z, -1000, 1000, (v) => {
          item.z = v;
        });
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
    const drawToken = token;
    if (!scene) return;
    const pixelWidth = scene.width * cell.width;
    const pixelHeight = scene.height * cell.height;
    canvas.width = Math.ceil(pixelWidth);
    canvas.height = Math.ceil(pixelHeight);
    canvas.style.width = `${pixelWidth}px`;
    canvas.style.height = `${pixelHeight}px`;
    hoverCanvas.width = canvas.width;
    hoverCanvas.height = canvas.height;
    hoverCanvas.style.width = canvas.style.width;
    hoverCanvas.style.height = canvas.style.height;
    if (autoFit) fitView();
    context.fillStyle = scene.clear.bg;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (scene.clear.ch !== ' ') {
      context.fillStyle = scene.clear.fg;
      for (let y = 0; y < scene.height; y++)
        for (let x = 0; x < scene.width; x++)
          drawTerminalGlyph(context, cell, scene.clear.ch, x * cell.width, y * cell.height);
    }
    const visuals = await Promise.all(
      scene.entities.map(async (entry) => {
        if (entry.type === 'Background')
          return { entry, sprite: await sheet(entry.sprite), index: entry.index, depth: 0 };
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
        if (asset.visual.type === 'sprite') {
          spriteId = asset.visual.id;
          index = asset.visual.index;
        } else {
          const clip = await animation(asset.visual.id);
          const first = clip?.frames.find((frame) => !isInvisibleFrame(frame));
          if (!first || isInvisibleFrame(first))
            return { entry, sprite: null, index: 0, depth: entry.y };
          spriteId = first.sprite;
          index = first.index;
        }
        return {
          entry,
          sprite: await sheet(spriteId),
          index,
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
    hitBoxes = [];
    propLabels = [];
    triggerLabels = [];
    const outlines: SceneHitBox[] = [];
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
    for (const { entry, sprite, index } of visuals) {
      if (entry.type === 'Prop')
        propLabels.push({
          id: entry.id,
          name: entry.name ?? entry.id,
          x: sprite ? entry.x - sprite.originX : entry.x,
          y: sprite ? entry.y - sprite.originY : entry.y,
          width: sprite?.width ?? 1,
        });
      if (!sprite || index >= sprite.sprites.length) {
        context.fillStyle = '#dca665';
        drawTerminalGlyph(context, cell, '?', entry.x * cell.width, entry.y * cell.height);
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
      flattenSprite(sprite, index).forEach((glyph, at) => {
        const x = (left + (at % sprite.width)) * cell.width;
        const y = (top + Math.floor(at / sprite.width)) * cell.height;
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
        context.fillStyle = palette ? (paletteRgb(palette, glyph.bg) ?? '#000') : '#000';
        fillTerminalCell(context, cell, x, y);
        if (glyph.ch !== ' ') {
          context.fillStyle = palette ? (paletteRgb(palette, glyph.fg) ?? '#fff') : '#fff';
          drawTerminalGlyph(context, cell, glyph.ch, x, y);
        }
      });
    }
    for (const trigger of backgroundEdit ? [] : scene.triggers) {
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
    paintHover();
  }

  function render(): void {
    ++token;
    if (hovered && !selectable(hovered)) setHover(null);
    renderList();
    $<HTMLElement>('#scene-title').textContent = current?.id ?? 'NO SCENE';
    $<HTMLElement>('#scene-workspace').hidden = !current;
    $<HTMLButtonElement>('#scene-save').disabled = !current || saving;
    $<HTMLButtonElement>('#scene-delete').disabled = !current;
    if (!current) return;
    const bg = background();
    if (backgroundEdit && !bg) {
      backgroundEdit = false;
      selected = [];
    }
    const modeButton = $<HTMLButtonElement>('#scene-background-mode');
    modeButton.disabled = !bg;
    modeButton.setAttribute('aria-pressed', String(backgroundEdit));
    modeButton.textContent = backgroundEdit ? 'EDIT BACKGROUND: ON' : 'EDIT BACKGROUND: OFF';
    $<HTMLButtonElement>('#scene-add-background').textContent = bg
      ? 'REPLACE BACKGROUND SPRITE'
      : 'ADD BACKGROUND SPRITE';
    $<HTMLButtonElement>('#scene-add-prop').disabled = backgroundEdit;
    const addTriggerButton = $<HTMLButtonElement>('#scene-add-trigger');
    addTriggerButton.disabled = backgroundEdit;
    addTriggerButton.setAttribute('aria-pressed', String(placingTrigger));
    addTriggerButton.textContent = placingTrigger ? 'CANCEL TRIGGER' : '+ TRIGGER';
    $<HTMLInputElement>('#scene-width').value = String(current.width);
    $<HTMLInputElement>('#scene-height').value = String(current.height);
    $<HTMLSelectElement>('#scene-depth').value = current.depthMode;
    renderInspector();
    void draw();
  }

  async function refresh(): Promise<void> {
    const [sceneList, propList, sheetList, colors, triggers] = await Promise.all([
      requestJson<{ files: string[] }>('/api/scenes'),
      requestJson<{ files: string[] }>('/api/props'),
      requestJson<{ files: string[] }>('/api/sprites'),
      requestJson<PaletteDocument>('/api/palette'),
      requestJson<{ names: string[] }>('/api/rpg-triggers'),
    ]);
    if (!alive) return;
    files = sceneList.files;
    props = propList.files;
    sprites = sheetList.files;
    palette = colors;
    rpgTriggers = triggers.names;
    render();
  }
  async function open(id: string): Promise<void> {
    if (current?.id === id) return;
    if (dirty() && !(await confirmModal('Discard unsaved scene changes?', 'DISCARD'))) return;
    const openToken = ++token;
    try {
      const scene = await requestJson<SceneDocument>(`/api/scenes/${encodeURIComponent(id)}`);
      if (!alive || openToken !== token) return;
      current = scene;
      saved = structuredClone(scene);
      backgroundEdit = false;
      placingTrigger = false;
      selected = [];
      setEditorAssetUrl(id);
      status.textContent = `Opened ${id}`;
      render();
      fitView();
    } catch (error) {
      if (alive && openToken === token) status.textContent = message(error);
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
        const rebased = mergeJson(sent, current, stored);
        if (rebased.ok) {
          current = rebased.value;
          saved = stored;
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

  function drawThumbnail(canvas: HTMLCanvasElement, sprite: SpriteDocument, index: number): void {
    const preview = canvas.getContext('2d');
    if (!preview) return;
    preview.fillStyle = '#000';
    preview.fillRect(0, 0, canvas.width, canvas.height);
    const native = terminalCellAtZoom(preview, 1, 'msdos-80x25');
    const scale = Math.min(
      3,
      (canvas.width - 8) / (sprite.width * native.width),
      (canvas.height - 8) / (sprite.height * native.height),
    );
    const grid = terminalCellAtZoom(preview, scale, 'msdos-80x25');
    const x0 = (canvas.width - sprite.width * grid.width) / 2;
    const y0 = (canvas.height - sprite.height * grid.height) / 2;
    flattenSprite(sprite, index).forEach((cell, at) => {
      const x = x0 + (at % sprite.width) * grid.width;
      const y = y0 + Math.floor(at / sprite.width) * grid.height;
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
    const id = backgroundSheet.value;
    backgroundChoice = null;
    backgroundAdd.disabled = true;
    backgroundFrames.replaceChildren();
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
    backgroundSheet.replaceChildren();
    for (const id of sprites) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      backgroundSheet.append(option);
    }
    backgroundChoice = null;
    backgroundPicker.showModal();
    void renderBackgroundFrames();
  }

  backgroundSheet.addEventListener('change', () => void renderBackgroundFrames());
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

  $<HTMLButtonElement>('#scene-background-mode').addEventListener('click', () => {
    const bg = background();
    if (!bg) return;
    backgroundEdit = !backgroundEdit;
    placingTrigger = false;
    selected = backgroundEdit ? [{ kind: 'entity', id: bg.id }] : [];
    drag = null;
    render();
  });

  function addTrigger(): void {
    if (!current || backgroundEdit) return;
    placingTrigger = !placingTrigger;
    if (placingTrigger) {
      selected = [];
      status.textContent = 'Drag on the scene to draw a trigger region. Esc cancels.';
      void requestJson<{ names: string[] }>('/api/rpg-triggers').then(
        (result) => {
          if (alive) {
            rpgTriggers = result.names;
            renderInspector();
          }
        },
        () => {
          if (alive) status.textContent = 'Could not refresh RPGTrigger names.';
        },
      );
    }
    render();
    syncCursor();
  }
  function canvasPoint(event: PointerEvent | MouseEvent): { x: number; y: number } | null {
    if (!current) return null;
    const pixel = viewportPixel(event);
    const { x, y } = sceneCellAt(view, pixel.x, pixel.y, cell.width, cell.height);
    return x >= 0 && y >= 0 && x < current.width && y < current.height ? { x, y } : null;
  }
  function hitAt(x: number, y: number): ObjectRef | null {
    return (
      [...hitBoxes]
        .reverse()
        .find(
          (box) =>
            selectable(box.ref) &&
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
    if (event.button !== 0 || spaceHeld) return;
    const point = canvasPoint(event);
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
  canvas.addEventListener('pointermove', (event) => {
    if (pan) return;
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
    if (!drag || drag.pointerId !== event.pointerId || !current) return;
    const pixel = scenePixel(event);
    const delta = groupSceneDelta(
      drag.items,
      Math.floor(pixel.x) - drag.x,
      Math.floor(pixel.y) - drag.y,
      current.width,
      current.height,
    );
    let changed = false;
    for (const start of drag.items) {
      const item = positioned(start.ref);
      if (!item || (item.x === start.x + delta.x && item.y === start.y + delta.y)) continue;
      item.x = start.x + delta.x;
      item.y = start.y + delta.y;
      changed = true;
    }
    if (changed) render();
  });
  canvas.addEventListener('pointerup', (event) => {
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
    if (drag?.pointerId === event.pointerId) drag = null;
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
    drag = null;
    marquee = null;
    drawingTrigger = null;
    resizing = null;
    paintHover();
  });
  canvas.addEventListener('pointerleave', () => {
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
  $<HTMLButtonElement>('#scene-fit').addEventListener('click', fitView);
  $<HTMLButtonElement>('#scene-add-background').addEventListener('click', openBackgroundPicker);
  $<HTMLButtonElement>('#scene-add-prop').addEventListener('click', () => void openPropPicker());
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
      current[dimension] = value;
      render();
      if (autoFit) fitView();
    });
  }
  $<HTMLSelectElement>('#scene-depth').addEventListener('change', (event) => {
    if (!current) return;
    current.depthMode = (event.target as HTMLSelectElement).value as SceneDocument['depthMode'];
    render();
  });
  $<HTMLInputElement>('#scene-search').addEventListener('input', renderList);
  $<HTMLButtonElement>('#scene-save').addEventListener('click', () => void save());
  $<HTMLButtonElement>('#scene-new').addEventListener(
    'click',
    () =>
      void (async () => {
        const id = await askId('New scene id');
        if (!id) return;
        if (!isAssetId(id) || files.includes(id)) {
          await alertModal('Use a unique short lowercase id');
          return;
        }
        if (dirty() && !(await confirmModal('Discard unsaved scene changes?', 'DISCARD'))) return;
        current = createScene(id);
        saved = null;
        backgroundEdit = false;
        placingTrigger = false;
        selected = [];
        setEditorAssetUrl(null);
        status.textContent = `New scene ${id}`;
        render();
        fitView();
      })(),
  );
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
          current = null;
          saved = null;
          backgroundEdit = false;
          placingTrigger = false;
          selected = [];
          setEditorAssetUrl(null);
          status.textContent = 'Scene deleted';
          await refresh();
        } catch (error) {
          status.textContent = message(error);
        }
      })(),
  );
  const onKey = (event: KeyboardEvent) => {
    if (!root.isConnected) return;
    if (
      event.key === 'Tab' &&
      current &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !backgroundPicker.open &&
      !propPicker.open &&
      !isModalOpen() &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(event.target instanceof HTMLSelectElement) &&
      !(event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      event.preventDefault();
      if (!showPropNames) {
        showPropNames = true;
        paintHover();
      }
      return;
    }
    if (
      event.key === 'Escape' &&
      !backgroundPicker.open &&
      !propPicker.open &&
      !isModalOpen() &&
      (placingTrigger || selected.length)
    ) {
      event.preventDefault();
      placingTrigger = false;
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
      !backgroundPicker.open &&
      !propPicker.open &&
      !isModalOpen() &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(event.target instanceof HTMLSelectElement) &&
      !(event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      event.preventDefault();
      selected = selectableSceneObjects(current, backgroundEdit);
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
      paintHover();
    }
    if (event.key === ' ') {
      spaceHeld = false;
      syncCursor();
    }
  };
  const onBlur = () => {
    showPropNames = false;
    paintHover();
    spaceHeld = false;
    pan = null;
    syncCursor();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  void document.fonts.ready.then(() => {
    if (!alive) return;
    cell = terminalCellAtZoom(context, 1);
    if (current) render();
  });
  void refresh()
    .then(async () => {
      const id = new URLSearchParams(location.search).get('id');
      if (id && alive) {
        if (isAssetId(id) && files.includes(id)) await open(id);
        else status.textContent = `Scene ${id} not found`;
      }
    })
    .catch((error: unknown) => {
      if (alive) status.textContent = message(error);
    });
  return () => {
    alive = false;
    ++token;
    ++pickerToken;
    ++propPickerToken;
    ++propLoadToken;
    if (backgroundPicker.open) backgroundPicker.close();
    if (propPicker.open) propPicker.close();
    resizeObserver.disconnect();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    setDirtyGuard(null);
  };
}
