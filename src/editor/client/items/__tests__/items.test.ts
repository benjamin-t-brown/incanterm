import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createItem, type ItemDocument } from '../../../items/item-schema.js';
import { createSprite } from '../../../schema.js';
import { TestElement } from '../../__tests__/dom-fixture.js';
import { requestJson } from '../../api.js';
import { saveDraft } from '../../save.js';
import { mountItems } from '../items.js';

vi.mock('../../project.js', () => ({
  projectStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
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
  createAssetTree: () => ({ select: vi.fn(), setData: vi.fn(), createFolder: vi.fn() }),
}));
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
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const element = new ItemTestElement(match[1]);
      element.id = match[2];
      elements.set(`#${element.id}`, element);
    }
  }
  querySelector(selector: string): ItemTestElement | null {
    return elements.get(selector) ?? null;
  }
  getContext() {
    return { clearRect: vi.fn() };
  }
}

function getElement(id: string): ItemTestElement {
  const element = elements.get(`#${id}`);
  if (!element) throw new Error(`Missing ${id}`);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  elements = new Map();
  vi.stubGlobal('document', { createElement: (tag: string) => new ItemTestElement(tag) });
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
      '/api/item-folders': { folders: [], placements: {} },
      '/api/sprites': { files: ['art'], labels: {} },
      '/api/sprites/art': createSprite('art', 1, 1),
      '/api/animations': { files: ['clip'], labels: {} },
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
  expect(getElement('item-script-name').value).toBe('OfficeKey');
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
