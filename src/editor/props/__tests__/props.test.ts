import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../../api.js';
import {
  blockPreviewGrid,
  blockPreviewPoint,
  paintPropBlockedCells,
  resizeBlockedCells,
} from '../prop-blocking.js';
import { createAnimation, createProp, createSprite, parseProp } from '../../schema.js';
import { AssetStore } from '../../store.js';
import { createSpriteProp } from '../../art/create-sprite-prop.js';

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

it('preserves optional prop labels while accepting existing unlabeled props', () => {
  const prop = createProp('crate', { type: 'sprite', id: 'crate-art', index: 0 });
  expect(parseProp(prop)).toEqual({ ok: true, value: prop });
  expect(parseProp({ ...prop, label: '  Wooden crate  ' })).toEqual({
    ok: true,
    value: { ...prop, label: 'Wooden crate' },
  });
  for (const label of ['', '   ', 'a'.repeat(81), 'Bad\nlabel', 123, null])
    expect(parseProp({ ...prop, label }).ok).toBe(false);
});

it('saves a sprite prop and exposes its label in the prop list', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-props-'));
  roots.push(root);
  const store = new AssetStore(root);
  const sprite = createSprite('crate-art', 3, 2);
  sprite.sprites.push(structuredClone(sprite.sprites[0]));
  await store.saveSprite(sprite.id, sprite);
  const prop = createSpriteProp('test-prop', 'Wooden crate', sprite, 1);
  const response = await dispatchAssetRequest(
    store,
    'PUT',
    `/api/props/${prop.id}`,
    JSON.stringify({ base: null, doc: prop }),
  );
  expect(response.status).toBe(200);
  expect(await store.readProp(prop.id)).toEqual(prop);
  expect(
    JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/props', '')).body)),
  ).toEqual({ files: ['test-prop'], labels: { 'test-prop': 'Wooden crate' } });
});

it('parses prop customAnimations and rejects reserved default', () => {
  const prop = createProp('machine', { type: 'animation', id: 'idle' });
  const { customAnimations: _, ...without } = prop;
  expect(parseProp(without)).toMatchObject({ ok: true, value: { customAnimations: {} } });
  expect(parseProp({ ...prop, customAnimations: { open: 'open-clip' } })).toMatchObject({
    ok: true,
    value: { customAnimations: { open: 'open-clip' } },
  });
  expect(parseProp({ ...prop, customAnimations: { default: 'open-clip' } }).ok).toBe(false);
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

it('maps preview clicks to the centered footprint, not the entire canvas or sprite', () => {
  const canvas = { width: 360, height: 240 };
  const footprint = { width: 2, height: 2 };
  const grid = blockPreviewGrid(canvas, footprint, {
    width: 3,
    height: 3,
    cellWidth: 10,
    cellHeight: 20,
  });
  expect(
    blockPreviewPoint(
      { x: grid.x + grid.cellWidth * 1.5, y: grid.y + grid.cellHeight * 1.5 },
      grid,
      footprint,
    ),
  ).toEqual({ x: 1, y: 1 });
  expect(
    blockPreviewPoint({ x: grid.x + grid.cellWidth * 2.5, y: grid.y }, grid, footprint),
  ).toBeNull();
  expect(blockPreviewPoint({ x: grid.x - 1, y: grid.y }, grid, footprint)).toBeNull();
  const empty = blockPreviewGrid(canvas, footprint, null);
  expect(blockPreviewPoint({ x: empty.x, y: empty.y }, empty, footprint)).toEqual({ x: 0, y: 0 });
});

it('paints a continuous blocked-cell stroke and erases it on a second stroke', () => {
  const painted = paintPropBlockedCells([], 4, { x: 0, y: 0 }, { x: 3, y: 0 }, true);
  expect(painted).toEqual([0, 1, 2, 3]);
  expect(paintPropBlockedCells(painted, 4, { x: 1, y: 0 }, { x: 2, y: 0 }, false)).toEqual([0, 3]);
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
  ).toEqual({ files: ['crate'], labels: { crate: 'crate' } });
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
