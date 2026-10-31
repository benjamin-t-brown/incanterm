import { expect, it } from 'vitest';
import { animationsUsingSheet, propVisualEditHref, propVisualSize } from './prop-picker.js';
import { createAnimation, createSprite } from '../schema.js';

it('lists only clips using the chosen sheet and previews their first matching frame', () => {
  const first = createAnimation('first');
  first.frames = [
    { invisible: true, durationMs: 100 },
    { sprite: 'other', index: 0, durationMs: 100 },
    { sprite: 'doors', index: 2, durationMs: 100 },
    { sprite: 'doors', index: 3, durationMs: 100 },
  ];
  const second = createAnimation('second');
  second.frames = [{ sprite: 'doors', index: 1, durationMs: 100 }];
  const unused = createAnimation('unused');
  unused.frames = [{ invisible: true, durationMs: 100 }];

  expect(animationsUsingSheet([first, second, unused], 'doors')).toEqual([
    { animation: first, frame: first.frames[2] },
    { animation: second, frame: second.frames[0] },
  ]);
  expect(animationsUsingSheet([first, second, unused], 'missing')).toEqual([]);
});

it('uses the selected sprite sheet dimensions for a sprite visual', async () => {
  const loadSprite = async (id: string) => createSprite(id, 7, 4);
  const loadAnimation = async () => {
    throw new Error('Animation should not be loaded');
  };
  expect(
    await propVisualSize({ type: 'sprite', id: 'doors', index: 2 }, loadSprite, loadAnimation),
  ).toEqual({ width: 7, height: 4 });
});

it('links to the editor for the selected visual asset', () => {
  expect(propVisualEditHref({ type: 'sprite', id: 'brass-door', index: 2 })).toBe(
    '/art?id=brass-door',
  );
  expect(propVisualEditHref({ type: 'animation', id: 'door-open' })).toBe(
    '/animation?id=door-open',
  );
});

it('uses the first visible animation frame, even if it belongs to a different sheet', async () => {
  const clip = createAnimation('open');
  clip.frames = [
    { invisible: true, durationMs: 100 },
    { sprite: 'first-sheet', index: 1, durationMs: 100 },
    { sprite: 'another-sheet', index: 0, durationMs: 100 },
  ];
  const loaded: string[] = [];
  const loadSprite = async (id: string) => {
    loaded.push(id);
    return createSprite(id, id === 'first-sheet' ? 9 : 2, 5);
  };
  const loadAnimation = async () => clip;
  expect(
    await propVisualSize({ type: 'animation', id: 'open' }, loadSprite, loadAnimation),
  ).toEqual({
    width: 9,
    height: 5,
  });
  expect(loaded).toEqual(['first-sheet']);

  clip.frames = [{ invisible: true, durationMs: 100 }];
  expect(
    await propVisualSize({ type: 'animation', id: 'open' }, loadSprite, loadAnimation),
  ).toBeNull();
});
