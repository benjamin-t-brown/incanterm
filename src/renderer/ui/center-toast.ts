import { BorderBox } from './border-box.js';
import type { DrawContext } from './element.js';
import { wrapParagraph } from './paragraph-wrapped.js';
import { UI_INK } from './standard-ui.js';

const TOAST_BACKGROUND = { r: 30, g: 38, b: 46 };

export class CenterToast extends BorderBox {
  private lines: readonly string[] = [''];

  constructor() {
    super('center-toast', 0, 0, 40, 5, { border: 'single', fg: UI_INK.fg, bg: TOAST_BACKGROUND, visible: false });
  }

  setMessage(message: string, viewportWidth: number, viewportHeight: number): void {
    this.lines = wrapParagraph(message, this.innerWidth - 2);
    this.height = Math.max(5, this.lines.length + 4);
    this.x = Math.floor((viewportWidth - this.width) / 2);
    this.y = Math.floor((viewportHeight - this.height) / 2);
  }

  protected paint(ctx: DrawContext): void {
    super.paint(ctx);
    const firstY = Math.floor((this.height - this.lines.length) / 2);
    for (let row = 0; row < this.lines.length; row++) {
      const line = this.lines[row];
      const firstX = Math.floor((this.width - line.length) / 2);
      for (let col = 0; col < line.length; col++)
        ctx.set(firstX + col, firstY + row, { ch: line[col], fg: this.fg, bg: this.bg });
    }
  }
}
