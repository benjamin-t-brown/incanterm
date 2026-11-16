import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProp, createSprite, type SceneDocument } from '../../../schema.js';
import { TestElement } from '../../__tests__/dom-fixture.js';
import { requestJson } from '../../api.js';
import { promptModal } from '../../modal.js';
import { mountScenes } from '../scenes.js';
import { createItem } from '../../../items/item-schema.js';

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

// Only emulate DOM APIs needed by these interactions; all assets are test-owned.
class SceneTestElement extends TestElement {
  checked = false;
  clientWidth = 0;
  clientHeight = 0;
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

  getContext() {
    return {
      measureText: () => ({ width: 10 }),
      fillRect: vi.fn(),
    };
  }
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

it.each(['background', 'blocked'] as const)(
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
