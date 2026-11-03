import { describe, expect, it } from 'vitest';
import { createScene } from '../../schema.js';
import { removeSelectedSceneObjects } from '../scene-delete.js';

describe('deleting selected scene objects', () => {
  it('removes selected props, characters, and triggers without removing the background', () => {
    const scene = createScene('room');
    scene.entities = [
      { id: 'a', type: 'Prop', prop: 'chair', x: 1, y: 1, z: 0 },
      { id: 'b', type: 'Prop', sprite: 'sheet', x: 2, y: 2, z: 0, depthOffset: 0 },
      { id: 'c', type: 'Prop', prop: 'chair', x: 3, y: 3, z: 0 },
      {
        id: 'hero',
        type: 'Character',
        character: 'hero-asset',
        facing: 'down',
        state: 'idle',
        x: 4,
        y: 4,
        z: 0,
      },
      { id: 'bg', type: 'Background', sprite: 'sheet', index: 0, x: 0, y: 0 },
    ];
    scene.triggers = [
      { id: 'door', trigger: 'open', event: 'action', x: 1, y: 1, width: 1, height: 1 },
      'legacy-trigger',
    ];
    expect(
      removeSelectedSceneObjects(scene, [
        { kind: 'entity', id: 'a' },
        { kind: 'entity', id: 'b' },
        { kind: 'entity', id: 'hero' },
        { kind: 'entity', id: 'bg' },
        { kind: 'trigger', id: 'door' },
        { kind: 'trigger', id: 'legacy-trigger' },
      ]),
    ).toEqual([
      { kind: 'entity', id: 'a' },
      { kind: 'entity', id: 'b' },
      { kind: 'entity', id: 'hero' },
      { kind: 'trigger', id: 'door' },
      { kind: 'trigger', id: 'legacy-trigger' },
    ]);
    expect(scene.entities.map((entry) => entry.id)).toEqual(['c', 'bg']);
    expect(scene.triggers).toEqual([]);
    expect(removeSelectedSceneObjects(scene, [{ kind: 'entity', id: 'missing' }])).toEqual([]);
  });
});
