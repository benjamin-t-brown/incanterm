import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../../api.js';
import { createScene } from '../../schema.js';
import { AssetStore } from '../../store.js';
import { renameScene } from '../scene-rename.js';
import { OPEN_SCENES_KEY, readSceneTabs } from '../scene-tabs.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('scene renaming', () => {
  it('changes only the display label, keeping the stable ID and other unsaved edits', () => {
    const scene = createScene('stable-room-id', 'Old room');
    scene.width = 42;
    const before = structuredClone(scene);
    renameScene(scene, '  New room  ');
    expect(scene).toEqual({ ...before, label: 'New room' });
  });

  it('supports legacy scenes without a label', () => {
    const scene = createScene('legacy-room');
    delete scene.label;
    renameScene(scene, 'Legacy room');
    expect(scene).toMatchObject({ id: 'legacy-room', label: 'Legacy room' });
  });

  it.each(['', '   ', 'x'.repeat(81), 'Room\nname', 'Room\u007f'])(
    'rejects invalid names without changing the draft: %j',
    (label) => {
      const scene = createScene('room', 'Original');
      const before = structuredClone(scene);
      expect(() => renameScene(scene, label)).toThrow('Scene label must be');
      expect(scene).toEqual(before);
    },
  );

  it('restores an unsaved rename without replacing the saved baseline', () => {
    const saved = createScene('room', 'Original');
    const doc = structuredClone(saved);
    renameScene(doc, 'Renamed room');
    const restored = readSceneTabs({
      getItem: (key) =>
        key === OPEN_SCENES_KEY
          ? JSON.stringify({
              version: 1,
              tabs: ['room'],
              active: 'room',
              drafts: { room: { doc, saved } },
            })
          : null,
    });
    expect(restored.drafts.room).toEqual({ doc, saved });
  });

  it('saves and reopens the renamed scene at its original asset URL and updates the library label', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-scene-rename-'));
    roots.push(root);
    const store = new AssetStore(root);
    const scene = createScene('stable-room-id', 'Original');
    await store.saveSceneDraft(scene.id, scene, null);
    const base = await store.readScene(scene.id);
    const doc = structuredClone(base);
    renameScene(doc, 'Renamed room');
    const response = await dispatchAssetRequest(
      store,
      'PUT',
      `/api/scenes/${scene.id}`,
      JSON.stringify({ doc, base }),
    );
    expect(response.status).toBe(200);
    expect(await store.readScene(scene.id)).toEqual({ ...base, label: 'Renamed room' });
    const list = await dispatchAssetRequest(store, 'GET', '/api/scenes', '');
    expect(JSON.parse(String(list.body))).toEqual({
      files: ['stable-room-id'],
      labels: { 'stable-room-id': 'Renamed room' },
    });
  });
});
