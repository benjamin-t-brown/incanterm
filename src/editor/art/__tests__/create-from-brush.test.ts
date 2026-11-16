import { describe, expect, it } from 'vitest';
import { createSpriteFromBrush, type BrushStamp } from '../art-brush.js';
import { parseSprite } from '../../schema.js';
import { DEFAULT_SPRITE_FONT } from '../../terminal-cell.js';

describe('create sprite from brush', () => {
  it('copies the exact rectangular brush, including colors and transparent cells', () => {
    const brush: BrushStamp = {
      width: 3,
      height: 2,
      cells: [
        { ch: 'A', fg: 'bright-red', bg: 'black' },
        null,
        { ch: '█', fg: '#123456', bg: '#abcdef' },
        null,
        { ch: ' ', fg: 'white', bg: 'blue' },
        { ch: 'B', fg: 'green', bg: 'yellow' },
      ],
    };
    const font = 'cascadia-mono';
    const sprite = createSpriteFromBrush('brush-copy', 'Brush copy', brush, font);

    expect(sprite).toMatchObject({
      id: 'brush-copy',
      label: 'Brush copy',
      width: 3,
      height: 2,
      originX: 0,
      originY: 0,
      font,
    });
    expect(sprite.sprites).toHaveLength(1);
    expect(sprite.sprites[0].layers).toHaveLength(1);
    expect(sprite.sprites[0].layers[0].cells).toEqual(brush.cells);
    expect(parseSprite(sprite)).toEqual({ ok: true, value: sprite });
  });

  it('keeps sprite edits independent from the sampled brush', () => {
    const brush: BrushStamp = {
      width: 1,
      height: 1,
      cells: [{ ch: 'X', fg: 'red', bg: 'black' }],
    };
    const sprite = createSpriteFromBrush('single-cell', 'Single cell', brush);
    const cells = sprite.sprites[0].layers[0].cells;

    expect(sprite.font).toBe(DEFAULT_SPRITE_FONT);
    expect(cells).not.toBe(brush.cells);
    expect(cells[0]).not.toBe(brush.cells[0]);
    const cell = cells[0];
    if (!cell) throw new Error('Expected a copied brush cell');
    cell.ch = 'Y';
    cells.push(null);
    expect(brush.cells).toEqual([{ ch: 'X', fg: 'red', bg: 'black' }]);
  });

  it('preserves a completely transparent brush without adding blank opaque cells', () => {
    const sprite = createSpriteFromBrush('transparent', 'Transparent', {
      width: 2,
      height: 2,
      cells: [null, null, null, null],
    });

    expect(sprite.sprites[0].layers[0].cells).toEqual([null, null, null, null]);
  });
});
