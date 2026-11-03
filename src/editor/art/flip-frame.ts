import type { SpriteFrame } from '../schema.js';

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
      return cells[sourceY * width + sourceX];
    });
  }
}
