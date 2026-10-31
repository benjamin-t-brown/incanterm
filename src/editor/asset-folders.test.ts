import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from './api.js';
import { generateCharacter3x3 } from './art/character-generator.js';
import { characterFromAnimationFolder } from './characters/auto-assign.js';
import { CHARACTER_STATES, createAnimation, createSprite, emptySpriteFrame } from './schema.js';
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
  expect(
    (
      await change({
        action: 'delete',
        folder: 'characters/hero',
        expectedIds: [],
        expectedFolders: ['characters/hero'],
      })
    ).status,
  ).toBe(409);
  expect((await change({ action: 'create', folder: '../outside', name: 'bad' })).status).toBe(404);
  expect((await change({ action: 'move', id: 'missing', folder: '' })).status).toBe(404);
  expect((await change({ action: 'rename', folder: 'characters', name: 'actors' })).status).toBe(
    200,
  );
  expect((await store.animationFolders()).placements.idle).toBe('actors/hero');
  await store.renameAnimation('idle', 'walking', createAnimation('idle'));
  expect((await store.animationFolders()).placements).toEqual({ walking: 'actors/hero' });
  expect(
    (
      await change({
        action: 'delete',
        folder: 'actors',
        expectedIds: ['walking'],
        expectedFolders: ['actors', 'actors/hero'],
      })
    ).status,
  ).toBe(200);
  expect(await store.listAnimations()).toEqual([]);
  expect(await store.animationFolders()).toEqual({ folders: [], placements: {} });
  expect(
    (
      await change({
        action: 'delete',
        folder: 'actors',
        expectedIds: [],
        expectedFolders: ['actors'],
      })
    ).status,
  ).toBe(404);
});

it('requires an exact contents preview before removing a populated folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  const change = (value: unknown) =>
    dispatchAssetRequest(store, 'POST', '/api/animation-folders', JSON.stringify(value));
  await store.saveAnimation('inside', createAnimation('inside'));
  await store.saveAnimation('outside', createAnimation('outside'));
  await change({ action: 'create', folder: '', name: 'group' });
  await change({ action: 'move', id: 'inside', folder: 'group' });
  expect(
    (
      await change({
        action: 'delete',
        folder: 'group',
        expectedIds: [],
        expectedFolders: ['group'],
      })
    ).status,
  ).toBe(409);
  expect(await store.listAnimations()).toEqual(['inside', 'outside']);
  expect(
    (
      await change({
        action: 'delete',
        folder: 'group',
        expectedIds: ['inside'],
        expectedFolders: ['group'],
      })
    ).status,
  ).toBe(200);
  expect(await store.listAnimations()).toEqual(['outside']);
});

it('creates all character state clips in a child folder without replacing existing assets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-folders-'));
  roots.push(root);
  const store = new AssetStore(root);
  const sheet = generateCharacter3x3('hero-sheet', 'Hero', 'bright-yellow', 'H', true);
  await store.saveSprite('hero-sheet', sheet);
  await store.changeAnimationFolders({ action: 'create', folder: '', name: 'characters' });
  const generate = (name: string, sprite = 'hero-sheet') =>
    dispatchAssetRequest(
      store,
      'POST',
      '/api/animation-folders',
      JSON.stringify({ action: 'create-character-animations', folder: 'characters', name, sprite }),
    );
  expect((await generate('missing', 'unknown')).status).toBe(404);
  const short = createSprite('short-sheet', 3, 3);
  await store.saveSprite('short-sheet', short);
  expect((await generate('short', 'short-sheet')).status).toBe(422);
  expect((await store.animationFolders()).folders).not.toContain('characters/short');
  const wrongSize = createSprite('large-sheet', 4, 3);
  wrongSize.sprites = Array.from({ length: 16 }, () => emptySpriteFrame(4, 3));
  await store.saveSprite('large-sheet', wrongSize);
  expect((await generate('large', 'large-sheet')).status).toBe(422);
  const created = await generate('hero');
  expect(created.status).toBe(200);
  const ids = (JSON.parse(String(created.body)) as { ids: string[] }).ids;
  expect(CHARACTER_STATES).toContain('talking-down');
  expect(ids).toHaveLength(12);
  expect(ids).toHaveLength(CHARACTER_STATES.length);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/);
  expect(JSON.parse(String(created.body))).toEqual({ folder: 'characters/hero', ids });
  expect((await store.animationFolders()).placements).toEqual(
    Object.fromEntries(ids.map((id) => [id, 'characters/hero'])),
  );
  const character = characterFromAnimationFolder(
    'hero',
    'characters/hero',
    await store.animationFolders(),
    await store.animationLabels(),
  );
  expect(character.character?.customAnimations).toEqual({});
  expect(character.character?.animations['talking-right']).toBe(ids[11]);
  const expectedFrames: Record<string, number[]> = {
    'idle-up': [6],
    'idle-down': [0],
    'idle-left': [2],
    'idle-right': [4],
    'walk-up': [6, 14, 6, 15],
    'walk-down': [0, 8, 0, 9],
    'walk-left': [2, 10, 2, 11],
    'walk-right': [4, 12, 4, 13],
    'talking-up': [6, 7],
    'talking-down': [0, 1],
    'talking-left': [2, 3],
    'talking-right': [4, 5],
  };
  for (const [index, id] of ids.entries()) {
    expect((await store.readAnimation(id)).label).toBe(
      `hero ${CHARACTER_STATES[index].replace('-', ' ')}`,
    );
    const state = CHARACTER_STATES[index];
    const clip = await store.readAnimation(id);
    expect(clip.loop).toBe(true);
    expect(clip.frames).toEqual(
      expectedFrames[state].map((frame) => ({
        sprite: 'hero-sheet',
        index: frame,
        durationMs: state.startsWith('talking-') ? 500 : 135,
      })),
    );
  }
  expect((await generate('hero')).status).toBe(409);
  await store.saveAnimationDraft('villain_walk_up', createAnimation('villain_walk_up'), null);
  expect((await generate('villain')).status).toBe(200);
  expect((await store.animationFolders()).folders).toContain('characters/villain');
  expect((await store.readAnimation('villain_walk_up')).id).toBe('villain_walk_up');
});
