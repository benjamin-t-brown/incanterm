import type { SceneDocument, SceneTrigger } from '../schema.js';

export type Region = { x: number; y: number; width: number; height: number };
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function triggerRegion(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  sceneWidth: number,
  sceneHeight: number,
): Region {
  const x1 = Math.max(0, Math.min(sceneWidth - 1, Math.floor(startX)));
  const y1 = Math.max(0, Math.min(sceneHeight - 1, Math.floor(startY)));
  const x2 = Math.max(0, Math.min(sceneWidth - 1, Math.floor(endX)));
  const y2 = Math.max(0, Math.min(sceneHeight - 1, Math.floor(endY)));
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1) + 1,
    height: Math.abs(y2 - y1) + 1,
  };
}

export function resizeTrigger(
  start: Region,
  handle: ResizeHandle,
  x: number,
  y: number,
  sceneWidth: number,
  sceneHeight: number,
): Region {
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = Math.max(0, Math.min(right - 1, Math.floor(x)));
  if (handle.includes('e')) right = Math.min(sceneWidth, Math.max(left + 1, Math.floor(x) + 1));
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - 1, Math.floor(y)));
  if (handle.includes('s')) bottom = Math.min(sceneHeight, Math.max(top + 1, Math.floor(y) + 1));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function newSceneTrigger(
  scene: SceneDocument,
  region: Region,
): Exclude<SceneTrigger, string> {
  const existing = new Set([
    ...scene.entities.map((entry) => entry.id),
    ...scene.triggers.map((entry) => (typeof entry === 'string' ? entry : entry.id)),
  ]);
  let id: string;
  do {
    id = crypto.randomUUID();
  } while (existing.has(id));
  const trigger: Exclude<SceneTrigger, string> = {
    id,
    trigger: '',
    event: 'action',
    ...region,
    actionEnabled: true,
    stepEnabled: false,
    description: '',
  };
  scene.triggers.push(trigger);
  return trigger;
}
