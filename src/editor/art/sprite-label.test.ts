import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../api.js';
import { createAnimation, createSprite, parseSprite } from '../schema.js';
import { AssetStore } from '../store.js';
import { encodeStoredSprite, parseStoredSprite } from './sprite-storage.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('sprite labels', () => {
  it('keeps legacy IDs stable and validates labels separately', () => {
    const legacy = createSprite('old-name', 1, 1);
    const parsed = parseSprite({ ...legacy, label: undefined });
    expect(parsed).toMatchObject({ ok: true, value: { id: 'old-name', label: 'old-name' } });
    expect(encodeStoredSprite(legacy)).not.toContain('"label"');
    const renamed = { ...legacy, label: 'A friendly name' };
    expect(parseStoredSprite(JSON.parse(encodeStoredSprite(renamed)))).toMatchObject({
      ok: true,
      value: { id: 'old-name', label: 'A friendly name' },
    });
    expect(parseSprite({ ...renamed, label: '  ' }).ok).toBe(false);
    expect(parseSprite({ ...renamed, label: 'bad\nname' }).ok).toBe(false);
  });

  it('lists display labels and changes one without changing animation references', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-labels-'));
    roots.push(root);
    const store = new AssetStore(root);
    const id = crypto.randomUUID();
    const original = createSprite(id, 1, 1, 'Johnathan');
    const animation = createAnimation('walk');
    animation.frames.push({ sprite: id, index: 0, durationMs: 100 });
    const put = (base: unknown, doc: unknown) =>
      dispatchAssetRequest(store, 'PUT', `/api/sprites/${id}`, JSON.stringify({ base, doc }));
    expect((await put(null, original)).status).toBe(200);
    await store.saveAnimation('walk', animation);
    const renamed = { ...original, label: 'Johnathan — walking' };
    expect((await put(original, renamed)).status).toBe(200);
    expect((await store.readSprite(id)).id).toBe(id);
    expect((await store.readAnimation('walk')).frames[0]).toMatchObject({ sprite: id });
    expect(
      JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/sprites', '')).body)),
    ).toEqual({ files: [id], labels: { [id]: renamed.label } });
    const duplicateId = crypto.randomUUID();
    const duplicate = await dispatchAssetRequest(
      store,
      'POST',
      '/api/duplicate',
      JSON.stringify({
        kind: 'sprite',
        from: id,
        id: duplicateId,
        label: 'Copy of Johnathan',
      }),
    );
    expect(duplicate.status).toBe(200);
    expect(await store.readSprite(duplicateId)).toMatchObject({
      id: duplicateId,
      label: 'Copy of Johnathan',
    });
  });
});
