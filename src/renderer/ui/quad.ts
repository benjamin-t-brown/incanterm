import type { Cell } from '../../game/cell-buffer.js';
import type { Rgb } from '../../game/color.js';
import { DrawContext, UIElement } from './element.js';

const DEFAULT_FG: Rgb = { r: 170, g: 170, b: 170 };
const DEFAULT_BG: Rgb = { r: 0, g: 0, b: 0 };

export class Quad extends UIElement {
  fg: Rgb;
  bg: Rgb;

  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options?: {
      fg?: Rgb;
      bg?: Rgb;
      enabled?: boolean;
      visible?: boolean;
    },
  ) {
    super(id, x, y, width, height, options);
    this.fg = options?.fg ?? DEFAULT_FG;
    this.bg = options?.bg ?? DEFAULT_BG;
  }

  protected paint(ctx: DrawContext): void {
    const fill = this.getInk(' ');
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) ctx.set(x, y, fill);
    }
  }

  private getInk(ch: string): Cell {
    return { ch, fg: this.fg, bg: this.bg };
  }
}
