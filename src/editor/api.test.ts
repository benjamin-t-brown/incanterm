import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAssetRequest } from './api.js';
import { createReference } from './reference.js';
import { createSprite } from './schema.js';
import { AssetStore } from './store.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const roots: string[] = [];

async function tempStore(): Promise<AssetStore> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-assets-'));
  roots.push(root);
  return new AssetStore(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('asset API', () => {
  it('round-trips a sprite and keeps the last valid file', async () => {
    const store = await tempStore();
    const sprite = createSprite('mark', 2, 1);
    sprite.sprites[0].layers[0].cells[0] = { ch: '█', fg: 'bright-white', bg: 'black' };
    let response = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/sprites/mark',
      JSON.stringify(sprite),
    );
    expect(response.status).toBe(200);
    const stored = JSON.parse(
      await fs.readFile(path.join(store.root, 'sprites', 'mark.json'), 'utf8'),
    ) as unknown;
    expect(stored).toHaveProperty('cellPalette');
    response = await dispatchAssetRequest(store, 'GET', '/api/sprites/mark', '');
    expect(JSON.parse(String(response.body))).toMatchObject({ id: 'mark', width: 2 });

    const invalid = { ...sprite, width: 999 };
    response = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/sprites/mark',
      JSON.stringify(invalid),
    );
    expect(response.status).toBe(422);
    response = await dispatchAssetRequest(store, 'GET', '/api/sprites/mark', '');
    expect(JSON.parse(String(response.body))).toMatchObject({ width: 2, height: 1 });
  });

  it('rejects a palette that adds a color and a renamed sprite id', async () => {
    const store = await tempStore();
    const palette = await store.palette();
    const extra = { ...palette, colors: [...palette.colors, { id: 'new', rgb: '#000000' }] };
    const response = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/palette',
      JSON.stringify(extra),
    );
    expect(response.status).toBe(422);

    const sprite = createSprite('mark', 1, 1);
    const renamed = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/sprites/mark',
      JSON.stringify({ ...sprite, id: 'other' }),
    );
    expect(renamed.status).toBe(422);
    expect((await store.listSprites()).includes('mark')).toBe(false);
  });

  it('blocks an animation that references a missing sprite and duplicates a clip', async () => {
    const store = await tempStore();
    const sprite = createSprite('lamp', 1, 1);
    await store.saveSprite('lamp', sprite);
    const missing = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/animations/blink',
      JSON.stringify({
        format: 'incanterm-animation',
        version: 1,
        id: 'blink',
        loop: false,
        frames: [{ sprite: 'gone', index: 0, durationMs: 100 }],
      }),
    );
    expect(missing.status).toBe(422);
    expect(await store.listAnimations()).toEqual([]);

    const tooFar = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/animations/blink',
      JSON.stringify({
        format: 'incanterm-animation',
        version: 1,
        id: 'blink',
        loop: false,
        frames: [{ sprite: 'lamp', index: 1, durationMs: 100 }],
      }),
    );
    expect(tooFar.status).toBe(422);
    expect(await store.listAnimations()).toEqual([]);

    await store.saveAnimation('blink', {
      format: 'incanterm-animation',
      version: 1,
      id: 'blink',
      loop: true,
      frames: [{ sprite: 'lamp', index: 0, durationMs: 100 }],
    });
    const copy = await dispatchAssetRequest(
      store,
      'POST',
      '/api/duplicate',
      JSON.stringify({ kind: 'animation', from: 'blink', id: 'blink-copy' }),
    );
    expect(copy.status).toBe(200);
    expect(await store.listAnimations()).toEqual(['blink', 'blink-copy']);

    const hold = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/animations/hold',
      JSON.stringify({
        format: 'incanterm-animation',
        version: 1,
        id: 'hold',
        loop: true,
        frames: [{ invisible: true, durationMs: 120 }],
      }),
    );
    expect(hold.status).toBe(200);
  });

  it('diagnoses scripts across files and streams only audio names inside the folder', async () => {
    const store = await tempStore();
    await store.saveScript('other', '@other\n');
    const response = await dispatchAssetRequest(
      store,
      'POST',
      '/api/scripts/diagnose',
      JSON.stringify({ id: 'intro', source: "@intro\n+callScript('missing')\n" }),
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(String(response.body)).diagnostics).toEqual([
      { line: 2, severity: 'error', message: 'No script exists with name "missing".' },
    ]);

    await fs.mkdir(path.join(store.root, 'audio'), { recursive: true });
    await fs.writeFile(path.join(store.root, 'audio', 'blip.wav'), Buffer.from('RIFF'));
    const audio = await dispatchAssetRequest(store, 'GET', '/api/audio/blip.wav', '');
    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/wav');
    const escaped = await dispatchAssetRequest(store, 'GET', '/api/audio/..%2Fpalette.json', '');
    expect(escaped.status).toBe(400);
    const upload = await dispatchAssetRequest(store, 'PUT', '/api/audio/blip.wav', 'nope');
    expect(upload.status).toBe(405);
  });

  it('stores a sprite reference image and placement, then copies and deletes it', async () => {
    const store = await tempStore();
    const sprite = createSprite('mark', 4, 2);
    expect(
      (await dispatchAssetRequest(store, 'PUT', '/api/sprites/mark', JSON.stringify(sprite)))
        .status,
    ).toBe(200);

    const missing = await dispatchAssetRequest(store, 'GET', '/api/references/mark', '');
    expect(missing.status).toBe(404);
    const spriteStill = await dispatchAssetRequest(store, 'GET', '/api/sprites/mark', '');
    expect(spriteStill.status).toBe(200);

    const rejected = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/references/mark/image',
      Buffer.from('not-an-image'),
      'text/plain',
    );
    expect(rejected.status).toBe(422);

    const uploaded = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/references/mark/image',
      TINY_PNG,
      'image/png',
    );
    expect(uploaded.status).toBe(200);
    expect(JSON.parse(String(uploaded.body))).toEqual({ ext: 'png' });

    const meta = createReference('mark', 'png', { x: -1, y: 0.5, width: 4, height: 2 }, 0.4);
    const saved = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/references/mark',
      JSON.stringify(meta),
    );
    expect(saved.status).toBe(200);
    expect(JSON.parse(String(saved.body))).toMatchObject({
      id: 'mark',
      ext: 'png',
      x: -1,
      opacity: 0.4,
    });

    const image = await dispatchAssetRequest(store, 'GET', '/api/references/mark/image', '');
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(Buffer.isBuffer(image.body) ? image.body.equals(TINY_PNG) : false).toBe(true);

    const copy = await dispatchAssetRequest(
      store,
      'POST',
      '/api/duplicate',
      JSON.stringify({ kind: 'sprite', from: 'mark', id: 'mark-copy' }),
    );
    expect(copy.status).toBe(200);
    const copiedMeta = await dispatchAssetRequest(store, 'GET', '/api/references/mark-copy', '');
    expect(copiedMeta.status).toBe(200);
    expect(JSON.parse(String(copiedMeta.body))).toMatchObject({
      id: 'mark-copy',
      ext: 'png',
      x: -1,
    });
    const copiedImage = await dispatchAssetRequest(
      store,
      'GET',
      '/api/references/mark-copy/image',
      '',
    );
    expect(copiedImage.status).toBe(200);
    expect(Buffer.isBuffer(copiedImage.body) ? copiedImage.body.equals(TINY_PNG) : false).toBe(
      true,
    );

    const removed = await dispatchAssetRequest(store, 'DELETE', '/api/sprites/mark', '');
    expect(removed.status).toBe(200);
    expect((await dispatchAssetRequest(store, 'GET', '/api/sprites/mark', '')).status).toBe(404);
    expect((await dispatchAssetRequest(store, 'GET', '/api/references/mark', '')).status).toBe(404);
    expect(
      (await dispatchAssetRequest(store, 'GET', '/api/references/mark/image', '')).status,
    ).toBe(404);
    expect((await dispatchAssetRequest(store, 'GET', '/api/references/mark-copy', '')).status).toBe(
      200,
    );
  });
});
