import { describe, expect, it } from 'vitest';
import { setSceneBackground } from '../scene-background.js';
import { createScene, parseScene } from '../../schema.js';

describe('scene background', () => {
  it('adds one scene-owned background and replaces its sprite without moving it', () => {
    const scene = createScene('room');
    scene.triggers = ['background-1'];
    const background = setSceneBackground(scene, 'walls', 0);
    expect(background.id).toBe('background-2');
    background.x = 12;
    background.y = 8;
    const replacement = setSceneBackground(scene, 'other-walls', 1);
    expect(replacement).toBe(background);
    expect(scene.entities).toEqual([
      { id: 'background-2', type: 'Background', sprite: 'other-walls', index: 1, x: 12, y: 8 },
    ]);
    expect(parseScene(scene).ok).toBe(true);
  });
});
