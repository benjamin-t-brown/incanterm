import type { Cell } from '../../game/cell-buffer.js';
import type { Rgb } from '../../game/color.js';
import { DrawContext, UIElement } from './element.js';

const DEFAULT_FG: Rgb = { r: 170, g: 170, b: 170 };
const DEFAULT_BG: Rgb = { r: 0, g: 0, b: 0 };

export function wrapParagraph(text: string, width: number): string[] {
  if (!Number.isInteger(width) || width < 1) {
    throw new Error('Wrap width must be an integer of at least 1');
  }
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];
  for (const paragraph of normalized.split('\n')) {
    lines.push(...wrapSoftLine(paragraph, width));
  }
  return lines;
}

function wrapSoftLine(text: string, width: number): string[] {
  const words = text.split(/[ \t]+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (fitsOnLine(current, word, width)) {
      current = current.length === 0 ? word : `${current} ${word}`;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
    }
    if (word.length <= width) {
      current = word;
      continue;
    }
    current = pushBrokenWord(lines, word, width);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function fitsOnLine(current: string, word: string, width: number): boolean {
  if (current.length === 0) return word.length <= width;
  return current.length + 1 + word.length <= width;
}

function pushBrokenWord(lines: string[], word: string, width: number): string {
  let rest = word;
  while (rest.length > width) {
    const take = breakIndex(rest, width);
    lines.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  return rest;
}

function breakIndex(word: string, width: number): number {
  const hyphen = word.slice(0, width).lastIndexOf('-');
  if (hyphen > 0) return hyphen + 1;
  return width;
}

export class ParagraphWrapped extends UIElement {
  fg: Rgb;
  bg: Rgb;
  lineColors?: readonly Rgb[];
  private _text: string;
  private _lines: string[] = [''];
  private _layoutWidth = 0;
  private _layoutText = '';

  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    text: string,
    options?: {
      fg?: Rgb;
      bg?: Rgb;
      enabled?: boolean;
      visible?: boolean;
    },
  ) {
    super(id, x, y, width, 1, options);
    this._text = text;
    this.fg = options?.fg ?? DEFAULT_FG;
    this.bg = options?.bg ?? DEFAULT_BG;
    this.relayout();
  }

  get text(): string {
    return this._text;
  }

  set text(value: string) {
    this._text = value;
    this.relayout();
  }

  get lines(): readonly string[] {
    this.relayout();
    return this._lines;
  }

  draw(ctx: DrawContext): void {
    this.relayout();
    super.draw(ctx);
  }

  protected paint(ctx: DrawContext): void {
    for (let y = 0; y < this.height; y++) {
      const line = this._lines[y] ?? '';
      for (let x = 0; x < this.width; x++) {
        ctx.set(x, y, this.getInk(line[x] ?? ' ', this.lineColors?.[y] ?? this.fg));
      }
    }
  }

  private relayout(): void {
    if (this._layoutWidth === this.width && this._layoutText === this._text) return;
    this._lines = wrapParagraph(this._text, this.width);
    this._layoutWidth = this.width;
    this._layoutText = this._text;
    this.height = Math.max(1, this._lines.length);
  }

  private getInk(ch: string, fg: Rgb): Cell {
    return { ch, fg, bg: this.bg };
  }
}
