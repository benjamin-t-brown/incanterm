import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadScene } from '../../game/load-scene.js';
import { CellBuffer } from '../../game/cell-buffer.js';
import { Background } from '../../game/scene.js';
import { dispatchAssetRequest } from '../api.js';
import {
  createAnimation,
  createCharacter,
  createProp,
  createScene,
  createSprite,
  parseScene,
} from '../schema.js';
import { addSceneCharacter } from './scene-characters.js';
import { moveSceneGroup } from './scene-selection.js';
import { AssetStore } from '../store.js';
import { rebaseJsonDraft } from '../safe-save.js';

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-scene-'));
  roots.push(root);
  const store = new AssetStore(root);
  const sheet = createSprite('tiles', 2, 1);
  sheet.sprites[0].layers[0].cells = [
    { ch: 'B', fg: 'white', bg: 'black' },
    { ch: 'B', fg: 'white', bg: 'black' },
  ];
  await store.saveSprite('tiles', sheet);
  await store.savePropDraft(
    'box',
    { ...createProp('box', { type: 'sprite', id: 'tiles', index: 0 }), depthOffset: 1 },
    null,
  );
  return { root, store };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('scene authoring', () => {
  it('adds character instances with independent facing and starting states, and loads their selected art', async () => {
    const { root, store } = await fixture();
    const left = createSprite('left-sprite', 1, 1);
    left.sprites[0].layers[0].cells[0] = { ch: 'L', fg: 'white', bg: 'black' };
    await store.saveSprite(left.id, left);
    const jump = createSprite('jump-sprite', 1, 1);
    jump.sprites[0].layers[0].cells[0] = { ch: 'J', fg: 'white', bg: 'black' };
    await store.saveSprite(jump.id, jump);
    for (const [id, sprite] of [
      ['stand', 'tiles'],
      ['look-left', left.id],
      ['jump', jump.id],
    ]) {
      const animation = createAnimation(id);
      animation.frames.push({ sprite, index: 0, durationMs: 100 });
      await store.saveAnimation(id, animation);
    }
    const character = createCharacter('hero', 'stand', 'The Hero');
    character.defaultFacing = 'left';
    character.animations['idle-left'] = 'look-left';
    character.customAnimations.jump = 'jump';
    await store.saveCharacterDraft('hero', character, null);
    const scene = createScene('cast');
    const first = addSceneCharacter(scene, character, 2, 1);
    const second = addSceneCharacter(scene, character, 3, 1);
    expect([first.id, second.id]).toEqual(['hero-1', 'hero-2']);
    expect(first).toMatchObject({ name: 'The Hero', facing: 'left', state: 'idle' });
    expect(second.name).toBe('The Hero');
    second.state = 'jump';
    second.facing = 'right';
    expect(parseScene(scene).ok).toBe(true);
    await store.saveSceneDraft(scene.id, scene, null);
    expect((await store.readScene(scene.id)).entities[1]).toMatchObject({
      name: 'The Hero',
      state: 'jump',
      facing: 'right',
    });
    const loaded = await loadScene(root, scene.id);
    const buffer = new CellBuffer(scene.width, scene.height, loaded.clear);
    loaded.draw(buffer, 0, 0);
    expect(buffer.get(2, 1).ch).toBe('L');
    expect(buffer.get(3, 1).ch).toBe('J');
    second.state = 'missing';
    expect(
      await dispatchAssetRequest(
        store,
        'PUT',
        '/api/scenes/cast',
        JSON.stringify({ doc: scene, base: await store.readScene('cast') }),
      ),
    ).toMatchObject({ status: 422 });
    second.state = 'idle';
    second.facing = 'diagonal' as typeof second.facing;
    expect(parseScene(scene).ok).toBe(false);
  });

  it('keeps a jointly moved character and prop after saving and reopening', async () => {
    const { store } = await fixture();
    const animation = createAnimation('stand');
    animation.frames.push({ sprite: 'tiles', index: 0, durationMs: 100 });
    await store.saveAnimation('stand', animation);
    const character = createCharacter('hero', 'stand');
    await store.saveCharacterDraft(character.id, character, null);
    const scene = createScene('paired');
    scene.entities.push({ id: 'box-1', type: 'Prop', prop: 'box', x: 10, y: 10, z: 0 });
    addSceneCharacter(scene, character, 12, 10);
    await store.saveSceneDraft(scene.id, scene, null);
    let base = await store.readScene(scene.id);
    let draft = structuredClone(base);
    const items = draft.entities.map((entry) => ({
      ref: { kind: 'entity' as const, id: entry.id },
      x: entry.x,
      y: entry.y,
      width: 1,
      height: 1,
    }));
    expect(moveSceneGroup(draft, items, 5, 3)).toBe(true);
    const sent = structuredClone(draft);
    const stored = await store.saveSceneDraft(scene.id, sent, base);
    expect(stored.entities.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 15, y: 13 },
      { x: 17, y: 13 },
    ]);
    const rebased = rebaseJsonDraft(sent, draft, stored);
    expect(rebased.ok).toBe(true);
    if (!rebased.ok) return;
    draft = rebased.value.draft;
    base = rebased.value.baseline;
    expect(draft).not.toBe(base);
    const nextItems = draft.entities.map((entry) => ({
      ref: { kind: 'entity' as const, id: entry.id },
      x: entry.x,
      y: entry.y,
      width: 1,
      height: 1,
    }));
    expect(moveSceneGroup(draft, nextItems, 4, 2)).toBe(true);
    expect(base.entities.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 15, y: 13 },
      { x: 17, y: 13 },
    ]);
    const second = await store.saveSceneDraft(scene.id, draft, base);
    expect(second.entities.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 19, y: 15 },
      { x: 21, y: 15 },
    ]);
    expect((await store.readScene(scene.id)).entities).toEqual(second.entities);
  });
  it('lists RPGScript trigger names for the scene inspector', async () => {
    const { store } = await fixture();
    await store.saveScript('first', '#door\n  action,open\n@open\n  +log("open")\n');
    await store.saveScript('second', '#floor\n  step,walk\n');
    const response = await dispatchAssetRequest(store, 'GET', '/api/rpg-triggers', '');
    expect(response.status).toBe(200);
    expect(JSON.parse(String(response.body))).toEqual({ names: ['door', 'floor'] });
  });

  it('persists independent Action and Step switches on a region', async () => {
    const scene = createScene('switches');
    scene.triggers.push({
      id: 'region-id',
      trigger: 'door',
      event: 'action',
      x: 3,
      y: 4,
      width: 5,
      height: 2,
      actionEnabled: false,
      stepEnabled: true,
      description: 'Inspect the door.',
    });
    expect(parseScene(scene)).toMatchObject({
      ok: true,
      value: {
        triggers: [{ actionEnabled: false, stepEnabled: true, description: 'Inspect the door.' }],
      },
    });
    const { store } = await fixture();
    await store.saveSceneDraft(scene.id, scene, null);
    expect((await store.readScene(scene.id)).triggers[0]).toMatchObject({
      id: 'region-id',
      trigger: 'door',
      actionEnabled: false,
      stepEnabled: true,
      description: 'Inspect the door.',
    });
    scene.triggers[0] = {
      ...(scene.triggers[0] as Exclude<(typeof scene.triggers)[number], string>),
      stepEnabled: 'yes' as unknown as boolean,
    };
    expect(parseScene(scene).ok).toBe(false);
  });

  it('defaults descriptions for older action regions and saves edits to the scene', async () => {
    const { store } = await fixture();
    const scene = createScene('described-room');
    scene.triggers.push({
      id: 'door',
      trigger: 'door',
      event: 'action',
      x: 1,
      y: 2,
      width: 3,
      height: 2,
    });
    await store.saveSceneDraft(scene.id, scene, null);
    const base = await store.readScene(scene.id);
    expect(base.triggers[0]).toMatchObject({ description: '' });
    const changed = structuredClone(base);
    const region = changed.triggers[0];
    if (typeof region === 'string') throw new Error('Expected a region');
    region.description = 'Opens the library door when used.';
    await store.saveSceneDraft(scene.id, changed, base);
    expect((await store.readScene(scene.id)).triggers[0]).toMatchObject({
      description: 'Opens the library door when used.',
    });
    region.description = 'x'.repeat(1001);
    expect(parseScene(changed).ok).toBe(false);
  });

  it('keeps a resized trigger after saving and reopening a scene', async () => {
    const { store } = await fixture();
    const scene = createScene('resize-room');
    scene.triggers.push({
      id: 'region-1',
      trigger: 'door',
      event: 'action',
      x: 46,
      y: 13,
      width: 2,
      height: 2,
      actionEnabled: true,
      stepEnabled: false,
    });
    await store.saveSceneDraft(scene.id, scene, null);
    const base = await store.readScene(scene.id);
    const changed = structuredClone(base);
    const region = changed.triggers[0];
    if (typeof region === 'string') throw new Error('Expected a region');
    region.width = 8;
    region.height = 5;
    const stored = await store.saveSceneDraft(scene.id, changed, base);
    expect(stored.triggers[0]).toMatchObject({ width: 8, height: 5 });
    expect((await store.readScene(scene.id)).triggers[0]).toMatchObject({ width: 8, height: 5 });
  });

  it('parses old scenes and rejects duplicate ids and out-of-bounds regions', () => {
    const scene = createScene('test');
    expect([scene.width, scene.height]).toEqual([120, 40]);
    scene.triggers = ['testRoomEntry'];
    expect(parseScene(scene).ok).toBe(true);
    scene.triggers.push({
      id: 'door',
      trigger: 'doorClick',
      event: 'action',
      x: 119,
      y: 39,
      width: 2,
      height: 1,
    });
    expect(parseScene(scene).ok).toBe(false);
    scene.triggers[1] = {
      id: 'door',
      trigger: 'doorClick',
      event: 'action',
      x: 118,
      y: 39,
      width: 2,
      height: 1,
    };
    expect(parseScene(scene).ok).toBe(true);
    scene.entities.push({ id: 'door', type: 'Background', sprite: 'tiles', index: 0, x: 0, y: 0 });
    expect(parseScene(scene).ok).toBe(false);
  });

  it('preserves per-instance prop names without changing stable ids', () => {
    const scene = createScene('named-room');
    scene.entities.push({
      id: 'chair-1',
      type: 'Prop',
      prop: 'chair',
      name: 'Reading chair',
      x: 2,
      y: 3,
      z: 0,
    });
    const parsed = parseScene(scene);
    expect(parsed.ok && parsed.value.entities[0]).toMatchObject({
      id: 'chair-1',
      name: 'Reading chair',
    });
    scene.entities[0] = { id: 'chair-1', type: 'Prop', prop: 'chair', name: ' ', x: 2, y: 3, z: 0 };
    expect(parseScene(scene).ok).toBe(false);
  });

  it('allows one scene-owned background, but not a second background', async () => {
    const scene = createScene('one-background');
    scene.entities.push({
      id: 'background-1',
      type: 'Background',
      sprite: 'tiles',
      index: 0,
      x: 0,
      y: 0,
    });
    expect(parseScene(scene).ok).toBe(true);
    scene.entities.push({
      id: 'background-2',
      type: 'Background',
      sprite: 'tiles',
      index: 0,
      x: 1,
      y: 1,
    });
    expect(parseScene(scene)).toMatchObject({
      ok: false,
      error: 'Scene can contain only one background',
    });
    const { root, store } = await fixture();
    await expect(store.saveSceneDraft(scene.id, scene, null)).rejects.toThrow(
      'only one background',
    );
    await fs.mkdir(path.join(root, 'scenes'), { recursive: true });
    await fs.writeFile(path.join(root, 'scenes', 'one-background.json'), JSON.stringify(scene));
    await expect(loadScene(root, scene.id)).rejects.toThrow('only one background');
  });

  it('saves, lists, merges, and loads backgrounds, reusable props and load triggers', async () => {
    const { root, store } = await fixture();
    const scene = createScene('room');
    scene.width = 4;
    scene.height = 2;
    scene.entities = [
      { id: 'wall', type: 'Background', sprite: 'tiles', index: 0, x: 0, y: 0 },
      { id: 'box-1', type: 'Prop', name: 'Storage box', prop: 'box', x: 1, y: 0, z: 0 },
    ];
    scene.triggers = [
      { id: 'arrival', trigger: 'testRoomEntry', event: 'load', x: 0, y: 0, width: 1, height: 1 },
    ];
    const put = (doc: unknown, base: unknown) =>
      dispatchAssetRequest(store, 'PUT', '/api/scenes/room', JSON.stringify({ doc, base }));
    expect((await put(scene, null)).status).toBe(200);
    expect(
      JSON.parse(String((await dispatchAssetRequest(store, 'GET', '/api/scenes', '')).body)),
    ).toEqual({ files: ['room'] });
    const changed = structuredClone(scene);
    changed.width = 5;
    expect((await put(changed, scene)).status).toBe(200);
    const elsewhere = structuredClone(scene);
    elsewhere.depthMode = 'regular-z';
    expect((await put(elsewhere, scene)).status).toBe(200);
    expect(await store.readScene('room')).toMatchObject({
      width: 5,
      depthMode: 'regular-z',
      entities: [expect.anything(), { name: 'Storage box' }],
    });
    const conflict = structuredClone(scene);
    conflict.width = 6;
    expect((await put(conflict, scene)).status).toBe(409);
    const missing = structuredClone(elsewhere);
    missing.entities[0] = {
      id: 'wall',
      type: 'Background',
      sprite: 'missing',
      index: 0,
      x: 0,
      y: 0,
    };
    expect((await put(missing, await store.readScene('room'))).status).toBe(404);
    const loaded = await loadScene(root, 'room');
    expect(loaded.triggers).toEqual(['testRoomEntry']);
    const buffer = new CellBuffer(5, 2, loaded.clear);
    loaded.draw(buffer, 0, 0);
    expect(buffer.get(0, 0)?.ch).toBe('B');
    expect(buffer.get(1, 0)?.ch).toBe('B');
    expect(loaded.entities).toHaveLength(2);
    expect(loaded.entities[0]).toBeInstanceOf(Background);
    if (!(loaded.entities[0] instanceof Background)) throw new Error('expected a background');
    expect(loaded.entities[0].sprite).toMatchObject({ width: 2, height: 1 });
    expect((await store.readScene('room')).entities[0]).toEqual({
      id: 'wall',
      type: 'Background',
      sprite: 'tiles',
      index: 0,
      x: 0,
      y: 0,
    });
    expect(await store.listProps()).toEqual(['box']);
    expect((await dispatchAssetRequest(store, 'DELETE', '/api/scenes/room', '')).status).toBe(200);
    expect(await store.listScenes()).toEqual([]);
  });

  it('draws backgrounds behind props regardless of world depth and skips action triggers on load', async () => {
    const { root, store } = await fixture();
    const front = createSprite('front-sprite', 1, 1);
    front.sprites[0].layers[0].cells[0] = { ch: 'P', fg: 'white', bg: 'black' };
    await store.saveSprite('front-sprite', front);
    const base = await store.readProp('box');
    await store.savePropDraft(
      'box',
      { ...base, visual: { type: 'sprite', id: 'front-sprite', index: 0 } },
      base,
    );
    const scene = createScene('overlap');
    scene.width = 2;
    scene.height = 1;
    scene.entities = [
      { id: 'front', type: 'Prop', prop: 'box', x: 0, y: 0, z: -1000 },
      { id: 'back', type: 'Background', sprite: 'tiles', index: 0, x: 0, y: 0 },
    ];
    scene.triggers = [
      { id: 'click', trigger: 'doorClick', event: 'action', x: 0, y: 0, width: 1, height: 1 },
    ];
    await store.saveSceneDraft('overlap', scene, null);
    const loaded = await loadScene(root, 'overlap');
    expect(loaded.triggers).toEqual([]);
    const buffer = new CellBuffer(2, 1, loaded.clear);
    loaded.draw(buffer, 0, 0);
    expect(buffer.get(0, 0).ch).toBe('P');
  });

  it('opens and resaves the legacy test-room sprite without converting it', async () => {
    const { root, store } = await fixture();
    await fs.copyFile(
      path.join('assets', 'sprites', 'crate.json'),
      path.join(root, 'sprites', 'crate.json'),
    );
    await fs.mkdir(path.join(root, 'scenes'), { recursive: true });
    await fs.copyFile(
      path.join('assets', 'scenes', 'test-room.json'),
      path.join(root, 'scenes', 'test-room.json'),
    );
    const original = await store.readScene('test-room');
    expect(original.entities[0]).toMatchObject({ id: 'crate', sprite: 'crate' });
    await store.saveSceneDraft('test-room', { ...original, width: 33 }, original);
    expect((await store.readScene('test-room')).width).toBe(33);
  });
});
