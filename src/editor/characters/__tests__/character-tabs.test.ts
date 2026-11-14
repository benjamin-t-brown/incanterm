import { expect, it } from 'vitest';
import { createCharacter } from '../../schema.js';
import {
  buildCharacterTabStore,
  getNeighborCharacterTab,
  getRestoredCharacterSession,
  isCharacterSessionDirty,
  OPEN_CHARACTERS_KEY,
  readCharacterTabs,
} from '../character-tabs.js';

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

it('clears a restored dirty baseline when custom animations are already saved on disk', () => {
  const saved = createCharacter('wyatt', 'idle', 'Wyatt');
  const doc = structuredClone(saved);
  doc.customAnimations = { 'sit left': 'sit', 'packing locker': 'pack' };
  const stored = structuredClone(doc);
  stored.customAnimations = { 'packing locker': 'pack', 'sit left': 'sit' };
  const session = getRestoredCharacterSession({ doc, saved }, stored);
  expect(session.doc).toEqual(stored);
  expect(JSON.stringify(session.doc)).toBe(JSON.stringify(session.saved));
  expect(session.doc).not.toBe(session.saved);
});

it('preserves genuine restored edits and their original saved baseline', () => {
  const stored = createCharacter('wyatt', 'idle', 'Wyatt');
  const doc = structuredClone(stored);
  doc.customAnimations['sit left'] = 'sit';
  const session = { doc, saved: structuredClone(stored) };
  expect(getRestoredCharacterSession(session, stored)).toBe(session);
});

it('does not mark unchanged character documents dirty because of property order', () => {
  const saved = createCharacter('wyatt', 'idle', 'Wyatt');
  saved.scriptName = 'Wyatt';
  saved.customAnimations = { 'sit left': 'sit', 'packing locker': 'pack' };
  const doc = { ...saved, customAnimations: { 'packing locker': 'pack', 'sit left': 'sit' } };
  expect(isCharacterSessionDirty({ doc, saved })).toBe(false);
  expect(buildCharacterTabStore(['wyatt'], 'wyatt', [['wyatt', { doc, saved }]]).drafts).toEqual(
    {},
  );
});

it('persists genuine drafts but discards them on exit without forgetting open tabs', () => {
  const saved = createCharacter('wyatt', 'idle', 'Wyatt');
  const doc = { ...saved, scriptName: 'Earlier unsaved edit' };
  const tabs = ['wyatt', 'new-character'];
  const active = 'wyatt';
  const sessions = new Map([
    ['wyatt', { doc, saved }],
    ['new-character', { doc: createCharacter('new-character', 'idle'), saved: null }],
  ]);
  const store = buildCharacterTabStore(tabs, active, sessions);
  expect(Object.keys(store.drafts)).toEqual(tabs);
  const discarded = buildCharacterTabStore(tabs, active, []);
  const restored = readCharacterTabs({ getItem: () => JSON.stringify(discarded) });
  expect(restored).toEqual({ version: 1, tabs, active, drafts: {} });
});
