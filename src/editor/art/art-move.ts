import type { SpriteCell } from '../schema.js';

export type SelectionRect = { x: number; y: number; width: number; height: number };

export function moveSelectedCells(
  original: (SpriteCell | null)[],
  width: number,
  height: number,
  selection: SelectionRect,
  dx: number,
  dy: number,
): { cells: (SpriteCell | null)[]; selection: SelectionRect } {
  const x = Math.max(0, Math.min(width - selection.width, selection.x + dx));
  const y = Math.max(0, Math.min(height - selection.height, selection.y + dy));
  const destination = { ...selection, x, y };
  if (x === selection.x && y === selection.y) return { cells: original, selection: destination };

  const cells = original.slice();
  for (let row = 0; row < selection.height; row++) {
    for (let col = 0; col < selection.width; col++) {
      cells[(selection.y + row) * width + selection.x + col] = null;
    }
  }
  for (let row = 0; row < selection.height; row++) {
    for (let col = 0; col < selection.width; col++) {
      cells[(y + row) * width + x + col] =
        original[(selection.y + row) * width + selection.x + col] ?? null;
    }
  }
  return { cells, selection: destination };
}
