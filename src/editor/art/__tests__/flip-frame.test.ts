import { expect, it } from 'vitest';
import { createSprite, type SpriteCell } from '../../schema.js';
import { applyFrameFlip } from '../flip-frame.js';

function getCell(ch: string): SpriteCell {
  return { ch, fg: 'bright-white', bg: 'black' };
}

it('mirrors glyphs only on horizontal flips and only in the active frame', () => {
  const sprite = createSprite('art', 3, 2);
  const frame = sprite.sprites[0];
  frame.layers[0].cells = [getCell('/'), null, getCell('C'), getCell('D'), getCell('E'), getCell('F')];
  frame.layers.push({
    id: 'layer-2', name: 'Layer 2', visible: false, locked: true,
    cells: [null, getCell('B'), null, getCell('G'), null, getCell('H')],
  });
  sprite.sprites.push({ layers: [{
    id: 'layer-1', name: 'Layer 1', visible: true, locked: false,
    cells: [getCell('X'), null, null, null, null, null],
  }] });
  const original = structuredClone(frame);

  applyFrameFlip(frame, sprite.width, sprite.height, 'horizontal');
  expect(frame.layers[0].cells).toEqual([
    getCell('C'), null, getCell('\\'), getCell('F'), getCell('E'), getCell('D'),
  ]);
  expect(frame.layers[1].cells).toEqual([null, getCell('B'), null, getCell('H'), null, getCell('G')]);
  expect(frame.layers[1]).toMatchObject({ visible: false, locked: true });
  expect(sprite.sprites[1].layers[0].cells[0]).toEqual(getCell('X'));

  applyFrameFlip(frame, sprite.width, sprite.height, 'horizontal');
  expect(frame).toEqual(original);
  applyFrameFlip(frame, sprite.width, sprite.height, 'vertical');
  expect(frame.layers[0].cells).toEqual([
    getCell('D'), getCell('E'), getCell('F'), getCell('/'), null, getCell('C'),
  ]);
  expect(frame.layers[1].cells).toEqual([getCell('G'), null, getCell('H'), null, getCell('B'), null]);
  applyFrameFlip(frame, sprite.width, sprite.height, 'vertical');
  expect(frame).toEqual(original);
});

it('swaps directional glyphs even in the stationary center column', () => {
  const source = '/pqbd()[]{}<>`╔├▌←◄';
  const expected = "\\qpdb)(][}{><'╗┤▐→►";
  const frame = createSprite('column', 1, source.length).sprites[0];
  frame.layers[0].cells = Array.from(source, getCell);
  applyFrameFlip(frame, 1, source.length, 'horizontal');
  expect(frame.layers[0].cells).toEqual(Array.from(expected, getCell));
  applyFrameFlip(frame, 1, source.length, 'horizontal');
  expect(frame.layers[0].cells).toEqual(Array.from(source, getCell));
});
