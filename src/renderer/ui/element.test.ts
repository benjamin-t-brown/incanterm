import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../game/cell-buffer.js';
import { plainText } from '../../game/terminal.js';
import { DrawContext, UIElement } from './element.js';

const ink: Cell = {
  ch: '.',
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
};

describe('UIElement', () => {
  it('finds itself and descendants by id', () => {
    const root = new UIElement('root', 0, 0, 8, 4);
    const panel = new UIElement('panel', 0, 0, 4, 2);
    const label = new UIElement('label', 1, 0, 2, 1);
    root.addChild(panel).addChild(new UIElement('other', 4, 0, 2, 1));
    panel.addChild(label);
    expect(root.findById('root')).toBe(root);
    expect(root.findById('panel')).toBe(panel);
    expect(root.findById('label')).toBe(label);
    expect(root.findById('missing')).toBeNull();
  });

  it('reparents a child and rejects cycles', () => {
    const root = new UIElement('root', 0, 0, 4, 4);
    const a = new UIElement('a', 0, 0, 2, 2);
    const b = new UIElement('b', 0, 0, 1, 1);
    root.addChild(a);
    a.addChild(b);
    expect(b.parent).toBe(a);
    root.addChild(b);
    expect(b.parent).toBe(root);
    expect(a.children).toEqual([]);
    expect(root.children).toEqual([a, b]);
    expect(() => b.addChild(root)).toThrow(/ancestor/);
    expect(() => a.addChild(a)).toThrow(/itself/);
  });

  it('draws later siblings over earlier ones and skips hidden subtrees', () => {
    const root = new UIElement('root', 0, 0, 2, 1);
    root.addChild(new Fill('back', 0, 0, 2, 1, 'A'));
    root.addChild(new Fill('front', 1, 0, 1, 1, 'B'));
    const hidden = new Fill('hidden', 0, 0, 1, 1, 'Z');
    hidden.visible = false;
    root.addChild(hidden);
    expect(draw(root, 2, 1)).toBe('AB');
  });

  it('clips children to the parent bounds', () => {
    const root = new UIElement('root', 1, 1, 3, 2);
    root.addChild(new Fill('overflow', -1, -1, 5, 4, '#'));
    expect(draw(root, 6, 5).split('\n')).toEqual([
      '......',
      '.###..',
      '.###..',
      '......',
      '......',
    ]);
  });

  it('does not update a disabled subtree', () => {
    const root = new UIElement('root', 0, 0, 1, 1);
    const child = new Counter('child', 0, 0, 1, 1);
    root.addChild(child);
    root.update(16);
    expect(child.ticks).toBe(1);
    root.enabled = false;
    root.update(16);
    expect(child.ticks).toBe(1);
  });
});

describe('DrawContext', () => {
  it('intersects nested clips', () => {
    const buffer = new CellBuffer(4, 4, ink);
    const ctx = DrawContext.fromBuffer(buffer).nested(1, 1, { x: 1, y: 1, width: 2, height: 2 });
    ctx.set(0, 0, { ...ink, ch: 'A' });
    ctx.set(1, 1, { ...ink, ch: 'B' });
    ctx.set(2, 0, { ...ink, ch: 'C' });
    expect(plainText(buffer).split('\n')).toEqual(['....', '.A..', '..B.', '....']);
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
    private readonly ch: string,
  ) {
    super(id, x, y, width, height);
  }

  protected paint(ctx: DrawContext): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) ctx.set(x, y, { ...ink, ch: this.ch });
    }
  }
}

class Counter extends UIElement {
  ticks = 0;

  protected onUpdate(_elapsedMs: number): void {
    this.ticks += 1;
  }
}
