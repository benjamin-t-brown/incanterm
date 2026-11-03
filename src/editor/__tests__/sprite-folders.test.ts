import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../api.js';
import { createReference } from '../art/reference.js';
import { createSprite } from '../schema.js';
import { AssetStore } from '../store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('persists nested sprite folders, rejects stale deletion previews, and deletes folder contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-sprite-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveSpriteDraft('sheet', createSprite('sheet', 2, 2), null);
  await store.saveReference('sheet', createReference('sheet', 'png', { x: 0, y: 0, width: 2, height: 2 }));
  const change = (value: unknown) =>
    dispatchAssetRequest(store, 'POST', '/api/sprite-folders', JSON.stringify(value));
  expect(JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/sprite-folders', '')).body)))
    .toEqual({ folders: [], placements: {} });
  expect((await change({ action: 'create', folder: '', name: 'rooms' })).status).toBe(200);
  expect((await change({ action: 'create', folder: 'rooms', name: 'classroom' })).status).toBe(200);
  expect((await change({ action: 'move', id: 'sheet', folder: 'rooms/classroom' })).status).toBe(200);
  expect((await new AssetStore(root).getSpriteFolders()).placements).toEqual({ sheet: 'rooms/classroom' });
  expect((await change({ action: 'rename', folder: 'rooms', name: 'school' })).status).toBe(200);
  expect((await store.getSpriteFolders()).placements.sheet).toBe('school/classroom');
  expect((await change({ action: 'delete', folder: 'school', expectedIds: [], expectedFolders: ['school', 'school/classroom'] })).status).toBe(409);
  expect(await store.listSprites()).toContain('sheet');
  expect((await change({ action: 'delete', folder: 'school', expectedIds: ['sheet'], expectedFolders: ['school', 'school/classroom'] })).status).toBe(200);
  expect(await store.getSpriteFolders()).toEqual({ folders: [], placements: {} });
  expect(await store.listSprites()).not.toContain('sheet');
  await expect(store.readReference('sheet')).rejects.toThrow();
});

it('clears a sprite placement when deleting the sprite directly', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-sprite-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveSpriteDraft('sheet', createSprite('sheet', 2, 2), null);
  await store.changeSpriteFolders({ action: 'create', folder: '', name: 'rooms' });
  await store.changeSpriteFolders({ action: 'move', id: 'sheet', folder: 'rooms' });
  await store.deleteSprite('sheet');
  expect(await store.getSpriteFolders()).toEqual({ folders: ['rooms'], placements: {} });
});
