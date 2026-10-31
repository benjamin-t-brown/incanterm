import { describe, expect, it } from 'vitest';
import { createScene, isAssetId } from '../schema.js';
import { newSceneTrigger, resizeTrigger, triggerRegion } from './scene-triggers.js';

describe('scene trigger regions', () => {
  it('draws in either direction, inclusive of the starting cell and clipped to the scene', () => {
    expect(triggerRegion(8, 6, 3, 2, 10, 8)).toEqual({ x: 3, y: 2, width: 6, height: 5 });
    expect(triggerRegion(8, 6, 50, -5, 10, 8)).toEqual({ x: 8, y: 0, width: 2, height: 7 });
    expect(triggerRegion(4, 3, 4, 3, 10, 8)).toEqual({ x: 4, y: 3, width: 1, height: 1 });
  });

  it('resizes edges and corners without collapsing or leaving the scene', () => {
    const box = { x: 3, y: 2, width: 4, height: 3 };
    expect(resizeTrigger(box, 'nw', 1, 0, 10, 8)).toEqual({ x: 1, y: 0, width: 6, height: 5 });
    expect(resizeTrigger(box, 'e', 99, 0, 10, 8)).toEqual({ x: 3, y: 2, width: 7, height: 3 });
    expect(resizeTrigger(box, 'w', 99, 0, 10, 8)).toEqual({ x: 6, y: 2, width: 1, height: 3 });
    expect(resizeTrigger(box, 's', 0, -99, 10, 8)).toEqual({ x: 3, y: 2, width: 4, height: 1 });
  });

  it('generates unique schema-compatible IDs and defaults to Action only', () => {
    const scene = createScene('room');
    const first = newSceneTrigger(scene, { x: 2, y: 3, width: 4, height: 5 });
    const second = newSceneTrigger(scene, { x: 0, y: 0, width: 1, height: 1 });
    expect(isAssetId(first.id)).toBe(true);
    expect(second.id).not.toBe(first.id);
    expect(first).toMatchObject({
      trigger: '',
      actionEnabled: true,
      stepEnabled: false,
      description: '',
    });
  });
});
