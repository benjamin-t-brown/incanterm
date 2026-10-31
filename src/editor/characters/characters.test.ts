import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../api.js';
import { createAnimation, createCharacter, parseCharacter } from '../schema.js';
import { AssetStore } from '../store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('character assets', () => {
  it('opens legacy eight-state characters with a talking fallback', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-characters-'));
    roots.push(root);
    const character = createCharacter('hero', 'stand');
    const { talking: _talking, ...animations } = character.animations;
    await fs.mkdir(path.join(root, 'characters'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'characters', 'hero.json'),
      JSON.stringify({ ...character, animations }),
    );
    expect((await new AssetStore(root).readCharacter('hero')).animations.talking).toBe('stand');
  });

  it('validates directional and custom animation state names', () => {
    const character = createCharacter('hero', 'stand');
    expect(character.animations.talking).toBe('stand');
    expect(parseCharacter(character)).toMatchObject({ ok: true, value: character });
    const { talking: _talking, ...oldAnimations } = character.animations;
    expect(parseCharacter({ ...character, animations: oldAnimations })).toMatchObject({
      ok: true,
      value: { animations: { talking: 'stand' } },
    });
    expect(
      parseCharacter({
        ...character,
        animations: oldAnimations,
        customAnimations: { talking: 'speech' },
      }),
    ).toMatchObject({
      ok: true,
      value: { animations: { talking: 'speech' }, customAnimations: {} },
    });
    expect(
      parseCharacter({ ...character, animations: { ...character.animations, talking: '' } }).ok,
    ).toBe(false);
    expect(
      parseCharacter({ ...character, animations: { ...character.animations, 'idle-up': '' } }).ok,
    ).toBe(false);
    expect(
      parseCharacter({ ...character, animations: { ...character.animations, extra: 'stand' } }).ok,
    ).toBe(false);
    expect(parseCharacter({ ...character, customAnimations: { 'walk-up': 'stand' } }).ok).toBe(
      false,
    );
    expect(parseCharacter({ ...character, customAnimations: { jump: 'stand' } }).ok).toBe(true);
    expect(parseCharacter({ ...character, customAnimations: { talking: 'stand' } })).toMatchObject({
      ok: true,
      value: { animations: { talking: 'stand' }, customAnimations: {} },
    });
    expect(parseCharacter({ ...character, defaultFacing: 'diagonal' }).ok).toBe(false);
  });

  it('creates, lists, merges and deletes through the safe-save API', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-characters-'));
    roots.push(root);
    const store = new AssetStore(root);
    await store.saveAnimation('stand', createAnimation('stand'));
    const base = createCharacter('hero', 'stand');
    const put = (snapshot: unknown, doc: unknown) =>
      dispatchAssetRequest(
        store,
        'PUT',
        '/api/characters/hero',
        JSON.stringify({ base: snapshot, doc }),
      );
    expect((await put(null, base)).status).toBe(200);
    expect(
      JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/characters', '')).body)),
    ).toEqual({ files: ['hero'] });
    const facing = { ...base, defaultFacing: 'left' };
    const custom = { ...base, customAnimations: { jump: 'stand' } };
    expect((await put(base, facing)).status).toBe(200);
    expect((await put(base, custom)).status).toBe(200);
    expect(await store.readCharacter('hero')).toMatchObject({
      defaultFacing: 'left',
      customAnimations: { jump: 'stand' },
    });
    expect((await put(base, { ...base, defaultFacing: 'right' })).status).toBe(409);
    expect((await put(null, createCharacter('hero', 'missing'))).status).toBe(409);
    expect(
      (
        await put(await store.readCharacter('hero'), {
          ...custom,
          defaultFacing: 'left',
          animations: { ...base.animations, 'idle-up': 'missing' },
        })
      ).status,
    ).toBe(422);
    expect((await dispatchAssetRequest(store, 'DELETE', '/api/characters/hero', '')).status).toBe(
      200,
    );
    expect(await store.listCharacters()).toEqual([]);
  });
});
