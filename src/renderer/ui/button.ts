import type { Cell } from '../../game/cell-buffer.js';
import type { Rgb } from '../../game/color.js';
import { isBorderStyle, paintBox, type BorderStyle } from './border-box.js';
import { DrawContext, UIElement } from './element.js';

const DEFAULT_FG: Rgb = { r: 170, g: 170, b: 170 };
const DEFAULT_BG: Rgb = { r: 0, g: 0, b: 0 };

export class Button extends UIElement {
  border: BorderStyle;
  fg: Rgb;
  bg: Rgb;
  private _text: string;

  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    text: string,
    options?: {
      border?: BorderStyle;
      fg?: Rgb;
      bg?: Rgb;
      enabled?: boolean;
      visible?: boolean;
    },
  ) {
    super(id, x, y, width, 3, options);
    if (width < 2) throw new Error('Button width must be at least 2');
    const border = options?.border ?? 'single';
    if (!isBorderStyle(border)) throw new Error(`Unknown border style ${border}`);
    this.border = border;
    this.fg = options?.fg ?? DEFAULT_FG;
    this.bg = options?.bg ?? DEFAULT_BG;
    this._text = text;
  }

  get innerWidth(): number {
    return Math.max(0, this.width - 2);
  }

  get text(): string {
    return this._text;
  }

  set text(value: string) {
    this._text = value;
  }

  protected paint(ctx: DrawContext): void {
    paintBox(ctx, this.width, this.height, this.border, (ch) => this.getInk(ch));
    if (this.height < 3 || this.innerWidth < 1) return;
    const label = centerText(this._text, this.innerWidth);
    for (let x = 0; x < this.innerWidth; x++) {
      ctx.set(x + 1, 1, this.getInk(label[x] ?? ' '));
    }
  }

  private getInk(ch: string): Cell {
    return { ch, fg: this.fg, bg: this.bg };
  }
}

function centerText(text: string, width: number): string {
  const clipped = text.length > width ? text.slice(0, width) : text;
  const pad = width - clipped.length;
  const left = Math.floor(pad / 2);
  return `${' '.repeat(left)}${clipped}${' '.repeat(pad - left)}`;
}
