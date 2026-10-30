import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../game/cell-buffer.js';
import { plainText } from '../../game/terminal.js';
import { DrawContext, UIElement } from './element.js';
import { ParagraphWrapped } from './paragraph-wrapped.js';
import { Quad } from './quad.js';

const ink: Cell = {
  ch: '.',
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
};

const SPRITE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

describe('Quad', () => {
  it('clips an 8x8 child to the top-left of a 4x4 quad', () => {
    const quad = new Quad('view', 0, 0, 4, 4);
    quad.addChild(new Fill('sprite', 0, 0, 8, 8, SPRITE));
    expect(draw(quad, 8, 8).split('\n')).toEqual([
      'ABCD....',
      'IJKL....',
      'QRST....',
      'YZab....',
      '........',
      '........',
      '........',
      '........',
    ]);
  });

  it('clips children that hang off any edge', () => {
    const quad = new Quad('view', 1, 1, 4, 4);
    quad.addChild(new Fill('sprite', -2, -1, 8, 8, SPRITE));
    expect(draw(quad, 8, 8).split('\n')).toEqual([
      '........',
      '.KLMN...',
      '.STUV...',
      '.abcd...',
      '.ijkl...',
      '........',
      '........',
      '........',
    ]);
  });

  it('clips paragraphs and other components the same way', () => {
    const quad = new Quad('view', 0, 0, 8, 2);
    quad.addChild(
      new ParagraphWrapped('lore', 0, 0, 12, 'A well-known tightly-sealed crate.'),
    );
    expect(draw(quad, 8, 4).split('\n')).toEqual([
      'A well-k',
      'tightly-',
      '........',
      '........',
    ]);
  });

  it('fills its own background where children do not cover', () => {
    const quad = new Quad('view', 1, 1, 4, 3);
    quad.addChild(new Fill('mark', 0, 0, 2, 2, '####'));
    expect(draw(quad, 6, 5).split('\n')).toEqual([
      '......',
      '.##  .',
      '.##  .',
      '.    .',
      '......',
    ]);
  });
});

function draw(root: UIElement, width: number, height: number): string {
  const buffer = new CellBuffer(width, height, ink);
  root.render(buffer);
  return plainText(buffer);
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
