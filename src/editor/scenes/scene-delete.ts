import type { SceneDocument } from '../schema.js';
import type { SceneObjectRef } from './scene-selection.js';

export function removeSelectedSceneObjects(
  scene: SceneDocument,
  selected: SceneObjectRef[],
): SceneObjectRef[] {
  const entityIds = new Set(selected.filter((ref) => ref.kind === 'entity').map((ref) => ref.id));
  const triggerIds = new Set(selected.filter((ref) => ref.kind === 'trigger').map((ref) => ref.id));
  const removed: SceneObjectRef[] = [];
  scene.entities = scene.entities.filter((entry) => {
    if (entry.type === 'Background' || !entityIds.has(entry.id)) return true;
    removed.push({ kind: 'entity', id: entry.id });
    return false;
  });
  scene.triggers = scene.triggers.filter((entry) => {
    const id = typeof entry === 'string' ? entry : entry.id;
    if (!triggerIds.has(id)) return true;
    removed.push({ kind: 'trigger', id });
    return false;
  });
  return removed;
}
