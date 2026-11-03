import { describe, expect, it } from 'vitest';
import { createProp } from '../../schema.js';
import { paintSceneBlockedCells, getPropBlockedSceneCells } from '../scene-blocked-cells.js';

it('paints and erases continuous scene-cell strokes', () => {
  expect(paintSceneBlockedCells([], 5, { x: 0, y: 0 }, { x: 4, y: 2 }, true)).toEqual([
    0, 1, 7, 8, 14,
  ]);
  expect(
    paintSceneBlockedCells([0, 1, 7, 8, 14], 5, { x: 1, y: 0 }, { x: 3, y: 1 }, false),
  ).toEqual([0, 7, 14]);
});

describe('scene blocked-cell overlay', () => {
  it('positions the prop footprint at the sprite origin and clips cells outside the scene', () => {
    const prop = createProp('desk', { type: 'sprite', id: 'desk-sheet', index: 0 });
    prop.width = 3;
    prop.height = 2;
    prop.blockedCells = [0, 2, 3, 5];
    const entry = { id: 'desk-1', type: 'Prop' as const, prop: 'desk', x: 1, y: 1, z: 0 };
    expect(
      getPropBlockedSceneCells(entry, prop, { originX: 1, originY: 1 }, { width: 3, height: 2 }),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(
      getPropBlockedSceneCells(entry, prop, { originX: 2, originY: 1 }, { width: 3, height: 2 }),
    ).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it('does not highlight cells for a non-blocking prop', () => {
    const prop = createProp('rug', { type: 'sprite', id: 'rug-sheet', index: 0 });
    expect(
      getPropBlockedSceneCells(
        { id: 'rug-1', type: 'Prop', prop: 'rug', x: 2, y: 3, z: 0 },
        prop,
        { originX: 0, originY: 0 },
        { width: 10, height: 10 },
      ),
    ).toEqual([]);
  });
});
