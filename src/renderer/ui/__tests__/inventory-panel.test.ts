import { expect, it } from 'vitest';
import {
  createItemAsset,
  createItemScene,
  ITEM_INK,
} from '../../../game/__tests__/item-fixture.js';
import { CellBuffer } from '../../../game/cell-buffer.js';
import type { ItemAsset } from '../../../game/items.js';
import { Sprite } from '../../../game/sprite.js';
import { getPlainText } from '../../../game/terminal.js';
import { BUTTON_BG, BUTTON_FG } from '../button.js';
import { InventoryPanel } from '../inventory-panel.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../layout-standard-scene.js';

function createCenteredItem(id: string, glyph: string, tail = ' '): ItemAsset {
  const asset = createItemAsset(id);
  const cells = Array.from({ length: 12 }, (_, index) => ({
    ...ITEM_INK,
    ch: index === 4 ? glyph : index === 9 ? tail : ' ',
  }));
  const sprite = new Sprite(`${id}-art`, 4, 3, 0, 0, cells);
  return { ...asset, sprite, clip: { frames: [{ sprite, durationMs: 100 }], loop: true } };
}

it('uses one line per item and lets adjacent sprites overlap without covering the actions', () => {
  const panel = new InventoryPanel();
  panel.items = [createCenteredItem('key', 'K', '*'), createCenteredItem('coin', '$')];
  panel.resize(60, 9);
  const buffer = new CellBuffer(panel.width, panel.height, STANDARD_BACKGROUND);
  panel.render(buffer);
  const rows = getPlainText(buffer).split('\n');
  expect(rows[0]).toMatch(/^ {2}1\. K {4}KEY {2}\[ Examine \] \[ Use \] +$/);
  expect(rows[1]).toMatch(/^ {2}2\. \$\* {3}COIN \[ Examine \] \[ Use \] +$/);
  const examineX = rows[0].indexOf('Examine');
  const useX = rows[0].indexOf('Use');
  expect(buffer.get(examineX, 0)).toMatchObject({ fg: BUTTON_FG, bg: BUTTON_BG });
  expect(buffer.get(useX, 0)).toMatchObject({ fg: BUTTON_FG, bg: BUTTON_BG });
  expect(buffer.get(useX, 1)).toMatchObject({ fg: BUTTON_FG, bg: BUTTON_BG });
  expect(panel.getActionAt(examineX, 0)).toEqual({ itemId: 'key', examine: true });
  expect(panel.getActionAt(useX, 0)).toEqual({ itemId: 'key', examine: false });
  expect(panel.getActionAt(useX, 1)).toEqual({ itemId: 'coin', examine: false });
  expect(panel.getActionAt(useX, 2)).toBeUndefined();
  expect(panel.getActionAt(10, 0)).toBeUndefined();
  expect(panel.getActionAt(10, 0, true)).toEqual({ itemId: 'key', examine: true });
});

it('moves the selection cursor one cell every 500 ms without moving the item number', () => {
  const panel = new InventoryPanel();
  panel.items = [createCenteredItem('key', 'K'), createCenteredItem('coin', '$')];
  panel.resize(60, 9);
  panel.focusItemNumber(1);
  const getRowStartAt = (elapsedMs: number, row = 0) => {
    panel.elapsedMs = elapsedMs;
    const buffer = new CellBuffer(panel.width, panel.height, STANDARD_BACKGROUND);
    panel.render(buffer);
    return getPlainText(buffer).split('\n')[row].slice(0, 4);
  };

  expect(getRowStartAt(137)).toBe('> 1.');
  expect(getRowStartAt(636)).toBe('> 1.');
  expect(getRowStartAt(637)).toBe(' >1.');
  expect(getRowStartAt(1136)).toBe(' >1.');
  expect(getRowStartAt(1137)).toBe('> 1.');

  panel.selectedId = 'key';
  panel.focusItemNumber(2);
  expect(getRowStartAt(1400)).toBe('* 1.');
  expect(getRowStartAt(1400, 1)).toBe('> 2.');
  expect(getRowStartAt(1900, 1)).toBe(' >2.');
  panel.clearItemFocus();
  expect(getRowStartAt(1900)).toBe('> 1.');
  expect(getRowStartAt(2400)).toBe(' >1.');
});

it('replaces the regular actions with Combine and Cancel while an item is selected', () => {
  const panel = new InventoryPanel();
  panel.items = [createCenteredItem('key', 'K'), createCenteredItem('coin', '$')];
  panel.selectedId = 'key';
  panel.resize(60, 9);
  const buffer = new CellBuffer(panel.width, panel.height, STANDARD_BACKGROUND);
  panel.render(buffer);
  const rows = getPlainText(buffer).split('\n');
  expect(rows[0]).toMatch(/^> 1\..*KEY +\[ Cancel \]/);
  expect(rows[1]).toContain('COIN [ Combine With This Item ]');
  expect(getPlainText(buffer)).not.toContain('[ Examine ]');
  expect(getPlainText(buffer)).not.toContain('[ Use ]');

  const cancelX = rows[0].indexOf('Cancel');
  const combineX = rows[1].indexOf('This');
  expect(panel.getActionAt(cancelX, 0)).toEqual({ itemId: 'key', examine: false });
  expect(panel.getActionAt(combineX, 1)).toEqual({ itemId: 'coin', examine: false });
  expect(panel.getActionAt(combineX, 0)).toBeUndefined();
  expect(panel.getActionAt(10, 1, true)).toEqual({ itemId: 'coin', examine: true });
});

it('shortens the Combine action when necessary to keep target labels visible', () => {
  const panel = new InventoryPanel();
  panel.items = [createItemAsset('key'), createItemAsset('coin')];
  panel.selectedId = 'key';
  panel.resize(38, 9);
  const buffer = new CellBuffer(panel.width, panel.height, STANDARD_BACKGROUND);
  panel.render(buffer);
  const row = getPlainText(buffer).split('\n')[1];
  expect(row).toContain('COIN [ Combine ]');
  expect(panel.getActionAt(row.indexOf('Combine'), 1)).toEqual({ itemId: 'coin', examine: false });
});

it('keeps the page text in the top-right border and both buttons visible at minimum width', () => {
  const layout = new LayoutStandardScene(createItemScene());
  const book = createItemAsset('book');
  book.definition.label = 'Book: A Very Long Title That Cannot Fit On One Line';
  layout.inventory.items = [book];
  layout.tabs.select('inventory');
  const buffer = new CellBuffer(40, 24, STANDARD_BACKGROUND);
  layout.render(buffer);
  const rows = getPlainText(buffer).split('\n');
  const borderY = rows.findIndex((row) => row.endsWith(' Page 1/1 ┐'));
  expect(borderY).toBeGreaterThanOrEqual(0);
  expect(rows[borderY + 1]).toContain('Book: … [ Examine ] [ Use ]');
  const useX = rows[borderY + 1].indexOf('Use');
  expect(layout.getInventoryActionAt(useX, borderY + 1)).toEqual({
    itemId: 'book',
    examine: false,
  });
  expect(layout.getInventoryActionAt(useX, borderY, true)).toBeUndefined();
  expect(layout.getInventoryActionAt(useX, borderY + 2)).toBeUndefined();
});

it('keeps item actions in place when an animated item reaches an invisible frame', () => {
  const panel = new InventoryPanel();
  const key = createCenteredItem('key', 'K');
  key.clip.frames.push({ durationMs: 100 });
  panel.items = [key];
  panel.resize(60, 9);
  panel.elapsedMs = 150;
  const buffer = new CellBuffer(panel.width, panel.height, STANDARD_BACKGROUND);
  panel.render(buffer);
  const rows = getPlainText(buffer).split('\n');
  expect(rows[0].slice(5, 9)).toBe('    ');
  expect(rows[0]).toContain('KEY [ Examine ] [ Use ]');
  expect(panel.getActionAt(rows[0].indexOf('Use'), 0)).toEqual({ itemId: 'key', examine: false });
});

it('maps inventory clicks to the visible page after scrolling in a centered viewport', () => {
  const layout = new LayoutStandardScene(createItemScene());
  layout.inventory.items = Array.from({ length: 22 }, (_, index) =>
    createItemAsset(`item-${index}`),
  );
  layout.tabs.select('inventory');
  layout.render(new CellBuffer(80, 30, STANDARD_BACKGROUND));
  expect(layout.scrollInventory(1, true)).toBe(true);
  const buffer = new CellBuffer(80, 30, STANDARD_BACKGROUND);
  layout.render(buffer);
  expect(getPlainText(buffer)).toContain('Page 2/3 ┐');
  const actions = [];
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 80; x++) {
      const action = layout.getInventoryActionAt(x, y);
      if (action) actions.push(action);
    }
  expect([...new Set(actions.map((action) => action.itemId))]).toEqual(
    Array.from({ length: 10 }, (_, index) => `item-${index + 10}`),
  );
  expect(actions).toContainEqual({ itemId: 'item-10', examine: true });
  expect(actions).toContainEqual({ itemId: 'item-10', examine: false });
  layout.tabs.select('log');
  expect(layout.scrollInventory(-1, true)).toBe(false);
  expect(layout.getInventoryActionAt(30, 20)).toBeUndefined();
});

it('sizes pages to fit on short terminals and clamps the page when inventory shrinks', () => {
  const layout = new LayoutStandardScene(createItemScene());
  layout.inventory.items = Array.from({ length: 11 }, (_, index) =>
    createItemAsset(`item-${index}`),
  );
  layout.tabs.select('inventory');
  const renderPage = () => {
    const buffer = new CellBuffer(80, 18, STANDARD_BACKGROUND);
    layout.render(buffer);
    return getPlainText(buffer);
  };
  const first = renderPage();
  expect(first).toContain('Page 1/2 ┐');
  expect(first).toContain('ITEM-8');
  expect(first).not.toContain('ITEM-9');
  layout.scrollInventory(1, true);
  layout.scrollInventory(1, true);
  layout.scrollInventory(1, true);
  const last = renderPage();
  expect(last).toContain('Page 2/2 ┐');
  expect(last).toMatch(/11\. +ITEM-10/);
  layout.inventory.items = layout.inventory.items.slice(0, 1);
  expect(renderPage()).toContain('Page 1/1 ┐');
  layout.inventory.items = [];
  expect(renderPage()).toContain('No items.');
});
