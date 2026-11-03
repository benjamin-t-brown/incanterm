import type { SpriteFrame } from '../schema.js';

export function applyBlackWhiteInversionToFrame(frame: SpriteFrame): number {
  let changed = 0;
  for (const layer of frame.layers) {
    for (const cell of layer.cells) {
      if (!cell) continue;
      const bg = cell.bg === 'black'
        ? 'bright-white'
        : cell.bg === 'white' || cell.bg === 'bright-white'
          ? 'black'
          : cell.bg;
      const fg = cell.fg === 'black'
        ? 'bright-white'
        : cell.fg === 'white' || cell.fg === 'bright-white'
          ? 'black'
          : cell.fg;
      if (bg === cell.bg && fg === cell.fg) continue;
      cell.bg = bg;
      cell.fg = fg;
      changed++;
    }
  }
  const bottomVisibleLayer = frame.layers.find((layer) => layer.visible);
  if (bottomVisibleLayer) {
    for (let index = 0; index < bottomVisibleLayer.cells.length; index++) {
      if (frame.layers.some((layer) => layer.visible && layer.cells[index] !== null)) continue;
      bottomVisibleLayer.cells[index] = { ch: ' ', fg: 'black', bg: 'bright-white' };
      changed++;
    }
  }
  return changed;
}
