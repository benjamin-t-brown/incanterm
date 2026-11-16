import { describe, expect, it } from 'vitest';
import { createScene, parseScene } from '../../schema.js';
import { addSceneItem } from '../../scenes/scene-items.js';
import { createItem, parseItem } from '../item-schema.js';

describe('item authoring schema', () => {
  it('round-trips visuals and script hooks without unknown fields', () => {
    const item = createItem('key', { type: 'sprite', id: 'art', index: 2 }, 'Key');
    Object.assign(item, {
      scriptName: 'OfficeKey',
      examineScript: 'inspect',
      combineFailScript: 'fail',
      combinations: [{ targetType: 'prop', target: 'lock', script: 'unlock' }],
    });
    expect(parseItem({ ...item, unexpected: true })).toEqual({ ok: true, value: item });
    expect(parseItem({ ...item, visual: { type: 'animation', id: 'sparkle' } }).ok).toBe(true);
  });
  it('rejects malformed visuals, identifiers, hooks, target kinds and duplicate rules', () => {
    const item = createItem('key', { type: 'sprite', id: 'art', index: 0 });
    for (const update of [
      { id: '../escape' },
      { label: '\n' },
      { scriptName: 'two names' },
      { examineScript: '@inspect' },
      { visual: { type: 'sprite', id: 'art', index: -1 } },
      { visual: { type: 'video', id: 'art' } },
      { combinations: [{ targetType: 'scene', target: 'room', script: 'use' }] },
      { combinations: [{ targetType: 'item', target: '../key', script: 'use' }] },
      { combinations: Array(2).fill({ targetType: 'item', target: 'coin', script: 'use' }) },
    ])
      expect(parseItem({ ...item, ...update }).ok).toBe(false);
  });
  it('places items with unique IDs, clamped coordinates, and scene round-trip support', () => {
    const item = createItem('key', { type: 'animation', id: 'clip' }, 'Office key');
    const scene = createScene('room', undefined, 10, 5);
    const first = addSceneItem(scene, item, -3, 99);
    const second = addSceneItem(scene, item, 2, 3);
    expect(first).toMatchObject({ type: 'Item', item: 'key', name: 'Office key', x: 0, y: 4 });
    expect(first.id).not.toBe(second.id);
    expect(parseScene(scene)).toEqual({ ok: true, value: scene });
    expect(parseScene({ ...scene, entities: [{ ...first, item: '../escape' }] }).ok).toBe(false);
  });
});
