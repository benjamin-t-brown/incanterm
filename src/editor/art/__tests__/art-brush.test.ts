import { describe, expect, it } from 'vitest';
import { getBrushValue } from '../art-brush.js';

const source = { ch: 'X', fg: 'bright-red', bg: 'bright-blue' };
const target = { ch: 'A', fg: 'white', bg: 'green' };

describe('art brush variants', () => {
  it('recolors text without replacing its glyph or background', () => {
    expect(getBrushValue('fg-brush', source, target)).toEqual({
      ch: 'A',
      fg: 'bright-red',
      bg: 'green',
    });
  });

  it('recolors the background without replacing the glyph or text color', () => {
    expect(getBrushValue('bg-brush', source, target)).toEqual({
      ch: 'A',
      fg: 'white',
      bg: 'bright-blue',
    });
  });

  it('does not paint foreground color on transparent or space cells', () => {
    expect(getBrushValue('fg-brush', source, null)).toBeNull();
    expect(getBrushValue('fg-brush', source, { ch: ' ', fg: 'white', bg: 'green' })).toEqual({
      ch: ' ',
      fg: 'white',
      bg: 'green',
    });
  });

  it('paints only background color on a transparent cell', () => {
    expect(getBrushValue('bg-brush', source, null)).toEqual({
      ch: ' ',
      fg: 'white',
      bg: 'bright-blue',
    });
  });

  it('retains the normal full brush and partial eraser behavior', () => {
    expect(getBrushValue('brush', source, target)).toEqual(source);
    expect(getBrushValue('brush', source, null)).toEqual(source);
    expect(getBrushValue('fg-erase', source, null)).toBeNull();
    expect(getBrushValue('bg-erase', source, target)).toEqual({ ...target, bg: 'black' });
  });
});
