import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../api.js';
import type { AssetFolders } from '../asset-folders.js';
import { AssetStore } from '../store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createFolderStore(kind = 'animation', extraFolders: string[] = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-folder-moves-'));
  roots.push(root);
  const index: AssetFolders = {
    folders: [
      'source',
      'source/child',
      'source/child/deep',
      'source-other',
      'destination',
      'destination/nested',
      ...extraFolders,
    ],
    placements: { direct: 'source', nested: 'source/child/deep', outside: 'source-other' },
  };
  const indexPath = path.join(root, `${kind}-folders.json`);
  await fs.writeFile(indexPath, JSON.stringify(index));
  const store = new AssetStore(root);
  const changeFolders = (change: unknown) =>
    dispatchAssetRequest(store, 'POST', `/api/${kind}-folders`, JSON.stringify(change));
  const readFolders = async () => JSON.parse(await fs.readFile(indexPath, 'utf8')) as AssetFolders;
  return { store, root, index, changeFolders, readFolders };
}

it.each(['animation', 'scene', 'sprite', 'prop', 'character', 'item'])(
  'moves populated %s folders recursively and persists moves back to the root',
  async (kind) => {
    const { root, changeFolders, readFolders } = await createFolderStore(kind);
    const response = await changeFolders({
      action: 'move-folder',
      folder: 'source',
      parent: 'destination/nested',
    });
    expect(response.status).toBe(200);
    const moved: AssetFolders = {
      folders: [
        'destination/nested/source',
        'destination/nested/source/child',
        'destination/nested/source/child/deep',
        'source-other',
        'destination',
        'destination/nested',
      ],
      placements: {
        direct: 'destination/nested/source',
        nested: 'destination/nested/source/child/deep',
        outside: 'source-other',
      },
    };
    expect(JSON.parse(String(response.body))).toEqual(moved);
    const persisted = await dispatchAssetRequest(
      new AssetStore(root),
      'GET',
      `/api/${kind}-folders`,
      '',
    );
    expect(JSON.parse(String(persisted.body))).toEqual(moved);
    expect(
      (
        await changeFolders({
          action: 'move-folder',
          folder: 'destination/nested/source',
          parent: '',
        })
      ).status,
    ).toBe(200);
    expect(await readFolders()).toEqual({
      folders: [
        'source',
        'source/child',
        'source/child/deep',
        'source-other',
        'destination',
        'destination/nested',
      ],
      placements: { direct: 'source', nested: 'source/child/deep', outside: 'source-other' },
    });
  },
);

it.each([
  { folder: 'source', parent: 'source', status: 400 },
  { folder: 'source', parent: 'source/child/deep', status: 400 },
  { folder: 'missing', parent: 'destination', status: 404 },
  { folder: '', parent: 'destination', status: 400 },
  { folder: 'source', parent: 'missing', status: 404 },
  { folder: 'source', parent: '../outside', status: 404 },
  { folder: 'source', parent: null, status: 400 },
])('rejects invalid folder moves: $folder into $parent', async ({ folder, parent, status }) => {
  const { index, changeFolders, readFolders } = await createFolderStore();
  expect((await changeFolders({ action: 'move-folder', folder, parent })).status).toBe(status);
  expect(await readFolders()).toEqual(index);
});

it('does not merge or replace a folder with the same name', async () => {
  const { index, changeFolders, readFolders } = await createFolderStore('animation', [
    'destination/source',
  ]);
  expect(
    (await changeFolders({ action: 'move-folder', folder: 'source', parent: 'destination' }))
      .status,
  ).toBe(409);
  expect(await readFolders()).toEqual(index);
});

it('treats moves to the current parent as a no-op', async () => {
  const { index, changeFolders, readFolders } = await createFolderStore();
  expect(
    (await changeFolders({ action: 'move-folder', folder: 'source', parent: '' })).status,
  ).toBe(200);
  expect(
    (await changeFolders({ action: 'move-folder', folder: 'source/child', parent: 'source' }))
      .status,
  ).toBe(200);
  expect(await readFolders()).toEqual(index);
});

it('rejects a move that would make a descendant path too long without changing the index', async () => {
  const parent = Array.from({ length: 5 }, () => 'a'.repeat(48)).join('/');
  const ancestors = parent
    .split('/')
    .map((_part, index, parts) => parts.slice(0, index + 1).join('/'));
  const { index, changeFolders, readFolders } = await createFolderStore('animation', ancestors);
  // The moved folder itself fits, but its deepest descendant would exceed 256 characters.
  expect(`${parent}/source`.length).toBeLessThanOrEqual(256);
  expect(`${parent}/source/child/deep`.length).toBeGreaterThan(256);
  expect((await changeFolders({ action: 'move-folder', folder: 'source', parent })).status).toBe(
    400,
  );
  expect(await readFolders()).toEqual(index);
});
