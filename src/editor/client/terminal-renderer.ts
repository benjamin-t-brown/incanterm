import { applyTerminalGlyphStyle, type TerminalCell } from '../terminal-cell.js';

export function fillTerminalCell(
  context: CanvasRenderingContext2D,
  cell: TerminalCell,
  x: number,
  y: number,
): void {
  context.fillRect(x, y, cell.width, cell.height);
}

/** Render smooth glyphs at the exact cell scale, preserving pan, DPR, and preview opacity. */
export function drawTerminalGlyph(
  context: CanvasRenderingContext2D,
  cell: TerminalCell,
  glyph: string,
  x: number,
  y: number,
): void {
  context.save();
  context.translate(x, y);
  context.scale(cell.scale, cell.scale);
  applyTerminalGlyphStyle(context, cell);
  // Keep fallback fonts and overhanging glyphs inside their cells at every zoom.
  context.beginPath();
  context.rect(0, 0, cell.width / cell.scale, cell.height / cell.scale);
  context.clip();
  context.fillText(glyph, 0, cell.ascent / cell.scale);
  context.restore();
}
