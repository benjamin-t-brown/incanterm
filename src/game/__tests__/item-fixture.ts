import { createItem } from '../../editor/items/item-schema.js';
import { WorldItem, type ItemAsset } from '../items.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

export const ITEM_INK = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

export function createItemAsset(id: string, glyph = '*'): ItemAsset {
  const definition = createItem(
    id,
    { type: 'sprite', id: `${id}-art`, index: 0 },
    id.toUpperCase(),
  );
  const sprite = new Sprite(`${id}-art`, 1, 1, 0, 0, [{ ...ITEM_INK, ch: glyph }]);
  return { definition, sprite, clip: { frames: [{ sprite, durationMs: 100 }], loop: true } };
}

export function createItemScene(): Scene {
  const key = createItemAsset('key', 'K');
  key.definition.scriptName = 'OfficeKey';
  key.definition.examineScript = 'examineKey';
  key.definition.combineFailScript = 'failKey';
  key.definition.combinations = [
    { targetType: 'item', target: 'coin', script: 'combineCoin' },
    { targetType: 'prop', target: 'lock', script: 'unlockDoor' },
    { targetType: 'character', target: 'guard', script: 'giveKey' },
  ];
  const coin = createItemAsset('coin', '$');
  const assets = new Map([
    ['key', key],
    ['coin', coin],
  ]);
  return new Scene(
    'items',
    120,
    40,
    'regular-z',
    ITEM_INK,
    [new WorldItem('world-key', 2, 2, 0, 0, key), new WorldItem('world-coin', 4, 2, 0, 0, coin)],
    [],
    new Set(),
    [],
    [],
    [],
    undefined,
    assets,
  );
}
