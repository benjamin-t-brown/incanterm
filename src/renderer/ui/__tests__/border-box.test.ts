import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../../game/cell-buffer.js';
import { getPlainText } from '../../../game/terminal.js';
import { BorderBox, isBorderStyle, type BorderStyle } from '../border-box.js';
import { DrawContext, UIElement } from '../element.js';

const ink: Cell = {
  ch: '.',
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
};

describe('BorderBox', () => {
  it('draws the art path styles', () => {
    expect(createFrame(3, 3, 'single')).toBe('┌─┐\n│ │\n└─┘');
    expect(createFrame(3, 3, 'double')).toBe('╔═╗\n║ ║\n╚═╝');
    expect(createFrame(3, 3, 'heavy')).toBe('┏━┓\n┃ ┃\n┗━┛');
    expect(createFrame(3, 3, 'rounded')).toBe('╭─╮\n│ │\n╰─╯');
    expect(isBorderStyle('double')).toBe(true);
    expect(isBorderStyle('dialog')).toBe(false);
  });

  it('defaults to a double border and fills the interior', () => {
    const box = new BorderBox('panel', 1, 1, 6, 4);
    expect(box.border).toBe('double');
    expect(draw(box, 8, 6).split('\n')).toEqual([
      '........',
      '.╔════╗.',
      '.║    ║.',
      '.║    ║.',
      '.╚════╝.',
      '........',
    ]);
  });

  it('renders children inside the border', () => {
    const box = new BorderBox('panel', 0, 0, 6, 4);
    box.addChild(new Fill('title', 0, 0, 4, 1, 'Hi!!'));
    expect(draw(box, 6, 4).split('\n')).toEqual(['╔════╗', '║Hi!!║', '║    ║', '╚════╝']);
  });

  it('clips content that would paint over the border', () => {
    const box = new BorderBox('panel', 0, 0, 5, 4);
    box.addChild(new Fill('wide', -1, 0, 5, 1, 'XXXXX'));
    expect(draw(box, 5, 4).split('\n')).toEqual(['╔═══╗', '║XXX║', '║   ║', '╚═══╝']);
  });

  it('scrolls overflow past the bottom without a scrollbar', () => {
    const box = new BorderBox('log', 0, 0, 5, 4);
    box.addChild(new Fill('lines', 0, 0, 1, 4, 'ABCD'));
    expect(box.getContentHeight()).toBe(4);
    expect(box.maxScrollY()).toBe(2);
    expect(draw(box, 5, 4).split('\n')).toEqual(['╔═══╗', '║A  ║', '║B  ║', '╚═══╝']);

    box.scrollY = 2;
    expect(draw(box, 5, 4).split('\n')).toEqual(['╔═══╗', '║C  ║', '║D  ║', '╚═══╝']);

    box.scrollY = 99;
    expect(box.scrollY).toBe(2);
    box.addChild(new Fill('more', 0, 4, 1, 1, 'E'));
    expect(box.maxScrollY()).toBe(3);
    box.scrollToEnd();
    expect(draw(box, 5, 4).split('\n')).toEqual(['╔═══╗', '║D  ║', '║E  ║', '╚═══╝']);
  });

  it('clamps scroll when content shrinks and ignores hidden children', () => {
    const box = new BorderBox('log', 0, 0, 4, 3);
    const lines = new Fill('lines', 0, 0, 1, 5, 'ABCDE');
    box.addChild(lines);
    box.scrollToEnd();
    expect(box.scrollY).toBe(4);
    lines.visible = false;
    box.scrollY = 99;
    expect(box.scrollY).toBe(0);
    expect(draw(box, 4, 3).split('\n')).toEqual(['╔══╗', '║  ║', '╚══╝']);
  });

  it('rejects undersized boxes', () => {
    expect(() => new BorderBox('tiny', 0, 0, 1, 2)).toThrow(/at least 2 by 2/);
  });
});

function createFrame(width: number, height: number, border: BorderStyle): string {
  return draw(new BorderBox('box', 0, 0, width, height, { border }), width, height);
}

function draw(root: UIElement, width: number, height: number): string {
  const buffer = new CellBuffer(width, height, ink);
  root.render(buffer);
  return getPlainText(buffer);
}

class Fill extends UIElement {
  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    private readonly text: string,
  ) {
    super(id, x, y, width, height);
  }

  protected paint(ctx: DrawContext): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const ch = this.text[y * this.width + x] ?? ' ';
        ctx.set(x, y, { ...ink, ch });
      }
    }
  }
}
