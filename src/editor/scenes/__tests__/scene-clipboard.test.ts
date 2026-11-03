import { describe, expect, it } from 'vitest';
import { createScene } from '../../schema.js';
import { copySceneObjects, pasteSceneObjects } from '../scene-clipboard.js';
import { moveSceneGroup } from '../scene-selection.js';

describe('scene prop and trigger clipboard', () => {
  const scene = createScene('room');
  scene.width = 12;
  scene.height = 10;
  scene.entities = [
    { id: 'back', type: 'Background', sprite: 'sheet', index: 1, x: 0, y: 0 },
    { id: 'chair', type: 'Prop', prop: 'chair-asset', x: 2, y: 3, z: 7 },
    {
      id: 'legacy',
      type: 'Prop',
      sprite: 'old-sheet',
      name: 'Old',
      x: 4,
      y: 3,
      z: 2,
      depthOffset: 5,
    },
    {
      id: 'npc',
      type: 'Character',
      character: 'hero',
      facing: 'down',
      state: 'idle-down',
      x: 3,
      y: 3,
      z: 0,
    },
  ];
  scene.triggers = [
    {
      id: 'door',
      trigger: 'open-door',
      event: 'action',
      x: 6,
      y: 4,
      width: 2,
      height: 3,
      actionEnabled: false,
      stepEnabled: true,
      description: 'Exit',
    },
    'legacy-trigger',
  ];

  it('copies a mixed selection with every property except new ids, then selects movable copies', () => {
    const target = structuredClone(scene);
    const copied = copySceneObjects(target, [
      { kind: 'entity', id: 'back' },
      { kind: 'entity', id: 'chair' },
      { kind: 'entity', id: 'legacy' },
      { kind: 'entity', id: 'npc' },
      { kind: 'trigger', id: 'door' },
      { kind: 'trigger', id: 'legacy-trigger' },
    ]);
    expect(copied.entities).toHaveLength(2);
    expect(copied.triggers).toHaveLength(1);
    target.entities[1].x = 10;
    const refs = pasteSceneObjects(
      target,
      copied,
      { x: 3, y: 4 },
      (() => {
        const ids = ['new-chair', 'new-legacy', 'new-door'];
        return () => ids.shift()!;
      })(),
    );
    expect(refs).toEqual([
      { kind: 'entity', id: 'new-chair' },
      { kind: 'entity', id: 'new-legacy' },
      { kind: 'trigger', id: 'new-door' },
    ]);
    expect(target.entities.slice(-2)).toEqual([
      { id: 'new-chair', type: 'Prop', prop: 'chair-asset', name: 'chair', x: 3, y: 4, z: 7 },
      {
        id: 'new-legacy',
        type: 'Prop',
        sprite: 'old-sheet',
        name: 'Old',
        x: 5,
        y: 4,
        z: 2,
        depthOffset: 5,
      },
    ]);
    expect(target.triggers.at(-1)).toEqual({
      id: 'new-door',
      trigger: 'open-door',
      event: 'action',
      x: 7,
      y: 5,
      width: 2,
      height: 3,
      actionEnabled: false,
      stepEnabled: true,
      description: 'Exit',
    });
    expect(copied.entities[0].x).toBe(2);
    expect(target.entities[1]).not.toHaveProperty('name');
    expect(
      moveSceneGroup(
        target,
        [
          { ref: refs[0], x: 3, y: 4, width: 1, height: 1 },
          { ref: refs[1], x: 5, y: 4, width: 1, height: 1 },
          { ref: refs[2], x: 7, y: 5, width: 2, height: 3 },
        ],
        -1,
        0,
      ),
    ).toBe(true);
    expect(target.entities.at(-2)?.x).toBe(2);
    expect(target.triggers.at(-1)).toMatchObject({ x: 6, y: 5 });
  });

  it('keeps the group within the scene and permits repeated paste with distinct ids', () => {
    const target = structuredClone(scene);
    const copied = copySceneObjects(target, [{ kind: 'trigger', id: 'door' }]);
    const refs = pasteSceneObjects(target, copied, { x: 7, y: 5 }, () => 'new-door');
    expect(refs).toEqual([{ kind: 'trigger', id: 'new-door' }]);
    expect(pasteSceneObjects(target, copied, { x: 7, y: 5 }, () => 'another-door')).toEqual([
      { kind: 'trigger', id: 'another-door' },
    ]);
    target.width = 7;
    expect(pasteSceneObjects(target, copied, { x: 6, y: 5 })).toEqual([]);
    expect(target.triggers).toHaveLength(4);
  });

  it('anchors a multi-object group to the mouse and clamps the whole group at scene edges', () => {
    const target = structuredClone(scene);
    const copied = copySceneObjects(target, [
      { kind: 'entity', id: 'chair' },
      { kind: 'trigger', id: 'door' },
    ]);
    pasteSceneObjects(
      target,
      copied,
      { x: 11, y: 9 },
      (() => {
        const ids = ['edge-chair', 'edge-door'];
        return () => ids.shift()!;
      })(),
    );
    expect(target.entities.at(-1)).toMatchObject({ id: 'edge-chair', x: 6, y: 6 });
    expect(target.triggers.at(-1)).toMatchObject({
      id: 'edge-door',
      x: 10,
      y: 7,
      width: 2,
      height: 3,
    });
  });
});
