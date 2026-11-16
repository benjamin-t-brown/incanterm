import type { PropDocument, SceneDocument, SceneEntity } from '../schema.js';

type PropEntry = Extract<SceneEntity, { type: 'Prop' }>;

export function addSceneProp(
  scene: SceneDocument,
  prop: PropDocument,
  x: number,
  y: number,
): PropEntry {
  const base = prop.id.slice(0, 58).replace(/[-_]$/, '');
  const ids = new Set([
    ...scene.entities.map((entry) => entry.id),
    ...scene.triggers.map((entry) => (typeof entry === 'string' ? entry : entry.id)),
  ]);
  let number = 1;
  while (ids.has(`${base}-${number}`)) number++;
  const entry: PropEntry = {
    id: `${base}-${number}`,
    type: 'Prop',
    name: prop.label ?? `${base}_${number}`,
    prop: prop.id,
    state: 'default',
    x: Math.max(0, Math.min(scene.width - 1, x)),
    y: Math.max(0, Math.min(scene.height - 1, y)),
    z: 0,
    depthOffset: 0,
  };
  scene.entities.push(entry);
  return entry;
}
