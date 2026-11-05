import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../api.js';
import { createProp, createSprite } from '../schema.js';
import { AssetStore } from '../store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('persists prop folders and deletes folder contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-prop-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveSpriteDraft('sheet', createSprite('sheet', 2, 2), null);
  await store.savePropDraft('lamp', createProp('lamp', { type: 'sprite', id: 'sheet', index: 0 }), null);
  const change = (value: unknown) =>
    dispatchAssetRequest(store, 'POST', '/api/prop-folders', JSON.stringify(value));
  expect((await change({ action: 'create', folder: '', name: 'decor' })).status).toBe(200);
  expect((await change({ action: 'move', id: 'lamp', folder: 'decor' })).status).toBe(200);
  expect((await new AssetStore(root).getPropFolders()).placements).toEqual({ lamp: 'decor' });
  expect(
    (await change({ action: 'delete', folder: 'decor', expectedIds: ['lamp'], expectedFolders: ['decor'] })).status,
  ).toBe(200);
  expect(await store.listProps()).not.toContain('lamp');
  expect(await store.getPropFolders()).toEqual({ folders: [], placements: {} });
});

it('clears a prop placement when deleting the prop directly', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-prop-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveSpriteDraft('sheet', createSprite('sheet', 2, 2), null);
  await store.savePropDraft('lamp', createProp('lamp', { type: 'sprite', id: 'sheet', index: 0 }), null);
  await store.changePropFolders({ action: 'create', folder: '', name: 'decor' });
  await store.changePropFolders({ action: 'move', id: 'lamp', folder: 'decor' });
  await store.deleteProp('lamp');
  expect(await store.getPropFolders()).toEqual({ folders: ['decor'], placements: {} });
});

it('serves character folders', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-character-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  const response = await dispatchAssetRequest(store, 'GET', '/api/character-folders', '');
  expect(JSON.parse(String(response.body))).toEqual({ folders: [], placements: {} });
  expect(
    (await dispatchAssetRequest(store, 'POST', '/api/character-folders',
      JSON.stringify({ action: 'create', folder: '', name: 'npcs' }))).status,
  ).toBe(200);
});
