import { describe, expect, it } from 'vitest';
import { fillCells } from './art-fill.js';
import type { SpriteCell } from './schema.js';

const paint = { ch: 'X', fg: 'bright-red', bg: 'bright-blue' };
const text = (ch: string, fg = 'white', bg = 'black'): SpriteCell => ({ ch, fg, bg });

describe('art fill variants', () => {
  it('changes only foreground color on adjacent identical tiles', () => {
    const cells = [text('A'), text('A'), text('B'), text('A')];
    expect(fillCells(cells, 4, 1, 0, 0, 'fg-fill', paint)).toBe(true);
    expect(cells).toEqual([text('A', 'bright-red'), text('A', 'bright-red'), text('B'), text('A')]);
  });

  it('does nothing on transparent or space cells in foreground mode', () => {
    const cells = [null, text(' '), text('A')];
    expect(fillCells(cells, 3, 1, 0, 0, 'fg-fill', paint)).toBe(false);
    expect(fillCells(cells, 3, 1, 1, 0, 'fg-fill', paint)).toBe(false);
    expect(cells).toEqual([null, text(' '), text('A')]);
  });

  it('changes only background color on adjacent identical tiles', () => {
    const cells = [text('A'), text('A'), text('A', 'green'), text('A', 'white', 'green')];
    expect(fillCells(cells, 4, 1, 0, 0, 'bg-fill', paint)).toBe(true);
    expect(cells).toEqual([
      text('A', 'white', 'bright-blue'),
      text('A', 'white', 'bright-blue'),
      text('A', 'green'),
      text('A', 'white', 'green'),
    ]);
  });

  it('does not spread across tiles with a different text or background color', () => {
    const cells = [text('A'), text('A', 'green'), text('A', 'white', 'green')];
    expect(fillCells(cells, 3, 1, 0, 0, 'fg-fill', paint)).toBe(true);
    expect(cells).toEqual([
      text('A', 'bright-red'),
      text('A', 'green'),
      text('A', 'white', 'green'),
    ]);
  });

  it('matches tiles by four-way adjacency, not diagonals', () => {
    const cells = [text('A'), text('B'), text('B'), text('A')];
    expect(fillCells(cells, 2, 2, 0, 0, 'bg-fill', paint)).toBe(true);
    expect(cells).toEqual([text('A', 'white', 'bright-blue'), text('B'), text('B'), text('A')]);
  });

  it('paints a background-only region of transparent cells', () => {
    const cells = [null, null, text('A'), null];
    expect(fillCells(cells, 4, 1, 0, 0, 'bg-fill', paint)).toBe(true);
    expect(cells).toEqual([
      text(' ', 'white', 'bright-blue'),
      text(' ', 'white', 'bright-blue'),
      text('A'),
      null,
    ]);
  });

  it('keeps full fill replacing the complete cell in a connected region', () => {
    const cells = [null, null, text('A')];
    expect(fillCells(cells, 3, 1, 0, 0, 'fill', paint)).toBe(true);
    expect(cells).toEqual([paint, paint, text('A')]);
  });

  it('does not change cells when the requested color is already present', () => {
    const cells = [text('A', 'bright-red'), text('B', 'bright-red')];
    expect(fillCells(cells, 2, 1, 0, 0, 'fg-fill', paint)).toBe(false);
    expect(cells).toEqual([text('A', 'bright-red'), text('B', 'bright-red')]);
  });
});
