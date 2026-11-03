import { CellBuffer, type Cell } from '../../game/cell-buffer.js';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class DrawContext {
  constructor(
    readonly buffer: CellBuffer,
    readonly originX: number,
    readonly originY: number,
    readonly clip: Readonly<Rect>,
  ) {}

  static createFromBuffer(buffer: CellBuffer): DrawContext {
    return new DrawContext(buffer, 0, 0, {
      x: 0,
      y: 0,
      width: buffer.width,
      height: buffer.height,
    });
  }

  createNested(originX: number, originY: number, clip: Rect): DrawContext {
    return new DrawContext(this.buffer, originX, originY, intersectRects(this.clip, clip));
  }

  set(x: number, y: number, cell: Cell): void {
    const px = this.originX + x;
    const py = this.originY + y;
    if (!containsRect(this.clip, px, py)) return;
    this.buffer.set(px, py, cell);
  }
}

export class UIElement {
  readonly id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
  visible: boolean;
  private _parent: UIElement | null = null;
  private readonly _children: UIElement[] = [];

  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options?: { enabled?: boolean; visible?: boolean },
  ) {
    assertInteger('x', x);
    assertInteger('y', y);
    assertSize(width, height);
    this.id = id;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.enabled = options?.enabled ?? true;
    this.visible = options?.visible ?? true;
  }

  get parent(): UIElement | null {
    return this._parent;
  }

  get children(): readonly UIElement[] {
    return this._children;
  }

  addChild(child: UIElement): this {
    if (child === this) throw new Error('Cannot add a UI element as a child of itself');
    let ancestor = this.parent;
    while (ancestor) {
      if (ancestor === child) throw new Error('Cannot add an ancestor as a child');
      ancestor = ancestor.parent;
    }
    child.parent?.removeChild(child);
    this._children.push(child);
    child._parent = this;
    return this;
  }

  removeChild(child: UIElement): void {
    const index = this._children.indexOf(child);
    if (index < 0) return;
    this._children.splice(index, 1);
    child._parent = null;
  }

  findById(id: string): UIElement | null {
    if (this.id === id) return this;
    for (const child of this._children) {
      const found = child.findById(id);
      if (found) return found;
    }
    return null;
  }

  update(elapsedMs: number): void {
    if (!this.enabled) return;
    this.onUpdate(elapsedMs);
    for (const child of this._children) child.update(elapsedMs);
  }

  render(buffer: CellBuffer): void {
    this.draw(DrawContext.createFromBuffer(buffer));
  }

  draw(ctx: DrawContext): void {
    if (!this.visible) return;
    const originX = ctx.originX + this.x;
    const originY = ctx.originY + this.y;
    const local = ctx.createNested(originX, originY, {
      x: originX,
      y: originY,
      width: this.width,
      height: this.height,
    });
    this.paint(local);
    this.drawChildren(local);
  }

  protected onUpdate(_elapsedMs: number): void {}

  protected paint(_ctx: DrawContext): void {}

  protected drawChildren(ctx: DrawContext): void {
    for (const child of this._children) child.draw(ctx);
  }
}

export function intersectRects(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

function containsRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function assertInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
}

function assertSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('UI element size must be at least 1 by 1');
  }
}
