import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../../api.js';
import { createAnimation, createScene, createSprite } from '../../schema.js';
import { AssetStore } from '../../store.js';
import { createItem } from '../item-schema.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createStore(): Promise<AssetStore> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-item-api-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveSprite('art', createSprite('art', 4, 3));
  await store.saveScript('hooks', '@inspect\n@fail\n@combine\n');
  return store;
}

describe('item asset API', () => {
  it('creates, lists, reads, merges, detects conflicts, and deletes items', async () => {
    const store = await createStore();
    const item = {
      ...createItem('key', { type: 'sprite', id: 'art', index: 0 }),
      examineScript: 'inspect',
      combineFailScript: 'fail',
    };
    const putItem = (base: unknown, doc: unknown) =>
      dispatchAssetRequest(store, 'PUT', '/api/items/key', JSON.stringify({ base, doc }));
    expect((await putItem(null, item)).status).toBe(200);
    expect((await putItem(null, item)).status).toBe(409);
    expect(
      JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/items', '')).body)),
    ).toEqual({ files: ['key'], labels: { key: 'key' } });
    expect((await dispatchAssetRequest(store, 'GET', '/api/items/key', '')).status).toBe(200);
    expect((await putItem(item, { ...item, label: 'Brass key' })).status).toBe(200);
    expect((await putItem(item, { ...item, examineScript: 'fail' })).status).toBe(200);
    expect(await store.readItem('key')).toMatchObject({
      label: 'Brass key',
      examineScript: 'fail',
    });
    expect((await putItem(item, { ...item, label: 'Different key' })).status).toBe(409);
    expect((await dispatchAssetRequest(store, 'DELETE', '/api/items/key', '')).status).toBe(200);
    expect((await dispatchAssetRequest(store, 'GET', '/api/items/key', '')).status).toBe(404);
  });

  it('validates visuals, frames, script hooks, targets, unique script names, and scene references', async () => {
    const store = await createStore();
    const item = createItem('key', { type: 'sprite', id: 'art', index: 0 });
    await expect(
      store.saveItemDraft('key', { ...item, visual: { ...item.visual, index: 5 } }, null),
    ).rejects.toThrow('missing sprite frame');
    await expect(
      store.saveItemDraft('key', { ...item, examineScript: 'missing' }, null),
    ).rejects.toThrow('missing or ambiguous');
    await expect(
      store.saveItemDraft(
        'key',
        { ...item, combinations: [{ targetType: 'item', target: 'missing', script: 'combine' }] },
        null,
      ),
    ).rejects.toThrow();
    const key = { ...item, scriptName: 'OfficeKey, SpareKey/KeyTag' };
    expect(await store.saveItemDraft('key', key, null)).toEqual(key);
    expect(await store.readItem('key')).toEqual(key);
    await expect(
      store.saveItemDraft('coin', { ...item, id: 'coin', scriptName: 'Token/sparekey' }, null),
    ).rejects.toThrow('"SpareKey" conflicts');
    await expect(
      store.saveItemDraft('coin', { ...item, id: 'coin', scriptName: 'Token, Key' }, null),
    ).rejects.toThrow('"key" conflicts');
    await expect(
      store.saveItemDraft('keytag', { ...item, id: 'keytag' }, null),
    ).rejects.toThrow('"KeyTag" conflicts');
    const empty = createAnimation('empty');
    await store.saveAnimationDraft(empty.id, empty, null);
    await expect(
      store.saveItemDraft(
        'coin',
        { ...item, id: 'coin', visual: { type: 'animation', id: 'empty' } },
        null,
      ),
    ).rejects.toThrow('visible frame');
    const scene = createScene('room');
    scene.entities.push({
      type: 'Item',
      id: 'key-1',
      item: 'key',
      x: 0,
      y: 0,
      z: 0,
      depthOffset: 0,
    });
    await store.saveSceneDraft('room', scene, null);
    expect(await store.readScene('room')).toEqual(scene);
    await expect(
      store.saveSceneDraft(
        'other',
        { ...scene, id: 'other', entities: [{ ...scene.entities[0], item: 'missing' }] },
        null,
      ),
    ).rejects.toThrow();
  });

  it('supports item folders through the API and clears placement on deletion', async () => {
    const store = await createStore();
    await store.saveItemDraft(
      'key',
      createItem('key', { type: 'sprite', id: 'art', index: 0 }),
      null,
    );
    const changeFolders = (change: unknown) =>
      dispatchAssetRequest(store, 'POST', '/api/item-folders', JSON.stringify(change));
    expect((await changeFolders({ action: 'create', folder: '', name: 'keys' })).status).toBe(200);
    expect((await changeFolders({ action: 'move', folder: 'keys', id: 'key' })).status).toBe(200);
    expect(await store.getItemFolders()).toEqual({
      folders: ['keys'],
      placements: { key: 'keys' },
    });
    await store.deleteItem('key');
    expect((await store.getItemFolders()).placements).toEqual({});
  });

  it('only offers and accepts item visuals with 4×3 sprites in every visible frame', async () => {
    const store = await createStore();
    await store.saveSprite('tall', createSprite('tall', 3, 4));
    const blink = createAnimation('blink');
    blink.frames = [
      { sprite: 'art', index: 0, durationMs: 100 },
      { invisible: true, durationMs: 100 },
    ];
    await store.saveAnimationDraft(blink.id, blink, null);
    const mixed = {
      ...blink,
      id: 'mixed',
      frames: [...blink.frames, { sprite: 'tall', index: 0, durationMs: 100 }],
    };
    await store.saveAnimationDraft(mixed.id, mixed, null);
    const hidden = { ...createAnimation('hidden'), frames: [{ invisible: true, durationMs: 100 }] };
    await store.saveAnimationDraft(hidden.id, hidden, null);

    const listed = await dispatchAssetRequest(store, 'GET', '/api/item-visuals', '');
    expect(listed.status).toBe(200);
    expect(JSON.parse(String(listed.body))).toEqual({
      sprites: { files: ['art'], labels: { art: 'art' } },
      animations: { files: ['blink'], labels: { blink: 'blink' } },
    });
    const invalidVisuals = [
      { type: 'sprite', id: 'tall', index: 0 },
      { type: 'animation', id: 'mixed' },
    ] as const;
    for (const visual of invalidVisuals) {
      const doc = createItem('key', visual);
      const response = await dispatchAssetRequest(
        store,
        'PUT',
        '/api/items/key',
        JSON.stringify({ base: null, doc }),
      );
      expect(response.status).toBe(422);
      expect(JSON.parse(String(response.body)).error).toContain('Item sprites must be 4×3');
    }
    const item = createItem('key', { type: 'animation', id: blink.id });
    expect(await store.saveItemDraft(item.id, item, null)).toEqual(item);
  });

  it('rejects sprite resizes and animation edits that would invalidate existing items', async () => {
    const store = await createStore();
    const animatedArt = await store.saveSprite('animated-art', createSprite('animated-art', 4, 3));
    await store.saveSprite('tall', createSprite('tall', 4, 4));
    const clip = createAnimation('clip');
    clip.frames = [{ sprite: animatedArt.id, index: 0, durationMs: 100 }];
    await store.saveAnimationDraft(clip.id, clip, null);
    const key = createItem('key', { type: 'sprite', id: 'art', index: 0 });
    const coin = createItem('coin', { type: 'animation', id: clip.id });
    await store.saveItemDraft(key.id, key, null);
    await store.saveItemDraft(coin.id, coin, null);

    const art = await store.readSprite('art');
    await expect(store.saveSpriteDraft('art', createSprite('art', 5, 3), art)).rejects.toThrow(
      'Item sprites must be 4×3',
    );
    await expect(
      store.saveSpriteDraft(animatedArt.id, createSprite(animatedArt.id, 4, 4), animatedArt),
    ).rejects.toThrow('Item sprites must be 4×3');
    const frames = [...clip.frames, { sprite: 'tall', index: 0, durationMs: 100 }];
    await expect(store.saveAnimationDraft(clip.id, { ...clip, frames }, clip)).rejects.toThrow(
      'Item sprites must be 4×3',
    );
    expect(await store.readSprite('art')).toEqual(art);
    expect(await store.readSprite(animatedArt.id)).toEqual(animatedArt);
    expect(await store.readAnimation(clip.id)).toEqual(clip);
    const updated = { ...clip, frames: [{ ...clip.frames[0], durationMs: 200 }] };
    expect(await store.saveAnimationDraft(clip.id, updated, clip)).toEqual(updated);
  });
});
