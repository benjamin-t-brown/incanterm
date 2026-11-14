import { expect, it } from 'vitest';
import { parseSprite } from '../../schema.js';
import { generateCharacter5x5 } from '../character-generator.js';

it('generates sixteen distinct 5x5 frames with valid layers and transparent cells', () => {
  const sprite = generateCharacter5x5('hero', ' Hero ', 'red', 'H', true);
  expect(parseSprite(sprite).ok).toBe(true);
  expect(sprite).toMatchObject({
    id: 'hero',
    label: 'Hero',
    width: 5,
    height: 5,
    originX: 0,
    originY: 0,
    font: 'consolas',
  });
  expect(sprite.sprites).toHaveLength(16);
  expect(new Set(sprite.sprites.map((frame) => JSON.stringify(frame))).size).toBe(16);
  for (const frame of sprite.sprites) {
    expect(frame.layers).toHaveLength(1);
    expect(frame.layers[0]).toMatchObject({ id: 'layer-1', visible: true, locked: false });
    expect(frame.layers[0].cells).toHaveLength(25);
    expect(frame.layers[0].cells).toContain(null);
    expect(frame.layers[0].cells.some((cell) => cell?.bg === 'red')).toBe(true);
  }
  expect(sprite.sprites[0].layers[0].cells[12]).toEqual({ ch: 'H', fg: 'bright-white', bg: 'red' });
});

it('customizes every shirt cell without changing hair, expressions, or other glyphs', () => {
  const template = generateCharacter5x5('baseline', 'Baseline', 'red', 'A', true);
  const sprite = generateCharacter5x5('hero', 'Hero', '#aBcDeF', 'H', true, '#FeDcBa');
  expect(parseSprite(sprite).ok).toBe(true);
  template.sprites.forEach((frame, index) => {
    frame.layers[0].cells.forEach((cell, position) => {
      const expected =
        cell && cell.bg === 'red'
          ? { ...cell, bg: '#abcdef', ...(cell.ch === 'A' ? { ch: 'H', fg: '#fedcba' } : {}) }
          : cell;
      expect(
        sprite.sprites[index].layers[0].cells[position],
        `frame ${index}, cell ${position}`,
      ).toEqual(expected);
    });
  });
  expect(sprite.sprites[0].layers[0].cells[12]).toEqual({ ch: 'H', fg: '#fedcba', bg: '#abcdef' });
  expect(sprite.sprites[2].layers[0].cells[12]).toEqual({
    ch: '/',
    fg: 'bright-white',
    bg: '#abcdef',
  });
  expect(sprite.sprites[4].layers[0].cells[12]).toEqual({
    ch: '\\',
    fg: 'bright-white',
    bg: '#abcdef',
  });
  expect(sprite.sprites[6].layers[0].cells[12]).toEqual({ ch: ' ', fg: 'white', bg: '#abcdef' });
});

it('removes hair while keeping the head outline and all non-hair cells', () => {
  const withHair = generateCharacter5x5('hair', 'Hair', 'blue', 'H', true);
  const plain = generateCharacter5x5('plain', 'Plain', 'blue', 'H', false);
  expect(parseSprite(plain).ok).toBe(true);
  withHair.sprites.forEach((frame, index) => {
    frame.layers[0].cells.forEach((cell, position) => {
      const actual = plain.sprites[index].layers[0].cells[position];
      if (cell?.fg === 'yellow') {
        expect(actual?.fg).toBe('bright-white');
        expect(['╭', '─', '╮', '╰', '╯']).toContain(actual?.ch);
      } else {
        expect(actual).toEqual(cell);
      }
    });
  });
});

it('keeps generated frames and sheets independent', () => {
  const first = generateCharacter5x5('first', 'First', 'red', 'A', true);
  const second = generateCharacter5x5('second', 'Second', 'blue', 'B', true);
  const cell = first.sprites[0].layers[0].cells[1];
  if (!cell) throw new Error('Missing head cell');
  cell.ch = 'X';
  expect(first.sprites[1].layers[0].cells[1]?.ch).toBe('╭');
  expect(second.sprites[0].layers[0].cells[1]?.ch).toBe('╭');
});

it('validates the same inputs as the 3x3 generator', () => {
  expect(() => generateCharacter5x5('hero', '', 'red', 'H', true)).toThrow();
  expect(() => generateCharacter5x5('hero', 'Hero', 'not-a-color', 'H', true)).toThrow();
  expect(() => generateCharacter5x5('hero', 'Hero', 'red', 'HH', true)).toThrow();
  expect(() => generateCharacter5x5('hero', 'Hero', 'red', ' ', true)).toThrow();
  expect(() => generateCharacter5x5('hero', 'Hero', 'red', 'H', true, '#oops')).toThrow();
});
