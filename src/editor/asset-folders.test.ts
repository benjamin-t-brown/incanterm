import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from './api.js';
import { CHARACTER_STATES, createAnimation, createSprite } from './schema.js';
import { AssetStore } from './store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('persists nested animation folders and placement across store instances', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveAnimationDraft('idle', createAnimation('idle'), null);
  const change = (value: unknown) =>
    dispatchAssetRequest(store, 'POST', '/api/animation-folders', JSON.stringify(value));
  expect(
    JSON.parse(
      String((await dispatchAssetRequest(store, 'GET', '/api/animation-folders', '')).body),
    ),
  ).toEqual({ folders: [], placements: {} });
  expect((await change({ action: 'create', folder: '', name: 'characters' })).status).toBe(200);
  expect((await change({ action: 'create', folder: 'characters', name: 'hero' })).status).toBe(200);
  expect((await change({ action: 'move', id: 'idle', folder: 'characters/hero' })).status).toBe(
    200,
  );
  expect(await new AssetStore(root).animationFolders()).toEqual({
    folders: ['characters', 'characters/hero'],
    placements: { idle: 'characters/hero' },
  });
  const copy = await dispatchAssetRequest(
    store,
    'POST',
    '/api/animations/idle/copy',
    JSON.stringify({ id: 'idle_copy', doc: { ...createAnimation('idle_copy'), loop: false } }),
  );
  expect(copy.status).toBe(200);
  expect((await store.readAnimation('idle_copy')).loop).toBe(false);
  expect((await store.animationFolders()).placements.idle_copy).toBe('characters/hero');
  expect(
    (
      await dispatchAssetRequest(
        store,
        'POST',
        '/api/animations/idle/copy',
        JSON.stringify({ id: 'idle_copy', doc: createAnimation('idle_copy') }),
      )
    ).status,
  ).toBe(409);
  await store.deleteAnimation('idle_copy');
  expect((await change({ action: 'delete', folder: 'characters/hero' })).status).toBe(409);
  expect((await change({ action: 'create', folder: '../outside', name: 'bad' })).status).toBe(404);
  expect((await change({ action: 'move', id: 'missing', folder: '' })).status).toBe(404);
  expect((await change({ action: 'rename', folder: 'characters', name: 'actors' })).status).toBe(
    200,
  );
  expect((await store.animationFolders()).placements.idle).toBe('actors/hero');
  await store.renameAnimation('idle', 'walking', createAnimation('idle'));
  expect((await store.animationFolders()).placements).toEqual({ walking: 'actors/hero' });
  await store.deleteAnimation('walking');
  expect((await store.animationFolders()).placements).toEqual({});
  expect((await change({ action: 'delete', folder: 'actors/hero' })).status).toBe(200);
  expect((await change({ action: 'delete', folder: 'actors' })).status).toBe(200);
});

it('creates all character state clips in a child folder without replacing existing assets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  await store.saveSprite('hero-sheet', createSprite('hero-sheet', 1, 1));
  await store.changeAnimationFolders({ action: 'create', folder: '', name: 'characters' });
  const generate = (name: string, sprite = 'hero-sheet') =>
    dispatchAssetRequest(
      store,
      'POST',
      '/api/animation-folders',
      JSON.stringify({ action: 'create-character-animations', folder: 'characters', name, sprite }),
    );
  expect((await generate('missing', 'unknown')).status).toBe(404);
  const created = await generate('hero');
  expect(created.status).toBe(200);
  const ids = (JSON.parse(String(created.body)) as { ids: string[] }).ids;
  expect(CHARACTER_STATES).toContain('talking');
  expect(ids).toHaveLength(9);
  expect(ids).toHaveLength(CHARACTER_STATES.length);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/);
  expect(JSON.parse(String(created.body))).toEqual({ folder: 'characters/hero', ids });
  expect((await store.animationFolders()).placements).toEqual(
    Object.fromEntries(ids.map((id) => [id, 'characters/hero'])),
  );
  for (const [index, id] of ids.entries()) {
    expect((await store.readAnimation(id)).label).toBe(
      `hero ${CHARACTER_STATES[index].replace('-', ' ')}`,
    );
    expect((await store.readAnimation(id)).frames).toEqual([
      { sprite: 'hero-sheet', index: 0, durationMs: createAnimation(id).defaultDurationMs },
    ]);
  }
  expect((await generate('hero')).status).toBe(409);
  await store.saveAnimationDraft('villain_walk_up', createAnimation('villain_walk_up'), null);
  expect((await generate('villain')).status).toBe(200);
  expect((await store.animationFolders()).folders).toContain('characters/villain');
  expect((await store.readAnimation('villain_walk_up')).id).toBe('villain_walk_up');
});
