import type { SceneDocument, SceneEntity, SceneTrigger } from '../schema.js';
import { groupSceneDelta, type SceneObjectRef } from './scene-selection.js';

type CopyableEntity = Extract<SceneEntity, { type: 'Prop' }>;
type CopyableTrigger = Exclude<SceneTrigger, string>;
export type SceneClipboard = {
  entities: CopyableEntity[];
  triggers: CopyableTrigger[];
};

export function copySceneObjects(scene: SceneDocument, selected: SceneObjectRef[]): SceneClipboard {
  const entities: CopyableEntity[] = [];
  const triggers: CopyableTrigger[] = [];
  for (const ref of selected) {
    if (ref.kind === 'entity') {
      const entity = scene.entities.find((entry) => entry.id === ref.id);
      if (entity?.type === 'Prop')
        entities.push({ ...structuredClone(entity), name: entity.name ?? entity.id });
    } else {
      const trigger = scene.triggers.find(
        (entry) => typeof entry !== 'string' && entry.id === ref.id,
      );
      if (trigger && typeof trigger !== 'string') triggers.push(structuredClone(trigger));
    }
  }
  return { entities, triggers };
}

export function pasteSceneObjects(
  scene: SceneDocument,
  clipboard: SceneClipboard,
  point: { x: number; y: number },
  uuid: () => string = () => crypto.randomUUID(),
): SceneObjectRef[] {
  const items = [
    ...clipboard.entities.map((entry) => ({ ...entry, width: 1, height: 1 })),
    ...clipboard.triggers,
  ];
  if (!items.length) return [];
  // Keep the entire group inside the scene, including trigger regions.
  if (
    items.some(
      (entry) => entry.x + entry.width > scene.width || entry.y + entry.height > scene.height,
    )
  )
    return [];
  const left = Math.min(...items.map((entry) => entry.x));
  const top = Math.min(...items.map((entry) => entry.y));
  const offset = groupSceneDelta(items, point.x - left, point.y - top, scene.width, scene.height);
  const ids = new Set([
    ...scene.entities.map((entry) => entry.id),
    ...scene.triggers.map((entry) => (typeof entry === 'string' ? entry : entry.id)),
  ]);
  const newId = () => {
    let id: string;
    do {
      id = uuid();
    } while (ids.has(id));
    ids.add(id);
    return id;
  };
  const selected: SceneObjectRef[] = [];
  for (const source of clipboard.entities) {
    const entry = {
      ...structuredClone(source),
      id: newId(),
      x: source.x + offset.x,
      y: source.y + offset.y,
    };
    scene.entities.push(entry);
    selected.push({ kind: 'entity', id: entry.id });
  }
  for (const source of clipboard.triggers) {
    const entry = {
      ...structuredClone(source),
      id: newId(),
      x: source.x + offset.x,
      y: source.y + offset.y,
    };
    scene.triggers.push(entry);
    selected.push({ kind: 'trigger', id: entry.id });
  }
  return selected;
}
