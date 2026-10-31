import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAssetRequest } from '../api.js';
import { characterAnimation, createAnimation, createCharacter, parseCharacter } from '../schema.js';
import { AssetStore } from '../store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('character assets', () => {
  it('opens legacy eight-state characters with directional talking fallbacks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-characters-'));
    roots.push(root);
    const character = createCharacter('hero', 'stand');
    const animations = Object.fromEntries(
      Object.entries(character.animations).filter(([state]) => !state.startsWith('talking-')),
    );
    await fs.mkdir(path.join(root, 'characters'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'characters', 'hero.json'),
      JSON.stringify({ ...character, animations }),
    );
    const loaded = await new AssetStore(root).readCharacter('hero');
    expect(loaded.label).toBe('hero');
    expect(loaded.animations['talking-up']).toBe('stand');
    expect(loaded.animations['talking-right']).toBe('stand');
  });

  it('validates directional and custom animation state names', () => {
    const character = createCharacter('hero', 'stand');
    expect(character.animations['talking-down']).toBe('stand');
    expect(parseCharacter(character)).toMatchObject({ ok: true, value: character });
    const { label: _label, ...legacy } = character;
    expect(parseCharacter(legacy)).toMatchObject({ ok: true, value: { label: 'hero' } });
    expect(parseCharacter({ ...character, label: '  Hero One  ' })).toMatchObject({
      ok: true,
      value: { id: 'hero', label: 'Hero One' },
    });
    expect(parseCharacter({ ...character, label: '' }).ok).toBe(false);
    expect(parseCharacter({ ...character, label: 'bad\nlabel' }).ok).toBe(false);
    const oldAnimations = Object.fromEntries(
      Object.entries(character.animations).filter(([state]) => !state.startsWith('talking-')),
    );
    expect(parseCharacter({ ...character, animations: oldAnimations })).toMatchObject({
      ok: true,
      value: { animations: { 'talking-up': 'stand', 'talking-down': 'stand' } },
    });
    expect(
      parseCharacter({
        ...character,
        animations: oldAnimations,
        customAnimations: { talking: 'speech' },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        animations: { 'talking-up': 'speech', 'talking-right': 'speech' },
        customAnimations: {},
      },
    });
    expect(
      parseCharacter({ ...character, animations: { ...character.animations, 'talking-up': '' } })
        .ok,
    ).toBe(false);
    expect(
      parseCharacter({ ...character, animations: { ...oldAnimations, talking: 'speech' } }),
    ).toMatchObject({
      ok: true,
      value: { animations: { 'talking-down': 'speech', 'talking-left': 'speech' } },
    });
    expect(
      parseCharacter({ ...character, animations: { ...oldAnimations, 'talking-up': 'speech' } }).ok,
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
      value: { animations: { 'talking-down': 'stand' }, customAnimations: {} },
    });
    expect(parseCharacter({ ...character, defaultFacing: 'diagonal' }).ok).toBe(false);
    character.animations['talking-up'] = 'speech';
    expect(characterAnimation(character, 'talking', 'up')).toBe('speech');
    expect(characterAnimation(character, 'talking', 'down')).toBe('stand');
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
    ).toEqual({ files: ['hero'], labels: { hero: 'hero' } });
    const facing = { ...base, defaultFacing: 'left' };
    const custom = { ...base, customAnimations: { jump: 'stand' } };
    expect((await put(base, facing)).status).toBe(200);
    expect((await put(base, custom)).status).toBe(200);
    expect(await store.readCharacter('hero')).toMatchObject({
      defaultFacing: 'left',
      customAnimations: { jump: 'stand' },
    });
    const saved = await store.readCharacter('hero');
    expect((await put(saved, { ...saved, label: 'Hero One' })).status).toBe(200);
    expect(await store.readCharacter('hero')).toMatchObject({ id: 'hero', label: 'Hero One' });
    expect(await store.characterLabels()).toEqual({ hero: 'Hero One' });
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
