import { applyTerminalGlyphStyle, type TerminalCell } from '../terminal-cell.js';

export function fillTerminalCell(
  context: CanvasRenderingContext2D,
  cell: TerminalCell,
  x: number,
  y: number,
): void {
  context.fillRect(x, y, cell.width, cell.height);
}

/** Cover fractional cell edges at device-pixel boundaries so adjacent fills have no seams. */
export function fillTerminalCellWithoutSeams(
  context: CanvasRenderingContext2D,
  cell: TerminalCell,
  x: number,
  y: number,
): void {
  const transform = context.getTransform();
  const scaleX = transform.a;
  const scaleY = transform.d;
  const left = Math.floor(x * scaleX) / scaleX;
  const top = Math.floor(y * scaleY) / scaleY;
  const right = Math.ceil((x + cell.width) * scaleX) / scaleX;
  const bottom = Math.ceil((y + cell.height) * scaleY) / scaleY;
  context.fillRect(left, top, right - left, bottom - top);
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
