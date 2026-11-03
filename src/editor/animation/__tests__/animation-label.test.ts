import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../../api.js';
import { createAnimation, parseAnimation } from '../../schema.js';
import { AssetStore } from '../../store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('loads legacy clips with their original id as label and validates new labels', () => {
  const old = createAnimation('walk');
  expect(parseAnimation({ ...old, label: undefined })).toMatchObject({
    ok: true,
    value: { id: 'walk', label: 'walk' },
  });
  expect(parseAnimation({ ...old, label: '  ' }).ok).toBe(false);
  expect(parseAnimation({ ...old, label: 'bad\nlabel' }).ok).toBe(false);
});

it('lists and edits labels while keeping references to animation IDs intact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-animation-label-'));
  roots.push(root);
  const store = new AssetStore(root);
  const id = crypto.randomUUID();
  const original = createAnimation(id, 'Idle down');
  const put = (base: unknown, doc: unknown) =>
    dispatchAssetRequest(store, 'PUT', `/api/animations/${id}`, JSON.stringify({ base, doc }));
  expect((await put(null, original)).status).toBe(200);
  const renamed = { ...original, label: 'Standing south' };
  expect((await put(original, renamed)).status).toBe(200);
  expect((await store.readAnimation(id)).id).toBe(id);
  expect(
    JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/animations', '')).body)),
  ).toEqual({ files: [id], labels: { [id]: 'Standing south' } });
  const copiedId = crypto.randomUUID();
  const copied = await dispatchAssetRequest(
    store,
    'POST',
    `/api/animations/${id}/copy`,
    JSON.stringify({
      id: copiedId,
      doc: { ...renamed, id: copiedId, label: 'Standing south copy' },
    }),
  );
  expect(copied.status).toBe(200);
  expect(await store.readAnimation(copiedId)).toMatchObject({
    id: copiedId,
    label: 'Standing south copy',
  });
});
