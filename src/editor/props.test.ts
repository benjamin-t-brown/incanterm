import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from './api.js';
import { resizeBlockedCells } from './prop-blocking.js';
import { createAnimation, createProp, createSprite, parseProp } from './schema.js';
import { AssetStore } from './store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('validates the prop visual, footprint and depth fields', () => {
  const prop = createProp('crate', { type: 'sprite', id: 'crate-art', index: 0 });
  expect(parseProp(prop)).toEqual({ ok: true, value: prop });
  expect(parseProp({ ...prop, visual: { type: 'sprite', id: 'crate-art', index: -1 } }).ok).toBe(
    false,
  );
  expect(parseProp({ ...prop, width: 0 }).ok).toBe(false);
  expect(parseProp({ ...prop, blockedCells: [1] }).ok).toBe(false);
  expect(parseProp({ ...prop, blockedCells: [0, 0] }).ok).toBe(false);
  expect(parseProp({ ...prop, visual: { type: 'animation', id: 'idle' } }).ok).toBe(true);
});

it('migrates legacy movement flags and keeps blocked cells in place when resized', () => {
  const prop = {
    ...createProp('crate', { type: 'sprite', id: 'crate-art', index: 0 }),
    width: 3,
    height: 2,
  };
  const { blockedCells: _, ...legacy } = prop;
  expect(parseProp({ ...legacy, blocksMovement: true })).toMatchObject({
    ok: true,
    value: { blockedCells: [0, 1, 2, 3, 4, 5] },
  });
  expect(parseProp({ ...legacy, blocksMovement: false })).toMatchObject({
    ok: true,
    value: { blockedCells: [] },
  });
  expect(resizeBlockedCells([1, 4, 5], 3, 2, 2)).toEqual([1, 3]);
  expect(resizeBlockedCells([1, 4, 5], 3, 4, 3)).toEqual([1, 5, 6]);
});

it('loads existing legacy prop files and saves edited masks without the old flag', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-props-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'props'));
  const prop = {
    ...createProp('desk', { type: 'sprite', id: 'desk-art', index: 0 }),
    width: 2,
    height: 2,
  };
  const { blockedCells: _, ...legacy } = prop;
  await fs.writeFile(
    path.join(root, 'props', 'desk.json'),
    JSON.stringify({ ...legacy, blocksMovement: true }),
  );
  const store = new AssetStore(root);
  const loaded = await store.readProp('desk');
  expect(loaded.blockedCells).toEqual([0, 1, 2, 3]);
  await store.saveSprite('desk-art', createSprite('desk-art', 2, 2));
  await store.savePropDraft('desk', { ...loaded, blockedCells: [0, 3] }, loaded);
  expect(await store.readProp('desk')).toMatchObject({ blockedCells: [0, 3] });
  expect(await fs.readFile(path.join(root, 'props', 'desk.json'), 'utf8')).not.toContain(
    'blocksMovement',
  );
});

it('lists, saves, merges and deletes prop assets with validated references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-props-'));
  roots.push(root);
  const store = new AssetStore(root);
  const put = (id: string, base: unknown, doc: unknown) =>
    dispatchAssetRequest(store, 'PUT', `/api/props/${id}`, JSON.stringify({ base, doc }));
  const prop = createProp('crate', { type: 'sprite', id: 'crate-art', index: 0 });
  expect((await put('crate', null, prop)).status).toBe(422);
  await store.saveSprite('crate-art', createSprite('crate-art', 1, 1));
  expect((await put('crate', null, { ...prop, visual: { ...prop.visual, index: 1 } })).status).toBe(
    422,
  );
  expect((await put('crate', null, prop)).status).toBe(200);
  expect(
    JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/props', '')).body)),
  ).toEqual({ files: ['crate'] });
  expect((await put('crate', prop, { ...prop, blockedCells: [0] })).status).toBe(200);
  expect((await put('crate', prop, { ...prop, depthOffset: 2 })).status).toBe(200);
  expect(await store.readProp('crate')).toMatchObject({ blockedCells: [0], depthOffset: 2 });
  expect((await put('crate', prop, { ...prop, depthOffset: 3 })).status).toBe(409);
  expect((await put('crate', null, prop)).status).toBe(409);

  const animation = createAnimation('idle');
  await store.saveAnimation('idle', animation);
  const saved = await store.readProp('crate');
  expect(
    (await put('crate', saved, { ...saved, visual: { type: 'animation', id: 'idle' } })).status,
  ).toBe(200);
  expect((await dispatchAssetRequest(store, 'DELETE', '/api/props/crate', '')).status).toBe(200);
  expect((await dispatchAssetRequest(store, 'GET', '/api/props', '')).body).toContain('"files":[]');
});
