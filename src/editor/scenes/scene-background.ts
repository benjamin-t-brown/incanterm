import type { SceneDocument, SceneEntity } from '../schema.js';

type BackgroundEntry = Extract<SceneEntity, { type: 'Background' }>;

// Backgrounds are scene instances, not entries in assets/props. Replacing the
// sprite keeps the instance identity and its placement in the room.
export function setSceneBackground(
  scene: SceneDocument,
  sprite: string,
  index: number,
): BackgroundEntry {
  const existing = scene.entities.find(
    (entity): entity is BackgroundEntry => entity.type === 'Background',
  );
  if (existing) {
    existing.sprite = sprite;
    existing.index = index;
    return existing;
  }
  let number = 1;
  const ids = new Set([
    ...scene.entities.map((entity) => entity.id),
    ...scene.triggers.map((trigger) => (typeof trigger === 'string' ? trigger : trigger.id)),
  ]);
  while (ids.has(`background-${number}`)) number++;
  const background: BackgroundEntry = {
    id: `background-${number}`,
    type: 'Background',
    sprite,
    index,
    x: 0,
    y: 0,
  };
  scene.entities.push(background);
  return background;
}
