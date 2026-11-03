import { expect, it } from 'vitest';
import { generateCharacter3x3 } from '../character-generator.js';
import { parseSprite } from '../../schema.js';

it('generates every test3x3 frame with independent shirt and hair options', () => {
  const withHair = generateCharacter3x3('hero', 'Hero', 'bright-blue', 'H', true);
  const withoutHair = generateCharacter3x3('other', 'Other', 'red', 'X', false);
  expect(parseSprite(withHair).ok).toBe(true);
  expect(withHair).toMatchObject({
    id: 'hero',
    label: 'Hero',
    width: 3,
    height: 3,
    font: 'consolas',
  });
  expect(withHair.sprites).toHaveLength(22);
  expect(withHair.sprites[0].layers[0].cells[4]).toEqual({
    ch: 'H',
    fg: 'bright-white',
    bg: 'bright-blue',
  });
  expect(withoutHair.sprites[0].layers[0].cells[4]).toEqual({
    ch: 'X',
    fg: 'bright-white',
    bg: 'red',
  });
  expect(withoutHair.sprites[6].layers[0].cells[4]).toEqual({ ch: ' ', fg: 'white', bg: 'red' });
  expect(withHair.sprites[4].layers[0].cells[0]?.ch).toBe(';');
  expect(withoutHair.sprites[4].layers[0].cells[0]).toBeNull();
  expect(withHair.sprites[10].layers[0].cells[2]?.ch).toBe(';');
  expect(withoutHair.sprites[10].layers[0].cells[2]).toBeNull();
  expect(withoutHair.sprites[6].layers[0].cells[3]?.ch).toBe('.');
  expect(withHair.sprites[0].layers[0].cells[4]?.ch).toBe('H');
  expect(withoutHair.sprites[2].layers[0].cells[3]?.ch).toBe('.');
  expect(withoutHair.sprites[4].layers[0].cells[5]?.ch).toBe('.');
  expect(withoutHair.sprites[8].layers[0].cells[4]).toEqual({ ch: ' ', fg: 'white', bg: 'red' });
  expect(withoutHair.sprites[9].layers[0].cells[7]?.ch).toBe('|');
  expect(withoutHair.sprites[11].layers[0].cells[8]).toEqual({ ch: ' ', fg: 'white', bg: 'black' });
  expect(withoutHair.sprites[21].layers[0].cells[3]?.ch).toBe(',');
  expect(withoutHair.sprites[21].layers[0].cells[6]?.ch).toBe('┘');
  const custom = generateCharacter3x3('custom', 'Custom', '#aBcDeF', 'Z', false);
  expect(custom.sprites[0].layers[0].cells[4]?.bg).toBe('#abcdef');
  expect(parseSprite(custom).ok).toBe(true);
  const customLetter = generateCharacter3x3('letter', 'Letter', 'blue', 'Z', true, '#aBcDeF');
  expect(customLetter.sprites[0].layers[0].cells[4]).toEqual({
    ch: 'Z',
    fg: '#abcdef',
    bg: 'blue',
  });
  expect(customLetter.sprites[0].layers[0].cells[3]?.fg).toBe('bright-white');
  expect(customLetter.sprites[6].layers[0].cells[4]?.fg).toBe('white');
});

it('matches the ada3x3 hair glyphs in every frame', () => {
  const withHair = generateCharacter3x3('hair', 'Hair', 'yellow', 'H', true);
  const withoutHair = generateCharacter3x3('plain', 'Plain', 'yellow', 'H', false);
  const headFrames = new Set([2, 4, 10, 11, 12, 13, 14, 15, 16, 17, 21]);
  const sideCells = new Map([
    [2, 2], [3, 2], [4, 0], [5, 0], [10, 2], [11, 2],
    [12, 0], [13, 0], [16, 2], [17, 0], [21, 2],
  ]);
  withHair.sprites.forEach((frame, index) => {
    const cells = frame.layers[0].cells;
    const plain = withoutHair.sprites[index].layers[0].cells;
    expect(cells[1]?.ch, `frame ${index} head`).toBe(
      headFrames.has(index) ? 'o' : plain[1]?.ch,
    );
    expect(plain[1]?.ch === ';', `frame ${index} without hair`).toBe(false);
    for (const position of [0, 2]) {
      expect(cells[position], `frame ${index} side ${position}`).toEqual(
        sideCells.get(index) === position
          ? { ch: ';', fg: 'bright-white', bg: 'black' }
          : plain[position],
      );
    }
  });
});

it('validates generator inputs', () => {
  expect(() => generateCharacter3x3('hero', '', 'red', 'H', true)).toThrow();
  expect(() => generateCharacter3x3('hero', 'Hero', 'not-a-color', 'H', true)).toThrow();
  expect(() => generateCharacter3x3('hero', 'Hero', 'red', 'HH', true)).toThrow();
  expect(() => generateCharacter3x3('hero', 'Hero', 'red', 'H', true, '#oops')).toThrow();
});
