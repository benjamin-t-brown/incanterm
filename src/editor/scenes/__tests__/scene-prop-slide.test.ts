import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  createPropSlideFixtureDocuments,
  createPropSlideScene,
} from '../../../game/__tests__/prop-slide-fixture.js';
import { CellBuffer } from '../../../game/cell-buffer.js';
import { loadScene } from '../../../game/load-scene.js';
import { Prop } from '../../../game/scene.js';
import { getSceneSlideSetup, getSlidePath } from '../../../game/prop-slide.js';
import { createScene, parseScene } from '../../schema.js';
import { AssetStore } from '../../store.js';

it('round-trips editor JSON and loads the same board without treating walking masks as slide masks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-shelves-'));
  try {
    const store = new AssetStore(root);
    const { scene, sprite, prop } = createPropSlideFixtureDocuments();
    await store.saveSprite(sprite.id, sprite);
    await store.savePropDraft(prop.id, prop, null);
    await store.saveSceneDraft(scene.id, scene, null);
    const reopened = await store.readScene(scene.id);
    expect(reopened).toEqual(scene);
    expect(await store.readProp(prop.id)).toEqual(prop);
    const runtime = await loadScene(root, scene.id);
    const editorSetup = getSceneSlideSetup(reopened);
    const runtimeSetup = getSceneSlideSetup(runtime);
    if (!editorSetup || !runtimeSetup) throw new Error('Expected editor and runtime slide boards');
    expect(runtimeSetup).toEqual(editorSetup);
    expect(runtime.blockedCells.has(19)).toBe(true); // Scene walking block at (3,2).
    expect(runtime.blockedCells.has(20)).toBe(true); // Other shelf's walking block at (4,2).
    expect(runtime.blockedCells.has(27)).toBe(true); // Prop walking block at (3,3).
    expect(runtime.blockedCells.has(12)).toBe(false); // Walking-clear hole at (4,1).

    const right = getSlidePath(editorSetup.board, editorSetup.positions, 'first', 'right');
    expect(right).toEqual({
      ok: true,
      path: [{ x: 3, y: 2 }, { x: 4, y: 2 }],
      finalAnchor: { x: 4, y: 2 },
      obstruction: { cell: { x: 4, y: 1 }, reason: 'outside-travel' },
    });
    expect(getSlidePath(runtimeSetup.board, runtimeSetup.positions, 'first', 'right')).toEqual(right);
    expect(getSlidePath(runtimeSetup.board, runtimeSetup.positions, 'first', 'down')).toMatchObject({
      ok: true,
      path: [{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }],
    });
    expect(getSlidePath(runtimeSetup.board, runtimeSetup.positions, 'second', 'right')).toMatchObject({
      ok: true,
      path: [{ x: 6, y: 3 }, { x: 7, y: 3 }],
    });

    const first = runtime.entities[0];
    if (!(first instanceof Prop)) throw new Error('Expected a loaded prop');
    const clone = first.clone();
    expect(clone.slidable).toEqual(scene.entities[0].slidable);
    clone.x = 4;
    expect(first.x).toBe(2);
    const buffer = new CellBuffer(runtime.width, runtime.height, runtime.clear);
    runtime.draw(buffer, 0, 0);
    // The top-left glyph and the (-1,-1) painted cell share the same scene position.
    expect(buffer.get(1, 1).ch).toBe('S');
    expect(buffer.get(2, 2).ch).toBe(' ');

    // A malformed hand-edited scene is rejected by the same shelf validator at runtime.
    scene.entities[0].slidable = { footprint: [], actionScript: 'pushShelf' };
    await fs.writeFile(path.join(root, 'scenes', `${scene.id}.json`), JSON.stringify(scene));
    await expect(loadScene(root, scene.id)).rejects.toThrow('Prop first needs a nonempty slide footprint');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('opens a provisional shelfSlide draft and writes the generic propSlide key', () => {
  const { propSlide, ...scene } = createPropSlideScene();
  expect(parseScene({ ...scene, shelfSlide: propSlide })).toEqual({ ok: true, value: { ...scene, propSlide } });
});

it('loads the shared slide mask from the saved prop, independently of walking paint and instance bindings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-slide-asset-'));
  try {
    const store = new AssetStore(root);
    const { scene, prop, sprite } = createPropSlideFixtureDocuments();
    for (const entry of scene.entities) entry.slidable = { actionScript: 'push' };
    await store.saveSprite(sprite.id, sprite);
    await store.savePropDraft(prop.id, { ...prop, slideCells: [0, 4] }, null);
    await store.saveSceneDraft(scene.id, scene, null);
    const loadBoard = async () => {
      const setup = getSceneSlideSetup(await loadScene(root, scene.id));
      if (!setup) throw new Error('Expected a slide board');
      return getSlidePath(setup.board, setup.positions, 'first', 'right');
    };
    expect(await loadBoard()).toMatchObject({ finalAnchor: { x: 3, y: 2 }, obstruction: { instanceId: 'second' } });
    const oldProp = await store.readProp(prop.id);
    await store.savePropDraft(prop.id, { ...oldProp, slideCells: [4] }, oldProp);
    expect(await loadBoard()).toMatchObject({ finalAnchor: { x: 7, y: 2 } });
    expect((await store.readProp(prop.id)).blockedCells).toEqual(prop.blockedCells);
    expect(await store.readScene(scene.id)).toEqual(scene);
    const updated = await store.readProp(prop.id);
    await store.savePropDraft(prop.id, { ...updated, slideCells: [] }, updated);
    await expect(loadBoard()).rejects.toThrow('nonempty slide footprint');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it.each([
  [[0, 0], 'unique indexes'],
  [[48], 'inside the scene'],
  [[-1], 'inside the scene'],
  [[1.5], 'unique indexes'],
])('rejects invalid travel indexes %j', (travelCells, error) => {
  const scene = createPropSlideScene();
  expect(parseScene({ ...scene, propSlide: { ...scene.propSlide, travelCells } })).toEqual({
    ok: false,
    error: expect.stringContaining(error),
  });
});

it.each([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0.5 }, { x: 1 }, null])(
  'rejects invalid direction vector %j',
  (right) => {
    const scene = createPropSlideScene();
    expect(
      parseScene({
        ...scene,
        propSlide: { ...scene.propSlide, directions: { ...scene.propSlide.directions, right } },
      }),
    ).toEqual({ ok: false, error: expect.stringContaining('right must be a nonzero unit vector') });
  },
);

it.each([
  [[], 'nonempty slide footprint'],
  [[{ x: 0, y: 0 }, { x: 0, y: 0 }], 'offsets must be unique'],
  [[{ x: 0.5, y: 0 }], 'offsets must be integers'],
  [[{ x: -3, y: 0 }], 'starts outside prop travel'],
  [[{ x: 2, y: -1 }], 'starts outside prop travel'],
  [[{ x: 3, y: 1 }], 'overlaps prop first'],
])('rejects an illegal starting footprint %j', (footprint, error) => {
  const scene = createPropSlideScene();
  scene.entities[0].slidable = { actionScript: 'pushShelf', footprint };
  expect(parseScene(scene)).toEqual({ ok: false, error: expect.stringContaining(error) });
});

it('requires all four directions, a travel area, and a valid instance action binding', () => {
  const scene = createPropSlideScene();
  const { left, right, up } = scene.propSlide.directions;
  expect(
    parseScene({ ...scene, propSlide: { ...scene.propSlide, directions: { left, right, up } } }),
  ).toEqual({ ok: false, error: expect.stringContaining('left, right, up, and down') });
  expect(parseScene({ ...scene, propSlide: undefined })).toEqual({
    ok: false,
    error: expect.stringContaining('Prop first requires a scene propSlide'),
  });
  const [first] = scene.entities;
  expect(parseScene({ ...scene, entities: [{ ...first, type: 'Marker' }] })).toEqual({
    ok: false,
    error: expect.stringContaining('Only scene props can be slidable'),
  });
  expect(
    parseScene({ ...scene, entities: [{ ...first, slidable: { footprint: [{ x: 0, y: 0 }] } }] }),
  ).toEqual({
    ok: false,
    error: expect.stringContaining('Prop first actionScript must be an RPGScript name'),
  });
  const legacy = createScene('legacy');
  expect(parseScene(legacy)).toEqual({ ok: true, value: legacy });
});
