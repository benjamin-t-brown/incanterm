import type { SceneDocument, SceneEntity } from './schema.js';

type PropEntry = Extract<SceneEntity, { type: 'Prop' }>;

export function addSceneProp(
  scene: SceneDocument,
  propId: string,
  x: number,
  y: number,
): PropEntry {
  const base = propId.slice(0, 58).replace(/[-_]$/, '');
  const ids = new Set([
    ...scene.entities.map((entry) => entry.id),
    ...scene.triggers.map((entry) => (typeof entry === 'string' ? entry : entry.id)),
  ]);
  let number = 1;
  while (ids.has(`${base}-${number}`)) number++;
  const entry: PropEntry = {
    id: `${base}-${number}`,
    type: 'Prop',
    name: `${base}-${number}`,
    prop: propId,
    x: Math.max(0, Math.min(scene.width - 1, x)),
    y: Math.max(0, Math.min(scene.height - 1, y)),
    z: 0,
  };
  scene.entities.push(entry);
  return entry;
}
