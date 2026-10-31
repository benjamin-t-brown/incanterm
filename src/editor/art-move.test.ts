import { describe, expect, it } from 'vitest';
import { moveSelectedCells } from './art-move.js';
import type { SpriteCell } from './schema.js';

const cell = (ch: string): SpriteCell => ({ ch, fg: 'white', bg: 'black' });

describe('moving an art selection', () => {
  it('moves a rectangle without smearing overlapping source cells', () => {
    const original = [cell('A'), cell('B'), cell('C'), null];
    const result = moveSelectedCells(original, 4, 1, { x: 0, y: 0, width: 2, height: 1 }, 1, 0);
    expect(result.cells).toEqual([null, cell('A'), cell('B'), null]);
    expect(result.selection).toEqual({ x: 1, y: 0, width: 2, height: 1 });
    expect(original).toEqual([cell('A'), cell('B'), cell('C'), null]);
  });

  it('moves transparent cells too, replacing destination cells', () => {
    const original = [cell('A'), null, cell('B'), cell('C')];
    const result = moveSelectedCells(original, 4, 1, { x: 0, y: 0, width: 2, height: 1 }, 2, 0);
    expect(result.cells).toEqual([null, null, cell('A'), null]);
  });

  it('clamps the whole selection to canvas edges', () => {
    const original = [cell('A'), cell('B'), null, null];
    const result = moveSelectedCells(original, 2, 2, { x: 0, y: 0, width: 2, height: 1 }, 10, 10);
    expect(result.cells).toEqual([null, null, cell('A'), cell('B')]);
    expect(result.selection).toEqual({ x: 0, y: 1, width: 2, height: 1 });
  });

  it('does not alter the selection when there is no movement', () => {
    const original = [cell('A')];
    const selection = { x: 0, y: 0, width: 1, height: 1 };
    const result = moveSelectedCells(original, 1, 1, selection, 0, 0);
    expect(result.cells).toBe(original);
    expect(result.selection).toEqual(selection);
  });
});
