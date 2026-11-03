import { expect, it } from 'vitest';
import { filterSprites } from '../sprite-search.js';

it('filters the sprite column by label or id without changing file order', () => {
  const files = ['char-1', 'bg-room', 'char-2'];
  const labels = new Map([
    ['char-1', 'Hero'],
    ['bg-room', 'Classroom'],
    ['char-2', 'Villain'],
  ]);
  expect(filterSprites(files, labels, '  ROOm ')).toEqual(['bg-room']);
  expect(filterSprites(files, labels, 'CHAR')).toEqual(['char-1', 'char-2']);
  expect(filterSprites(files, labels, '')).toEqual(files);
});
