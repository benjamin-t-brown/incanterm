import { describe, expect, it } from 'vitest';
import { createSprite } from '../../schema.js';
import {
  LAST_SPRITE_KEY,
  OPEN_SPRITES_KEY,
  addOpenTab,
  buildArtTabStore,
  closeOpenTab,
  getDefaultArtTabChrome,
  getNeighborTab,
  parseArtTabStore,
  pruneMissingTabs,
  readArtTabStore,
  renameOpenTab,
  isSessionDirty,
  writeArtTabStore,
  type ArtTabDirtySession,
  type ArtTabStorage,
} from '../art-tabs.js';

function createMemoryStorage(initial: Record<string, string> = {}): ArtTabStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

function isDirtySession(id: string, patch?: Partial<ArtTabDirtySession>): ArtTabDirtySession {
  const saved = createSprite(id, 2, 2);
  const doc = createSprite(id, 2, 2);
  doc.originX = 1;
  return {
    ...getDefaultArtTabChrome(),
    doc,
    savedState: JSON.stringify(saved),
    ...patch,
  };
}

describe('art tab list', () => {
  it('adds unique valid ids and ignores the rest', () => {
    expect(addOpenTab([], 'crate')).toEqual(['crate']);
    expect(addOpenTab(['crate'], 'crate')).toEqual(['crate']);
    expect(addOpenTab(['crate'], 'Nope')).toEqual(['crate']);
    expect(addOpenTab(['crate'], 'test1')).toEqual(['crate', 'test1']);
  });

  it('closes and renames tabs without leaving duplicates', () => {
    expect(closeOpenTab(['crate', 'test1'], 'crate')).toEqual(['test1']);
    expect(renameOpenTab(['crate', 'test1'], 'crate', 'box')).toEqual(['box', 'test1']);
    expect(renameOpenTab(['crate', 'box'], 'crate', 'box')).toEqual(['box']);
    expect(renameOpenTab(['crate'], 'crate', 'NOPE')).toEqual(['crate']);
  });

  it('picks a neighbor, preferring the next tab', () => {
    expect(getNeighborTab(['a', 'b', 'c'], 'b')).toBe('c');
    expect(getNeighborTab(['a', 'b', 'c'], 'c')).toBe('b');
    expect(getNeighborTab(['only'], 'only')).toBeNull();
    expect(getNeighborTab(['a', 'b'], 'missing')).toBe('b');
  });

  it('keeps dirty tabs whose files are gone', () => {
    expect(pruneMissingTabs(['crate', 'ghost', 'test1'], ['crate', 'test1'], new Set())).toEqual([
      'crate',
      'test1',
    ]);
    expect(pruneMissingTabs(['crate', 'ghost'], ['crate'], new Set(['ghost']))).toEqual([
      'crate',
      'ghost',
    ]);
  });
});

describe('art tab store', () => {
  it('omits clean sessions and ids that are not open', () => {
    const crate = isDirtySession('crate');
    const clean = {
      ...getDefaultArtTabChrome(),
      doc: createSprite('test1', 2, 2),
      savedState: JSON.stringify(createSprite('test1', 2, 2)),
    };
    const store = buildArtTabStore(
      ['crate', 'test1'],
      'crate',
      new Map([
        ['crate', crate],
        ['test1', clean],
        ['extra', isDirtySession('extra')],
      ]),
    );
    expect(store.tabs).toEqual(['crate', 'test1']);
    expect(store.active).toBe('crate');
    expect(Object.keys(store.sessions)).toEqual(['crate']);
    expect(isSessionDirty(crate.doc, crate.savedState)).toBe(true);
    expect(isSessionDirty(clean.doc, clean.savedState)).toBe(false);
  });

  it('drops unknown versions and invalid stored docs', () => {
    expect(parseArtTabStore({ version: 2, tabs: ['crate'] })).toEqual({
      version: 1,
      tabs: [],
      active: null,
      sessions: {},
    });
    const parsed = parseArtTabStore({
      version: 1,
      tabs: ['crate', 'Nope', 'crate'],
      active: 'crate',
      sessions: {
        crate: { ...getDefaultArtTabChrome(), doc: { nope: true }, savedState: '{}' },
      },
    });
    expect(parsed.tabs).toEqual(['crate']);
    expect(parsed.sessions).toEqual({});
  });

  it('round-trips a dirty session and last-open id', () => {
    const storage = createMemoryStorage();
    const session = isDirtySession('crate', {
      selectedFrame: 2,
      activeLayerId: 'layer-1',
      zoom: 2,
      autoFit: false,
    });
    const written = writeArtTabStore(
      storage,
      buildArtTabStore(['crate'], 'crate', new Map([['crate', session]])),
    );
    expect(written).toEqual({ ok: true });
    expect(storage.getItem(LAST_SPRITE_KEY)).toBe('crate');
    const read = readArtTabStore(storage);
    expect(read.tabs).toEqual(['crate']);
    expect(read.active).toBe('crate');
    expect(read.sessions.crate?.doc.originX).toBe(1);
    expect(read.sessions.crate?.selectedFrame).toBe(2);
    expect(read.sessions.crate?.activeLayerId).toBe('layer-1');
    expect(read.sessions.crate?.zoom).toBe(2);
    expect(isSessionDirty(read.sessions.crate!.doc, read.sessions.crate!.savedState)).toBe(true);
  });

  it('clears a session once the working doc matches the saved snapshot', () => {
    const saved = createSprite('crate', 2, 2);
    const store = buildArtTabStore(
      ['crate'],
      'crate',
      new Map([
        [
          'crate',
          {
            ...getDefaultArtTabChrome(),
            doc: saved,
            savedState: JSON.stringify(saved),
          },
        ],
      ]),
    );
    expect(store.sessions).toEqual({});
  });

  it('discards drafts on exit without forgetting open tabs', () => {
    const storage = createMemoryStorage();
    writeArtTabStore(
      storage,
      buildArtTabStore(['crate', 'test1'], 'crate', new Map([['crate', isDirtySession('crate')]])),
    );
    expect(readArtTabStore(storage).sessions.crate).toBeDefined();

    writeArtTabStore(storage, buildArtTabStore(['crate', 'test1'], 'crate', []));
    expect(readArtTabStore(storage)).toEqual({
      version: 1,
      tabs: ['crate', 'test1'],
      active: 'crate',
      sessions: {},
    });
  });

  it('reports quota failures without throwing', () => {
    const storage: ArtTabStorage = {
      getItem: () => null,
      setItem() {
        const error = new Error('full');
        error.name = 'QuotaExceededError';
        throw error;
      },
      removeItem() {},
    };
    expect(
      writeArtTabStore(
        storage,
        buildArtTabStore(['crate'], 'crate', new Map([['crate', isDirtySession('crate')]])),
      ),
    ).toEqual({ ok: false, quota: true });
  });

  it('returns an empty store when storage is missing or corrupt', () => {
    expect(readArtTabStore(createMemoryStorage())).toEqual({
      version: 1,
      tabs: [],
      active: null,
      sessions: {},
    });
    expect(readArtTabStore(createMemoryStorage({ [OPEN_SPRITES_KEY]: '{not json' }))).toEqual({
      version: 1,
      tabs: [],
      active: null,
      sessions: {},
    });
  });
});
