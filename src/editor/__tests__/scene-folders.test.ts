import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../api.js';
import { createScene } from '../schema.js';
import { AssetStore } from '../store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('persists nested scene folders and safely moves, renames, and deletes their scenes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-scene-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveSceneDraft('room', createScene('room'), null);
  const change = (value: unknown) =>
    dispatchAssetRequest(store, 'POST', '/api/scene-folders', JSON.stringify(value));
  expect(JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/scene-folders', '')).body)))
    .toEqual({ folders: [], placements: {} });
  expect((await change({ action: 'create', folder: '', name: 'school' })).status).toBe(200);
  expect((await change({ action: 'create', folder: 'school', name: 'classrooms' })).status).toBe(200);
  expect((await change({ action: 'move', id: 'room', folder: 'school/classrooms' })).status).toBe(200);
  expect(await new AssetStore(root).getSceneFolders()).toEqual({
    folders: ['school', 'school/classrooms'],
    placements: { room: 'school/classrooms' },
  });
  expect((await change({ action: 'rename', folder: 'school', name: 'academy' })).status).toBe(200);
  expect((await store.getSceneFolders()).placements.room).toBe('academy/classrooms');
  expect((await change({ action: 'delete', folder: 'academy', expectedIds: [], expectedFolders: ['academy', 'academy/classrooms'] })).status).toBe(409);
  expect(await store.listScenes()).toContain('room');
  expect((await change({ action: 'delete', folder: 'academy', expectedIds: ['room'], expectedFolders: ['academy', 'academy/classrooms'] })).status).toBe(200);
  expect(await store.getSceneFolders()).toEqual({ folders: [], placements: {} });
  expect((await change({ action: 'move', id: 'missing', folder: '' })).status).toBe(404);
});

it('removes folder placement when a scene is deleted directly', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-scene-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveSceneDraft('room', createScene('room'), null);
  await store.changeSceneFolders({ action: 'create', folder: '', name: 'school' });
  await store.changeSceneFolders({ action: 'move', id: 'room', folder: 'school' });
  await store.deleteScene('room');
  expect(await store.getSceneFolders()).toEqual({ folders: ['school'], placements: {} });
});
