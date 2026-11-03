import { getBrushValue } from './art-brush.js';
import type { SpriteCell } from '../schema.js';

export type FillTool = 'fill' | 'fg-fill' | 'bg-fill';

function isSameCell(left: SpriteCell | null, right: SpriteCell | null): boolean {
  if (left === null || right === null) return left === right;
  return left.ch === right.ch && left.fg === right.fg && left.bg === right.bg;
}

export function fillCells(
  cells: (SpriteCell | null)[],
  width: number,
  height: number,
  x: number,
  y: number,
  tool: FillTool,
  source: SpriteCell,
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const original = cells[y * width + x] ?? null;
  if (tool === 'fg-fill' && (!original || original.ch === ' ')) return false;

  const paintTool = tool === 'fg-fill' ? 'fg-brush' : tool === 'bg-fill' ? 'bg-brush' : 'brush';
  if (isSameCell(getBrushValue(paintTool, source, original), original)) return false;

  const visited = new Uint8Array(width * height);
  const stack = [y * width + x];
  while (stack.length) {
    const index = stack.pop();
    if (index === undefined || visited[index]) continue;
    visited[index] = 1;
    const entry = cells[index] ?? null;
    if (!isSameCell(entry, original)) continue;
    cells[index] = getBrushValue(paintTool, source, entry);
    const col = index % width;
    const row = Math.floor(index / width);
    if (col > 0) stack.push(index - 1);
    if (col < width - 1) stack.push(index + 1);
    if (row > 0) stack.push(index - width);
    if (row < height - 1) stack.push(index + width);
  }
  return true;
}
