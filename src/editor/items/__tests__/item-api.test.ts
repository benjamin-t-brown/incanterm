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
  await store.saveSprite('art', createSprite('art', 1, 1));
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
    await store.saveItemDraft('key', { ...item, scriptName: 'OfficeKey' }, null);
    await expect(
      store.saveItemDraft('coin', { ...item, id: 'coin', scriptName: 'OfficeKey' }, null),
    ).rejects.toThrow('conflicts');
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
});
