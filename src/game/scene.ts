import { CellBuffer, type Cell } from './cell-buffer.js';
import type { Sprite } from './sprite.js';
import type { Character } from './character.js';
import type { ItemAsset } from './items.js';
import { compareSceneDrawRank, getSceneDepth, type DepthMode } from './scene-order.js';

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
    public x: number,
    public y: number,
    readonly depthOffset: number,
    readonly z: number,
  ) {}

  abstract draw(buffer: CellBuffer, originX: number, originY: number): void;

  update(_deltaMs: number, _scene: Scene): void {}

  getDepth(mode: DepthMode): number {
    return getSceneDepth(mode, this.y, this.z, this.depthOffset);
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
    readonly foreground = false,
    readonly instanceName?: string,
    readonly blockingOffsets: readonly { x: number; y: number }[] = [],
  ) {
    super(id, x, y, depthOffset, z);
  }

  clone(): Prop {
    // Static props only share immutable sprite and footprint data.
    return Object.assign(new Prop(this.id, this.x, this.y, this.depthOffset, this.z, this.sprite), this);
  }

  draw(buffer: CellBuffer, originX: number, originY: number): void {
    this.sprite.draw(buffer, originX + this.x, originY + this.y);
  }
}

export class Background extends Prop {}

export type ActionTrigger = {
  id: string;
  trigger: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type StepTrigger = ActionTrigger;
export type SceneMarker = { id: string; name: string; x: number; y: number };

export class Scene {
  entities: Entity[];

  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
    readonly depthMode: DepthMode,
    readonly clear: Cell,
    entities: readonly Entity[],
    readonly triggers: readonly string[] = [],
    readonly staticBlockedCells: ReadonlySet<number> = new Set(),
    readonly actionTriggers: readonly ActionTrigger[] = [],
    readonly stepTriggers: readonly StepTrigger[] = [],
    readonly markers: readonly SceneMarker[] = [],
    readonly loadCharacter?: (reference: string) => Promise<Character>,
    readonly itemAssets: ReadonlyMap<string, ItemAsset> = new Map(),
  ) {
    this.entities = [...entities];
  }

  get blockedCells(): ReadonlySet<number> {
    let cells: Set<number> | undefined;
    for (const entity of this.entities) {
      if (!(entity instanceof Prop) || !entity.blockingOffsets.length) continue;
      cells ??= new Set(this.staticBlockedCells);
      for (const offset of entity.blockingOffsets) {
        const x = entity.x + offset.x;
        const y = entity.y + offset.y;
        if (x >= 0 && y >= 0 && x < this.width && y < this.height)
          cells.add(y * this.width + x);
      }
    }
    return cells ?? this.staticBlockedCells;
  }

  getMarker(name: string): SceneMarker | undefined {
    return this.markers.find((marker) => marker.name === name);
  }

  removeEntity(entity: Entity): boolean {
    const index = this.entities.indexOf(entity);
    if (index < 0) return false;
    this.entities.splice(index, 1);
    return true;
  }

  update(deltaMs: number): void {
    for (const entity of this.entities) entity.update(deltaMs, this);
  }

  draw(buffer: CellBuffer, originX: number, originY: number): void {
    const sceneBuffer = new CellBuffer(this.width, this.height, EMPTY);
    const ranked = this.entities.map((entity, index) => ({ entity, index }));
    ranked.sort((a, b) =>
      compareSceneDrawRank(
        {
          background: a.entity instanceof Background,
          foreground: a.entity instanceof Prop && a.entity.foreground,
          depth: a.entity.getDepth(this.depthMode),
          order: a.index,
        },
        {
          background: b.entity instanceof Background,
          foreground: b.entity instanceof Prop && b.entity.foreground,
          depth: b.entity.getDepth(this.depthMode),
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
