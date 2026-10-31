import type {
  CharacterDirection,
  CharacterDocument,
  SceneDocument,
  SceneEntity,
} from '../schema.js';

export function addSceneCharacter(
  scene: SceneDocument,
  character: CharacterDocument,
  x: number,
  y: number,
): Extract<SceneEntity, { type: 'Character' }> {
  const base = character.id.slice(0, 58).replace(/[-_]$/, '');
  const ids = new Set([
    ...scene.entities.map((entry) => entry.id),
    ...scene.triggers.map((entry) => (typeof entry === 'string' ? entry : entry.id)),
  ]);
  let number = 1;
  while (ids.has(`${base}-${number}`)) number++;
  const id = `${base}-${number}`;
  const entry: Extract<SceneEntity, { type: 'Character' }> = {
    id,
    type: 'Character',
    name: character.label,
    character: character.id,
    facing: character.defaultFacing as CharacterDirection,
    state: 'idle',
    x: Math.max(0, Math.min(scene.width - 1, x)),
    y: Math.max(0, Math.min(scene.height - 1, y)),
    z: 0,
  };
  scene.entities.push(entry);
  return entry;
}
