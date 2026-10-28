import { CellBuffer, type Cell } from './cell-buffer.js';

export class Sprite {
  private readonly cells: Cell[];

  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
    readonly originX: number,
    readonly originY: number,
    cells: readonly Cell[],
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error(`Sprite ${id} size must be at least 1 by 1`);
    }
    if (cells.length !== width * height) {
      throw new Error(`Sprite ${id} has ${cells.length} cells, expected ${width * height}`);
    }
    if (
      !Number.isInteger(originX) ||
      !Number.isInteger(originY) ||
      originX < 0 ||
      originY < 0 ||
      originX >= width ||
      originY >= height
    ) {
      throw new Error(`Sprite ${id} origin is outside the sprite`);
    }
    this.cells = cells.map((cell) => ({
      ch: cell.ch,
      fg: { r: cell.fg.r, g: cell.fg.g, b: cell.fg.b },
      bg: { r: cell.bg.r, g: cell.bg.g, b: cell.bg.b },
    }));
  }

  draw(buffer: CellBuffer, anchorX: number, anchorY: number): void {
    const left = anchorX - this.originX;
    const top = anchorY - this.originY;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y * this.width + x];
        if (cell) buffer.set(left + x, top + y, cell);
      }
    }
  }
}
