import type { CellBuffer, Cell } from './cell-buffer.js';

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

  getFlipped(horizontal: boolean, vertical: boolean): Sprite {
    if (!horizontal && !vertical) return this;
    const cells = this.cells.map((_, index) => {
      const x = index % this.width,
        y = Math.floor(index / this.width);
      return this.cells[
        (vertical ? this.height - 1 - y : y) * this.width + (horizontal ? this.width - 1 - x : x)
      ];
    });
    return new Sprite(this.id, this.width, this.height, this.originX, this.originY, cells);
  }

  draw(buffer: CellBuffer, anchorX: number, anchorY: number): void {
    const left = anchorX - this.originX;
    const top = anchorY - this.originY;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y * this.width + x];
        const targetX = left + x;
        const targetY = top + y;
        if (
          !cell ||
          targetX < 0 ||
          targetY < 0 ||
          targetX >= buffer.width ||
          targetY >= buffer.height
        )
          continue;
        const transparent = cell.bg.r === 0 && cell.bg.g === 0 && cell.bg.b === 0;
        if (transparent && cell.ch === ' ') continue;
        buffer.set(targetX, targetY, {
          ch: cell.ch,
          fg: cell.fg,
          bg: transparent ? buffer.get(targetX, targetY).bg : cell.bg,
        });
      }
    }
  }
}
