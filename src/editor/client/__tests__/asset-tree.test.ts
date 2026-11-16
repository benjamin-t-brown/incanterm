import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAssetTree } from '../asset-tree.js';
import { createTestElement, TestElement } from './dom-fixture.js';

vi.mock('../project.js', () => ({
  projectStorage: { getItem: () => null, setItem: vi.fn() },
}));

beforeEach(() => vi.stubGlobal('document', { createElement: createTestElement }));
afterEach(() => vi.unstubAllGlobals());

function createBrowser(readOnly: boolean) {
  const list = new TestElement();
  const search = new TestElement('input');
  const onSelect = vi.fn();
  const common = {
    list: list as unknown as HTMLElement,
    search: search as unknown as HTMLInputElement,
    label: 'PROPS',
    storageKey: 'test-folders',
    onSelect,
  };
  const tree = createAssetTree(
    readOnly
      ? { ...common, readOnly: true }
      : {
          ...common,
          onChange: vi.fn(),
          askName: vi.fn(),
          confirmDelete: vi.fn(),
          onError: vi.fn(),
        },
  );
  tree.setData(
    ['chair-id', 'lamp-id'],
    {
      folders: ['Furniture'],
      placements: { 'chair-id': 'Furniture' },
    },
    { 'chair-id': 'Reading Chair', 'lamp-id': 'Desk Lamp' },
  );
  return { tree, list, search, onSelect };
}

it('browses folders, searches labels, IDs and folder names, and selects read-only assets', () => {
  const { tree, list, search, onSelect } = createBrowser(true);
  expect(list.querySelectorAll('.asset-tree-file').map((row) => row.dataset.id)).toEqual([
    'lamp-id',
  ]);
  tree.expand('Furniture');
  expect(list.querySelectorAll('.asset-tree-file').map((row) => row.dataset.id)).toEqual([
    'chair-id',
    'lamp-id',
  ]);
  for (const query of ['reading chair', 'chair-id', 'furniture']) {
    search.value = query;
    search.dispatch('input');
    const rows = list.querySelectorAll('.asset-tree-file');
    expect(rows.map((row) => row.dataset.id)).toEqual(['chair-id']);
    rows[0].dispatch('click');
    expect(onSelect).toHaveBeenLastCalledWith('chair-id');
  }
  tree.select('chair-id');
  expect(list.querySelectorAll('.asset-tree-file')[0].attributes.get('aria-current')).toBe('true');
});

it('does not expose editing actions, F2 renaming, or drag-and-drop in a picker', async () => {
  const { tree, list } = createBrowser(true);
  tree.expand('Furniture');
  expect(list.querySelectorAll('.asset-tree-file').every((row) => !row.draggable)).toBe(true);
  const folder = list.querySelectorAll('.asset-tree-folder')[0];
  expect(folder.title).toBe('Furniture');
  const actions = list.querySelectorAll('.asset-tree-actions')[0];
  expect(actions.children).toHaveLength(0);
  expect(list.querySelectorAll('.asset-tree-folder-row')[0].listeners.has('drop')).toBe(false);
  await expect(tree.createFolder()).resolves.toBeUndefined();
});

it('keeps folder editing and dragging available in the normal asset library', () => {
  const { tree, list } = createBrowser(false);
  tree.expand('Furniture');
  expect(list.querySelectorAll('.asset-tree-file').every((row) => row.draggable)).toBe(true);
  expect(list.querySelectorAll('.asset-tree-actions')[0].children).toHaveLength(2);
  expect(list.querySelectorAll('.asset-tree-folder-row')[0].listeners.has('drop')).toBe(true);
});
