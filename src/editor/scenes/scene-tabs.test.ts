import { describe, expect, it } from 'vitest';
import { createScene, parseScene } from '../schema.js';
import { neighborSceneTab, OPEN_SCENES_KEY, readSceneTabs } from './scene-tabs.js';

describe('scene tabs', () => {
  it('keeps new scene labels and dimensions through parsing', () => {
    const scene = createScene('room', 'Classroom', 120, 40, 'regular-z');
    expect(parseScene(scene)).toEqual({ ok: true, value: scene });
    expect(parseScene(createScene('legacy'))).toEqual({ ok: true, value: createScene('legacy') });
    expect(parseScene({ ...scene, label: '' }).ok).toBe(false);
    expect(parseScene({ ...scene, blockedCells: [2, 2] }).ok).toBe(false);
    expect(parseScene({ ...scene, blockedCells: [scene.width * scene.height] }).ok).toBe(false);
    expect(parseScene({ ...scene, blockedCells: [121, 0] })).toMatchObject({
      ok: true,
      value: { blockedCells: [0, 121] },
    });
    const { blockedCells: _, ...legacy } = scene;
    expect(parseScene(legacy)).toMatchObject({ ok: true, value: { blockedCells: [] } });
  });
  it('restores ordered tabs, active scene and valid drafts', () => {
    const draft = createScene('second');
    draft.width += 1;
    const storage = {
      getItem: (key: string) =>
        key === OPEN_SCENES_KEY
          ? JSON.stringify({
              version: 1,
              tabs: ['first', 'second', 'first', '../bad'],
              active: 'second',
              drafts: {
                second: { doc: draft, saved: createScene('second') },
                first: { doc: draft, saved: null },
              },
            })
          : null,
    };
    const result = readSceneTabs(storage);
    expect(result.tabs).toEqual(['first', 'second']);
    expect(result.active).toBe('second');
    expect(result.drafts.second.doc.width).toBe(draft.width);
    expect(result.drafts.first).toBeUndefined();
  });

  it('ignores corrupt or incompatible storage and chooses an adjacent tab', () => {
    expect(readSceneTabs({ getItem: () => '{' }).tabs).toEqual([]);
    expect(
      readSceneTabs({ getItem: () => JSON.stringify({ version: 2, tabs: ['first'] }) }).tabs,
    ).toEqual([]);
    expect(neighborSceneTab(['a', 'b', 'c'], 'b')).toBe('c');
    expect(neighborSceneTab(['a', 'b'], 'b')).toBe('a');
  });
});
