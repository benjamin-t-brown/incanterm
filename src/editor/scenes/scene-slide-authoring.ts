import { getSceneSlideSetup, getSlidePath, type SlideCell, type SlideDirection } from '../../game/prop-slide.js';
import type { SceneDocument, SceneEntity } from '../schema.js';
import { paintSceneBlockedCells } from './scene-blocked-cells.js';

export type SceneProp = Extract<SceneEntity, { type: 'Prop' }>;
export type ScenePaintTarget = { kind: 'walking' } | { kind: 'travel' };
type AssetFootprints = ReadonlyMap<string, readonly SlideCell[] | undefined>;

export function ensurePropTravel(scene: SceneDocument) {
  scene.propSlide ??= {
    travelCells: [],
    directions: {
      left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
      up: { x: -1, y: -1 }, down: { x: 1, y: 1 },
    },
  };
  return scene.propSlide;
}

export function getPlacedFootprint(prop: SceneProp, assets?: AssetFootprints) {
  return ('prop' in prop ? assets?.get(prop.prop) : undefined) ?? prop.slidable?.footprint ?? [];
}

export function hasScenePaintCell(scene: SceneDocument, target: ScenePaintTarget, point: SlideCell) {
  const index = point.y * scene.width + point.x;
  if (target.kind === 'walking') return scene.blockedCells.includes(index);
  return scene.propSlide?.travelCells.includes(index) ?? false;
}

export function paintSceneMask(scene: SceneDocument, target: ScenePaintTarget, from: SlideCell, to: SlideCell, add: boolean) {
  if (target.kind === 'walking') {
    scene.blockedCells = paintSceneBlockedCells(scene.blockedCells, scene.width, from, to, add);
  } else {
    const area = ensurePropTravel(scene);
    scene.propSlide = { ...area, travelCells: paintSceneBlockedCells(area.travelCells, scene.width, from, to, add) };
  }
}

export function getSlidePlacementIssues(scene: SceneDocument, prop: SceneProp, assets?: AssetFootprints): string[] {
  if (!prop.slidable) return [];
  const issues = new Set<string>();
  const footprint = getPlacedFootprint(prop, assets);
  if (!footprint.length) issues.add('Paint a slide footprint on the asset in the Prop editor.');
  const travel = new Set(scene.propSlide?.travelCells);
  const cells = new Set<string>();
  for (const offset of footprint) {
    const x = prop.x + offset.x;
    const y = prop.y + offset.y;
    cells.add(`${x},${y}`);
    if (x < 0 || x >= scene.width || y < 0 || y >= scene.height || !travel.has(y * scene.width + x))
      issues.add(`Starts outside prop travel at (${x}, ${y}).`);
  }
  for (const other of scene.entities) {
    if (other.type !== 'Prop' || other.id === prop.id || !other.slidable) continue;
    for (const offset of getPlacedFootprint(other, assets)) {
      const x = other.x + offset.x;
      const y = other.y + offset.y;
      if (cells.has(`${x},${y}`)) issues.add(`Overlaps ${other.id} at (${x}, ${y}).`);
    }
  }
  return [...issues];
}

export function getSceneSlidePreview(scene: SceneDocument, id: string, direction: SlideDirection, assets?: AssetFootprints) {
  const footprints = new Map(scene.entities.flatMap(e => e.type === 'Prop' && e.slidable ? [[e.id, getPlacedFootprint(e, assets)] as const] : []));
  const setup = getSceneSlideSetup(scene, footprints);
  return setup && getSlidePath(setup.board, setup.positions, id, direction);
}

export function getSlideAuthoringIssues(scene: SceneDocument, prop: SceneProp, assets?: AssetFootprints) {
  const issues = getSlidePlacementIssues(scene, prop, assets);
  if (prop.slidable && !/^[A-Za-z_][\w-]*$/.test(prop.slidable.actionScript))
    issues.push('Enter a valid slide action script name before saving.');
  return issues;
}
