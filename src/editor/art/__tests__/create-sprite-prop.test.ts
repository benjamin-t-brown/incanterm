import { expect, it } from 'vitest';
import { createSpriteProp } from '../create-sprite-prop.js';
import { createEmptySpriteFrame, createSprite, parseProp } from '../../schema.js';

it('creates a labeled prop referencing the selected sheet and frame with its full dimensions', () => {
  const sprite = createSprite('test-sheet', 6, 3, 'Test sheet');
  sprite.sprites.push(createEmptySpriteFrame(6, 3), createEmptySpriteFrame(6, 3));
  const before = structuredClone(sprite);
  const prop = createSpriteProp('test-prop', '  Wooden crate  ', sprite, 2);

  expect(prop).toEqual({
    format: 'incanterm-prop',
    version: 1,
    id: 'test-prop',
    label: 'Wooden crate',
    visual: { type: 'sprite', id: 'test-sheet', index: 2 },
    width: 6,
    height: 3,
    blockedCells: [],
    groundOffsetY: 0,
    depthOffset: 0,
    foreground: false,
    customAnimations: {},
  });
  expect(parseProp(prop)).toEqual({ ok: true, value: prop });
  expect(sprite).toEqual(before);
});

it.each([-1, 1, 0.5, Number.NaN])('rejects a missing or invalid frame (%s)', (index) => {
  expect(() =>
    createSpriteProp('test-prop', 'Crate', createSprite('test-sheet', 1, 1), index),
  ).toThrow('Select an existing sprite frame');
});

it.each(['', '   ', 'a'.repeat(81), 'Bad\nlabel'])(
  'rejects an invalid prop label (%j)',
  (label) => {
    expect(() => createSpriteProp('test-prop', label, createSprite('test-sheet', 1, 1), 0)).toThrow(
      'Prop label',
    );
  },
);
