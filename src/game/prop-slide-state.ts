import { getSceneSlideSetup, getSlideLayoutError, type SlideCell, type SlidePositions } from './prop-slide.js';
import { Prop, type Scene } from './scene.js';

/** Only settled anchors that differ from the room's authored layout. */
export type PropSlideState = Readonly<Record<string, Readonly<Record<string, SlideCell>>>>;

function getRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

function getRoomOverrides(value: unknown): Map<string, SlideCell> | undefined {
  const record = getRecord(value);
  if (!record) return;
  const positions = new Map<string, SlideCell>();
  for (const [id, raw] of Object.entries(record)) {
    const point = getRecord(raw);
    if (typeof point?.x !== 'number' || typeof point.y !== 'number' ||
      !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) return;
    positions.set(id, { x: point.x, y: point.y });
  }
  return positions;
}

function isSameAnchor(a: SlideCell, b: SlideCell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function applyPropSlidePositions(scene: Scene, positions: SlidePositions): void {
  for (const entity of scene.entities) {
    if (!(entity instanceof Prop) || !entity.slidable) continue;
    const position = positions.get(entity.id);
    if (position) {
      entity.x = position.x;
      entity.y = position.y;
    }
  }
}

export class PropSlideLayouts {
  private readonly rooms = new Map<string, Map<string, SlideCell>>();

  constructor(state?: unknown) {
    for (const [roomId, saved] of Object.entries(getRecord(state) ?? {})) {
      const positions = getRoomOverrides(saved);
      if (positions?.size) this.rooms.set(roomId, positions);
    }
  }

  getState(): PropSlideState {
    return Object.fromEntries([...this.rooms].map(([roomId, positions]) => [
      roomId, Object.fromEntries([...positions].map(([id, point]) => [id, { ...point }])),
    ]));
  }

  setSettledAnchor(roomId: string, id: string, authored: SlideCell, position: SlideCell): void {
    if (isSameAnchor(authored, position)) {
      const positions = this.rooms.get(roomId);
      positions?.delete(id);
      if (!positions?.size) this.clearRoom(roomId);
      return;
    }
    const positions = this.rooms.get(roomId) ?? new Map<string, SlideCell>();
    positions.set(id, { ...position });
    this.rooms.set(roomId, positions);
  }

  clearRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  /** Capture authored defaults on a fresh clone, then restore only a complete, valid layout. */
  restoreRoom(scene: Scene): { defaults: SlidePositions; error?: string } {
    const setup = getSceneSlideSetup(scene);
    const defaults = setup?.positions ?? new Map<string, SlideCell>();
    const overrides = this.rooms.get(scene.id);
    if (!overrides) return { defaults };
    const candidate = new Map(defaults);
    let error: string | undefined;
    for (const [id, position] of overrides) {
      if (!defaults.has(id)) {
        error = `unknown slidable prop ${id}`;
        break;
      }
      candidate.set(id, position);
    }
    if (setup && !error) error = getSlideLayoutError(setup.board, candidate);
    if (error) {
      this.clearRoom(scene.id);
      return { defaults, error };
    }
    applyPropSlidePositions(scene, candidate);
    for (const [id, authored] of defaults) {
      const position = overrides.get(id);
      if (position && isSameAnchor(authored, position)) overrides.delete(id);
    }
    if (!overrides.size) this.clearRoom(scene.id);
    return { defaults };
  }
}
