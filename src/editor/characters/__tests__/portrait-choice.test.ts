import { expect, it } from 'vitest';
import { getDefaultPortraitSpriteChoice, getPortraitAssetChoice } from '../portrait-choice.js';

it('preserves the assigned sprite frame for portrait thumbnails and editing', () => {
  expect(getPortraitAssetChoice('face_3', ['face'], [])).toEqual({
    kind: 'sprite',
    id: 'face',
    index: 3,
  });
});

it('prefers an animation whose id looks like a sprite frame', () => {
  expect(getPortraitAssetChoice('face_3', ['face'], ['face_3'])).toEqual({
    kind: 'animation',
    id: 'face_3',
    index: 0,
  });
});

it('keeps unavailable asset ids so their load failure can be displayed', () => {
  expect(getPortraitAssetChoice('missing', [], [])).toEqual({
    kind: 'animation',
    id: 'missing',
    index: 0,
  });
});

it('defaults new portraits to the most recently assigned available spritesheet', () => {
  expect(
    getDefaultPortraitSpriteChoice(
      [
        { portrait: 'old_0' },
        { portrait: 'face_3' },
        { portrait: 'talk' },
        { portrait: 'missing_2' },
      ],
      ['old', 'face'],
      ['talk'],
    ),
  ).toEqual({ kind: 'sprite', id: 'face', index: 3 });
});

it('does not select a spritesheet when no previous sprite portraits are available', () => {
  expect(getDefaultPortraitSpriteChoice([], ['face'], [])).toBeUndefined();
  expect(
    getDefaultPortraitSpriteChoice(
      [{ portrait: 'face_3' }, { portrait: 'missing_2' }],
      ['face'],
      ['face_3'],
    ),
  ).toBeUndefined();
});
