import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createPropSlideFixtureDocuments } from '../../../game/__tests__/prop-slide-fixture.js';
import { loadScene } from '../../../game/load-scene.js';
import { Prop } from '../../../game/scene.js';
import { createScene, parseScene, type SceneEntity } from '../../schema.js';
import { AssetStore } from '../../store.js';

it('round-trips action scripts on reusable props and directly placed sprites without slide data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-prop-action-'));
  try {
    const { prop, sprite } = createPropSlideFixtureDocuments();
    const store = new AssetStore(root);
    await store.saveSprite(sprite.id, sprite);
    await store.savePropDraft(prop.id, prop, null);
    const scene = createScene('actions');
    scene.entities = [
      { id: 'cabinet', type: 'Prop', prop: prop.id, x: 2, y: 2, z: 0, actionScript: 'openCabinet' },
      { id: 'sign', type: 'Prop', sprite: sprite.id, x: 6, y: 2, z: 0, depthOffset: 0, actionScript: 'readSign' },
    ];
    await store.saveSceneDraft(scene.id, scene, null);
    expect(await store.readScene(scene.id)).toEqual(scene);
    const runtime = await loadScene(root, scene.id);
    expect(runtime.propSlide).toBeUndefined();
    expect(runtime.entities.map((entity) => entity instanceof Prop && entity.clone().actionScript))
      .toEqual(['openCabinet', 'readSign']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('rejects invalid action names and action bindings on non-props', () => {
  const scene = createScene('actions');
  const prop: SceneEntity = { id: 'sign', type: 'Prop', sprite: 'art', x: 0, y: 0, z: 0, depthOffset: 0 };
  for (const actionScript of ['', 'bad name', '@readSign', 42]) {
    expect(parseScene({ ...scene, entities: [{ ...prop, actionScript }] }))
      .toMatchObject({ ok: false, error: expect.stringContaining('actionScript must be an RPGScript name') });
  }
  expect(parseScene({ ...scene, entities: [{ ...prop, type: 'Background', actionScript: 'readSign' }] }))
    .toMatchObject({ ok: false, error: expect.stringContaining('Only scene props can have an actionScript') });
});
