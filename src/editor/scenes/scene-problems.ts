import type { SlideCell } from '../../game/prop-slide.js';
import { isSceneScriptName, type SceneDocument } from '../schema.js';
import type { SceneObjectRef } from './scene-selection.js';
import { getSlideActionScriptIssue, getSlidePlacementIssues, type SceneProp } from './scene-slide-authoring.js';

export type SceneProblem = {
  message: string;
  target?: SceneObjectRef & { label?: string };
};

type ScriptSources = Readonly<Record<string, readonly string[]>>;
type SceneProblemSources = {
  propIds: ReadonlySet<string>;
  triggers: ScriptSources;
  scripts: ScriptSources;
  footprints: ReadonlyMap<string, readonly SlideCell[] | undefined>;
};

export function getSceneProblems(scene: SceneDocument, sources: SceneProblemSources): SceneProblem[] {
  const problems: SceneProblem[] = [];
  for (const entity of scene.entities) {
    if (entity.type !== 'Prop' && entity.type !== 'Character') continue;
    const target = { kind: 'entity' as const, id: entity.id, label: entity.name };
    if (entity.type === 'Character') {
      if (entity.talkScript && !hasScriptSource(sources.scripts, entity.talkScript))
        problems.push({ target, message: `Talk script @${entity.talkScript} not found.` });
      continue;
    }
    const hasPropAsset = !('prop' in entity) || sources.propIds.has(entity.prop);
    if ('prop' in entity && !hasPropAsset)
      problems.push({ target, message: `Prop asset "${entity.prop}" not found.` });
    const scriptIssue = getPropActionScriptIssue(entity) ?? getSlideActionScriptIssue(entity);
    const script = entity.actionScript ?? entity.slidable?.actionScript;
    if (scriptIssue) problems.push({ target, message: scriptIssue });
    else if (script && !hasScriptSource(sources.scripts, script))
      problems.push({
        target,
        message: `${entity.actionScript ? 'Action' : 'Slide action'} script @${script} not found.`,
      });
    // An absent footprint cache entry means the asset is still being loaded.
    if (entity.slidable && hasPropAsset && (!('prop' in entity) || sources.footprints.has(entity.prop))) {
      for (const issue of getSlidePlacementIssues(scene, entity, sources.footprints))
        problems.push({ target, message: issue });
    }
  }
  for (const entry of scene.triggers) {
    const name = (typeof entry === 'string' ? entry : entry.trigger).trim();
    const target =
      typeof entry === 'string'
        ? undefined
        : { kind: 'trigger' as const, id: entry.id, label: 'Region' };
    if (!name) {
      if (target) problems.push({ target, message: 'Select an RPGTrigger.' });
    } else if (!hasScriptSource(sources.triggers, name)) {
      const message = `RPGTrigger #${name} not found.`;
      problems.push(target ? { target, message } : { message });
    }
  }
  return problems;
}

export function getPropActionScriptIssue(prop: SceneProp): string | undefined {
  if (prop.actionScript !== undefined && !isSceneScriptName(prop.actionScript))
    return 'Enter a valid action script name before saving.';
}

function hasScriptSource(sources: ScriptSources, name: string): boolean {
  return Object.hasOwn(sources, name) && sources[name].length > 0;
}
