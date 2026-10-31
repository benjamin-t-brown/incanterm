import type { SceneDocument } from '../schema.js';

export type SceneObjectRef = { kind: 'entity' | 'trigger'; id: string };

export type SceneHitBox = {
  ref: SceneObjectRef;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function sameSceneObject(a: SceneObjectRef, b: SceneObjectRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function selectableSceneObjects(
  scene: SceneDocument,
  backgroundEdit: boolean,
): SceneObjectRef[] {
  return [
    ...scene.entities.map((entry): SceneObjectRef => ({ kind: 'entity', id: entry.id })),
    ...scene.triggers.map(
      (entry): SceneObjectRef => ({
        kind: 'trigger',
        id: typeof entry === 'string' ? entry : entry.id,
      }),
    ),
  ].filter((ref) => canSelectSceneObject(scene, ref, backgroundEdit));
}

export function boxesInSceneRect(
  boxes: SceneHitBox[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): SceneObjectRef[] {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return boxes
    .filter(
      (box) =>
        box.x < right && box.x + box.width > left && box.y < bottom && box.y + box.height > top,
    )
    .map((box) => box.ref);
}

export type SceneMove = { x: number; y: number; width: number; height: number };

export function groupSceneDelta(
  items: SceneMove[],
  dx: number,
  dy: number,
  width: number,
  height: number,
): { x: number; y: number } {
  if (!items.length) return { x: 0, y: 0 };
  const minX = Math.max(...items.map((item) => -item.x));
  const maxX = Math.min(...items.map((item) => width - item.width - item.x));
  const minY = Math.max(...items.map((item) => -item.y));
  const maxY = Math.min(...items.map((item) => height - item.height - item.y));
  return {
    x: Math.max(minX, Math.min(maxX, dx)),
    y: Math.max(minY, Math.min(maxY, dy)),
  };
}

export function moveSceneGroup(
  scene: SceneDocument,
  starts: Array<SceneMove & { ref: SceneObjectRef }>,
  dx: number,
  dy: number,
): boolean {
  const delta = groupSceneDelta(starts, dx, dy, scene.width, scene.height);
  let changed = false;
  for (const start of starts) {
    const item =
      start.ref.kind === 'entity'
        ? scene.entities.find((entry) => entry.id === start.ref.id)
        : scene.triggers.find((entry) => typeof entry !== 'string' && entry.id === start.ref.id);
    if (
      !item ||
      typeof item === 'string' ||
      (item.x === start.x + delta.x && item.y === start.y + delta.y)
    )
      continue;
    item.x = start.x + delta.x;
    item.y = start.y + delta.y;
    changed = true;
  }
  return changed;
}

export function canSelectSceneObject(
  scene: SceneDocument,
  ref: SceneObjectRef,
  backgroundEdit: boolean,
): boolean {
  if (ref.kind === 'trigger') {
    return (
      !backgroundEdit &&
      scene.triggers.some(
        (trigger) => (typeof trigger === 'string' ? trigger : trigger.id) === ref.id,
      )
    );
  }
  const entity = scene.entities.find((entry) => entry.id === ref.id);
  return !!entity && (entity.type === 'Background') === backgroundEdit;
}
