import { expect, it } from 'vitest';
import { createProp } from '../schema.js';
import { neighborPropTab, OPEN_PROPS_KEY, readPropTabs } from './prop-tabs.js';

it('restores validated tabs and unsaved prop drafts', () => {
  const doc = createProp('crate', { type: 'sprite', id: 'crate-art', index: 0 });
  const store = readPropTabs({
    getItem: (key) =>
      key === OPEN_PROPS_KEY
        ? JSON.stringify({
            version: 1,
            tabs: ['crate', 'crate', 'bad id', 'desk'],
            active: 'crate',
            drafts: {
              crate: { doc: { ...doc, blockedCells: [0] }, saved: doc },
              desk: { doc: { ...doc, id: 'crate' }, saved: null },
            },
          })
        : null,
  });
  expect(store.tabs).toEqual(['crate', 'desk']);
  expect(store.active).toBe('crate');
  expect(store.drafts.crate.doc.blockedCells).toEqual([0]);
  expect(store.drafts.desk).toBeUndefined();
});

it('rejects malformed storage and chooses an adjacent tab on close', () => {
  expect(readPropTabs({ getItem: () => '{' }).tabs).toEqual([]);
  expect(neighborPropTab(['a', 'b', 'c'], 'b')).toBe('c');
  expect(neighborPropTab(['a', 'b'], 'b')).toBe('a');
});
