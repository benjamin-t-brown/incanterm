import { describe, expect, it } from 'vitest';
import { addSceneProp } from './scene-props.js';
import { createScene, parseScene } from '../schema.js';

describe('placing existing props', () => {
  it('adds separate scene instances that reference the same reusable prop', () => {
    const scene = createScene('room');
    scene.triggers = ['chair-1'];
    const first = addSceneProp(scene, 'chair', 12, 8);
    const second = addSceneProp(scene, 'chair', 20, 10);
    expect(first).toMatchObject({ id: 'chair-2', name: 'chair-2', prop: 'chair', x: 12, y: 8 });
    expect(second).toMatchObject({ id: 'chair-3', name: 'chair-3', prop: 'chair', x: 20, y: 10 });
    expect(parseScene(scene).ok).toBe(true);
  });
});
