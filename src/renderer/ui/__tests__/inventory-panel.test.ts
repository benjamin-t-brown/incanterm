import { expect, it } from 'vitest';
import { createItemAsset, createItemScene } from '../../../game/__tests__/item-fixture.js';
import { CellBuffer } from '../../../game/cell-buffer.js';
import { getPlainText } from '../../../game/terminal.js';
import { InventoryPanel } from '../inventory-panel.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../layout-standard-scene.js';

it('renders inventory labels, sprites, selected state and examine actions', () => {
  const panel = new InventoryPanel();
  panel.items = [createItemAsset('key', 'K'), createItemAsset('coin', '$')];
  panel.selectedId = 'key';
  panel.height = 10;
  const buffer = new CellBuffer(120, 20, STANDARD_BACKGROUND);
  panel.render(buffer);
  const text = getPlainText(buffer);
  expect(text).toContain('> KEY');
  expect(text).toContain('COIN');
  expect(text).toContain('[EXAMINE]');
  expect(panel.getActionAt(20, 3)).toEqual({ itemId: 'key', examine: false });
  expect(panel.getActionAt(panel.width - 2, 3)).toEqual({ itemId: 'key', examine: true });
  expect(panel.getActionAt(20, 7)).toEqual({ itemId: 'coin', examine: false });
  expect(panel.getActionAt(20, 0)).toBeUndefined();
});

it('maps inventory clicks through centering, clipping and scrolling', () => {
  const layout = new LayoutStandardScene(createItemScene());
  layout.inventory.items = Array.from({ length: 8 }, (_, index) =>
    createItemAsset(`item-${index}`),
  );
  layout.tabs.select('inventory');
  layout.render(new CellBuffer(80, 30, STANDARD_BACKGROUND));
  const pane = layout.tabs.getContent('inventory');
  pane.scrollY = 6;
  layout.render(new CellBuffer(80, 30, STANDARD_BACKGROUND));
  const actions = [];
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 80; x++) {
      const action = layout.getInventoryActionAt(x, y);
      if (action) actions.push(action);
    }
  expect(actions.some((action) => action.itemId === 'item-1')).toBe(true);
  expect(actions.some((action) => action.itemId === 'item-0')).toBe(false);
  expect(actions.some((action) => action.examine)).toBe(true);
  layout.tabs.select('log');
  expect(layout.getInventoryActionAt(30, 20)).toBeUndefined();
});
