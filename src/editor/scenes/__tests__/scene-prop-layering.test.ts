import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createProp, createScene, createSprite, parseScene } from '../../schema.js';
import { AssetStore } from '../../store.js';
import { copySceneObjects, pasteSceneObjects } from '../scene-clipboard.js';
import { addSceneProp } from '../scene-props.js';

it('validates per-instance signed Z offsets and accepts old scenes without them', () => {
  const scene = createScene('room');
  const entry = { id: 'box', type: 'Prop' as const, prop: 'box-asset', x: 0, y: 0, z: 0 };
  scene.entities = [entry];
  expect(parseScene(scene)).toEqual({ ok: true, value: scene });
  for (const depthOffset of [-1024, 0, 1024]) {
    scene.entities = [{ ...entry, depthOffset }];
    expect(parseScene(scene)).toEqual({ ok: true, value: scene });
  }
  for (const depthOffset of [-1025, 1025, 0.5, '2', null]) {
    expect(parseScene({ ...scene, entities: [{ ...entry, depthOffset }] }).ok).toBe(false);
  }
});

it('saves independent offsets and copies them without changing the reusable prop', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-instance-layering-'));
  try {
    const store = new AssetStore(root);
    const prop = createProp('box', { type: 'sprite', id: 'box-art', index: 0 });
    prop.depthOffset = 50;
    await store.saveSprite('box-art', createSprite('box-art', 1, 1));
    await store.savePropDraft(prop.id, prop, null);
    const scene = createScene('room');
    const first = addSceneProp(scene, prop, 2, 3);
    const second = addSceneProp(scene, prop, 4, 3);
    expect(first.depthOffset).toBe(0);
    expect(second.depthOffset).toBe(0);
    first.depthOffset = -12;
    second.depthOffset = 8;
    const copied = copySceneObjects(scene, [{ kind: 'entity', id: first.id }]);
    pasteSceneObjects(scene, copied, { x: 6, y: 3 }, () => 'copy');
    await store.saveSceneDraft(scene.id, scene, null);
    expect(await store.readScene(scene.id)).toMatchObject({
      entities: [
        { id: first.id, z: 0, depthOffset: -12 },
        { id: second.id, z: 0, depthOffset: 8 },
        { id: 'copy', z: 0, depthOffset: -12 },
      ],
    });
    expect(await store.readProp(prop.id)).toEqual(prop);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
