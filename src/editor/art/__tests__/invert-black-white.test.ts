import { expect, it } from 'vitest';
import { createSprite } from '../../schema.js';
import { applyBlackWhiteInversionToFrame } from '../invert-black-white.js';

it('toggles black and white colors in the selected frame only', () => {
  const sprite = createSprite('art', 5, 1);
  sprite.sprites[0].layers[0].cells = [
    { ch: 'A', fg: 'white', bg: 'black' },
    { ch: 'B', fg: 'bright-white', bg: 'blue' },
    null,
    { ch: ' ', fg: 'white', bg: 'black' },
    { ch: 'G', fg: 'black', bg: 'bright-white' },
  ];
  sprite.sprites[0].layers.push({
    id: 'layer-2', name: 'Layer 2', visible: false, locked: true,
    cells: [{ ch: 'C', fg: 'red', bg: 'black' }, null, null, null, null],
  });
  sprite.sprites.push({ layers: [{
    id: 'layer-1', name: 'Layer 1', visible: true, locked: false,
    cells: [
      { ch: 'D', fg: 'black', bg: 'white' },
      { ch: 'E', fg: '#ffffff', bg: '#000000' },
      { ch: 'F', fg: 'green', bg: 'black' },
      null,
      null,
    ],
  }] });

  expect(applyBlackWhiteInversionToFrame(sprite.sprites[0])).toBe(6);
  expect(sprite.sprites[0].layers[0].cells).toEqual([
    { ch: 'A', fg: 'black', bg: 'bright-white' },
    { ch: 'B', fg: 'black', bg: 'blue' },
    { ch: ' ', fg: 'black', bg: 'bright-white' },
    { ch: ' ', fg: 'black', bg: 'bright-white' },
    { ch: 'G', fg: 'bright-white', bg: 'black' },
  ]);
  expect(sprite.sprites[0].layers[1].cells[0]).toEqual({ ch: 'C', fg: 'red', bg: 'bright-white' });
  expect(sprite.sprites[1].layers[0].cells).toEqual([
    { ch: 'D', fg: 'black', bg: 'white' },
    { ch: 'E', fg: '#ffffff', bg: '#000000' },
    { ch: 'F', fg: 'green', bg: 'black' },
    null,
    null,
  ]);
  expect(applyBlackWhiteInversionToFrame(sprite.sprites[0])).toBe(6);
  expect(sprite.sprites[0].layers[0].cells).toEqual([
    { ch: 'A', fg: 'bright-white', bg: 'black' },
    { ch: 'B', fg: 'bright-white', bg: 'blue' },
    { ch: ' ', fg: 'bright-white', bg: 'black' },
    { ch: ' ', fg: 'bright-white', bg: 'black' },
    { ch: 'G', fg: 'black', bg: 'bright-white' },
  ]);
  expect(sprite.sprites[0].layers[1].cells[0]).toEqual({ ch: 'C', fg: 'red', bg: 'black' });
});

it('also treats palette white backgrounds as white', () => {
  const sprite = createSprite('art', 1, 1);
  sprite.sprites[0].layers[0].cells[0] = { ch: 'X', fg: 'blue', bg: 'white' };

  expect(applyBlackWhiteInversionToFrame(sprite.sprites[0])).toBe(1);
  expect(sprite.sprites[0].layers[0].cells[0]?.bg).toBe('black');
});
