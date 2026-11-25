import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAnimation, createCharacter, createScene, createSprite } from '../../editor/schema.js';
import { addCharacterVariant } from '../../editor/characters/character-variants.js';
import { addSceneCharacter } from '../../editor/scenes/scene-characters.js';
import { AssetStore } from '../../editor/store.js';
import { Character } from '../character.js';
import { findCharacter } from '../character-movement.js';
import { CellBuffer } from '../cell-buffer.js';
import { loadCharacterByReference, loadScene } from '../load-scene.js';
import { getDialogueActorName, getDialoguePortrait, loadPortraitAssets } from '../portrait-assets.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { runRpgScriptSnippet } from '../scene-commands-shim.js';
import { Scene } from '../scene.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createVariantFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-variants-'));
  roots.push(root);
  const store = new AssetStore(root);
  for (const [id, size, ch] of [['small', 3, 's'], ['large', 5, 'L']] as const) {
    const sprite = createSprite(id, size, size);
    sprite.sprites[0].layers[0].cells = Array.from({ length: size * size }, () => ({
      ch, fg: 'white', bg: 'black',
    }));
    await store.saveSprite(id, sprite);
    const animation = createAnimation(id);
    animation.frames.push({ sprite: id, index: 0, durationMs: 100 });
    await store.saveAnimation(id, animation);
  }
  const character = {
    ...createCharacter('actor', 'small', 'Actor'),
    scriptName: 'Actor/A', defaultVariant: '3x3', speed: 100,
    portraits: [{ facing: 'right' as const, emotion: '', portrait: 'small_0' }],
  };
  character.customAnimations.wave = 'small';
  addCharacterVariant(character, '5x5');
  const large = character.variants?.['5x5'];
  if (!large) throw new Error('Missing variant');
  for (const key of Object.keys(large.animations) as (keyof typeof large.animations)[])
    large.animations[key] = 'large';
  large.customAnimations.wave = 'large';
  await store.saveCharacterDraft(character.id, character, null);
  const scene = createScene('room', undefined, 20, 16);
  const first = addSceneCharacter(scene, character, 1, 4);
  first.name = 'SmallActor';
  const second = addSceneCharacter(scene, character, 10, 4);
  second.name = 'LargeActor';
  second.variant = '5x5';
  second.state = 'wave';
  await store.saveSceneDraft(scene.id, scene, null);
  return { root, store, character, scene };
}

it('loads different visuals for instances of one identity and preserves variants through saves and clones', async () => {
  const { root, store, scene: document } = await createVariantFixture();
  expect((await store.readScene(document.id)).entities[1]).toMatchObject({ variant: '5x5' });
  const scene = await loadScene(root, document.id);
  const small = findCharacter(scene, 'SmallActor');
  const large = findCharacter(scene, 'LargeActor');
  expect(small).toMatchObject({ characterId: 'actor', scriptName: 'Actor/A', variant: '3x3' });
  expect(large).toMatchObject({ characterId: 'actor', scriptName: 'Actor/A', variant: '5x5', state: 'wave' });
  expect([small.sprite.width, large.sprite.width]).toEqual([3, 5]);
  const buffer = new CellBuffer(20, 16, scene.clear);
  scene.draw(buffer, 0, 0);
  expect(buffer.get(1, 4).ch).toBe('s');
  expect(buffer.get(10, 4).ch).toBe('L');
  const clone = large.clone();
  clone.setVariant('3x3');
  expect(clone.variant).toBe('3x3');
  expect(large.variant).toBe('5x5');
  expect(clone.bottomY).toBe(large.bottomY);
  expect(() => findCharacter(scene, 'Actor')).toThrow('ambiguous');
  expect(() => findCharacter(scene, 'actor')).toThrow('ambiguous');
  const control = new PlayerControl(scene, true);
  expect(() => control.setPlayerWalkCh('Actor')).toThrow('ambiguous');
  expect(scene.entities).toHaveLength(2);
});

it('switches through RPGScript without replacing the walker or losing its activity', async () => {
  const { root, scene: document } = await createVariantFixture();
  const scene = await loadScene(root, document.id);
  const actor = findCharacter(scene, 'SmallActor');
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('SmallActor');
  actor.speedMult = 2;
  actor.setBusy(true);
  actor.walkTo(scene, { x: 5, y: actor.bottomY });
  const before = actor.getActivity();
  const bottom = actor.bottomY;
  const runner = new ScriptRunner(parseRpgScript(
    '@start(variant)\n+setCharacterVariant(player, [variant])', 'variants.rpgscript', { commands },
  ), { commands, context: { scene, playerControl: control } });
  runner.start('start', ['5x5']);
  expect(control.playerWalkCh).toBe(actor);
  expect(actor).toMatchObject({ variant: '5x5', state: 'walk', speed: 100, speedMult: 2 });
  expect(actor.isBusy()).toBe(true);
  expect(actor.bottomY).toBe(bottom);
  expect(actor.getActivity().destination).toEqual(before.destination);
  scene.update(1000);
  expect(actor.x).toBe(5);
  expect(actor.isWalking()).toBe(false);
});

it('selects an existing walker and variant in one command, and keeps the variant when omitted', async () => {
  const { root, scene: document } = await createVariantFixture();
  const scene = await loadScene(root, document.id);
  const actor = findCharacter(scene, 'SmallActor');
  const bottom = actor.bottomY;
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('LargeActor');
  const runner = new ScriptRunner(parseRpgScript(
    '@start(who, variant)\n+setPlayerWalkCh([who], [variant])\n+setPlayerWalkCh(player)',
    'variants.rpgscript', { commands },
  ), { commands, context: { scene, playerControl: control } });
  runner.start('start', ['SmallActor', '5x5']);
  expect(control.playerWalkCh).toBe(actor);
  expect(actor.variant).toBe('5x5');
  expect(actor.bottomY).toBe(bottom);
  expect(scene.entities).toHaveLength(2);
  expect(() => control.setPlayerWalkCh('LargeActor', 'missing')).toThrow('has no variant missing');
  expect(control.playerWalkCh).toBe(actor);
});

it('spawns the requested NPC variant with its feet at the named marker before the next command', async () => {
  const { root } = await createVariantFixture();
  const scene = new Scene('room', 20, 16, 'bottom-up',
    { ch: ' ', fg: { r: 0, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } },
    [], [], new Set(), [], [], [{ id: 'door', name: 'Doorway', x: 4, y: 8 }],
    (reference) => loadCharacterByReference(root, reference));
  const control = new PlayerControl(scene);
  const runner = new ScriptRunner(parseRpgScript(
    '@start\n+spawnCh(Actor, 5x5, Doorway)\n+setFacing(Actor,left)', 'spawn.rpgscript', { commands },
  ), { commands, context: { scene, playerControl: control } });
  runner.start('start');
  await vi.waitFor(() => {
    runner.update();
    expect(scene.entities[0]).toMatchObject({ variant: '5x5', facing: 'left', x: 4, bottomY: 8 });
  });
  expect(control.playerWalkCh).toBeUndefined();
});

it('waits for the requested spawn variant before continuing and anchors its feet at the marker', async () => {
  const { root } = await createVariantFixture();
  const scene = new Scene('spawn-room', 20, 16, 'bottom-up',
    { ch: ' ', fg: { r: 0, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } },
    [], [], new Set(), [], [], [{ id: 'spawn', name: 'MarkerPlayer', x: 4, y: 8 }],
    (reference) => loadCharacterByReference(root, reference));
  const control = new PlayerControl(scene, true);
  const runner = new ScriptRunner(parseRpgScript(
    '@start\n+setPlayerWalkCh(Actor, 5x5)\n+setStorage(ready,true)',
    'variants.rpgscript', { commands },
  ), { commands, context: { scene, playerControl: control } });
  runner.start('start');
  expect(runner.getGlobal('ready')).toBeUndefined();
  await vi.waitFor(() => {
    runner.update();
    expect(runner.getGlobal('ready')).toBe(true);
  });
  expect(control.playerWalkCh).toMatchObject({ variant: '5x5', x: 4, y: 4 });
  expect(control.playerWalkCh?.bottomY).toBe(8);
  await control.setPlayerWalkCh('A');
  expect(control.playerWalkCh?.variant).toBe('5x5');
  expect(scene.entities).toHaveLength(1);
});

it('does not insert a spawned character when the requested variant is missing', async () => {
  const { root, scene: document } = await createVariantFixture();
  const loaded = await loadScene(root, document.id);
  const scene = new Scene('spawn-room', 20, 16, 'bottom-up', loaded.clear,
    [], [], new Set(), [], [], [{ id: 'spawn', name: 'MarkerPlayer', x: 4, y: 8 }],
    (reference) => loadCharacterByReference(root, reference));
  const control = new PlayerControl(scene, true);
  await expect(control.setPlayerWalkCh('Actor', 'missing')).rejects.toThrow('has no variant missing');
  expect(control.playerWalkCh).toBeUndefined();
  expect(scene.entities).toHaveLength(0);
});

it('loads script-spawned characters by shared aliases and uses the same portraits for every variant', async () => {
  const { root } = await createVariantFixture();
  const actor = await loadCharacterByReference(root, 'A');
  expect(actor).toBeInstanceOf(Character);
  expect(actor.variant).toBe('3x3');
  actor.setVariant('5x5');
  expect(actor.scriptName).toBe('Actor/A');
  const portraits = await loadPortraitAssets(root);
  expect(portraits.characters?.size).toBe(2);
  expect(getDialogueActorName(portraits, 'A')).toBe('Actor');
  expect(getDialoguePortrait(portraits, 'A')).toEqual(getDialoguePortrait(portraits, 'Actor'));
  expect(getDialoguePortrait(portraits, 'A')?.asset.width).toBe(3);
});

it('rejects missing variants and unsupported custom states without changing the character', async () => {
  const { root, store, character } = await createVariantFixture();
  const visual = character.variants?.['5x5'];
  if (!visual) throw new Error('Missing variant');
  delete visual.customAnimations.wave;
  await store.saveCharacterDraft(character.id, character, await store.readCharacter(character.id));
  const actor = await loadCharacterByReference(root, 'Actor');
  const original = { sprite: actor.sprite, clips: actor.clips, y: actor.y, variant: actor.variant };
  expect(() => actor.setVariant('missing')).toThrow('has no variant missing');
  actor.state = 'wave';
  expect(() => actor.setVariant('5x5')).toThrow('has no state wave');
  expect(actor).toMatchObject(original);
});

it('rejects invalid scene references and checks animation references in all variants', async () => {
  const { root, store, character, scene } = await createVariantFixture();
  const base = await store.readScene(scene.id);
  const entry = scene.entities[0];
  if (entry.type !== 'Character') throw new Error('Missing character instance');
  entry.variant = 'missing';
  await expect(store.saveSceneDraft(scene.id, scene, base)).rejects.toThrow('has no variant missing');
  await fs.writeFile(path.join(root, 'scenes', `${scene.id}.json`), JSON.stringify(scene));
  await expect(loadScene(root, scene.id)).rejects.toThrow('has no character variant missing');
  const visual = character.variants?.['5x5'];
  if (!visual) throw new Error('Missing variant');
  visual.animations['walk-left'] = 'missing-animation';
  await expect(store.saveCharacterDraft(character.id, character, await store.readCharacter(character.id)))
    .rejects.toThrow('missing animation "missing-animation"');
});

it('validates variant commands in scene-free scripts', async () => {
  const io = { writeLine: () => {}, promptChoice: async () => 0 };
  const scripts = parseRpgScript('', 'empty.rpgscript', { commands });
  const runner = await runRpgScriptSnippet(scripts, '+setCharacterVariant(Actor, 5x5)', io);
  expect(runner.isIdle()).toBe(true);
  await expect(runRpgScriptSnippet(scripts, '+setCharacterVariant(Actor, 42)', io))
    .rejects.toThrow('requires a variant name');
  await expect(runRpgScriptSnippet(scripts, '+setCharacterVariant(42, 5x5)', io))
    .rejects.toThrow('requires a character id or instance name');
  const selected = await runRpgScriptSnippet(scripts, '+setPlayerWalkCh(Actor, 5x5)', io);
  expect(selected.isIdle()).toBe(true);
  await expect(runRpgScriptSnippet(scripts, '+setPlayerWalkCh(Actor, 42)', io))
    .rejects.toThrow('setPlayerWalkCh requires a variant name');
  await expect(runRpgScriptSnippet(scripts, '+setPlayerWalkCh(Actor, 5x5, extra)', io))
    .rejects.toThrow();
});
