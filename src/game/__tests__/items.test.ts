import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAnimation, createScene, createSprite } from '../../editor/schema.js';
import { createItem } from '../../editor/items/item-schema.js';
import { AnimatedProp } from '../animated-prop.js';
import { Character } from '../character.js';
import {
  getInventoryEntries,
  getItemAsset,
  getItemCombinationScript,
  hasInventoryItem,
  WorldItem,
} from '../items.js';
import { loadScene } from '../load-scene.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { PlayerControl } from '../player-control.js';
import { renderView } from '../scene.js';
import { createItemScene } from './item-fixture.js';

const source = `@add
+addItem(OfficeKey)
+acquireItem(key)
+?func(hasItem, OfficeKey):+setStorage(owned, true)
@remove
+removeItem(OfficeKey)
@inspect
+examineItem(OfficeKey)
@combine(kind, target)
+combineItem(OfficeKey, [kind], [target])
@examineKey
+setStorage(examined, true)
@combineCoin
+removeItem(key)
+setStorage(combined, coin)
@unlockDoor
+setStorage(combined, lock)
@giveKey
+setStorage(combined, guard)
@failKey
+setStorage(failed, true)
@unknown
+addItem(missing)
`;

function createItemRunner() {
  const scene = createItemScene();
  const runner = new ScriptRunner(parseRpgScript(source, 'items.rpgscript', { commands }), {
    commands,
    context: { scene, playerControl: new PlayerControl(scene) },
    hasItem: (inventory, reference) => hasInventoryItem(inventory, scene.itemAssets, reference),
  });
  return { scene, runner };
}

describe('item assets and inventory', () => {
  it('checks canonical inventory references even without a host alias resolver', () => {
    const scene = createItemScene();
    const library = parseRpgScript(
      '@check\n+?func(hasItem, key):+setStorage(owned, true)',
      'check.rpgscript',
      { commands },
    );
    const runner = new ScriptRunner(library, {
      commands,
      context: { scene, playerControl: new PlayerControl(scene) },
    });
    runner.setGlobal('vars.inventory', [{ itemId: 'key' }]);
    runner.start('check');
    expect(runner.getGlobal('owned')).toBe(true);
  });

  it('resolves script names, keeps canonical unique references, removes world items, and isolates players', () => {
    const { scene, runner } = createItemRunner();
    const other = createItemRunner();
    runner.start('add');
    expect(runner.getGlobal('vars.inventory')).toEqual([{ itemId: 'key' }]);
    expect(runner.getGlobal('vars.acquiredItems')).toEqual(['key']);
    expect(runner.getGlobal('owned')).toBe(true);
    expect(runner.getStorage('vars.inventory')).toBeUndefined();
    expect(runner.getStorage('vars.acquiredItems')).toBeUndefined();
    expect(
      scene.entities.some(
        (entity) => entity instanceof WorldItem && entity.asset.definition.id === 'key',
      ),
    ).toBe(false);
    expect(other.scene.entities).toHaveLength(2);
    expect(other.runner.getGlobal('vars.inventory')).toBeUndefined();
    runner.start('remove');
    expect(runner.getGlobal('vars.inventory')).toEqual([]);
    expect(() => runner.start('unknown')).toThrow('Unknown item missing');
  });

  it('migrates legacy inventory names without duplicating or copying item definitions', () => {
    const { scene, runner } = createItemRunner();
    runner.setGlobal('vars.inventory', ['OfficeKey', 'key', 'coin']);
    expect(
      hasInventoryItem(runner.getGlobal('vars.inventory'), scene.itemAssets, 'OfficeKey'),
    ).toBe(true);
    runner.start('add');
    expect(runner.getGlobal('vars.inventory')).toEqual([{ itemId: 'key' }, { itemId: 'coin' }]);
    expect(() => getInventoryEntries([3], scene.itemAssets)).toThrow(
      'Invalid inventory item reference',
    );
    expect(() => getInventoryEntries(['deleted'], scene.itemAssets)).toThrow(
      'Unknown item deleted',
    );
    expect(() => getItemAsset(scene.itemAssets, '../key')).toThrow('Unknown item');
  });

  it('examines available items, combines against world items, and lets scripts consume ingredients', () => {
    const { runner } = createItemRunner();
    runner.start('inspect'); // World item need not be owned to examine it.
    expect(runner.getGlobal('examined')).toBe(true);
    expect(() => runner.start('combine', ['item', 'coin'])).toThrow('requires an owned item');
    runner.start('add');
    runner.start('combine', ['item', 'coin']);
    expect(runner.getGlobal('combined')).toBe('coin');
    expect(runner.getGlobal('vars.inventory')).toEqual([]);
    expect(() => runner.start('inspect')).toThrow('not available');
  });

  it('matches prop and character asset IDs through scene instance references and falls back on failure', () => {
    const { scene, runner } = createItemRunner();
    const asset = getItemAsset(scene.itemAssets, 'key');
    scene.entities.push(
      new AnimatedProp(
        'door-1',
        6,
        2,
        0,
        0,
        asset.sprite,
        new Map([['default', asset.clip]]),
        'default',
        'OfficeDoor',
        'lock',
      ),
      new Character('guard-1', 8, 2, 0, asset.sprite, 'guard', 'Gatekeeper', 'idle', 'down'),
      new Character('stranger-1', 10, 2, 0, asset.sprite, 'stranger', 'Stranger', 'idle', 'down'),
    );
    runner.start('add');
    runner.start('combine', ['prop', 'OfficeDoor']);
    expect(runner.getGlobal('combined')).toBe('lock');
    runner.start('combine', ['character', 'Gatekeeper']);
    expect(runner.getGlobal('combined')).toBe('guard');
    runner.start('combine', ['character', 'Stranger']);
    expect(runner.getGlobal('failed')).toBe(true);
    expect(runner.getGlobal('vars.inventory')).toEqual([{ itemId: 'key' }]);
    expect(() => runner.start('combine', ['prop', 'missing'])).toThrow('no prop missing');
  });

  it('uses symmetric item recipes, selected-item precedence, and source failure scripts', () => {
    const { scene } = createItemRunner();
    const key = getItemAsset(scene.itemAssets, 'key').definition;
    const coin = getItemAsset(scene.itemAssets, 'coin').definition;
    expect(
      getItemCombinationScript(scene.itemAssets, coin, { targetType: 'item', target: 'key' }),
    ).toBe('combineCoin');
    coin.combinations.push({ targetType: 'item', target: 'key', script: 'coinFirst' });
    expect(
      getItemCombinationScript(scene.itemAssets, coin, { targetType: 'item', target: 'key' }),
    ).toBe('coinFirst');
    expect(
      getItemCombinationScript(scene.itemAssets, key, { targetType: 'prop', target: 'other' }),
    ).toBe('failKey');
  });

  it('loads static and animated world items with independent clocks and no blocked cells', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-items-'));
    try {
      async function writeAsset(folder: string, id: string, value: unknown): Promise<void> {
        await fs.mkdir(path.join(root, folder), { recursive: true });
        await fs.writeFile(path.join(root, folder, `${id}.json`), `${JSON.stringify(value)}\n`);
      }
      const sprite = createSprite('art', 1, 1);
      sprite.sprites[0].layers[0].cells[0] = { ch: 'K', fg: 'white', bg: 'black' };
      await writeAsset('sprites', sprite.id, sprite);
      const clip = createAnimation('blink');
      clip.frames = [
        { sprite: 'art', index: 0, durationMs: 50 },
        { invisible: true, durationMs: 50 },
      ];
      await writeAsset('animations', clip.id, clip);
      await writeAsset('items', 'key', createItem('key', { type: 'sprite', id: 'art', index: 0 }));
      await writeAsset('items', 'coin', createItem('coin', { type: 'animation', id: 'blink' }));
      const doc = createScene('room', undefined, 4, 2);
      doc.entities = [
        { type: 'Item', id: 'key-1', item: 'key', x: 0, y: 0, z: 0, depthOffset: 0 },
        { type: 'Item', id: 'coin-1', item: 'coin', x: 1, y: 0, z: 0, depthOffset: 0 },
      ];
      await writeAsset('scenes', doc.id, doc);
      const scene = await loadScene(root, 'room');
      expect(scene.itemAssets.size).toBe(2);
      expect(scene.blockedCells.size).toBe(0);
      expect(renderView(scene, 4, 2).get(1, 0).ch).toBe('K');
      const item = scene.entities[1];
      if (!(item instanceof WorldItem)) throw new Error('Expected world item');
      const copy = item.clone();
      item.update(60);
      expect(copy).toBeInstanceOf(WorldItem);
      expect(renderView(scene, 4, 2).get(1, 0).ch).toBe(' ');
      scene.entities[1] = copy;
      expect(renderView(scene, 4, 2).get(1, 0).ch).toBe('K');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
