import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createItem, type ItemDocument } from '../../../items/item-schema.js';
import { createAnimation, createSprite } from '../../../schema.js';
import { TestElement } from '../../__tests__/dom-fixture.js';
import { requestJson } from '../../api.js';
import { saveDraft } from '../../save.js';
import { mountItems } from '../items.js';
import { createAssetTree } from '../../asset-tree.js';
import { confirmModal } from '../../modal.js';
import { projectStorage } from '../../project.js';
import { OPEN_ITEMS_KEY } from '../../../items/item-tabs.js';
import { askId } from '../../shell.js';

vi.mock('../../project.js', () => ({
  projectStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  requestJson: vi.fn(),
}));
vi.mock('../../save.js', () => ({ saveDraft: vi.fn() }));
vi.mock('../../shell.js', () => ({
  askId: vi.fn(),
  createPageShell: (_title: string, content: string) => content,
  setDirtyGuard: vi.fn(),
  setEditorAssetUrl: vi.fn(),
}));
vi.mock('../../asset-tree.js', () => ({
  createAssetTree: vi.fn(() => ({ select: vi.fn(), setData: vi.fn(), createFolder: vi.fn() })),
}));
vi.mock('../../panel-resizer.js', () => ({ createPanelResizer: () => vi.fn() }));
vi.mock('../../tab-close-actions.js', () => ({ renderTabCloseActions: vi.fn() }));
vi.mock('../../modal.js', () => ({ confirmModal: vi.fn(async () => true) }));
vi.mock('../../../terminal-cell.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../terminal-cell.js')>()),
  preloadSpriteFonts: () => Promise.resolve(),
}));

let cleanup: (() => void) | undefined;
let elements: Map<string, ItemTestElement>;
const item: ItemDocument = {
  ...createItem('key', { type: 'sprite', id: 'art', index: 0 }, 'Brass key'),
  scriptName: 'OfficeKey',
  examineScript: 'inspect',
  combineFailScript: 'fail',
  combinations: [{ targetType: 'item', target: 'coin', script: 'combine' }],
};

class ItemTestElement extends TestElement {
  inert = false;
  set innerHTML(html: string) {
    for (const name of ['item-main', 'item-library'])
      elements.set(`.${name}`, new ItemTestElement());
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const element = new ItemTestElement(match[1]);
      element.id = match[2];
      elements.set(`#${element.id}`, element);
    }
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bdata-picker="([^"]+)"[^>]*>/g)) {
      const element = new ItemTestElement(match[1]);
      elements.set(`[data-picker="${match[2]}"]`, element);
    }
  }
  querySelector(selector: string): ItemTestElement | null {
    return elements.get(selector) ?? null;
  }
  getContext() {
    return { clearRect: vi.fn() };
  }
  remove(): void {}
}

function getElement(id: string): ItemTestElement {
  const element = elements.get(`#${id}`);
  if (!element) throw new Error(`Missing ${id}`);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(projectStorage.getItem).mockReturnValue(null);
  elements = new Map();
  vi.stubGlobal('document', {
    createElement: (tag: string) => new ItemTestElement(tag),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('location', { search: '?id=key' });
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
  vi.mocked(requestJson).mockImplementation(async <T>(url: string): Promise<T> => {
    const responses: Record<string, unknown> = {
      '/api/items': { files: ['key', 'coin'], labels: { key: 'Brass key', coin: 'Coin' } },
      '/api/items/key': item,
      '/api/items/coin': createItem('coin', { type: 'sprite', id: 'art', index: 0 }, 'Coin'),
      '/api/item-folders': { folders: [], placements: {} },
      '/api/sprites': { files: ['art'], labels: {} },
      '/api/sprites/art': createSprite('art', 1, 1),
      '/api/animations': { files: ['clip'], labels: {} },
      '/api/animations/clip': {
        ...createAnimation('clip'),
        frames: [{ sprite: 'art', index: 0, durationMs: 100 }],
      },
      '/api/props': { files: ['lock'], labels: { lock: 'Door lock' } },
      '/api/characters': { files: ['guard'], labels: { guard: 'Guard' } },
      '/api/scripts/names': {
        sources: { inspect: ['hooks'], fail: ['hooks'], combine: ['hooks'] },
      },
      '/api/palette': null,
    };
    if (!(url in responses)) throw new Error(`Unexpected test request ${url}`);
    return structuredClone(responses[url]) as T;
  });
  vi.mocked(saveDraft).mockImplementation(async (_url, doc) => structuredClone(doc));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('edits labels, script hooks and typed combination rules and saves against the loaded baseline', async () => {
  cleanup = mountItems(new ItemTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe(item.label));
  expect(elements.has('#item-script-name')).toBe(false);
  getElement('item-label').value = 'Golden key';
  getElement('item-label').dispatch('input');
  const examine = getElement('item-examine').children[0].children[0];
  examine.value = 'fail';
  examine.dispatch('input');
  const row = getElement('item-rules').children[0];
  const type = row.children[0];
  type.value = 'prop';
  type.dispatch('change');
  const updated = getElement('item-rules').children[0];
  const target = updated.children[1].children[0].children[0];
  target.value = 'lock';
  target.dispatch('input');
  expect(getElement('item-save').disabled).toBe(false);
  getElement('item-save').dispatch('click');
  await vi.waitFor(() => expect(saveDraft).toHaveBeenCalled());
  expect(vi.mocked(saveDraft).mock.calls[0]).toEqual([
    '/api/items/key',
    expect.objectContaining({
      label: 'Golden key',
      examineScript: 'fail',
      combinations: [{ targetType: 'prop', target: 'lock', script: 'combine' }],
    }),
    item,
  ]);
  await vi.waitFor(() => expect(getElement('item-fields').inert).toBe(false));
  expect(getElement('item-save').disabled).toBe(true);
});

function getPickerElement(name: string): ItemTestElement {
  const element = elements.get(`[data-picker="${name}"]`);
  if (!element) throw new Error(`Missing picker ${name}`);
  return element;
}

function pressSave(metaKey = false): ReturnType<typeof vi.fn> {
  const preventDefault = vi.fn();
  const handler = vi
    .mocked(document.addEventListener)
    .mock.calls.find(([type]) => type === 'keydown')?.[1];
  if (typeof handler !== 'function') throw new Error('Missing save shortcut');
  handler.call(document, {
    key: 's',
    ctrlKey: !metaKey,
    metaKey,
    preventDefault,
  } as unknown as KeyboardEvent);
  return preventDefault;
}

it('keeps independent dirty tabs, saves only the active item with Ctrl/Cmd+S, and cleans up', async () => {
  cleanup = mountItems(new ItemTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe(item.label));
  getElement('item-label').value = 'Unsaved brass key';
  getElement('item-label').dispatch('input');
  const options = vi.mocked(createAssetTree).mock.calls[0][0];
  options.onSelect('coin');
  await vi.waitFor(() => expect(getElement('item-label').value).toBe('Coin'));
  expect(confirmModal).not.toHaveBeenCalled();
  expect(getElement('item-tabs').children).toHaveLength(2);
  getElement('item-label').value = 'Gold coin';
  getElement('item-label').dispatch('input');
  expect(pressSave()).toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(saveDraft).toHaveBeenCalledWith(
      '/api/items/coin',
      expect.objectContaining({ label: 'Gold coin' }),
      expect.objectContaining({ label: 'Coin' }),
    ),
  );
  await vi.waitFor(() => expect(getElement('item-fields').inert).toBe(false));
  options.onSelect('key');
  await vi.waitFor(() => expect(getElement('item-label').value).toBe('Unsaved brass key'));
  expect(pressSave(true)).toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(saveDraft).toHaveBeenCalledWith(
      '/api/items/key',
      expect.objectContaining({ label: 'Unsaved brass key' }),
      item,
    ),
  );
  await vi.waitFor(() => expect(getElement('item-fields').inert).toBe(false));
  cleanup();
  cleanup = undefined;
  expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
});

it('confirms closing dirty tabs and preserves the draft when closing is cancelled', async () => {
  cleanup = mountItems(new ItemTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe(item.label));
  getElement('item-add-rule').dispatch('click');
  vi.mocked(confirmModal).mockResolvedValueOnce(false);
  getElement('item-tabs').children[0].children[1].dispatch('click');
  await vi.waitFor(() => expect(confirmModal).toHaveBeenCalled());
  expect(getElement('item-tabs').children).toHaveLength(1);
  expect(getElement('item-rules').children).toHaveLength(2);
  getElement('item-tabs').children[0].children[1].dispatch('click');
  await vi.waitFor(() => expect(getElement('item-fields').hidden).toBe(true));
});

it('opens the shared frame picker, cancels type changes, and accepts an animation only on OK', async () => {
  cleanup = mountItems(new ItemTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe(item.label));
  getElement('item-choose-visual').dispatch('click');
  await vi.waitFor(() => expect(getPickerElement('results').children).toHaveLength(1));
  expect(getPickerElement('results').children[0].title).toBe('FRAME 1');
  getPickerElement('cancel').dispatch('click');
  expect(getElement('item-save').disabled).toBe(true);
  getElement('item-visual-type').value = 'animation';
  getElement('item-visual-type').dispatch('change');
  await vi.waitFor(() => expect(getPickerElement('title').textContent).toBe('CHOOSE ANIMATION'));
  await vi.waitFor(() => expect(getPickerElement('results').children).toHaveLength(1));
  expect(getElement('item-visual-type').value).toBe('sprite');
  getPickerElement('results').children[0].dispatch('click');
  expect(pressSave()).toHaveBeenCalled();
  expect(saveDraft).not.toHaveBeenCalled();
  getPickerElement('ok').dispatch('click');
  await vi.waitFor(() => expect(getElement('item-visual-type').value).toBe('animation'));
  expect(getElement('item-save').disabled).toBe(false);
  pressSave();
  await vi.waitFor(() =>
    expect(saveDraft).toHaveBeenCalledWith(
      '/api/items/key',
      expect.objectContaining({ visual: { type: 'animation', id: 'clip' } }),
      item,
    ),
  );
});

it('restores open tabs and unsaved drafts from project storage', async () => {
  vi.mocked(projectStorage.getItem).mockImplementation((key: string) =>
    key === OPEN_ITEMS_KEY
      ? JSON.stringify({
          version: 1,
          tabs: ['key', 'coin'],
          active: 'coin',
          drafts: { key: { doc: { ...item, label: 'Restored key' }, base: item, folder: '' } },
        })
      : null,
  );
  vi.stubGlobal('location', { search: '' });
  cleanup = mountItems(new ItemTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe('Coin'));
  expect(getElement('item-tabs').children).toHaveLength(2);
  vi.mocked(createAssetTree).mock.calls[0][0].onSelect('key');
  await vi.waitFor(() => expect(getElement('item-label').value).toBe('Restored key'));
});

it('chooses a nonzero sprite frame in the modal instead of requiring a frame-number input', async () => {
  const request = vi.mocked(requestJson).getMockImplementation();
  if (!request) throw new Error('Missing test API');
  vi.mocked(requestJson).mockImplementation(async <T>(url: string): Promise<T> => {
    if (url !== '/api/sprites/art') return (await request(url)) as T;
    const sprite = createSprite('art', 1, 1);
    sprite.sprites.push(structuredClone(sprite.sprites[0]));
    return sprite as T;
  });
  cleanup = mountItems(new ItemTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe(item.label));
  expect(elements.has('#item-frame')).toBe(false);
  getElement('item-choose-visual').dispatch('click');
  await vi.waitFor(() => expect(getPickerElement('results').children).toHaveLength(2));
  getPickerElement('results').children[1].dispatch('click');
  getPickerElement('ok').dispatch('click');
  await vi.waitFor(() => expect(getElement('item-visual').textContent).toContain('FRAME 2'));
  pressSave();
  await vi.waitFor(() =>
    expect(saveDraft).toHaveBeenCalledWith(
      '/api/items/key',
      expect.objectContaining({ visual: { type: 'sprite', id: 'art', index: 1 } }),
      item,
    ),
  );
});

it('keeps a new item’s destination folder when switching tabs before its first save', async () => {
  cleanup = mountItems(new ItemTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe(item.label));
  vi.mocked(askId).mockResolvedValueOnce('Wrench');
  const tree = vi.mocked(createAssetTree).mock.calls[0][0];
  tree.onCreateAsset?.('Tools');
  await vi.waitFor(() => expect(getElement('item-label').value).toBe('Wrench'));
  const tab = getElement('item-tabs').children.find(
    (entry) => entry.children[0].textContent === 'Wrench',
  );
  if (!tab) throw new Error('Missing new item tab');
  const id = tab.dataset.tabId;
  tree.onSelect('coin');
  await vi.waitFor(() => expect(getElement('item-label').value).toBe('Coin'));
  tree.onSelect(id);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe('Wrench'));
  pressSave();
  await vi.waitFor(() =>
    expect(requestJson).toHaveBeenCalledWith(
      '/api/item-folders',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'move', id, folder: 'Tools' }),
      }),
    ),
  );
});

it('keeps invalid combination drafts editable and preserves edits when a save fails', async () => {
  cleanup = mountItems(new ItemTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('item-label').value).toBe(item.label));
  getElement('item-add-rule').dispatch('click');
  getElement('item-save').dispatch('click');
  await vi.waitFor(() =>
    expect(getElement('item-status').textContent).toContain('Combination needs'),
  );
  expect(saveDraft).not.toHaveBeenCalled();
  expect(getElement('item-fields').inert).toBe(false);
  const last = getElement('item-rules').children[1];
  last.children[3].dispatch('click');
  getElement('item-label').value = 'Unsaved key';
  getElement('item-label').dispatch('input');
  vi.mocked(saveDraft).mockRejectedValueOnce(new Error('Concurrent edit; nothing saved'));
  getElement('item-save').dispatch('click');
  await vi.waitFor(() =>
    expect(getElement('item-status').textContent).toContain('Concurrent edit'),
  );
  expect(getElement('item-label').value).toBe('Unsaved key');
  expect(getElement('item-save').disabled).toBe(false);
});
