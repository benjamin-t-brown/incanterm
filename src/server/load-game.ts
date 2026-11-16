import { loadSceneByReference } from '../game/load-scene.js';
import { loadRpgScripts } from '../game/rpgscript/index.js';
import { commands } from '../game/scene-commands.js';
import { loadPortraitAssets } from '../game/portrait-assets.js';
import { getProjectSource, type ProjectSourceOptions } from '../project/project.js';
import { loadSessionConfig } from '../project/session-config.js';
import type { DialogueAnimationOptions, PortraitAnimationOptions } from './game-session.js';

export async function loadGame(
  options: ProjectSourceOptions & {
    dialogueAnimation?: DialogueAnimationOptions;
    portraitAnimation?: PortraitAnimationOptions;
    allowPlayerSpawn?: boolean;
  },
) {
  const { assetsRoot, sceneId } = getProjectSource(options);
  const settings = await loadSessionConfig(assetsRoot);
  const scene = await loadSceneByReference(assetsRoot, sceneId);
  const scripts = await loadRpgScripts(assetsRoot, { commands });
  for (const { definition } of scene.itemAssets.values()) {
    for (const name of [definition.examineScript, definition.combineFailScript, ...definition.combinations.map((rule) => rule.script)]) {
      if (name && scripts.get(name)?.parameters.length !== 0)
        throw new Error(`Item ${definition.id} references missing or non-zero-argument RPGScript ${name}`);
    }
  }
  const portraits = await loadPortraitAssets(assetsRoot);
  for (const trigger of [...scene.triggers, ...scene.actionTriggers.map((entry) => entry.trigger)])
    if (!scripts.triggers.has(trigger))
      throw new Error(`Scene ${scene.id} references unknown RPGScript trigger ${trigger}`);
  return {
    scene,
    scripts,
    portraits,
    dialogueAnimation: options.dialogueAnimation ?? settings.dialogueAnimation,
    portraitAnimation: options.portraitAnimation ?? settings.portraitAnimation,
    allowPlayerSpawn: options.allowPlayerSpawn,
    reloadPortraits: () => loadPortraitAssets(assetsRoot),
    loadSceneById: (reference: string) => loadSceneByReference(assetsRoot, reference),
  };
}
