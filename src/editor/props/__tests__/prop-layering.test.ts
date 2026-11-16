import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createProp, createSprite, parseProp } from '../../schema.js';
import { AssetStore } from '../../store.js';

it('defaults legacy props to normal layering and validates foreground and Z offsets', () => {
  const prop = createProp('overlay', { type: 'sprite', id: 'overlay-art', index: 0 });
  const { foreground: _, ...legacy } = prop;
  expect(parseProp(legacy)).toEqual({ ok: true, value: prop });
  for (const depthOffset of [-1024, 0, 1024]) {
    const layered = { ...prop, foreground: true, depthOffset };
    expect(parseProp(layered)).toEqual({ ok: true, value: layered });
  }
  for (const foreground of [null, 0, 1, 'true'])
    expect(parseProp({ ...prop, foreground }).ok).toBe(false);
  for (const depthOffset of [-1025, 1025, 0.5, '2'])
    expect(parseProp({ ...prop, depthOffset }).ok).toBe(false);
});

it('persists foreground and signed Z offsets with prop drafts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-prop-layering-'));
  try {
    const store = new AssetStore(root);
    const prop = createProp('overlay', { type: 'sprite', id: 'overlay-art', index: 0 });
    await store.saveSprite('overlay-art', createSprite('overlay-art', 1, 1));
    await store.savePropDraft(prop.id, prop, null);
    const edited = { ...prop, foreground: true, depthOffset: -12 };
    await store.savePropDraft(prop.id, edited, prop);
    expect(await store.readProp(prop.id)).toEqual(edited);
    await store.savePropDraft(prop.id, { ...edited, foreground: false, depthOffset: 8 }, edited);
    expect(await store.readProp(prop.id)).toMatchObject({ foreground: false, depthOffset: 8 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
