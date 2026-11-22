import type { Cell } from '../../game/cell-buffer.js';
import type { Rgb } from '../../game/color.js';
import { isBorderStyle, paintBox, type BorderStyle } from './border-box.js';
import { type DrawContext, UIElement } from './element.js';

export const BUTTON_FG: Rgb = { r: 20, g: 64, b: 40 };
export const BUTTON_BG: Rgb = { r: 210, g: 210, b: 210 };

type InlineButtonOptions = {
  fg?: Rgb;
  bg?: Rgb;
  enabled?: boolean;
  visible?: boolean;
};

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
    options?: InlineButtonOptions & { border?: BorderStyle },
  ) {
    super(id, x, y, width, 3, options);
    if (width < 2) throw new Error('Button width must be at least 2');
    const border = options?.border ?? 'single';
    if (!isBorderStyle(border)) throw new Error(`Unknown border style ${border}`);
    this.border = border;
    this.fg = options?.fg ?? BUTTON_FG;
    this.bg = options?.bg ?? BUTTON_BG;
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
    if (this.height === 1) {
      ctx.set(0, 0, this.getInk('['));
      ctx.set(this.width - 1, 0, this.getInk(']'));
      this.paintLabel(ctx, 0);
      return;
    }
    paintBox(ctx, this.width, this.height, this.border, (ch) => this.getInk(ch));
    if (this.height >= 3) this.paintLabel(ctx, 1);
  }

  private paintLabel(ctx: DrawContext, y: number): void {
    const label = centerText(this._text, this.innerWidth);
    for (let x = 0; x < this.innerWidth; x++) {
      ctx.set(x + 1, y, this.getInk(label[x] ?? ' '));
    }
  }

  private getInk(ch: string): Cell {
    return { ch, fg: this.fg, bg: this.bg };
  }
}

/** A one-line button sized to render its label as `[ Label ]`. */
export class InlineButton extends Button {
  constructor(id: string, x: number, y: number, text: string, options?: InlineButtonOptions) {
    super(id, x, y, text.length + 4, text, options);
    this.height = 1;
  }
}

function centerText(text: string, width: number): string {
  const clipped = text.length > width ? text.slice(0, width) : text;
  const pad = width - clipped.length;
  const left = Math.floor(pad / 2);
  return `${' '.repeat(left)}${clipped}${' '.repeat(pad - left)}`;
}
