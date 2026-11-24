import type { SpriteFrame } from '../schema.js';

// Each entry is one reversible pair. Include directional glyphs from the art palette.
const horizontalMirrors = new Map<string, string>();
for (const [left, right] of [
  '/\\', 'pq', 'bd', '()', '[]', '{}', '<>', "`'",
  '╱╲', '┌┐', '└┘', '├┤', '╭╮', '╰╯', '┏┓', '┗┛', '┣┫', '╔╗', '╚╝', '╠╣',
  '←→', '◄►', '▌▐',
]) {
  horizontalMirrors.set(left, right);
  horizontalMirrors.set(right, left);
}

export function applyFrameFlip(
  frame: SpriteFrame,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical',
): void {
  for (const layer of frame.layers) {
    const cells = layer.cells.slice();
    layer.cells = cells.map((_, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      const sourceX = axis === 'horizontal' ? width - 1 - x : x;
      const sourceY = axis === 'vertical' ? height - 1 - y : y;
      const cell = cells[sourceY * width + sourceX];
      const mirrored = cell && axis === 'horizontal' ? horizontalMirrors.get(cell.ch) : undefined;
      return cell && mirrored ? { ...cell, ch: mirrored } : cell;
    });
  }
}
