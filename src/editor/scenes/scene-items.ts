import type { ItemDocument } from '../items/item-schema.js';
import type { SceneDocument, SceneEntity } from '../schema.js';

export function addSceneItem(
  scene: SceneDocument,
  item: ItemDocument,
  x: number,
  y: number,
): Extract<SceneEntity, { type: 'Item' }> {
  const base = item.id.slice(0, 58).replace(/[-_]$/, '');
  const ids = new Set([
    ...scene.entities.map((entry) => entry.id),
    ...scene.triggers.map((entry) => (typeof entry === 'string' ? entry : entry.id)),
  ]);
  let number = 1;
  while (ids.has(`${base}-${number}`)) number++;
  const entry: Extract<SceneEntity, { type: 'Item' }> = {
    id: `${base}-${number}`,
    type: 'Item',
    item: item.id,
    name: item.label,
    x: Math.max(0, Math.min(scene.width - 1, Math.round(x))),
    y: Math.max(0, Math.min(scene.height - 1, Math.round(y))),
    z: 0,
    depthOffset: 0,
  };
  scene.entities.push(entry);
  return entry;
}
