import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAssetTree } from '../asset-tree.js';
import type { AssetFolders } from '../../asset-folders.js';
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
  const onChange = vi
    .fn()
    .mockResolvedValue({ folders: ['Furniture'], placements: { 'chair-id': 'Furniture' } });
  const onError = vi.fn();
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
          onChange,
          askName: vi.fn(),
          confirmDelete: vi.fn(),
          onError,
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
  return { tree, list, search, onSelect, onChange, onError };
}

function createDragTransfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    types: [...data.keys()],
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    getData: (type: string) => data.get(type) ?? '',
    setData(type: string, value: string) {
      data.set(type, value);
      this.types = [...data.keys()];
    },
  };
}

function dispatchDragEvent(
  row: TestElement,
  type: string,
  dataTransfer: ReturnType<typeof createDragTransfer>,
) {
  const event = {
    target: row,
    dataTransfer,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  for (const listener of row.listeners.get(type) ?? []) listener(event);
  return event;
}

function getFolderRow(list: TestElement, folder: string): TestElement {
  const row = list
    .querySelectorAll('.asset-tree-folder-row')
    .find((item) => item.dataset.folder === folder);
  if (!row) throw new Error(`Missing folder ${folder}`);
  return row;
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
  expect(folder.draggable).toBe(false);
  const actions = list.querySelectorAll('.asset-tree-actions')[0];
  expect(actions.children).toHaveLength(0);
  expect(list.querySelectorAll('.asset-tree-folder-row')[0].listeners.has('drop')).toBe(false);
  expect(list.querySelectorAll('.asset-tree-root-hint')).toHaveLength(0);
  expect(list.listeners.has('drop')).toBe(false);
  await expect(tree.createFolder()).resolves.toBeUndefined();
});

it('keeps folder editing and dragging available in the normal asset library', () => {
  const { tree, list } = createBrowser(false);
  tree.expand('Furniture');
  expect(list.querySelectorAll('.asset-tree-file').every((row) => row.draggable)).toBe(true);
  expect(list.querySelectorAll('.asset-tree-folder').every((row) => row.draggable)).toBe(true);
  expect(list.querySelectorAll('.asset-tree-actions')[0].children).toHaveLength(2);
  expect(list.querySelectorAll('.asset-tree-folder-row')[0].listeners.has('drop')).toBe(true);
});

it('drags folders into other folders, preserving expanded descendants and revealing the destination', async () => {
  const { tree, list, onChange, onError } = createBrowser(false);
  const folders: AssetFolders = {
    folders: ['source', 'source/child', 'target', 'target/nested'],
    placements: { 'chair-id': 'source/child' },
  };
  tree.setData(['chair-id'], folders);
  tree.expand('source/child');
  onChange.mockResolvedValue({
    folders: ['target/nested/source', 'target/nested/source/child', 'target', 'target/nested'],
    placements: { 'chair-id': 'target/nested/source/child' },
  });
  const transfer = createDragTransfer();
  dispatchDragEvent(
    getFolderRow(list, 'source').querySelectorAll('.asset-tree-folder')[0],
    'dragstart',
    transfer,
  );
  expect(transfer.getData('application/x-incanterm-folder')).toBe('source');
  expect(transfer.effectAllowed).toBe('move');
  tree.expand('target');
  const target = getFolderRow(list, 'target/nested');
  // Browsers hide the payload during dragover; acceptance must not depend on getData.
  const over = dispatchDragEvent(target, 'dragover', { ...transfer, getData: () => '' });
  expect(over.preventDefault).toHaveBeenCalled();
  expect(target.className).toContain('drop-target');
  dispatchDragEvent(target, 'drop', transfer);
  expect(onChange).toHaveBeenCalledWith({
    action: 'move-folder',
    folder: 'source',
    parent: 'target/nested',
  });
  await vi.waitFor(() => expect(getFolderRow(list, 'target/nested/source/child')).toBeDefined());
  expect(list.querySelectorAll('.asset-tree-file').map((row) => row.dataset.id)).toEqual([
    'chair-id',
  ]);
  expect(onError).not.toHaveBeenCalled();
});

it.each(['heading', 'empty space'])(
  'allows moving a folder back to the root via %s',
  async (target) => {
    const { tree, list, onChange } = createBrowser(false);
    tree.setData([], { folders: ['parent', 'parent/child'], placements: {} });
    tree.expand('parent');
    onChange.mockResolvedValue({ folders: ['parent', 'child'], placements: {} });
    const transfer = createDragTransfer();
    dispatchDragEvent(
      getFolderRow(list, 'parent/child').querySelectorAll('.asset-tree-folder')[0],
      'dragstart',
      transfer,
    );
    dispatchDragEvent(
      target === 'heading' ? list.querySelectorAll('.asset-tree-root')[0] : list,
      'drop',
      transfer,
    );
    expect(onChange).toHaveBeenCalledWith({
      action: 'move-folder',
      folder: 'parent/child',
      parent: '',
    });
    await vi.waitFor(() => expect(getFolderRow(list, 'child')).toBeDefined());
  },
);

it.each(['heading', 'empty space'])('moves an asset out of a folder via %s', async (target) => {
  const { tree, list, onChange } = createBrowser(false);
  tree.expand('Furniture');
  const root = list.querySelectorAll('.asset-tree-root')[0];
  expect(root.className).not.toContain('asset-tree-root-drop-zone');
  const hint = root.querySelectorAll('.asset-tree-root-hint')[0];
  expect(hint.textContent).toBe('↑ Drop here for top level');
  expect(hint.hidden).toBe(true);
  onChange.mockResolvedValue({ folders: ['Furniture'], placements: {} });
  const source = list
    .querySelectorAll('.asset-tree-file')
    .find((row) => row.dataset.id === 'chair-id');
  if (!source) throw new Error('Missing nested asset');
  const transfer = createDragTransfer();
  dispatchDragEvent(source, 'dragstart', transfer);
  expect(root.className).toContain('asset-tree-root-drop-zone');
  expect(hint.hidden).toBe(false);
  const destination = target === 'heading' ? root : list;
  expect(dispatchDragEvent(destination, 'dragover', transfer).preventDefault).toHaveBeenCalled();
  expect(destination.className).toContain('drop-target');
  dispatchDragEvent(destination, 'drop', transfer);
  expect(hint.hidden).toBe(true);
  expect(root.className).not.toContain('asset-tree-root-drop-zone');
  expect(onChange).toHaveBeenCalledWith({ action: 'move', id: 'chair-id', folder: '' });
  await vi.waitFor(() =>
    expect(
      list
        .querySelectorAll('.asset-tree-root-contents')[0]
        .children.some((row) => row.dataset.id === 'chair-id'),
    ).toBe(true),
  );
  expect(list.className).not.toContain('drop-target');
});

it('only shows the top-level drop area while dragging a folder and hides it after cancellation', () => {
  const { tree, list } = createBrowser(false);
  const transfer = createDragTransfer();
  const root = list.querySelectorAll('.asset-tree-root')[0];
  const hint = list.querySelectorAll('.asset-tree-root-hint')[0];
  expect(hint.hidden).toBe(true);
  dispatchDragEvent(
    getFolderRow(list, 'Furniture').querySelectorAll('.asset-tree-folder')[0],
    'dragstart',
    transfer,
  );
  expect(hint.hidden).toBe(false);
  expect(root.className).toContain('asset-tree-root-drop-zone');
  tree.expand('Furniture');
  expect(list.querySelectorAll('.asset-tree-root-hint')[0].hidden).toBe(false);
  list.dispatch('dragend');
  expect(list.querySelectorAll('.asset-tree-root-hint')[0].hidden).toBe(true);
  expect(list.querySelectorAll('.asset-tree-root')[0].className).not.toContain(
    'asset-tree-root-drop-zone',
  );
});

it('does not show the top-level drop area for unrelated drags', () => {
  const { list } = createBrowser(false);
  const transfer = createDragTransfer({ 'application/x-incanterm-tab': 'test' });
  dispatchDragEvent(list, 'dragover', transfer);
  expect(list.querySelectorAll('.asset-tree-root-hint')[0].hidden).toBe(true);
});

it('clears the empty-space drop indicator when entering a folder or cancelling a drag', () => {
  const { list } = createBrowser(false);
  const transfer = createDragTransfer();
  dispatchDragEvent(list.querySelectorAll('.asset-tree-file')[0], 'dragstart', transfer);
  dispatchDragEvent(list, 'dragover', transfer);
  expect(list.className).toContain('drop-target');
  dispatchDragEvent(getFolderRow(list, 'Furniture'), 'dragover', transfer);
  expect(list.className).not.toContain('drop-target');
  dispatchDragEvent(list, 'dragover', transfer);
  list.dispatch('dragend');
  expect(list.className).not.toContain('drop-target');
  expect(getFolderRow(list, 'Furniture').className).not.toContain('drop-target');
});

it.each(['source', 'source/child', ''])(
  'rejects invalid folder drops onto %s without bubbling to a parent',
  (parent) => {
    const { tree, list, onChange } = createBrowser(false);
    tree.setData([], { folders: ['source', 'source/child'], placements: {} });
    tree.expand('source');
    const transfer = createDragTransfer();
    dispatchDragEvent(
      getFolderRow(list, 'source').querySelectorAll('.asset-tree-folder')[0],
      'dragstart',
      transfer,
    );
    const target = parent
      ? getFolderRow(list, parent)
      : list.querySelectorAll('.asset-tree-root')[0];
    const over = dispatchDragEvent(target, 'dragover', transfer);
    expect(over.preventDefault).not.toHaveBeenCalled();
    expect(over.stopPropagation).toHaveBeenCalled();
    expect(transfer.dropEffect).toBe('none');
    const drop = dispatchDragEvent(target, 'drop', transfer);
    expect(drop.stopPropagation).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  },
);

it('ignores folder drags originating outside this tree and clears cancelled drags', () => {
  const { tree, list, onChange } = createBrowser(false);
  tree.setData([], { folders: ['source', 'target'], placements: {} });
  const transfer = createDragTransfer({ 'application/x-incanterm-folder': 'source' });
  const target = getFolderRow(list, 'target');
  expect(dispatchDragEvent(target, 'dragover', transfer).preventDefault).not.toHaveBeenCalled();
  dispatchDragEvent(target, 'drop', transfer);
  dispatchDragEvent(
    getFolderRow(list, 'source').querySelectorAll('.asset-tree-folder')[0],
    'dragstart',
    transfer,
  );
  list.dispatch('dragend');
  expect(dispatchDragEvent(target, 'dragover', transfer).preventDefault).not.toHaveBeenCalled();
  dispatchDragEvent(target, 'drop', transfer);
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps asset dragging working', async () => {
  const { list, onChange } = createBrowser(false);
  const transfer = createDragTransfer();
  const asset = list.querySelectorAll('.asset-tree-file')[0];
  dispatchDragEvent(asset, 'dragstart', transfer);
  const target = getFolderRow(list, 'Furniture');
  expect(dispatchDragEvent(target, 'dragover', transfer).preventDefault).toHaveBeenCalled();
  dispatchDragEvent(target, 'drop', transfer);
  expect(onChange).toHaveBeenCalledWith({ action: 'move', id: 'lamp-id', folder: 'Furniture' });
  await vi.waitFor(() => expect(target.className).not.toContain('drop-target'));
});

it('leaves the folder tree unchanged when a move fails', async () => {
  const { tree, list, onChange, onError } = createBrowser(false);
  tree.setData([], { folders: ['source', 'target', 'target/source'], placements: {} });
  onChange.mockRejectedValue(new Error('Folder already exists'));
  const transfer = createDragTransfer();
  dispatchDragEvent(
    getFolderRow(list, 'source').querySelectorAll('.asset-tree-folder')[0],
    'dragstart',
    transfer,
  );
  dispatchDragEvent(getFolderRow(list, 'target'), 'drop', transfer);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Folder already exists'));
  expect(getFolderRow(list, 'source')).toBeDefined();
});
