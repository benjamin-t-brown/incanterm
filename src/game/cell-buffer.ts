import type { Rgb } from './color.js';

export type Cell = {
  ch: string;
  fg: Rgb;
  bg: Rgb;
};

export class CellBuffer {
  readonly width: number;
  readonly height: number;
  private readonly cells: Cell[];

  constructor(width: number, height: number, fill: Cell) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Buffer size must be at least 1 by 1');
    }
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: width * height }, () => copyCell(fill));
  }

  get(x: number, y: number): Cell {
    return this.cells[this.index(x, y)];
  }

  set(x: number, y: number, cell: Cell): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[this.index(x, y)] = copyCell(cell);
  }

  private index(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      throw new Error(`Cell ${x},${y} is outside ${this.width}x${this.height}`);
    }
    return y * this.width + x;
  }
}

function copyCell(cell: Cell): Cell {
  return {
    ch: cell.ch,
    fg: { r: cell.fg.r, g: cell.fg.g, b: cell.fg.b },
    bg: { r: cell.bg.r, g: cell.bg.g, b: cell.bg.b },
  };
}
