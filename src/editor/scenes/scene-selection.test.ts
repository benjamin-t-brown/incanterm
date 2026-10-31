import { describe, expect, it } from 'vitest';
import {
  boxesInSceneRect,
  canSelectSceneObject,
  groupSceneDelta,
  selectableSceneObjects,
} from './scene-selection.js';
import { createScene } from '../schema.js';

describe('scene selection modes', () => {
  const scene = createScene('room');
  scene.entities = [
    { id: 'background-1', type: 'Background', sprite: 'tiles', index: 0, x: 0, y: 0 },
    { id: 'chair', type: 'Prop', prop: 'chair', x: 2, y: 3, z: 0 },
  ];
  scene.triggers = [
    { id: 'door', trigger: 'doorClick', event: 'action', x: 1, y: 1, width: 1, height: 1 },
  ];

  it('locks the background during normal scene editing', () => {
    expect(canSelectSceneObject(scene, { kind: 'entity', id: 'background-1' }, false)).toBe(false);
    expect(canSelectSceneObject(scene, { kind: 'entity', id: 'chair' }, false)).toBe(true);
    expect(canSelectSceneObject(scene, { kind: 'trigger', id: 'door' }, false)).toBe(true);
  });

  it('allows only the background during background editing', () => {
    expect(canSelectSceneObject(scene, { kind: 'entity', id: 'background-1' }, true)).toBe(true);
    expect(canSelectSceneObject(scene, { kind: 'entity', id: 'chair' }, true)).toBe(false);
    expect(canSelectSceneObject(scene, { kind: 'trigger', id: 'door' }, true)).toBe(false);
    expect(canSelectSceneObject(scene, { kind: 'entity', id: 'missing' }, true)).toBe(false);
  });

  it('selects all props and triggers in normal mode, only background in background mode', () => {
    expect(selectableSceneObjects(scene, false)).toEqual([
      { kind: 'entity', id: 'chair' },
      { kind: 'trigger', id: 'door' },
    ]);
    expect(selectableSceneObjects(scene, true)).toEqual([{ kind: 'entity', id: 'background-1' }]);
  });

  it('box-selects intersecting footprints regardless of drag direction', () => {
    const boxes = [
      { ref: { kind: 'entity' as const, id: 'chair' }, x: 2, y: 3, width: 3, height: 2 },
      { ref: { kind: 'trigger' as const, id: 'door' }, x: 8, y: 8, width: 1, height: 1 },
    ];
    expect(boxesInSceneRect(boxes, 6, 6, 4, 4)).toEqual([{ kind: 'entity', id: 'chair' }]);
    expect(boxesInSceneRect(boxes, 0, 0, 2, 3)).toEqual([]);
  });

  it('clamps the entire group to scene bounds while retaining spacing', () => {
    const items = [
      { x: 2, y: 3, width: 1, height: 1 },
      { x: 7, y: 5, width: 2, height: 3 },
    ];
    expect(groupSceneDelta(items, 10, 10, 10, 10)).toEqual({ x: 1, y: 2 });
    expect(groupSceneDelta(items, -10, -10, 10, 10)).toEqual({ x: -2, y: -3 });
  });
});
