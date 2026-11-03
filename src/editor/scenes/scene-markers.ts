import type { SceneDocument, SceneEntity } from '../schema.js';

type Marker = Extract<SceneEntity, { type: 'Marker' }>;

export function getMarkerNameError(scene: SceneDocument, name: string, exceptId?: string): string | null {
  if (!/^[A-Za-z_][\w-]*$/.test(name) || name.length > 80)
    return 'Marker name must start with a letter or underscore and contain at most 80 letters, numbers, underscores or hyphens';
  if (scene.entities.some((entry) => entry.type === 'Marker' && entry.id !== exceptId && entry.name === name))
    return `Marker name ${name} is already in use`;
  return null;
}

export function addSceneMarker(scene: SceneDocument, name: string, x: number, y: number): Marker {
  const error = getMarkerNameError(scene, name);
  if (error) throw new Error(error);
  const ids = new Set([...scene.entities.map((entry) => entry.id), ...scene.triggers.map((entry) => typeof entry === 'string' ? entry : entry.id)]);
  let number = 1;
  while (ids.has(`marker-${number}`)) number++;
  const marker: Marker = {
    id: `marker-${number}`, type: 'Marker', name,
    x: Math.max(0, Math.min(scene.width - 1, x)),
    y: Math.max(0, Math.min(scene.height - 1, y)),
  };
  scene.entities.push(marker);
  return marker;
}

export function getAvailableMarkerName(scene: SceneDocument, name: string): string {
  let number = 2;
  let candidate = name;
  while (getMarkerNameError(scene, candidate)) {
    const suffix = `-${number++}`;
    candidate = `${name.slice(0, 80 - suffix.length)}${suffix}`;
  }
  return candidate;
}
