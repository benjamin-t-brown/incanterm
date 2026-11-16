import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSprite } from '../../../schema.js';
import { createTestElement, TestElement } from '../../__tests__/dom-fixture.js';
import { createSceneEntityPicker, type EntityPickerSelection } from '../entity-picker.js';

vi.mock('../../project.js', () => ({
  projectStorage: { getItem: () => null, setItem: vi.fn() },
}));

beforeEach(() => vi.stubGlobal('document', { createElement: createTestElement }));
afterEach(() => vi.unstubAllGlobals());

function createPicker() {
  const dialog = new TestElement('dialog');
  const search = new TestElement('input');
  const list = new TestElement();
  const preview = new TestElement();
  const status = new TestElement();
  const addButton = new TestElement('button');
  const loadInventory = vi.fn(async () => ({
    files: ['first', 'second'],
    labels: { first: 'First prop', second: 'Second prop' },
    folders: { folders: [], placements: {} },
  }));
  const loadSelection = vi.fn(
    async (id: string): Promise<EntityPickerSelection<string>> => ({
      asset: id,
      name: `${id} prop`,
      description: '2 × 1 cells',
      preview: { sprite: createSprite('sprite', 2, 1), index: 0 },
    }),
  );
  const drawPreview = vi.fn();
  const picker = createSceneEntityPicker({
    dialog: dialog as unknown as HTMLDialogElement,
    search: search as unknown as HTMLInputElement,
    list: list as unknown as HTMLElement,
    preview: preview as unknown as HTMLElement,
    status: status as unknown as HTMLElement,
    addButton: addButton as unknown as HTMLButtonElement,
    label: 'PROPS',
    storageKey: 'picker-test',
    loadInventory,
    loadSelection,
    drawPreview,
  });
  function selectAsset(id: string): void {
    const row = list.querySelectorAll('.asset-tree-file').find((row) => row.dataset.id === id);
    if (!row) throw new Error(`Missing test asset ${id}`);
    row.dispatch('click');
  }
  return {
    picker,
    dialog,
    search,
    list,
    preview,
    status,
    addButton,
    loadInventory,
    loadSelection,
    drawPreview,
    selectAsset,
  };
}

it('lists searchable files separately and loads a large preview only for the selected asset', async () => {
  const view = createPicker();
  await view.picker.open();
  expect(view.dialog.open).toBe(true);
  expect(view.addButton.disabled).toBe(true);
  expect(view.loadSelection).not.toHaveBeenCalled();
  expect(view.list.querySelectorAll('.asset-tree-file')).toHaveLength(2);
  view.search.value = 'second prop';
  view.search.dispatch('input');
  expect(view.list.querySelectorAll('.asset-tree-file').map((row) => row.dataset.id)).toEqual([
    'second',
  ]);
  view.selectAsset('second');
  expect(view.addButton.disabled).toBe(true);
  await vi.waitFor(() => expect(view.picker.getSelection()).toBe('second'));
  expect(view.preview.children.map((child) => child.tagName)).toEqual(['h3', 'canvas', 'p']);
  expect(view.preview.children[1]).toMatchObject({ width: 400, height: 280 });
  expect(view.drawPreview).toHaveBeenCalledOnce();
  expect(view.addButton.disabled).toBe(false);
  expect(view.loadSelection).toHaveBeenCalledExactlyOnceWith('second');
});

it('does not let a slow preview replace a more recently selected asset', async () => {
  const view = createPicker();
  let finishFirst = (_selection: EntityPickerSelection<string>) => {};
  view.loadSelection.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  );
  await view.picker.open();
  view.selectAsset('first');
  view.selectAsset('second');
  await vi.waitFor(() => expect(view.picker.getSelection()).toBe('second'));
  finishFirst({ asset: 'first', name: 'Old preview', description: 'Outdated' });
  await Promise.resolve();
  expect(view.picker.getSelection()).toBe('second');
  expect(view.preview.children[0].textContent).toBe('second prop');
});

it('clears selection on close and ignores previews that finish after reopening', async () => {
  const view = createPicker();
  let finishFirst = (_selection: EntityPickerSelection<string>) => {};
  view.loadSelection.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  );
  await view.picker.open();
  view.selectAsset('first');
  view.dialog.close();
  await view.picker.open();
  finishFirst({ asset: 'first', name: 'Old preview', description: 'Outdated' });
  await Promise.resolve();
  expect(view.picker.getSelection()).toBeNull();
  expect(view.addButton.disabled).toBe(true);
  expect(view.preview.children[0].textContent).toContain('Select an asset');
});

it('keeps Add disabled on loading failures and can recover with another selection', async () => {
  const view = createPicker();
  view.loadSelection.mockRejectedValueOnce(new Error('Prop unavailable'));
  await view.picker.open();
  view.selectAsset('first');
  await vi.waitFor(() => expect(view.preview.children[0].textContent).toBe('Prop unavailable'));
  expect(view.addButton.disabled).toBe(true);
  expect(view.picker.getSelection()).toBeNull();
  view.selectAsset('second');
  await vi.waitFor(() => expect(view.addButton.disabled).toBe(false));
});

it('allows valid characters without a visible idle frame to be added with a preview explanation', async () => {
  const view = createPicker();
  view.loadSelection.mockResolvedValueOnce({
    asset: 'first',
    name: 'First character',
    description: 'No idle-down preview',
  });
  await view.picker.open();
  view.selectAsset('first');
  await vi.waitFor(() => expect(view.addButton.disabled).toBe(false));
  expect(view.preview.children.map((child) => child.tagName)).toEqual(['h3', 'p']);
  expect(view.preview.children[1].textContent).toBe('No idle-down preview');
});

it('shows inventory errors and ignores pending work after disposal', async () => {
  const view = createPicker();
  view.loadInventory.mockRejectedValueOnce(new Error('Could not read project'));
  await view.picker.open();
  expect(view.status.textContent).toBe('Could not read project');
  expect(view.addButton.disabled).toBe(true);
  await view.picker.open();
  view.selectAsset('first');
  view.picker.cleanup();
  await Promise.resolve();
  expect(view.dialog.open).toBe(false);
  expect(view.picker.getSelection()).toBeNull();
  expect(view.addButton.disabled).toBe(true);
});
