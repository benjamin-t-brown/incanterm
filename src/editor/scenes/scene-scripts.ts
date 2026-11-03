import type { SceneDocument } from '../schema.js';

export type SceneScriptReference = { trigger: string; script: string | null };

export function getSceneScriptReferences(
  scene: SceneDocument,
  sources: Readonly<Record<string, readonly string[]>>,
): SceneScriptReference[] {
  return scene.triggers.flatMap<SceneScriptReference>((entry) => {
    const trigger = typeof entry === 'string' ? entry : entry.trigger.trim();
    if (!trigger) return [];
    const files = Object.hasOwn(sources, trigger) ? sources[trigger] : undefined;
    return files?.length
      ? files.map((script) => ({ trigger, script }))
      : [{ trigger, script: null }];
  });
}
