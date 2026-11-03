import { expect, it } from 'vitest';
import { createCharacter } from '../../schema.js';
import { getNeighborCharacterTab, OPEN_CHARACTERS_KEY, readCharacterTabs } from '../character-tabs.js';

it('restores valid character drafts and ignores mismatched ids', () => {
  const doc = createCharacter('hero', 'idle', 'Hero');
  const store = readCharacterTabs({
    getItem: (key) =>
      key === OPEN_CHARACTERS_KEY
        ? JSON.stringify({
            version: 1,
            tabs: ['hero', 'hero', 'bad id', 'villain'],
            active: 'hero',
            drafts: {
              hero: { doc: { ...doc, label: 'New Hero' }, saved: doc },
              villain: { doc, saved: null },
            },
          })
        : null,
  });
  expect(store.tabs).toEqual(['hero', 'villain']);
  expect(store.active).toBe('hero');
  expect(store.drafts.hero.doc.label).toBe('New Hero');
  expect(store.drafts.villain).toBeUndefined();
});

it('ignores invalid storage and selects an adjacent tab when closing', () => {
  expect(readCharacterTabs({ getItem: () => '{' }).tabs).toEqual([]);
  expect(getNeighborCharacterTab(['one', 'two', 'three'], 'two')).toBe('three');
  expect(getNeighborCharacterTab(['one', 'two'], 'two')).toBe('one');
});
