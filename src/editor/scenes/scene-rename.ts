import { getSpriteLabelError, type SceneDocument } from '../schema.js';

export function renameScene(scene: SceneDocument, label: string): void {
  const error = getSpriteLabelError(label);
  if (error) throw new Error(error.replace('Sprite', 'Scene'));
  scene.label = label.trim();
}
