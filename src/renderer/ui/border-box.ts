import type { Cell } from '../../game/cell-buffer.js';
import type { Rgb } from '../../game/color.js';
import { DrawContext, UIElement } from './element.js';

export const BORDER_STYLES = ['single', 'double', 'heavy', 'rounded'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

const BORDER_GLYPHS: Record<
  BorderStyle,
  {
    horizontal: string;
    vertical: string;
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
  }
> = {
  single: {
    horizontal: '─',
    vertical: '│',
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
  },
  double: {
    horizontal: '═',
    vertical: '║',
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
  },
  heavy: {
    horizontal: '━',
    vertical: '┃',
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
  },
  rounded: {
    horizontal: '─',
    vertical: '│',
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
  },
};

const DEFAULT_FG: Rgb = { r: 170, g: 170, b: 170 };
const DEFAULT_BG: Rgb = { r: 0, g: 0, b: 0 };

export function isBorderStyle(value: string): value is BorderStyle {
  return (BORDER_STYLES as readonly string[]).includes(value);
}

export function paintBox(
  ctx: DrawContext,
  width: number,
  height: number,
  border: BorderStyle,
  ink: (ch: string) => Cell,
): void {
  const fill = ink(' ');
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) ctx.set(x, y, fill);
  }
  const glyphs = BORDER_GLYPHS[border];
  const lastX = width - 1;
  const lastY = height - 1;
  const horizontal = ink(glyphs.horizontal);
  const vertical = ink(glyphs.vertical);
  for (let x = 1; x < lastX; x++) {
    ctx.set(x, 0, horizontal);
    ctx.set(x, lastY, horizontal);
  }
  for (let y = 1; y < lastY; y++) {
    ctx.set(0, y, vertical);
    ctx.set(lastX, y, vertical);
  }
  ctx.set(0, 0, ink(glyphs.topLeft));
  ctx.set(lastX, 0, ink(glyphs.topRight));
  ctx.set(0, lastY, ink(glyphs.bottomLeft));
  ctx.set(lastX, lastY, ink(glyphs.bottomRight));
}

export class BorderBox extends UIElement {
  border: BorderStyle;
  fg: Rgb;
  bg: Rgb;
  private _scrollY = 0;

  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options?: {
      border?: BorderStyle;
      fg?: Rgb;
      bg?: Rgb;
      scrollY?: number;
      enabled?: boolean;
      visible?: boolean;
    },
  ) {
    super(id, x, y, width, height, options);
    if (width < 2 || height < 2) throw new Error('BorderBox size must be at least 2 by 2');
    const border = options?.border ?? 'double';
    if (!isBorderStyle(border)) throw new Error(`Unknown border style ${border}`);
    this.border = border;
    this.fg = options?.fg ?? DEFAULT_FG;
    this.bg = options?.bg ?? DEFAULT_BG;
    if (options?.scrollY !== undefined) this.scrollY = options.scrollY;
  }

  get innerWidth(): number {
    return Math.max(0, this.width - 2);
  }

  get innerHeight(): number {
    return Math.max(0, this.height - 2);
  }

  get scrollY(): number {
    return this._scrollY;
  }

  set scrollY(value: number) {
    if (!Number.isInteger(value)) throw new Error('scrollY must be an integer');
    this._scrollY = value;
    this.clampScroll();
  }

  contentHeight(): number {
    let bottom = 0;
    for (const child of this.children) {
      if (!child.visible) continue;
      bottom = Math.max(bottom, child.y + child.height);
    }
    return bottom;
  }

  maxScrollY(): number {
    return Math.max(0, this.contentHeight() - this.innerHeight);
  }

  scrollToEnd(): void {
    this.scrollY = this.maxScrollY();
  }

  addChild(child: UIElement): this {
    super.addChild(child);
    this.clampScroll();
    return this;
  }

  removeChild(child: UIElement): void {
    super.removeChild(child);
    this.clampScroll();
  }

  protected paint(ctx: DrawContext): void {
    paintBox(ctx, this.width, this.height, this.border, (ch) => this.ink(ch));
  }

  protected drawChildren(ctx: DrawContext): void {
    this.clampScroll();
    if (this.innerWidth < 1 || this.innerHeight < 1) return;
    const content = ctx.nested(ctx.originX + 1, ctx.originY + 1 - this._scrollY, {
      x: ctx.originX + 1,
      y: ctx.originY + 1,
      width: this.innerWidth,
      height: this.innerHeight,
    });
    for (const child of this.children) child.draw(content);
  }

  private clampScroll(): void {
    this._scrollY = Math.max(0, Math.min(this._scrollY, this.maxScrollY()));
  }

  private ink(ch: string): Cell {
    return { ch, fg: this.fg, bg: this.bg };
  }
}
