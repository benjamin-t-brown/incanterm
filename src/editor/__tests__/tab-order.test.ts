import { expect, it } from 'vitest';
import { parseArtTabStore } from '../art/art-tabs.js';
import { readCharacterTabs } from '../characters/character-tabs.js';
import { readPropTabs } from '../props/prop-tabs.js';
import { readSceneTabs } from '../scenes/scene-tabs.js';
import { addOpenTab, moveOpenTab } from '../tab-order.js';

it('opens new tabs on the left without alphabetizing or moving existing tabs', () => {
  const first = addOpenTab([], 'zebra');
  const second = addOpenTab(first, 'alpha');
  const third = addOpenTab(second, 'middle');
  expect(third).toEqual(['middle', 'alpha', 'zebra']);
  expect(addOpenTab(third, 'zebra')).toEqual(third);
  expect(addOpenTab(third, '../invalid')).toEqual(third);
  expect(first).toEqual(['zebra']);
  expect(second).toEqual(['alpha', 'zebra']);
});

it.each([
  { id: 'c', target: 'a', side: 'before', expected: ['c', 'a', 'b', 'd'] },
  { id: 'a', target: 'c', side: 'after', expected: ['b', 'c', 'a', 'd'] },
  { id: 'b', target: 'd', side: 'after', expected: ['a', 'c', 'd', 'b'] },
  { id: 'd', target: 'b', side: 'before', expected: ['a', 'd', 'b', 'c'] },
  { id: 'a', target: 'b', side: 'before', expected: ['a', 'b', 'c', 'd'] },
] as const)('moves $id $side $target', ({ id, target, side, expected }) => {
  const tabs = ['a', 'b', 'c', 'd'];
  expect(moveOpenTab(tabs, id, target, side)).toEqual(expected);
  expect(tabs).toEqual(['a', 'b', 'c', 'd']);
});

it.each([
  ['a', 'a'],
  ['missing', 'a'],
  ['a', 'missing'],
])('ignores invalid tab moves from %s to %s', (id, target) => {
  expect(moveOpenTab(['a', 'b'], id, target, 'before')).toEqual(['a', 'b']);
  expect(moveOpenTab([], id, target, 'after')).toEqual([]);
});

it.each(['sprites', 'scenes', 'props', 'characters'] as const)(
  'restores a custom %s tab order without sorting it or changing the active tab',
  (kind) => {
    const tabs = moveOpenTab(['alpha', 'middle', 'zebra'], 'zebra', 'alpha', 'before');
    const value = { version: 1, tabs, active: 'middle', drafts: {}, sessions: {} };
    const storage = { getItem: () => JSON.stringify(value) };
    const readTabs = {
      sprites: () => parseArtTabStore(JSON.parse(storage.getItem())),
      scenes: () => readSceneTabs(storage),
      props: () => readPropTabs(storage),
      characters: () => readCharacterTabs(storage),
    };
    const restored = readTabs[kind]();
    expect(restored.tabs).toEqual(['zebra', 'alpha', 'middle']);
    expect(restored.active).toBe('middle');
  },
);
