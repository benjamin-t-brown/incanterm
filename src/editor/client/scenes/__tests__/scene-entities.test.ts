import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProp, createSprite, type SceneDocument } from '../../../schema.js';
import { TestElement } from '../../__tests__/dom-fixture.js';
import { requestJson } from '../../api.js';
import { promptModal } from '../../modal.js';
import { mountScenes } from '../scenes.js';
import { createItem } from '../../../items/item-schema.js';
import { createPropSlideFixtureDocuments } from '../../../../game/__tests__/prop-slide-fixture.js';
import { parseScene } from '../../../schema.js';

vi.mock('../../project.js', () => ({
  projectStorage: { getItem: () => null, setItem: vi.fn() },
}));
vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  requestJson: vi.fn(),
}));
vi.mock('../../shell.js', () => ({
  createPageShell: (_title: string, content: string) => content,
  setDirtyGuard: vi.fn(),
  setEditorAssetUrl: vi.fn(),
}));
vi.mock('../../panel-resizer.js', () => ({ createPanelResizer: () => vi.fn() }));
vi.mock('../../tab-close-actions.js', () => ({ renderTabCloseActions: vi.fn() }));
vi.mock('../../modal.js', () => ({
  alertModal: vi.fn(),
  confirmModal: vi.fn(),
  isModalOpen: () => false,
  promptModal: vi.fn(),
}));

let cleanup: (() => void) | undefined;
let elements: Map<string, SceneTestElement>;
let storedScene: SceneDocument | null;
const sprite = createSprite('test-sprite', 2, 1);
const prop = createProp('test-prop', { type: 'sprite', id: sprite.id, index: 0 });
const item = createItem('test-item', { type: 'sprite', id: sprite.id, index: 0 }, 'Office Key');
const slideFixture = createPropSlideFixtureDocuments();

// Only emulate DOM APIs needed by these interactions; all assets are test-owned.
class SceneTestElement extends TestElement {
  checked = false;
  clientWidth = 0;
  clientHeight = 0;
  clientLeft = 1;
  clientTop = 1;
  isConnected = true;

  set innerHTML(html: string) {
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const element = new SceneTestElement(match[1]);
      element.id = match[2];
      elements.set(`#${element.id}`, element);
    }
  }

  querySelector(selector: string): SceneTestElement | null {
    return elements.get(selector) ?? null;
  }

  before = this.insertElements;
  after = this.insertElements;

  insertElements(...items: SceneTestElement[]): void {
    for (const item of items) {
      if (item.id) elements.set(`#${item.id}`, item);
      this.insertElements(...(item.children as SceneTestElement[]));
    }
  }

  getBoundingClientRect() {
    return { left: 40, top: 60 };
  }

  setPointerCapture(): void {}

  click(): void { this.dispatch('click'); }

  dispatchPointer(type: string, clientX: number, clientY: number, button = 0): void {
    const event = {
      type,
      target: this,
      clientX,
      clientY,
      button,
      pointerId: 1,
      preventDefault: function handlePreventDefault() {},
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  readonly context = {
      measureText: () => ({ width: 10 }),
      fillRect: vi.fn(),
      resetTransform: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(),
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), fillText: vi.fn(), strokeRect: vi.fn(),
  };
  getContext() { return this.context; }
}

function getElement(id: string): SceneTestElement {
  const element = elements.get(`#${id}`);
  if (!element) throw new Error(`Missing test element ${id}`);
  return element;
}

function clickElement(id: string): void {
  const element = getElement(id);
  expect(element.disabled, `${id} should be enabled`).toBe(false);
  element.dispatch('click');
}

async function createSceneWithBackground(): Promise<void> {
  cleanup = mountScenes(new SceneTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('scene-add-prop').disabled).toBe(true));
  clickElement('scene-new');
  getElement('scene-new-label').value = 'Test room';
  getElement('scene-new-form').dispatch('submit');
  clickElement('scene-add-background');
  await vi.waitFor(() => expect(getElement('scene-background-frames').children).toHaveLength(1));
  getElement('scene-background-frames').children[0].dispatch('click');
  clickElement('scene-background-add');
  expect(getElement('scene-background-mode').attributes.get('aria-pressed')).toBe('true');
}

async function saveScene(): Promise<void> {
  clickElement('scene-save');
  await vi.waitFor(() => expect(getElement('scene-save').disabled).toBe(false));
  expect(storedScene).not.toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  elements = new Map([
    ['.simple-main', new SceneTestElement()],
    ['.scene-main', new SceneTestElement()],
    ['.scene-library', new SceneTestElement()],
  ]);
  storedScene = null;
  vi.stubGlobal('document', {
    createElement: (tag: string) => new SceneTestElement(tag),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    fonts: { ready: Promise.resolve() },
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'Option',
    class extends TestElement {
      constructor(text: string, value: string) {
        super('option');
        this.textContent = text;
        this.value = value;
      }
    },
  );
  vi.mocked(promptModal).mockResolvedValue('test_marker');
  vi.mocked(requestJson).mockImplementation(
    async <T>(url: string, options?: RequestInit): Promise<T> => {
      let result: unknown;
      if (url.startsWith('/api/scenes/') && options?.method === 'PUT') {
        storedScene = JSON.parse(options.body as string).doc as SceneDocument;
        result = storedScene;
      } else if (url === '/api/scenes') {
        result = { files: storedScene ? [storedScene.id] : [], labels: {} };
      } else if (storedScene && url === `/api/scenes/${storedScene.id}`) {
        result = storedScene;
      } else if (url === '/api/props') {
        result = { files: [prop.id], labels: {} };
      } else if (url === '/api/items') {
        result = { files: [item.id], labels: { [item.id]: item.label } };
      } else if (url === `/api/items/${item.id}`) {
        result = item;
      } else if (url === '/api/sprites') {
        result = { files: [sprite.id], labels: {} };
      } else if (url === `/api/sprites/${sprite.id}`) {
        result = sprite;
      } else if (url === `/api/props/${prop.id}`) {
        result = prop;
      } else if (url === `/api/props/${slideFixture.prop.id}`) {
        result = { ...slideFixture.prop, slideCells: [0, 4] };
      } else if (url === `/api/sprites/${slideFixture.sprite.id}`) {
        result = slideFixture.sprite;
      } else if (url.endsWith('-folders')) {
        result = { folders: [], placements: {} };
      } else if (url === '/api/rpg-triggers') {
        result = { names: [], sources: {} };
      } else if (url === '/api/scripts/names') {
        result = { sources: {} };
      } else if (url === '/api/characters') {
        result = { files: [], labels: {} };
      } else if (url === '/api/palette') {
        result = null;
      } else {
        throw new Error(`Unexpected test request ${url}`);
      }
      return structuredClone(result) as T;
    },
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('outlines the hovered cell and shows its coordinates without replacing the status message', async () => {
  cleanup = mountScenes(new SceneTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('scene-add-prop').disabled).toBe(true));
  const viewport = getElement('scene-viewport');
  viewport.clientWidth = 264;
  viewport.clientHeight = 224;
  const coordinates = getElement('scene-cell-status');
  const outline = getElement('scene-cell-outline');
  viewport.dispatchPointer('pointerenter', 73, 93);
  expect(coordinates.textContent).toBe('X: --  Y: --');
  expect(outline.hidden).toBe(true);

  clickElement('scene-new');
  getElement('scene-new-label').value = 'Test room';
  getElement('scene-new-width').value = '10';
  getElement('scene-new-height').value = '4';
  getElement('scene-new-form').dispatch('submit');
  // The fitted scene starts 32 px inside the viewport and has 20 × 40 px cells.
  viewport.dispatchPointer('pointermove', 113, 133);
  expect(coordinates.textContent).toBe('X: 2  Y: 1');
  expect(outline.hidden).toBe(false);
  expect(outline.style).toMatchObject({ left: '72px', top: '72px', width: '20px', height: '40px' });
  expect(getElement('scene-status').textContent).toBe('New scene Test room');

  viewport.dispatchPointer('pointermove', 72, 133);
  expect(coordinates.textContent).toBe('X: --  Y: --');
  expect(outline.hidden).toBe(true);
  viewport.dispatchPointer('pointermove', 73, 133);
  expect(coordinates.textContent).toBe('X: 0  Y: 1');
  clickElement('scene-zoom-in');
  expect(coordinates.textContent).toBe('X: 1  Y: 1');
  expect(outline.style).toMatchObject({ left: '32px', top: '62px', width: '25px', height: '50px' });

  viewport.dispatchPointer('pointerdown', 73, 133, 1);
  viewport.dispatchPointer('pointermove', 103, 153);
  expect(coordinates.textContent).toBe('X: 1  Y: 1');
  expect(outline.style).toMatchObject({ left: '62px', top: '82px' });
  viewport.dispatchPointer('pointerup', 103, 153, 1);
  viewport.dispatchPointer('pointermove', 128, 153);
  expect(coordinates.textContent).toBe('X: 2  Y: 1');
  viewport.dispatchPointer('pointerleave', 128, 153);
  expect(coordinates.textContent).toBe('X: --  Y: --');
  expect(outline.hidden).toBe(true);
});

it('adds a prop after creating a scene, adding a background, enabling Show UI and saving', async () => {
  await createSceneWithBackground();
  getElement('scene-show-ui').checked = true;
  getElement('scene-show-ui').dispatch('change');
  await saveScene();
  const background = structuredClone(storedScene?.entities[0]);

  clickElement('scene-add-prop');
  expect(getElement('scene-prop-picker').open).toBe(true);
  expect(getElement('scene-background-mode').attributes.get('aria-pressed')).toBe('false');
  await vi.waitFor(() =>
    expect(getElement('scene-prop-results').querySelectorAll('.asset-tree-file')).toHaveLength(1),
  );
  getElement('scene-prop-results').querySelectorAll('.asset-tree-file')[0].dispatch('click');
  await vi.waitFor(() => expect(getElement('scene-prop-add').disabled).toBe(false));
  clickElement('scene-prop-add');
  expect(getElement('scene-prop-picker').open).toBe(false);
  expect(getElement('scene-inspector').children[0].textContent).toBe('PROP');
  expect(getElement('scene-show-ui').checked).toBe(true);
  await saveScene();
  expect(storedScene?.entities).toEqual([
    background,
    expect.objectContaining({ type: 'Prop', prop: prop.id }),
  ]);
});

it.each(['background', 'blocked', 'travel'] as const)(
  'keeps every Entities command available during %s editing and exits that mode on use',
  async (mode) => {
    await createSceneWithBackground();
    for (const command of ['prop', 'character', 'marker', 'trigger']) {
      const modeButton = getElement(`scene-${mode}-mode`);
      if (modeButton.attributes.get('aria-pressed') !== 'true') clickElement(modeButton.id);
      for (const entity of ['prop', 'character', 'marker', 'trigger'])
        expect(getElement(`scene-add-${entity}`).disabled).toBe(false);
      clickElement(`scene-add-${command}`);
      expect(modeButton.attributes.get('aria-pressed')).toBe('false');
      if (command === 'prop' || command === 'character') {
        expect(getElement(`scene-${command}-picker`).open).toBe(true);
        clickElement(`scene-${command}-cancel`);
      } else if (command === 'marker') {
        await vi.waitFor(() =>
          expect(getElement('scene-inspector').children[0]?.textContent).toBe('MARKER'),
        );
      } else {
        expect(getElement('scene-add-trigger').attributes.get('aria-pressed')).toBe('true');
      }
    }
  },
);

it('disables entity creation when no scene is open', async () => {
  cleanup = mountScenes(new SceneTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('scene-add-prop').disabled).toBe(true));
  for (const entity of ['item', 'character', 'marker', 'trigger'])
    expect(getElement(`scene-add-${entity}`).disabled).toBe(true);
});

it('adds a collectible item with its appearance and editable instance depth from the item picker', async () => {
  await createSceneWithBackground();
  clickElement('scene-add-item');
  expect(getElement('scene-item-picker').open).toBe(true);
  expect(getElement('scene-background-mode').attributes.get('aria-pressed')).toBe('false');
  await vi.waitFor(() =>
    expect(getElement('scene-item-results').querySelectorAll('.asset-tree-file')).toHaveLength(1),
  );
  getElement('scene-item-results').querySelectorAll('.asset-tree-file')[0].dispatch('click');
  await vi.waitFor(() => expect(getElement('scene-item-add').disabled).toBe(false));
  clickElement('scene-item-add');
  expect(getElement('scene-item-picker').open).toBe(false);
  expect(getElement('scene-inspector').children[0].textContent).toBe('ITEM');
  expect(getInspectorInput('Z').disabled).toBe(true);
  getInspectorInput('Z OFFSET').value = '7';
  getInspectorInput('Z OFFSET').dispatch('change');
  await saveScene();
  expect(storedScene?.entities).toContainEqual(expect.objectContaining({
    type: 'Item', item: item.id, name: item.label, depthOffset: 7,
  }));
});

function getInspectorInput(label: string): TestElement {
  const pending: TestElement[] = [getElement('scene-inspector')];
  while (pending.length) {
    const element = pending.shift();
    if (!element) break;
    if (element.tagName === 'label' && element.textContent === label) return element.children[0];
    pending.push(...element.children);
  }
  throw new Error(`Missing inspector field ${label}`);
}

function getPreviewButton(direction: string) {
  const row = getElement('scene-inspector').children.find(e => e.className === 'scene-slide-preview-row');
  const button = row?.children.find(e => e.attributes.get('aria-label') === `Preview slide ${direction}`);
  if (!button) throw new Error(`Missing preview button: ${direction}`);
  return button;
}

it('paints room travel and previews shared asset footprints without storing them on instances', async () => {
  const { scene, prop: shelfAsset, sprite: shelfArt } = createPropSlideFixtureDocuments();
  storedScene = scene;
  for (const entry of scene.entities) entry.slidable = { actionScript: 'pushShelf' };
  vi.stubGlobal('location', { search: `?id=${scene.id}` });
  const loadEditor = async () => {
    cleanup = mountScenes(new SceneTestElement() as unknown as HTMLElement);
    await vi.waitFor(() => expect(getElement('scene-status').textContent).toBe(`Opened ${scene.id}`));
    const viewport = getElement('scene-viewport');
    viewport.clientWidth = 224;
    viewport.clientHeight = 304;
    clickElement('scene-fit');
  };
  const selectShelf = (index: number) => {
    clickElement('scene-tab-props');
    getElement('scene-room-props').children[index].dispatch('click');
  };
  const paintStroke = (x: number, y: number, endX = x, endY = y) => {
    const canvas = getElement('scene-canvas');
    canvas.dispatchPointer('pointerdown', 73 + x * 20, 93 + y * 40);
    canvas.dispatchPointer('pointerup', 73 + endX * 20, 93 + endY * 40);
  };
  const checkPreviewButtons = () => {
    for (const direction of ['left', 'right', 'up', 'down']) {
      getPreviewButton(direction).dispatch('click');
      expect(getPreviewButton(direction).attributes.get('aria-pressed')).toBe('true');
      expect(getElement('scene-inspector').children.some(e => /steps? to|blocked at/.test(e.textContent))).toBe(false);
    }
  };
  await loadEditor();
  clickElement('scene-travel-mode');
  paintStroke(7, 0);
  clickElement('scene-travel-mode');
  selectShelf(0);
  const setSlidable = (checked: boolean) => {
    const toggle = getInspectorInput('Slidable') as SceneTestElement;
    toggle.checked = checked;
    toggle.dispatch('change');
  };
  setSlidable(false);
  setSlidable(true);
  expect(getElement('scene-inspector').children.some(e => e.textContent === 'Preview Slide')).toBe(true);
  const action = getInspectorInput('Slide action script');
  action.value = 'pushShelf';
  action.dispatch('change');
  selectShelf(0);
  await saveScene();
  const authored = structuredClone(storedScene);
  expect(authored?.entities.map(e => 'slidable' in e && e.slidable)).toEqual([{ actionScript: 'pushShelf' }, { actionScript: 'pushShelf' }]);
  expect(authored?.propSlide?.travelCells).toEqual(scene.propSlide.travelCells.filter(i => i !== 7));
  expect(authored?.blockedCells).toEqual(scene.blockedCells);
  checkPreviewButtons();
  await saveScene();
  expect(storedScene).toEqual(authored);
  const reopened = parseScene(JSON.parse(JSON.stringify(authored)));
  if (!reopened.ok) throw new Error(reopened.error);
  storedScene = reopened.value;
  cleanup?.();
  await loadEditor();
  selectShelf(0);
  checkPreviewButtons();
  getPreviewButton('right').dispatch('click');
  vi.mocked(requestAnimationFrame).mock.lastCall?.[0](0);
  const context = getElement('scene-canvas').context;
  await vi.waitFor(() => expect(context.fillText).toHaveBeenCalledWith('×', 0, expect.any(Number)));
  // The ghost at (3,2) draws its glyph at (2,1); the other footprint stops it at (4,2).
  expect(context.translate.mock.calls.slice(-2)).toEqual([[20, 20], [40, 40]]);
  expect(getPreviewButton('right').attributes.get('aria-pressed')).toBe('true');
  getPreviewButton('right').dispatch('click');
  expect(getPreviewButton('right').attributes.get('aria-pressed')).toBe('false');
  expect(getElement('scene-inspector').children.some(e => /steps? to/.test(e.textContent))).toBe(false);
  expect(vi.mocked(requestJson).mock.calls.some(([url, options]) =>
    [shelfAsset.id, shelfArt.id].some(id => url.endsWith(`/${id}`)) && options?.method === 'PUT')).toBe(false);
});

it('previews an immediately blocked crate without a text readout and still reports invalid placements', async () => {
  const { scene } = createPropSlideFixtureDocuments();
  storedScene = {
    ...scene,
    entities: ['crate-a', 'crate-b'].map((id, i) => ({
      id, type: 'Prop', sprite: sprite.id, name: 'Crate', x: 2 + i, y: 2, z: 0, depthOffset: 0,
      slidable: { footprint: [{ x: 0, y: 0 }], actionScript: 'pushCrate' },
    })),
  };
  vi.stubGlobal('location', { search: `?id=${scene.id}` });
  cleanup = mountScenes(new SceneTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('scene-status').textContent).toBe(`Opened ${scene.id}`));
  clickElement('scene-tab-props');
  getElement('scene-room-props').children[0].dispatch('click');
  getPreviewButton('right').dispatch('click');
  expect(getPreviewButton('right').attributes.get('aria-pressed')).toBe('true');
  expect(getElement('scene-inspector').children.some(e => /steps? to|blocked at/.test(e.textContent))).toBe(false);
  const x = getInspectorInput('X');
  x.value = '3';
  x.dispatch('change');
  expect(getElement('scene-inspector').children.map(e => e.textContent)).toContain('Overlaps crate-b at (3, 2).');
  clickElement('scene-tab-props');
  getElement('scene-room-props').children[1].dispatch('click');
  expect(getElement('scene-inspector').children.map(e => e.textContent)).toContain('Overlaps crate-a at (3, 2).');
  const nextX = getInspectorInput('X');
  nextX.value = '4';
  nextX.dispatch('change');
  const y = getInspectorInput('Y');
  y.value = '1';
  y.dispatch('change');
  expect(getElement('scene-inspector').children.map(e => e.textContent)).toContain('Starts outside prop travel at (4, 1).');
});

it('disables world Z in Bottom Up and saves independent render-only Z offsets', async () => {
  await createSceneWithBackground();
  for (const offset of [-12, 8]) {
    clickElement('scene-add-prop');
    await vi.waitFor(() =>
      expect(getElement('scene-prop-results').querySelectorAll('.asset-tree-file')).toHaveLength(1),
    );
    getElement('scene-prop-results').querySelectorAll('.asset-tree-file')[0].dispatch('click');
    await vi.waitFor(() => expect(getElement('scene-prop-add').disabled).toBe(false));
    clickElement('scene-prop-add');
    expect(getInspectorInput('Z').disabled).toBe(true);
    expect(getElement('scene-inspector').children.some(
      (element) => element.tagName === 'p' && element.textContent.startsWith('Z offset'),
    )).toBe(false);
    const input = getInspectorInput('Z OFFSET');
    expect(input.value).toBe('0');
    input.value = String(offset);
    input.dispatch('change');
    expect(getInspectorInput('Z OFFSET').value).toBe(String(offset));
    await saveScene();
  }
  expect(storedScene?.entities.filter((entry) => entry.type === 'Prop')).toMatchObject([
    { prop: prop.id, z: 0, depthOffset: -12 },
    { prop: prop.id, z: 0, depthOffset: 8 },
  ]);
  expect(prop.depthOffset).toBe(0);
  getElement('scene-depth').value = 'regular-z';
  getElement('scene-depth').dispatch('change');
  expect(getInspectorInput('Z').disabled).toBe(false);
  expect(getInspectorInput('Z OFFSET').value).toBe('8');
  getElement('scene-depth').value = 'bottom-up';
  getElement('scene-depth').dispatch('change');
  expect(getInspectorInput('Z').disabled).toBe(true);
  expect(vi.mocked(requestJson).mock.calls.some(
    ([url, options]) => url.startsWith('/api/props/') && options?.method === 'PUT',
  )).toBe(false);
});
