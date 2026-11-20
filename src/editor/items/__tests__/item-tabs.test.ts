import { expect, it } from 'vitest';
import { createItem } from '../item-schema.js';
import { OPEN_ITEMS_KEY, readItemTabs } from '../item-tabs.js';

it('restores incomplete combination drafts and pending folders independently from their baselines', () => {
  const base = createItem('key', { type: 'sprite', id: 'art', index: 0 }, 'Key');
  const doc = { ...base, combinations: [{ targetType: 'prop', target: '', script: '' }] };
  const store = {
    version: 1,
    tabs: ['key', 'key', '../bad'],
    active: 'key',
    drafts: { key: { doc, base, folder: 'Tools' } },
  };
  const restored = readItemTabs({
    getItem: (key) => (key === OPEN_ITEMS_KEY ? JSON.stringify(store) : null),
  });
  expect(restored.tabs).toEqual(['key']);
  expect(restored.active).toBe('key');
  expect(restored.drafts.key).toEqual({ doc, base, folder: 'Tools' });
});

it('ignores corrupt storage and mismatched item IDs', () => {
  expect(readItemTabs({ getItem: () => '{' }).tabs).toEqual([]);
  const doc = createItem('other', { type: 'sprite', id: 'art', index: 0 });
  const restored = readItemTabs({
    getItem: () =>
      JSON.stringify({
        version: 1,
        tabs: ['key'],
        active: 'missing',
        drafts: { key: { doc, base: null } },
      }),
  });
  expect(restored.active).toBeNull();
  expect(restored.drafts).toEqual({});
});

it('keeps half-entered labels and script hooks so a reload does not lose work', () => {
  const base = createItem('key', { type: 'sprite', id: 'art', index: 0 }, 'Brass key');
  const doc = { ...base, label: '', examineScript: 'work in progress' };
  const restored = readItemTabs({
    getItem: () =>
      JSON.stringify({
        version: 1,
        tabs: ['key'],
        active: 'key',
        drafts: { key: { doc, base, folder: '' } },
      }),
  });
  expect(restored.drafts.key.doc).toEqual(doc);
});
