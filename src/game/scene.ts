import { CellBuffer, type Cell } from './cell-buffer.js';
import type { Sprite } from './sprite.js';
import { compareSceneDrawRank, sceneDepth, type DepthMode } from './scene-order.js';

export type { DepthMode } from './scene-order.js';

const MARGIN: Cell = {
  ch: ' ',
  fg: { r: 92, g: 107, b: 99 },
  bg: { r: 12, g: 14, b: 13 },
};

const EMPTY: Cell = {
  ch: ' ',
  fg: { r: 0, g: 0, b: 0 },
  bg: { r: 0, g: 0, b: 0 },
};

export abstract class Entity {
  constructor(
    readonly id: string,
    readonly x: number,
    readonly y: number,
    readonly depthOffset: number,
    readonly z: number,
  ) {}

  abstract draw(buffer: CellBuffer, originX: number, originY: number): void;

  depth(mode: DepthMode): number {
    return sceneDepth(mode, this.y, this.z, this.depthOffset);
  }
}

export class Prop extends Entity {
  constructor(
    id: string,
    x: number,
    y: number,
    depthOffset: number,
    z: number,
    readonly sprite: Sprite,
  ) {
    super(id, x, y, depthOffset, z);
  }

  draw(buffer: CellBuffer, originX: number, originY: number): void {
    this.sprite.draw(buffer, originX + this.x, originY + this.y);
  }
}

export class Background extends Prop {}

export class Scene {
  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
    readonly depthMode: DepthMode,
    readonly clear: Cell,
    readonly entities: readonly Entity[],
    readonly triggers: readonly string[] = [],
  ) {}

  draw(buffer: CellBuffer, originX: number, originY: number): void {
    const sceneBuffer = new CellBuffer(this.width, this.height, EMPTY);
    const ranked = this.entities.map((entity, index) => ({ entity, index }));
    ranked.sort((a, b) =>
      compareSceneDrawRank(
        {
          background: a.entity instanceof Background,
          depth: a.entity.depth(this.depthMode),
          order: a.index,
        },
        {
          background: b.entity instanceof Background,
          depth: b.entity.depth(this.depthMode),
          order: b.index,
        },
      ),
    );
    for (const { entity } of ranked) entity.draw(sceneBuffer, 0, 0);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        buffer.set(originX + x, originY + y, sceneBuffer.get(x, y));
      }
    }
  }
}

export function renderView(scene: Scene, cols: number, rows: number): CellBuffer {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new Error('View size must be at least 1 by 1');
  }
  const buffer = new CellBuffer(cols, rows, MARGIN);
  const originX = Math.floor((cols - scene.width) / 2);
  const originY = Math.floor((rows - scene.height) / 2);
  scene.draw(buffer, originX, originY);
  return buffer;
}
