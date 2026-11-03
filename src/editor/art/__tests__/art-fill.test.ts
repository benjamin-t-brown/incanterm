import { describe, expect, it } from 'vitest';
import { fillCells } from '../art-fill.js';
import type { SpriteCell } from '../../schema.js';

const paint = { ch: 'X', fg: 'bright-red', bg: 'bright-blue' };
const getText = (ch: string, fg = 'white', bg = 'black'): SpriteCell => ({ ch, fg, bg });

describe('art fill variants', () => {
  it('changes only foreground color on adjacent identical tiles', () => {
    const cells = [getText('A'), getText('A'), getText('B'), getText('A')];
    expect(fillCells(cells, 4, 1, 0, 0, 'fg-fill', paint)).toBe(true);
    expect(cells).toEqual([getText('A', 'bright-red'), getText('A', 'bright-red'), getText('B'), getText('A')]);
  });

  it('does nothing on transparent or space cells in foreground mode', () => {
    const cells = [null, getText(' '), getText('A')];
    expect(fillCells(cells, 3, 1, 0, 0, 'fg-fill', paint)).toBe(false);
    expect(fillCells(cells, 3, 1, 1, 0, 'fg-fill', paint)).toBe(false);
    expect(cells).toEqual([null, getText(' '), getText('A')]);
  });

  it('changes only background color on adjacent identical tiles', () => {
    const cells = [getText('A'), getText('A'), getText('A', 'green'), getText('A', 'white', 'green')];
    expect(fillCells(cells, 4, 1, 0, 0, 'bg-fill', paint)).toBe(true);
    expect(cells).toEqual([
      getText('A', 'white', 'bright-blue'),
      getText('A', 'white', 'bright-blue'),
      getText('A', 'green'),
      getText('A', 'white', 'green'),
    ]);
  });

  it('does not spread across tiles with a different text or background color', () => {
    const cells = [getText('A'), getText('A', 'green'), getText('A', 'white', 'green')];
    expect(fillCells(cells, 3, 1, 0, 0, 'fg-fill', paint)).toBe(true);
    expect(cells).toEqual([
      getText('A', 'bright-red'),
      getText('A', 'green'),
      getText('A', 'white', 'green'),
    ]);
  });

  it('matches tiles by four-way adjacency, not diagonals', () => {
    const cells = [getText('A'), getText('B'), getText('B'), getText('A')];
    expect(fillCells(cells, 2, 2, 0, 0, 'bg-fill', paint)).toBe(true);
    expect(cells).toEqual([getText('A', 'white', 'bright-blue'), getText('B'), getText('B'), getText('A')]);
  });

  it('paints a background-only region of transparent cells', () => {
    const cells = [null, null, getText('A'), null];
    expect(fillCells(cells, 4, 1, 0, 0, 'bg-fill', paint)).toBe(true);
    expect(cells).toEqual([
      getText(' ', 'white', 'bright-blue'),
      getText(' ', 'white', 'bright-blue'),
      getText('A'),
      null,
    ]);
  });

  it('keeps full fill replacing the complete cell in a connected region', () => {
    const cells = [null, null, getText('A')];
    expect(fillCells(cells, 3, 1, 0, 0, 'fill', paint)).toBe(true);
    expect(cells).toEqual([paint, paint, getText('A')]);
  });

  it('does not change cells when the requested color is already present', () => {
    const cells = [getText('A', 'bright-red'), getText('B', 'bright-red')];
    expect(fillCells(cells, 2, 1, 0, 0, 'fg-fill', paint)).toBe(false);
    expect(cells).toEqual([getText('A', 'bright-red'), getText('B', 'bright-red')]);
  });
});
