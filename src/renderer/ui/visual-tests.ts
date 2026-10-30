import { CellBuffer, type Cell } from '../../game/cell-buffer.js';
import { BorderBox, BORDER_STYLES } from './border-box.js';
import { DrawContext, UIElement } from './element.js';
import { ParagraphWrapped } from './paragraph-wrapped.js';
import { Quad } from './quad.js';

export interface VisualTest {
  readonly name: string;
  readonly contentHeight: number;
  draw(buffer: CellBuffer, scrollY: number): void;
}

export const background: Cell = {
  ch: ' ',
  fg: { r: 205, g: 211, b: 209 },
  bg: { r: 16, g: 20, b: 25 },
};

class Label extends UIElement {
  constructor(
    id: string,
    x: number,
    y: number,
    private readonly text: string,
  ) {
    super(id, x, y, text.length, 1);
  }

  protected paint(ctx: DrawContext): void {
    for (let x = 0; x < this.text.length; x++) {
      ctx.set(x, 0, { ...background, ch: this.text[x] });
    }
  }
}

const borderBoxTest: VisualTest = {
  name: 'border-box',
  contentHeight: 22,
  draw(buffer, scrollY) {
    const root = new UIElement('border-box-gallery', 0, -scrollY, buffer.width, this.contentHeight);
    root.addChild(new Label('heading', 0, 0, 'BorderBox — all border styles'));

    const x = buffer.width < 6 ? 0 : 2;
    const width = Math.min(36, Math.max(2, buffer.width - x - 2));
    for (const [index, border] of BORDER_STYLES.entries()) {
      const y = 2 + index * 5;
      root.addChild(new Label(`${border}-label`, x, y, border));
      const box = new BorderBox(`${border}-box`, x, y + 1, width, 3, {
        border,
        fg: { r: 110 + index * 30, g: 205 - index * 20, b: 230 - index * 20 },
        bg: background.bg,
      });
      box.addChild(new Label(`${border}-content`, 0, 0, `${border} border`));
      root.addChild(box);
    }
    root.render(buffer);
  },
};

const WORD_WRAP_SAMPLE = 'Pack your lantern before the mountain pass.';
const HYPHEN_WRAP_SAMPLE = 'A well-known tightly-sealed crate.';
const NEWLINE_WRAP_SAMPLE = 'First line stays.\nSecond line wraps if needed.';

const paragraphWrappedTest: VisualTest = {
  name: 'paragraph-wrapped',
  contentHeight: 20,
  draw(buffer, scrollY) {
    const root = new UIElement(
      'paragraph-wrapped-gallery',
      0,
      -scrollY,
      buffer.width,
      this.contentHeight,
    );
    root.addChild(new Label('heading', 0, 0, 'ParagraphWrapped — wrap at words and hyphens'));

    const x = buffer.width < 6 ? 0 : 2;
    let y = 2;
    const examples = [
      { id: 'word', label: 'word wrap (width 18)', width: 18, text: WORD_WRAP_SAMPLE },
      { id: 'hyphen', label: 'hyphen wrap (width 12)', width: 12, text: HYPHEN_WRAP_SAMPLE },
      { id: 'newline', label: 'hard newlines (width 20)', width: 20, text: NEWLINE_WRAP_SAMPLE },
    ] as const;

    for (const example of examples) {
      const width = Math.min(example.width, Math.max(1, buffer.width - x - 2));
      root.addChild(new Label(`${example.id}-label`, x, y, example.label));
      const paragraph = new ParagraphWrapped(`${example.id}-text`, x, y + 1, width, example.text, {
        fg: background.fg,
        bg: background.bg,
      });
      root.addChild(paragraph);
      y += paragraph.height + 2;
    }
    root.render(buffer);
  },
};

const SPRITE_GLYPHS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const quadTest: VisualTest = {
  name: 'quad',
  contentHeight: 18,
  draw(buffer, scrollY) {
    const root = new UIElement('quad-gallery', 0, -scrollY, buffer.width, this.contentHeight);
    root.addChild(new Label('heading', 0, 0, 'Quad — children clip to x, y, w, h'));

    const x = buffer.width < 6 ? 0 : 2;
    root.addChild(new Label('full-label', x, 2, '8x8 sprite'));
    root.addChild(new GlyphGrid('full-sprite', x, 3, 8, 8, SPRITE_GLYPHS));

    const clipX = x + 12;
    root.addChild(new Label('clip-label', clipX, 2, '4x4 quad'));
    const clip = new Quad('clip', clipX, 3, 4, 4, {
      fg: background.fg,
      bg: background.bg,
    });
    clip.addChild(new GlyphGrid('clipped-sprite', 0, 0, 8, 8, SPRITE_GLYPHS));
    root.addChild(clip);

    root.addChild(new Label('para-label', x, 13, 'paragraph in an 18x2 quad'));
    const para = new Quad('para-clip', x, 14, 18, 2, {
      fg: background.fg,
      bg: background.bg,
    });
    para.addChild(
      new ParagraphWrapped('para-text', 0, 0, 18, WORD_WRAP_SAMPLE, {
        fg: background.fg,
        bg: background.bg,
      }),
    );
    root.addChild(para);
    root.render(buffer);
  },
};

class GlyphGrid extends UIElement {
  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    private readonly glyphs: string,
  ) {
    super(id, x, y, width, height);
  }

  protected paint(ctx: DrawContext): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        ctx.set(x, y, { ...background, ch: this.glyphs[y * this.width + x] ?? ' ' });
      }
    }
  }
}

// Add new component galleries here; the terminal runner handles selection, sizing and scrolling.
export const visualTests: readonly VisualTest[] = [borderBoxTest, paragraphWrappedTest, quadTest];

export function renderVisualTest(
  test: VisualTest,
  cols: number,
  rows: number,
  scrollY = 0,
): CellBuffer {
  const buffer = new CellBuffer(cols, rows, background);
  const maxScroll = Math.max(0, test.contentHeight - Math.max(0, rows - 1));
  test.draw(buffer, Math.max(0, Math.min(scrollY, maxScroll)));
  const footer = ` ${test.name}  ↑/↓ scroll  r redraw  q / Ctrl-C quit `;
  for (let x = 0; x < cols; x++) {
    buffer.set(x, rows - 1, {
      ch: footer[x] ?? ' ',
      fg: { r: 16, g: 20, b: 25 },
      bg: { r: 170, g: 190, b: 195 },
    });
  }
  return buffer;
}
