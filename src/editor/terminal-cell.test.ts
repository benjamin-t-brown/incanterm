import { describe, expect, it } from 'vitest';
import {
  FALLBACK_CELL,
  SPRITE_FONTS,
  TERMINAL_FONT_PX,
  TERMINAL_FONT_STACK,
  measureTerminalCell,
  spriteFontFamily,
  spriteFontNativePx,
  terminalCellAtZoom,
  terminalFont,
  type TextMeasurer,
} from './terminal-cell.js';

function measurer(
  width: number,
  ascent?: number,
  descent?: number,
): TextMeasurer & { font: string } {
  return {
    font: '',
    measureText() {
      return { width, fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent };
    },
  };
}

describe('terminal cell metrics', () => {
  it('uses Consolas-first stack so the canvas matches Notepad and Windows terminals', () => {
    expect(terminalFont(16)).toBe(`16px ${TERMINAL_FONT_STACK}`);
    expect(TERMINAL_FONT_STACK.startsWith('Consolas')).toBe(true);
  });

  it('sizes the cell from the font advance and line box', () => {
    const cell = measureTerminalCell(measurer(8.8, 15, 4), 16);
    expect(cell).toEqual({
      width: 8.8,
      height: 19,
      ascent: 15,
      font: terminalFont(16),
      scale: 1,
    });
  });

  it('falls back to the 10×20 VT / Windows Terminal cell when the font cannot be measured', () => {
    expect(measureTerminalCell(measurer(0, 15, 4), 16)).toMatchObject(FALLBACK_CELL);
    expect(measureTerminalCell(measurer(8.8), 16)).toMatchObject(FALLBACK_CELL);
    const scaled = measureTerminalCell(measurer(Number.NaN, 15, 4), 32);
    expect(scaled.width).toBe(FALLBACK_CELL.width * 2);
    expect(scaled.height).toBe(FALLBACK_CELL.height * 2);
    expect(scaled.ascent).toBe(FALLBACK_CELL.ascent * 2);
  });

  it('keeps native font metrics and scales the glyph with the cell when zooming', () => {
    const cell = terminalCellAtZoom(measurer(10, 16, 4), 2);
    expect(cell.width).toBe(20);
    expect(cell.height).toBe(40);
    expect(cell.ascent).toBe(32);
    expect(cell.font).toBe(terminalFont(TERMINAL_FONT_PX));
    expect(cell.scale).toBe(2);
  });

  it('remasures the cell for the selected spritesheet font', () => {
    const family = spriteFontFamily('courier-new');
    const cell = measureTerminalCell(measurer(9.6, 13, 5), 16, family);
    expect(cell.font).toBe(terminalFont(16, family));
    expect(cell.width).toBe(9.6);
    expect(cell.height).toBe(18);
    expect(terminalCellAtZoom(measurer(9.6, 13, 5), 2, 'courier-new').font).toBe(
      terminalFont(TERMINAL_FONT_PX, family),
    );
  });

  it.each([0.01, 0.1, 0.35, 0.713, 1.25, 8])(
    'keeps glyphs proportional to their cells at %sx for every font, without a minimum text size',
    (zoom) => {
      for (const font of SPRITE_FONTS) {
        const metrics = measurer(8.8, 15, 4);
        const base = terminalCellAtZoom(metrics, 1, font.id);
        const cell = terminalCellAtZoom(metrics, zoom, font.id);
        expect(cell.width / cell.scale).toBeCloseTo(base.width);
        expect(cell.height / cell.scale).toBeCloseTo(base.height);
        expect(cell.ascent / cell.scale).toBeCloseTo(base.ascent);
        expect(cell.font).toBe(terminalFont(spriteFontNativePx(font.id), font.family));
        expect(cell.scale).toBe(zoom);
      }
    },
  );

  it('includes the classic ASCII faces and uses native size for MS-DOS 80x25', () => {
    expect(SPRITE_FONTS.map((font) => font.id)).toEqual([
      'consolas',
      'cascadia-mono',
      'cascadia-code',
      'courier-new',
      'mono',
      'lucida-console',
      'fixedsys',
      'msdos-80x25',
      'terminal',
    ]);
    const dos = terminalCellAtZoom(measurer(8, 16, 0), 1, 'msdos-80x25');
    expect(dos.font).toContain('Incanterm VGA 8x16');
    expect(dos.width).toBe(8);
    expect(dos.height).toBe(16);
  });
});
