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
  it('accepts a reference image replacement only from its latest revision', async () => {
    const store = await tempStore();
    const url = '/api/references/photo/image';
    const first = await dispatchAssetRequest(store, 'PUT', url, TINY_PNG, 'image/png', null);
    expect(first.status).toBe(200);
    const revision = (JSON.parse(String(first.body)) as { revision: string }).revision;
    const changed = Buffer.concat([TINY_PNG, Buffer.from([0])]);
    const replacement = await dispatchAssetRequest(
      store,
      'PUT',
      url,
      changed,
      'image/png',
      revision,
    );
    expect(replacement.status).toBe(200);
    expect(
      (await dispatchAssetRequest(store, 'PUT', url, TINY_PNG, 'image/png', revision)).status,
    ).toBe(409);
    expect((await store.readReferenceImage('photo')).bytes.equals(changed)).toBe(true);
    expect((await dispatchAssetRequest(store, 'PUT', url, changed, 'image/png')).status).toBe(428);
  });

  it('uses the same safe save path for scripts, animations, palette and reference metadata', async () => {
    const store = await tempStore();
    const put = (url: string, base: unknown, doc: unknown) =>
      dispatchAssetRequest(store, 'PUT', url, JSON.stringify({ base, doc }));
    const script = { id: 'intro', source: 'one\ntwo\n' };
    expect((await put('/api/scripts/intro', null, script)).status).toBe(200);
    const mergedScript = await put('/api/scripts/intro', script, {
      ...script,
      source: 'ONE\ntwo\n',
    });
    expect(mergedScript.status).toBe(200);
    expect(
      (await put('/api/scripts/intro', script, { ...script, source: 'one\nTWO\n' })).body,
    ).toContain('ONE\\nTWO');
    expect(
      (await put('/api/scripts/intro', script, { ...script, source: 'X\ntwo\n' })).status,
    ).toBe(409);
    expect((await store.readScript('intro')).source).toBe('ONE\nTWO\n');

    const animation = {
      format: 'incanterm-animation',
      version: 1,
      id: 'blink',
      loop: false,
      defaultDurationMs: 100,
      frames: [],
    };
    expect((await put('/api/animations/blink', null, animation)).status).toBe(200);
    expect(
      (await put('/api/animations/blink', animation, { ...animation, loop: true })).status,
    ).toBe(200);
    expect(
      (await put('/api/animations/blink', animation, { ...animation, defaultDurationMs: 200 }))
        .status,
    ).toBe(200);
    expect(await store.readAnimation('blink')).toMatchObject({
      loop: true,
      defaultDurationMs: 200,
    });

    const palette = await store.palette();
    const color = (index: number, rgb: string) => ({
      ...palette,
      colors: palette.colors.map((entry, at) => (at === index ? { ...entry, rgb } : entry)),
    });
    expect((await put('/api/palette', palette, color(0, '#111111'))).status).toBe(200);
    expect((await put('/api/palette', palette, color(1, '#222222'))).status).toBe(200);
    expect((await store.palette()).colors.slice(0, 2).map((entry) => entry.rgb)).toEqual([
      '#111111',
      '#222222',
    ]);

    const reference = createReference('test', 'png', { x: 0, y: 0, width: 2, height: 2 });
    expect((await put('/api/references/test', null, reference)).status).toBe(200);
    expect((await put('/api/references/test', reference, { ...reference, x: 1 })).status).toBe(200);
    expect((await put('/api/references/test', reference, { ...reference, y: 2 })).status).toBe(200);
    expect(await store.readReference('test')).toMatchObject({ x: 1, y: 2 });
  });

  it('merges two concurrent editors saving distinct cells and rejects conflicting edits', async () => {
    const store = await tempStore();
    const base = createSprite('shared', 2, 1);
    const save = (doc: typeof base, snapshot: typeof base | null) =>
      dispatchAssetRequest(
        store,
        'PUT',
        '/api/sprites/shared',
        JSON.stringify({ base: snapshot, doc }),
      );
    expect((await save(base, null)).status).toBe(200);
    const left = structuredClone(base);
    left.sprites[0].layers[0].cells[0] = { ch: 'L', fg: 'white', bg: 'black' };
    const right = structuredClone(base);
    right.sprites[0].layers[0].cells[1] = { ch: 'R', fg: 'white', bg: 'black' };
    const responses = await Promise.all([save(left, base), save(right, base)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await store.readSprite('shared')).sprites[0].layers[0].cells).toEqual([
      left.sprites[0].layers[0].cells[0],
      right.sprites[0].layers[0].cells[1],
    ]);

    const clash = structuredClone(base);
    clash.sprites[0].layers[0].cells[0] = { ch: 'X', fg: 'white', bg: 'black' };
    expect((await save(clash, base)).status).toBe(409);
    expect((await store.readSprite('shared')).sprites[0].layers[0].cells[0]).toEqual(
      left.sprites[0].layers[0].cells[0],
    );
    expect((await save(right, null)).status).toBe(409);
    expect(
      (await dispatchAssetRequest(store, 'PUT', '/api/sprites/shared', JSON.stringify(right)))
        .status,
    ).toBe(400);
  });

  it('does not recreate a deleted sprite from a stale editor', async () => {
    const store = await tempStore();
    const base = createSprite('gone', 1, 1);
    await store.saveSprite('gone', base);
    await store.deleteSprite('gone');
    const response = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/sprites/gone',
      JSON.stringify({ base, doc: base }),
    );
    expect(response.status).toBe(409);
    expect((await store.listSprites()).includes('gone')).toBe(false);
  });

  it('round-trips a sprite and keeps the last valid file', async () => {
    const store = await tempStore();
    const sprite = createSprite('mark', 2, 1);
    sprite.sprites[0].layers[0].cells[0] = { ch: '█', fg: 'bright-white', bg: 'black' };
    let response = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/sprites/mark',
      JSON.stringify({ base: null, doc: sprite }),
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
      JSON.stringify({ base: sprite, doc: invalid }),
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
      JSON.stringify({ base: palette, doc: extra }),
    );
    expect(response.status).toBe(422);

    const sprite = createSprite('mark', 1, 1);
    const renamed = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/sprites/mark',
      JSON.stringify({ base: null, doc: { ...sprite, id: 'other' } }),
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
        base: null,
        doc: {
          format: 'incanterm-animation',
          version: 1,
          id: 'blink',
          loop: false,
          frames: [{ sprite: 'gone', index: 0, durationMs: 100 }],
        },
      }),
    );
    expect(missing.status).toBe(422);
    expect(await store.listAnimations()).toEqual([]);

    const tooFar = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/animations/blink',
      JSON.stringify({
        base: null,
        doc: {
          format: 'incanterm-animation',
          version: 1,
          id: 'blink',
          loop: false,
          frames: [{ sprite: 'lamp', index: 1, durationMs: 100 }],
        },
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
        base: null,
        doc: {
          format: 'incanterm-animation',
          version: 1,
          id: 'hold',
          loop: true,
          frames: [{ invisible: true, durationMs: 120 }],
        },
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
      (
        await dispatchAssetRequest(
          store,
          'PUT',
          '/api/sprites/mark',
          JSON.stringify({ base: null, doc: sprite }),
        )
      ).status,
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
      null,
    );
    expect(rejected.status).toBe(422);

    const uploaded = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/references/mark/image',
      TINY_PNG,
      'image/png',
      null,
    );
    expect(uploaded.status).toBe(200);
    expect(JSON.parse(String(uploaded.body))).toMatchObject({ ext: 'png' });

    const meta = createReference('mark', 'png', { x: -1, y: 0.5, width: 4, height: 2 }, 0.4);
    const saved = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/references/mark',
      JSON.stringify({ base: null, doc: meta }),
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
    expect(image.headers['x-asset-revision']).toBe(JSON.parse(String(uploaded.body)).revision);
    expect(image.headers['content-type']).toBe('image/png');
    expect(Buffer.isBuffer(image.body) ? image.body.equals(TINY_PNG) : false).toBe(true);
    const staleUpload = await dispatchAssetRequest(
      store,
      'PUT',
      '/api/references/mark/image',
      Buffer.concat([TINY_PNG, Buffer.from([0])]),
      'image/png',
      null,
    );
    expect(staleUpload.status).toBe(409);
    expect((await store.readReferenceImage('mark')).bytes.equals(TINY_PNG)).toBe(true);

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
